import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import crypto from 'crypto';
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

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (buffer.length < 5 || buffer.subarray(0, 5).toString('utf8') !== '%PDF-') {
      return NextResponse.json({ error: 'Invalid PDF file. Please upload a valid PDF.' }, { status: 400 });
    }

    db = new Database(dbPath);
    ensureUploadSchema(db);

    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const duplicateJob = db.prepare(`
      SELECT id, trip_number, created_at
      FROM upload_jobs
      WHERE user_id = ? AND content_hash = ? AND status IN ('processing', 'done')
      ORDER BY id DESC
      LIMIT 1
    `).get(access.session.userId, contentHash) as { id: number; trip_number?: string; created_at: string } | undefined;

    if (duplicateJob) {
      return NextResponse.json(
        {
          error: duplicateJob.trip_number
            ? `Duplicate upload detected. This PDF was already processed as trip ${duplicateJob.trip_number}.`
            : 'Duplicate upload detected. This PDF was already submitted recently.',
        },
        { status: 409 }
      );
    }

    const uploadDir = join(process.cwd(), 'public', 'itineraries');
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);
    const relativePath = `/itineraries/${filename}`;

    const inserted = db.prepare(`
      INSERT INTO upload_jobs (user_id, original_filename, stored_path, mime_type, size_bytes, content_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'queued')
    `).run(access.session.userId, file.name, relativePath, file.type || 'application/pdf', file.size || buffer.length, contentHash);
    jobId = Number(inserted.lastInsertRowid);

    db.prepare("UPDATE upload_jobs SET status = 'processing', updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(jobId, access.session.userId);

    const rawText = await extractTextFromPdf(buffer);
    const parsed = parseDriverItinerary(rawText);

    if (!parsed.hasDetectedTripNumber) {
      throw new Error('Could not detect trip number in PDF. Please verify the document format.');
    }

    if (!parsed.tripNumber || !/^T\d{4,}/i.test(parsed.tripNumber)) {
      throw new Error('Parsed trip number is invalid. Please upload a valid itinerary PDF.');
    }

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

    const message = String(error?.message || 'Upload processing failed');
    const status =
      message.toLowerCase().includes('duplicate upload') ? 409 :
      message.toLowerCase().includes('invalid pdf') ||
      message.toLowerCase().includes('trip number') ||
      message.toLowerCase().includes('document format')
        ? 400
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
