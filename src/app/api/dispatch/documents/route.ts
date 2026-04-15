import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { uploadFileToR2, deleteFileFromR2, listUserFiles, isR2Configured } from '@/lib/r2-storage';
import { ensureUserDocumentsTable } from '@/lib/dispatch-documents';

// GET - List user's documents
export async function GET(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Document storage is not configured. Please set R2 environment variables.' },
        { status: 503 }
      );
    }

    const files = await listUserFiles({ userId: access.session.userId });

    return NextResponse.json({ files });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Upload a document
export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Document storage is not configured. Please set R2 environment variables.' },
        { status: 503 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const description = formData.get('description') as string | null;
    const tripNumber = formData.get('tripNumber') as string | null;
    const sourcePath = formData.get('sourcePath') as string | null;

    if (!file && !sourcePath) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

    const database = db();
    await ensureUserDocumentsTable();

    let storedFile = null as null | { key: string; url: string; originalFilename: string; fileType: string; fileSize: number; sourcePath?: string | null };

    if (file) {
      // File size limit: 50MB
      const MAX_FILE_SIZE = 50 * 1024 * 1024;
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: 'File size exceeds 50MB limit' },
          { status: 400 }
        );
      }

      // Allowed file types
      const ALLOWED_TYPES = [
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/jpg',
        'image/webp',
        'image/heic',
        'image/heif',
      ];

      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json(
          { error: 'Invalid file type. Only PDF and images (JPEG, PNG, WebP, HEIC) are supported.' },
          { status: 400 }
        );
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const r2Result = await uploadFileToR2({
        userId: access.session.userId,
        file: buffer,
        filename: file.name,
        contentType: file.type,
      });

      storedFile = {
        key: r2Result.key,
        url: r2Result.url,
        originalFilename: file.name,
        fileType: file.type,
        fileSize: file.size,
      };
    } else if (sourcePath) {
      storedFile = {
        key: sourcePath,
        url: sourcePath,
        originalFilename: sourcePath.split('/').pop() || 'receipt',
        fileType: 'image/jpeg',
        fileSize: 0,
        sourcePath,
      };
    }

    await database.run(`
      INSERT INTO user_documents (user_id, s3_key, filename, file_type, file_size, description, trip_number, source_path)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
      access.session.userId,
      storedFile?.key,
      storedFile?.originalFilename,
      storedFile?.fileType,
      storedFile?.fileSize,
      description,
      tripNumber,
      storedFile?.sourcePath || null,
    ]);

    return NextResponse.json({
      success: true,
      file: {
        key: storedFile?.key,
        url: storedFile?.url,
        originalFilename: storedFile?.originalFilename,
        fileType: storedFile?.fileType,
        fileSize: storedFile?.fileSize,
        description,
        tripNumber,
        sourcePath: storedFile?.sourcePath || null,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE - Delete a document
export async function DELETE(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Document storage is not configured' },
        { status: 503 }
      );
    }

    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'Missing file key' }, { status: 400 });
    }

    // Delete from R2
    await deleteFileFromR2({ userId: access.session.userId, key });

    // Delete from database
    const database = db();
    await ensureUserDocumentsTable();
    await database.run(`
      DELETE FROM user_documents
      WHERE user_id = $1 AND s3_key = $2
    `, [access.session.userId, key]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}