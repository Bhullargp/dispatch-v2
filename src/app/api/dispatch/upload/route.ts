import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { ensureUploadSchema, extractTextFromPdf, mergeTripAndStops, parseDriverItinerary } from '@/lib/pdf-processing';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function GET(req: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const db = new Database(dbPath);
    ensureUploadSchema(db);

    const jobs = db.prepare(`
      SELECT id, original_filename, status, trip_number, error_message, created_at, updated_at, processed_at
      FROM upload_jobs
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 8
    `).all(access.session.userId);

    return NextResponse.json({ jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let db: Database.Database | null = null;
  let jobId: number | null = null;
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.pdf')) return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });

    db = new Database(dbPath);
    ensureUploadSchema(db);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = join(process.cwd(), 'public', 'itineraries');
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);
    const relativePath = `/itineraries/${filename}`;

    const inserted = db.prepare(`
      INSERT INTO upload_jobs (user_id, original_filename, stored_path, mime_type, size_bytes, status)
      VALUES (?, ?, ?, ?, ?, 'queued')
    `).run(access.session.userId, file.name, relativePath, file.type || 'application/pdf', file.size || buffer.length);
    jobId = Number(inserted.lastInsertRowid);

    db.prepare("UPDATE upload_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(jobId, access.session.userId);

    const rawText = await extractTextFromPdf(buffer);
    const parsed = parseDriverItinerary(rawText);

    const tx = db.transaction(() => {
      const tripNumber = mergeTripAndStops(db!, access.session.userId, parsed, relativePath);
      db!.prepare(`
        UPDATE upload_jobs
        SET status = 'done', trip_number = ?, updated_at = datetime('now'), processed_at = datetime('now')
        WHERE id = ? AND user_id = ?
      `).run(tripNumber, jobId, access.session.userId);
      return tripNumber;
    });

    const tripNumber = tx();

    return NextResponse.json({
      success: true,
      jobId,
      tripNumber,
      path: relativePath,
      placeholders: parsed.placeholders,
    });
  } catch (error: any) {
    if (db && jobId) {
      db.prepare(`
        UPDATE upload_jobs
        SET status = 'failed', error_message = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(error.message || 'Upload processing failed', jobId);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
