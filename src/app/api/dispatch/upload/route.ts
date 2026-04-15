import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import crypto from 'crypto';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { claimUploadJobById, processClaimedUploadJob } from '@/lib/pdf-processing';

export async function GET(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const url = new URL(req.url);
    const tripNumber = url.searchParams.get('trip_number');

    let jobs;
    if (tripNumber) {
      jobs = await db().query(`
        SELECT id, original_filename, status, trip_number, stored_path, error_message, attempt_count, max_attempts, created_at, updated_at, processed_at
        FROM upload_jobs
        WHERE user_id = $1 AND trip_number = $2 AND status = 'done'
        ORDER BY id DESC
      `, [access.session.userId, tripNumber]);
    } else {
      jobs = await db().query(`
        SELECT id, original_filename, status, trip_number, error_message, attempt_count, max_attempts, created_at, updated_at, processed_at
        FROM upload_jobs
        WHERE user_id = $1
        ORDER BY id DESC
        LIMIT 8
      `, [access.session.userId]);
    }

    return NextResponse.json({ jobs });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let jobId: number | null = null;

  try {
    await ensureDispatchAuthSchemaAndSeed();
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

    // Hash still used for job lookup, but no duplicate block — Boss said re-uploads always have updated info.
    const contentHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const uploadDir = join(process.cwd(), 'public', 'itineraries');
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, buffer);
    const relativePath = `/itineraries/${filename}`;

    const inserted = await db().run(`
      INSERT INTO upload_jobs (user_id, original_filename, stored_path, mime_type, size_bytes, content_hash, status, max_attempts)
      VALUES ($1, $2, $3, $4, $5, $6, 'queued', 3)
    `, [access.session.userId, file.name, relativePath, file.type || 'application/pdf', file.size || buffer.length, contentHash]);
    jobId = inserted.changes;

    // Try to get the actual inserted ID
    const insertedJob = await db().get(
      'SELECT id FROM upload_jobs WHERE user_id = $1 AND content_hash = $2 ORDER BY id DESC LIMIT 1',
      [access.session.userId, contentHash]
    ) as { id: number } | undefined;
    if (insertedJob) jobId = insertedJob.id;

    const claimed = await claimUploadJobById(jobId!, `inline-${process.pid}`);
    if (!claimed) {
      return NextResponse.json({ success: true, queued: true, jobId, message: 'Upload queued for background processing.' }, { status: 202 });
    }

    const result = await processClaimedUploadJob(claimed);

    if (!result.ok) {
      const status = result.retryable ? 202 : 400;
      return NextResponse.json(
        {
          success: false,
          queued: result.retryable,
          jobId,
          error: result.error,
          message: result.retryable ? 'Queued for retry in background.' : result.error,
        },
        { status }
      );
    }

    const row = await db().get('SELECT trip_number FROM upload_jobs WHERE id = $1', [jobId]) as { trip_number: string } | undefined;

    return NextResponse.json({
      success: true,
      queued: false,
      jobId,
      tripNumber: row?.trip_number,
      path: relativePath,
    });
  } catch (error: any) {
    if (jobId) {
      try {
        await db().run(`
          UPDATE upload_jobs
          SET status = 'failed', error_message = $1, updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'), last_error_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
          WHERE id = $2
        `, [error.message || 'Upload processing failed', jobId]);
      } catch {}
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
