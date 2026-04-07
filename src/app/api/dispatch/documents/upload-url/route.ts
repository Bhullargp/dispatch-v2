import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { generateUploadUrl, isR2Configured } from '@/lib/r2-storage';

// Generate a presigned URL for direct browser-to-R2 upload
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

    const body = await req.json();
    const { filename, contentType } = body;

    if (!filename || !contentType) {
      return NextResponse.json(
        { error: 'Missing filename or contentType' },
        { status: 400 }
      );
    }

    // File size limit: 50MB
    const MAX_FILE_SIZE = 50 * 1024 * 1024;
    if (body.fileSize && body.fileSize > MAX_FILE_SIZE) {
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

    if (!ALLOWED_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: 'Invalid file type. Only PDF and images (JPEG, PNG, WebP, HEIC) are supported.' },
        { status: 400 }
      );
    }

    // Generate presigned URL (valid for 1 hour)
    const { uploadUrl, key } = await generateUploadUrl({
      userId: access.session.userId,
      filename,
      contentType,
      expiresIn: 3600, // 1 hour
    });

    return NextResponse.json({
      uploadUrl,
      key,
      expiresIn: 3600,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}