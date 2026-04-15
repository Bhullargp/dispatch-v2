import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

const RECEIPTS_DIR = path.resolve(process.cwd(), 'receipts');

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { searchParams } = new URL(request.url);
    const sourcePath = searchParams.get('path');
    if (!sourcePath) {
      return NextResponse.json({ error: 'Missing path' }, { status: 400 });
    }

    const resolvedPath = path.resolve(sourcePath);
    if (!resolvedPath.startsWith(RECEIPTS_DIR)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const file = await fs.readFile(resolvedPath);
    return new NextResponse(file, {
      headers: {
        'Content-Type': contentTypeFor(resolvedPath),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
