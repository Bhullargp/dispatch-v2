import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';

const execFileAsync = promisify(execFile);

export type ParsedStop = {
  stop_type: string;
  location: string;
  miles_from_last: number;
  date: string | null;
  event_index: number;
};

export type ParsedTrip = {
  tripNumber: string;
  startDate: string | null;
  endDate: string | null;
  totalMiles: number;
  route: string;
  rawText: string;
  notes: string;
  stops: ParsedStop[];
  placeholders: string[];
  hasDetectedTripNumber: boolean;
};

export function ensureUploadSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      original_filename TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      trip_number TEXT,
      error_message TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      cancel_requested INTEGER NOT NULL DEFAULT 0,
      started_at TEXT,
      last_error_at TEXT,
      processing_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      processed_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_upload_jobs_user_status ON upload_jobs(user_id, status, created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_worker_lock (
      lock_name TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const cols = db.prepare('PRAGMA table_info(upload_jobs)').all() as Array<{ name: string }>;
  const requiredColumns: Array<[string, string]> = [
    ['content_hash', 'TEXT'],
    ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['max_attempts', 'INTEGER NOT NULL DEFAULT 3'],
    ['cancel_requested', 'INTEGER NOT NULL DEFAULT 0'],
    ['started_at', 'TEXT'],
    ['last_error_at', 'TEXT'],
    ['processing_by', 'TEXT'],
  ];

  for (const [name, definition] of requiredColumns) {
    if (!cols.some((c) => c.name === name)) {
      db.exec(`ALTER TABLE upload_jobs ADD COLUMN ${name} ${definition}`);
    }
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_upload_jobs_user_hash ON upload_jobs(user_id, content_hash, created_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_upload_jobs_status_id ON upload_jobs(status, id)');
}

function monthToNumber(month: string): number {
  const m = month.slice(0, 3).toLowerCase();
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return map[m] || 1;
}

function fmtDate(year: number, month: string, day: string): string {
  const mm = String(monthToNumber(month)).padStart(2, '0');
  const dd = String(parseInt(day, 10)).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseDateFromLine(line: string, fallbackYear: number): string | null {
  const m = line.match(/(?:MON|TUE|WED|THU|FRI|SAT|SUN)?\s*,?\s*([A-Z][a-z]{2})\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
  if (!m) return null;

  const year = Number(m[3] || fallbackYear);
  const monthNum = monthToNumber(m[1]);
  const dayNum = Number(m[2]);
  const candidate = new Date(Date.UTC(year, monthNum - 1, dayNum));

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== monthNum - 1 ||
    candidate.getUTCDate() !== dayNum
  ) {
    return null;
  }

  return fmtDate(year, m[1], m[2]);
}

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'dispatch-pdf-'));
  const input = join(tmp, 'input.pdf');
  const output = join(tmp, 'output.txt');
  try {
    await writeFile(input, buffer);
    await execFileAsync('pdftotext', ['-layout', input, output]);
    const text = await readFile(output, 'utf8');
    if (text.trim()) return text;
  } catch {
    // fallback below
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return buffer.toString('utf8');
}

export function parseDriverItinerary(text: string): ParsedTrip {
  const tripMatch = text.match(/Trip Itinerary\s+(T\d{4,})/i) || text.match(/Driver Trip Itinerary\s+(T\d{4,})/i);
  const hasDetectedTripNumber = Boolean(tripMatch?.[1]);
  const tripNumber = tripMatch?.[1]?.toUpperCase() || `T${Date.now().toString().slice(-6)}`;

  const startMatch = text.match(/Start Date:\s*(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/i);
  const startDate = startMatch ? fmtDate(Number(startMatch[3]), startMatch[1], startMatch[2]) : null;
  const baseYear = startMatch ? Number(startMatch[3]) : new Date().getFullYear();

  const milesMatch = text.match(/TOTAL ROUTED MILES\s*:\s*([\d,]+(?:\.\d+)?)/i);
  const totalMiles = milesMatch ? Number(milesMatch[1].replace(/,/g, '')) : 0;

  const eventRegex = /(ACQUIRE|RELEASE|HOOK|DROP|PICKUP|DELIVER|BORDER CROSSING)\s*\(([^)]+)\)([\s\S]*?)(?=(?:\n(?:ACQUIRE|RELEASE|HOOK|DROP|PICKUP|DELIVER|BORDER CROSSING)\s*\()|$)/gi;
  const stops: ParsedStop[] = [];

  let match: RegExpExecArray | null;
  let currentDate = startDate;
  let lastPickupDate = startDate;

  while ((match = eventRegex.exec(text)) !== null) {
    const type = match[1].toUpperCase();
    const location = match[2].trim();
    const block = match[3] || '';

    const appointmentDate = parseDateFromLine(block, baseYear);
    if (appointmentDate) currentDate = appointmentDate;
    if (!currentDate) currentDate = startDate;

    const miles = Number((block.match(/([\d,]+(?:\.\d+)?)\s+miles\s+from\s+last\s+stop/i)?.[1] || '0').replace(/,/g, ''));

    const stopType =
      type === 'DELIVER' ? 'DELIVER' :
      type === 'PICKUP' ? 'PICKUP' :
      type === 'HOOK' ? 'HOOK' :
      type === 'DROP' ? 'DROP' :
      type === 'BORDER CROSSING' ? 'BORDER CROSSING' :
      type === 'ACQUIRE' ? 'ACQUIRE' : 'RELEASE';

    if (stopType === 'PICKUP') lastPickupDate = currentDate;

    stops.push({
      stop_type: stopType,
      location,
      miles_from_last: Number.isFinite(miles) ? miles : 0,
      date: currentDate,
      event_index: stops.length,
    });
  }

  const endDate = lastPickupDate ? new Date(`${lastPickupDate}T00:00:00`).toISOString().slice(0, 10) : null;
  const finalEnd = endDate ? new Date(new Date(endDate).getTime() + 86400000).toISOString().slice(0, 10) : null;

  const route = (() => {
    const first = stops.find((s) => s.stop_type === 'PICKUP' || s.stop_type === 'DELIVER')?.location || stops[0]?.location;
    const last = [...stops].reverse().find((s) => s.stop_type === 'PICKUP' || s.stop_type === 'DELIVER')?.location || stops[stops.length - 1]?.location;
    if (!first || !last) return 'Unknown';
    return `${first} → ${last}`;
  })();

  const placeholders: string[] = [];

  // Protocol heuristic: self pickup when pickup follows acquire(caledon)
  for (let i = 1; i < stops.length; i++) {
    const prev = stops[i - 1];
    const cur = stops[i];
    if (prev.stop_type === 'ACQUIRE' && /caledon,\s*on/i.test(prev.location) && cur.stop_type === 'PICKUP') {
      placeholders.push('Self Pickup heuristic detected (+$75 placeholder)');
    }
  }

  return {
    tripNumber,
    startDate,
    endDate: finalEnd,
    totalMiles,
    route,
    rawText: text,
    notes: '',
    stops,
    placeholders,
    hasDetectedTripNumber,
  };
}

export function mergeTripAndStops(db: Database.Database, userId: number, parsed: ParsedTrip, pdfPath: string) {
  const sameTripAnyUser = db.prepare('SELECT trip_number, user_id FROM trips WHERE trip_number = ?').get(parsed.tripNumber) as { trip_number: string; user_id: number } | undefined;
  const effectiveTripNumber = sameTripAnyUser && sameTripAnyUser.user_id !== userId ? `${parsed.tripNumber}-U${userId}` : parsed.tripNumber;

  const existing = db.prepare('SELECT trip_number FROM trips WHERE trip_number = ? AND user_id = ?').get(effectiveTripNumber, userId) as { trip_number: string } | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO trips (trip_number, start_date, end_date, total_miles, route, status, notes, pdf_path, raw_data, user_id)
      VALUES (?, ?, ?, ?, ?, 'Active', ?, ?, ?, ?)
    `).run(effectiveTripNumber, parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.route, '', pdfPath, parsed.rawText, userId);
  } else {
    db.prepare(`
      UPDATE trips
      SET start_date = COALESCE(?, start_date),
          end_date = COALESCE(?, end_date),
          total_miles = CASE WHEN ? > 0 THEN ? ELSE total_miles END,
          route = CASE WHEN ? != 'Unknown' THEN ? ELSE route END,
          pdf_path = ?,
          raw_data = ?,
          user_id = ?
      WHERE trip_number = ? AND user_id = ?
    `).run(parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.totalMiles, parsed.route, parsed.route, pdfPath, parsed.rawText, userId, effectiveTripNumber, userId);
  }

  const normalizeType = (t: string) => {
    const v = String(t || '').trim().toUpperCase();
    if (v === 'DELIVERY') return 'DELIVER';
    if (v === 'PICKUP') return 'PICKUP';
    if (v === 'HOOK') return 'HOOK';
    if (v === 'DROP') return 'DROP';
    if (v === 'BORDER') return 'BORDER CROSSING';
    if (v === 'ACQUIRE') return 'ACQUIRE';
    if (v === 'RELEASE') return 'RELEASE';
    return v;
  };

  const existingStops = db.prepare('SELECT id, location, stop_type FROM stops WHERE trip_number = ? AND user_id = ?').all(effectiveTripNumber, userId) as Array<{ id: number; location: string; stop_type: string }>;
  const dedupe = new Set(existingStops.map((s) => `${normalizeType(s.stop_type)}|${s.location.toLowerCase().trim()}`));

  const insertStop = db.prepare('INSERT INTO stops (trip_number, stop_type, location, date, miles_from_last, user_id) VALUES (?, ?, ?, ?, ?, ?)');

  for (const stop of parsed.stops) {
    const normalizedType = normalizeType(stop.stop_type);
    const key = `${normalizedType}|${stop.location.toLowerCase().trim()}`;
    if (dedupe.has(key)) continue;
    insertStop.run(effectiveTripNumber, normalizedType, stop.location, stop.date, stop.miles_from_last, userId);
    dedupe.add(key);
  }

  // add placeholder pay rows when heuristics detect events
  if (parsed.placeholders.some((p) => p.includes('Self Pickup'))) {
    const exists = db.prepare('SELECT id FROM extra_pay WHERE trip_number = ? AND user_id = ? AND type = ?').get(effectiveTripNumber, userId, 'Self Pickup') as { id: number } | undefined;
    if (!exists) {
      db.prepare('INSERT INTO extra_pay (trip_number, type, amount, quantity, date, user_id) VALUES (?, ?, ?, ?, ?, ?)')
        .run(effectiveTripNumber, 'Self Pickup', 75, 1, parsed.startDate, userId);
    }
  }

  return effectiveTripNumber;
}

export type UploadJob = {
  id: number;
  user_id: number;
  original_filename: string;
  stored_path: string;
  status: 'queued' | 'processing' | 'done' | 'failed' | 'cancelled';
  content_hash?: string | null;
  trip_number?: string | null;
  error_message?: string | null;
  attempt_count: number;
  max_attempts: number;
};

function isRetryableUploadError(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return !(
    m.includes('invalid pdf') ||
    m.includes('trip number') ||
    m.includes('document format') ||
    m.includes('only pdf files are supported')
  );
}

export function acquireUploadWorkerLock(db: Database.Database, owner: string, ttlSeconds = 120): boolean {
  ensureUploadSchema(db);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM upload_worker_lock WHERE lock_name = 'upload_queue' AND datetime(expires_at) <= datetime('now')").run();
    const existing = db.prepare("SELECT owner FROM upload_worker_lock WHERE lock_name = 'upload_queue'").get() as { owner: string } | undefined;
    if (existing) return false;

    db.prepare(`
      INSERT INTO upload_worker_lock (lock_name, owner, expires_at, updated_at)
      VALUES ('upload_queue', ?, datetime('now', ?), datetime('now'))
    `).run(owner, `+${Math.max(10, ttlSeconds)} seconds`);
    return true;
  });

  return tx();
}

export function releaseUploadWorkerLock(db: Database.Database, owner: string) {
  ensureUploadSchema(db);
  db.prepare("DELETE FROM upload_worker_lock WHERE lock_name = 'upload_queue' AND owner = ?").run(owner);
}

function claimQueuedUploadJob(db: Database.Database, owner: string): UploadJob | null {
  const tx = db.transaction(() => {
    const job = db.prepare(`
      SELECT *
      FROM upload_jobs
      WHERE status = 'queued' AND cancel_requested = 0 AND attempt_count < max_attempts
      ORDER BY id ASC
      LIMIT 1
    `).get() as UploadJob | undefined;

    if (!job) return null;

    const claimed = db.prepare(`
      UPDATE upload_jobs
      SET status = 'processing', started_at = datetime('now'), processing_by = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued'
    `).run(owner, job.id);

    if (!claimed.changes) return null;

    return db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(job.id) as UploadJob;
  });

  return tx();
}

export function claimUploadJobById(db: Database.Database, id: number, owner: string): UploadJob | null {
  const tx = db.transaction(() => {
    const claimed = db.prepare(`
      UPDATE upload_jobs
      SET status = 'processing', started_at = datetime('now'), processing_by = ?, updated_at = datetime('now')
      WHERE id = ? AND status = 'queued' AND cancel_requested = 0
    `).run(owner, id);

    if (!claimed.changes) return null;
    return db.prepare('SELECT * FROM upload_jobs WHERE id = ?').get(id) as UploadJob;
  });

  return tx();
}

export async function processClaimedUploadJob(db: Database.Database, job: UploadJob) {
  try {
    const cleanStoredPath = String(job.stored_path || '').replace(/^\/+/, '');
    const absPath = join(process.cwd(), 'public', cleanStoredPath);
    const buffer = await readFile(absPath);

    const rawText = await extractTextFromPdf(buffer);
    const parsed = parseDriverItinerary(rawText);

    if (!parsed.hasDetectedTripNumber) {
      throw new Error('Could not detect trip number in PDF. Please verify the document format.');
    }

    if (!parsed.tripNumber || !/^T\d{4,}/i.test(parsed.tripNumber)) {
      throw new Error('Parsed trip number is invalid. Please upload a valid itinerary PDF.');
    }

    const tx = db.transaction(() => {
      const tripNumber = mergeTripAndStops(db, job.user_id, parsed, job.stored_path);
      db.prepare(`
        UPDATE upload_jobs
        SET status = 'done',
            trip_number = ?,
            attempt_count = attempt_count + 1,
            error_message = NULL,
            processing_by = NULL,
            updated_at = datetime('now'),
            processed_at = datetime('now')
        WHERE id = ?
      `).run(tripNumber, job.id);
      return tripNumber;
    });

    const tripNumber = tx();
    return { ok: true as const, jobId: job.id, tripNumber };
  } catch (error: any) {
    const message = String(error?.message || 'Upload processing failed');
    const retryable = isRetryableUploadError(message);

    const row = db.prepare('SELECT attempt_count, max_attempts FROM upload_jobs WHERE id = ?').get(job.id) as { attempt_count: number; max_attempts: number } | undefined;
    const nextAttempt = (row?.attempt_count || 0) + 1;
    const maxAttempts = row?.max_attempts || 3;
    const shouldRetry = retryable && nextAttempt < maxAttempts;

    db.prepare(`
      UPDATE upload_jobs
      SET status = ?,
          attempt_count = ?,
          error_message = ?,
          last_error_at = datetime('now'),
          processing_by = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(shouldRetry ? 'queued' : 'failed', nextAttempt, message, job.id);

    return { ok: false as const, jobId: job.id, error: message, retryable: shouldRetry };
  }
}

export async function processNextQueuedUploadJob(db: Database.Database, owner: string) {
  const claimed = claimQueuedUploadJob(db, owner);
  if (!claimed) return { ok: true as const, empty: true as const };
  return processClaimedUploadJob(db, claimed);
}
