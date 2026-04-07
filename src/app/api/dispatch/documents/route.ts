import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { uploadFileToR2, deleteFileFromR2, listUserFiles, isR2Configured } from '@/lib/r2-storage';
import crypto from 'crypto';

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

    if (!file) {
      return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    }

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

    // Upload to R2 with per-user isolation
    const r2Result = await uploadFileToR2({
      userId: access.session.userId,
      file: buffer,
      filename: file.name,
      contentType: file.type,
    });

    // Store document metadata in database
    const database = db();

    // Ensure documents table exists
    await database.run(`
      CREATE TABLE IF NOT EXISTS user_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        description TEXT,
        trip_number TEXT,
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await database.run(`
      INSERT INTO user_documents (user_id, file_key, original_filename, file_type, file_size, description, trip_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [access.session.userId, r2Result.key, file.name, file.type, file.size, description, tripNumber]);

    return NextResponse.json({
      success: true,
      file: {
        key: r2Result.key,
        url: r2Result.url,
        originalFilename: file.name,
        fileType: file.type,
        fileSize: file.size,
        description,
        tripNumber,
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
    await database.run(`
      DELETE FROM user_documents
      WHERE user_id = $1 AND file_key = $2
    `, [access.session.userId, key]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}