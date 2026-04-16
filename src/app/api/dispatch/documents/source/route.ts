import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getDocumentSourceFileType, resolveDocumentSourcePath } from '@/lib/dispatch-documents';
import { requireAccess } from '@/lib/ownership';

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

    const resolvedPath = resolveDocumentSourcePath(sourcePath);
    const file = await fs.readFile(resolvedPath);
    return new NextResponse(file, {
      headers: {
        'Content-Type': getDocumentSourceFileType(resolvedPath),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
