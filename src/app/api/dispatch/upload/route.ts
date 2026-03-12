import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

async function extractTextFromPdf(_buffer: Buffer): Promise<string> {
  return '--- Extracted PDF Content ---';
}

export async function POST(req: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const tripNumber = formData.get('tripNumber') as string;
    if (!file || !tripNumber) return NextResponse.json({ error: 'Missing file or tripNumber' }, { status: 400 });

    const dbPath = path.resolve(process.cwd(), 'dispatch.db');
    const db = new Database(dbPath);
    if (!ensureTripOwnership(db, access, tripNumber)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'itineraries');
    await mkdir(uploadDir, { recursive: true });

    const filename = `${tripNumber}_${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const relativePath = `/itineraries/${filename}`;
    const rawPdfData = await extractTextFromPdf(buffer);

    const result = db.prepare('UPDATE trips SET pdf_path = ?, raw_data = ? WHERE trip_number = ? AND (? OR user_id = ?)')
      .run(relativePath, rawPdfData, tripNumber, access.adminMode ? 1 : 0, access.session.userId);
    if (!result.changes) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    return NextResponse.json({ success: true, path: relativePath });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
