import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { getFileFromR2, generateDownloadUrl, isR2Configured } from '@/lib/r2-storage';

// GET - Download a document
export async function GET(
  req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
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

    const { key: keyParts } = await params;
    const key = keyParts.join('/');

    // Security: Ensure the key belongs to the user
    if (!key.startsWith(`documents/${access.session.userId}/`)) {
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    // Check if redirecting to a presigned URL is preferred
    const url = new URL(req.url);
    const redirect = url.searchParams.get('redirect');

    if (redirect === 'true') {
      // Generate a presigned URL and redirect
      const downloadUrl = await generateDownloadUrl({
        userId: access.session.userId,
        key,
        expiresIn: 3600, // 1 hour
      });

      return NextResponse.redirect(downloadUrl);
    }

    // Otherwise, stream the file directly
    const { stream, contentType } = await getFileFromR2({
      userId: access.session.userId,
      key,
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=86400', // 1 day
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}