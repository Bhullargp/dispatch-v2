import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Anthropic from '@anthropic-ai/sdk';
import pool, { db } from '@/lib/db';

const execFileAsync = promisify(execFile);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_API_URL = 'https://api.minimax.chat/v1/chat/completions';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-Text-01';
const ZAI_API_KEY = process.env.ZAI_API_KEY || '';
const ZAI_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZAI_MODEL = 'glm-4.5-air';

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
  driverName?: string | null;
  leadDriver?: string | null;
  coDriver?: string | null;
  truckNumber?: string | null;
  trailerNumber?: string | null;
  customsBroker?: string | null;
  dispatcherName?: string | null;
};

export type LlmStop = {
  type: string;
  location: string;
  company?: string;
  appointment_time?: string;
  miles?: number;
  cargo?: string;
  bol?: string;
};

export type LlmExtractResult = {
  trip_number: string;
  start_date: string | null;
  driver_name: string | null;
  lead_driver: string | null;
  co_driver: string | null;
  truck_number: string | null;
  trailer_number: string | null;
  total_miles: number;
  stops: LlmStop[];
  customs_broker: string | null;
  dispatcher_name: string | null;
};

// Schema is already in PG - no need to ensure it

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
      type === 'DELIVERY' ? 'DELIVER' :
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

// ── LLM-based extraction using Z.AI ──────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are a dispatch itinerary parser. Extract structured trip data from the driver itinerary text provided.

CRITICAL DISTINCTIONS:
- "Name:" field with email like @dmtransport.ca = DISPATCHER (the person who issued the itinerary)
- "Lead Driver:" = the actual driver
- "Team Driver:" = co-driver (ONLY if a name appears after this field; if empty/null, set co_driver to null)
- "Dispatched By:" = dispatcher
- DO NOT confuse the dispatcher with the co-driver

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "trip_number": "string (e.g. T12345, extract from document)",
  "start_date": "YYYY-MM-DD or null",
  "driver_name": "string or null (the actual driver from Lead Driver field)",
  "lead_driver": "string or null (same as driver_name)",
  "co_driver": "string or null (ONLY from Team Driver field, NOT the dispatcher)",
  "truck_number": "string or null",
  "trailer_number": "string or null",
  "total_miles": number or 0,
  "stops": [
    {
      "type": "PICKUP|DELIVER|HOOK|DROP|ACQUIRE|RELEASE|BORDER CROSSING",
      "location": "string",
      "company": "string or null",
      "appointment_time": "string or null",
      "miles": number or 0,
      "cargo": "string or null",
      "bol": "string or null"
    }
  ],
  "customs_broker": "string or null",
  "dispatcher_name": "string or null (the Name field or Dispatched By field, NOT the driver)"
}`;

export async function extractWithLlm(text: string): Promise<LlmExtractResult> {
  if (!ZAI_API_KEY) {
    throw new Error('ZAI_API_KEY not configured. Add it to .env.local');
  }

  const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

  const response = await fetch(ZAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      messages: [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this driver itinerary:\n\n${truncated}` },
      ],
      temperature: 0.05,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Z.AI API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from LLM');
  }

  const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  let parsed: LlmExtractResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.trip_number || !/^T\d{4,}$/i.test(parsed.trip_number.trim())) {
    throw new Error(`LLM extracted invalid trip number: ${parsed.trip_number}`);
  }

  parsed.trip_number = parsed.trip_number.toUpperCase().trim();
  return parsed;
}

export async function extractWithMinimax(text: string): Promise<LlmExtractResult> {
  if (!MINIMAX_API_KEY) {
    throw new Error('MINIMAX_API_KEY not configured. Add it to .env.local');
  }

  const truncated = text.length > 10000 ? text.slice(0, 10000) : text;

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        { role: 'user', content: `Parse this driver itinerary:\n\n${truncated}` },
      ],
      temperature: 0.05,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Minimax API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from Minimax');
  }

  const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  let parsed: LlmExtractResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Minimax returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.trip_number || !/^T\d{4,}$/i.test(parsed.trip_number.trim())) {
    throw new Error(`Minimax extracted invalid trip number: ${parsed.trip_number}`);
  }

  parsed.trip_number = parsed.trip_number.toUpperCase().trim();
  return parsed;
}

export async function extractWithClaude(pdfBuffer: Buffer): Promise<LlmExtractResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to .env.local');
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const base64Pdf = pdfBuffer.toString('base64');

  const SCHEMA_PROMPT = `You are a dispatch itinerary parser for a trucking company. Extract structured trip data from this PDF.

CRITICAL DISTINCTIONS:
- "Name:" field with email like @dmtransport.ca = DISPATCHER (the person who issued the itinerary)
- "Lead Driver:" = the actual driver
- "Team Driver:" = co-driver (ONLY if a name appears after this field; if empty/null, set co_driver to null)
- "Dispatched By:" = dispatcher
- DO NOT confuse the dispatcher with the co-driver

Return ONLY valid JSON matching this schema (no markdown, no explanation):
{
  "trip_number": "string (e.g. T12345, extract from document)",
  "start_date": "YYYY-MM-DD or null",
  "driver_name": "string or null (the actual driver from Lead Driver field)",
  "lead_driver": "string or null (same as driver_name)",
  "co_driver": "string or null (ONLY from Team Driver field, NOT the dispatcher)",
  "truck_number": "string or null",
  "trailer_number": "string or null",
  "total_miles": number or 0,
  "stops": [
    {
      "type": "PICKUP|DELIVER|HOOK|DROP|ACQUIRE|RELEASE|BORDER CROSSING",
      "location": "string",
      "company": "string or null",
      "appointment_time": "string or null",
      "miles": number or 0,
      "cargo": "string or null",
      "bol": "string or null"
    }
  ],
  "customs_broker": "string or null",
  "dispatcher_name": "string or null (the Name field or Dispatched By field, NOT the driver)"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Pdf,
            },
          } as any,
          {
            type: 'text',
            text: SCHEMA_PROMPT,
          },
        ],
      },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const cleaned = content.text
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  let parsed: LlmExtractResult;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!parsed.trip_number || !/^T\d{4,}$/i.test(parsed.trip_number.trim())) {
    throw new Error(`Claude extracted invalid trip number: ${parsed.trip_number}`);
  }

  parsed.trip_number = parsed.trip_number.toUpperCase().trim();
  return parsed;
}

export function llmResultToParsedTrip(llm: LlmExtractResult, rawText: string): ParsedTrip {
  const stops: ParsedStop[] = (llm.stops || []).map((s, i) => ({
    stop_type: s.type?.toUpperCase() || 'PICKUP',
    location: s.location || '',
    miles_from_last: Number(s.miles) || 0,
    date: llm.start_date,
    event_index: i,
  }));

  const firstLoc = stops[0]?.location || '';
  const lastLoc = stops.length > 0 ? stops[stops.length - 1].location : '';
  const route = firstLoc && lastLoc ? `${firstLoc} → ${lastLoc}` : 'Unknown';

  return {
    tripNumber: llm.trip_number,
    startDate: llm.start_date,
    endDate: null,
    totalMiles: Number(llm.total_miles) || 0,
    route,
    rawText,
    notes: '',
    stops,
    placeholders: [],
    hasDetectedTripNumber: true,
    driverName: llm.driver_name,
    leadDriver: llm.lead_driver,
    coDriver: llm.co_driver,
    truckNumber: llm.truck_number,
    trailerNumber: llm.trailer_number,
    customsBroker: llm.customs_broker,
    dispatcherName: llm.dispatcher_name,
  };
}

export async function mergeTripAndStops(userId: number, parsed: ParsedTrip, pdfPath: string) {
  const d = db();

  const sameTripAnyUser = await d.get(
    'SELECT trip_number, user_id FROM trips WHERE trip_number = $1',
    [parsed.tripNumber]
  ) as { trip_number: string; user_id: number } | undefined;

  const effectiveTripNumber = sameTripAnyUser && sameTripAnyUser.user_id !== userId ? `${parsed.tripNumber}-U${userId}` : parsed.tripNumber;

  const existing = await d.get(
    'SELECT trip_number FROM trips WHERE trip_number = $1 AND user_id = $2',
    [effectiveTripNumber, userId]
  ) as { trip_number: string } | undefined;

  if (!existing) {
    await d.run(
      `INSERT INTO trips (trip_number, start_date, end_date, total_miles, route, status, notes, pdf_path, raw_data, user_id, driver_name, lead_driver, truck_number, trailer_number, truck, trailer)
      VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        effectiveTripNumber, parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.route, '', pdfPath, parsed.rawText, userId,
        parsed.driverName || null, parsed.leadDriver || null, parsed.truckNumber || null, parsed.trailerNumber || null,
        parsed.truckNumber || null, parsed.trailerNumber || null
      ]
    );
  } else {
    await d.run(
      `UPDATE trips
      SET start_date = COALESCE($1, start_date),
          end_date = COALESCE($2, end_date),
          total_miles = CASE WHEN $3 > 0 THEN $3 ELSE total_miles END,
          route = CASE WHEN $4 != 'Unknown' THEN $4 ELSE route END,
          pdf_path = $5,
          raw_data = $6,
          user_id = $7,
          driver_name = COALESCE($8, driver_name),
          lead_driver = COALESCE($9, lead_driver),
          truck_number = COALESCE($10, truck_number),
          trailer_number = COALESCE($11, trailer_number),
          truck = COALESCE($12, truck),
          trailer = COALESCE($13, trailer)
      WHERE trip_number = $14 AND user_id = $15`,
      [
        parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.totalMiles, parsed.route, parsed.route,
        pdfPath, parsed.rawText, userId,
        parsed.driverName || null, parsed.leadDriver || null, parsed.truckNumber || null, parsed.trailerNumber || null,
        parsed.truckNumber || null, parsed.trailerNumber || null,
        effectiveTripNumber, userId
      ]
    );
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

  const existingStops = await d.query(
    'SELECT id, location, stop_type FROM stops WHERE trip_number = $1 AND user_id = $2',
    [effectiveTripNumber, userId]
  ) as Array<{ id: number; location: string; stop_type: string }>;

  const dedupe = new Set(existingStops.map((s) => `${normalizeType(s.stop_type)}|${s.location.toLowerCase().trim()}`));

  for (const stop of parsed.stops) {
    const normalizedType = normalizeType(stop.stop_type);
    const key = `${normalizedType}|${stop.location.toLowerCase().trim()}`;
    if (dedupe.has(key)) continue;
    await d.run(
      'INSERT INTO stops (trip_number, stop_type, location, date, miles_from_last, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [effectiveTripNumber, normalizedType, stop.location, stop.date, stop.miles_from_last, userId]
    );
    dedupe.add(key);
  }

  // add placeholder pay rows when heuristics detect events
  if (parsed.placeholders.some((p) => p.includes('Self Pickup'))) {
    const exists = await d.get(
      'SELECT id FROM extra_pay WHERE trip_number = $1 AND user_id = $2 AND type = $3',
      [effectiveTripNumber, userId, 'Self Pickup']
    ) as { id: number } | undefined;
    if (!exists) {
      await d.run(
        'INSERT INTO extra_pay (trip_number, type, amount, quantity, date, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
        [effectiveTripNumber, 'Self Pickup', 75, 1, parsed.startDate, userId]
      );
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

export async function acquireUploadWorkerLock(owner: string, ttlSeconds = 120): Promise<boolean> {
  const d = db();

  // Delete expired locks
  await d.run("DELETE FROM upload_worker_lock WHERE lock_name = 'upload_queue' AND expires_at <= to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS')", []);

  const existing = await d.get("SELECT owner FROM upload_worker_lock WHERE lock_name = 'upload_queue'", []);
  if (existing) return false;

  await d.run(
    `INSERT INTO upload_worker_lock (lock_name, owner, expires_at, updated_at)
    VALUES ('upload_queue', $1, to_char(now() + ($2 || ' seconds')::interval, 'YYYY-MM-DD"T"HH24:MI:SS'), to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'))`,
    [owner, Math.max(10, ttlSeconds)]
  );
  return true;
}

export async function releaseUploadWorkerLock(owner: string) {
  await db().run("DELETE FROM upload_worker_lock WHERE lock_name = 'upload_queue' AND owner = $1", [owner]);
}

async function claimQueuedUploadJob(owner: string): Promise<UploadJob | null> {
  const d = db();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const jobResult = await client.query(`
      SELECT *
      FROM upload_jobs
      WHERE status = 'queued' AND cancel_requested = 0 AND attempt_count < max_attempts
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const job = jobResult.rows[0] as UploadJob | undefined;
    if (!job) {
      await client.query('COMMIT');
      return null;
    }

    const claimed = await client.query(`
      UPDATE upload_jobs
      SET status = 'processing', started_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'), processing_by = $1, updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
      WHERE id = $2 AND status = 'queued'
    `, [owner, job.id]);

    if (claimed.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }

    await client.query('COMMIT');
    return job;
  } catch {
    await client.query('ROLLBACK');
    return null;
  } finally {
    client.release();
  }
}

export async function claimUploadJobById(id: number, owner: string): Promise<UploadJob | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const claimed = await client.query(`
      UPDATE upload_jobs
      SET status = 'processing', started_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'), processing_by = $1, updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
      WHERE id = $2 AND status = 'queued' AND cancel_requested = 0
    `, [owner, id]);

    if (claimed.rowCount === 0) {
      await client.query('COMMIT');
      return null;
    }

    const jobResult = await client.query('SELECT * FROM upload_jobs WHERE id = $1', [id]);
    await client.query('COMMIT');
    return jobResult.rows[0] as UploadJob;
  } catch {
    await client.query('ROLLBACK');
    return null;
  } finally {
    client.release();
  }
}

export async function processClaimedUploadJob(job: UploadJob) {
  const d = db();
  try {
    const cleanStoredPath = String(job.stored_path || '').replace(/^\/+/, '');
    const absPath = join(process.cwd(), 'public', cleanStoredPath);
    const buffer = await readFile(absPath);

    const rawText = await extractTextFromPdf(buffer);

    let parsed: ParsedTrip;

    if (MINIMAX_API_KEY) {
      // Primary: Minimax (fast, cost-effective, OpenAI-compatible)
      try {
        const llmResult = await extractWithMinimax(rawText);
        parsed = llmResultToParsedTrip(llmResult, rawText);
      } catch (minimaxError: any) {
        console.warn(`Minimax extraction failed, trying fallback: ${minimaxError.message}`);
        if (ANTHROPIC_API_KEY) {
          try {
            const llmResult = await extractWithClaude(buffer);
            parsed = llmResultToParsedTrip(llmResult, rawText);
          } catch (claudeError: any) {
            console.warn(`Claude extraction failed, falling back to regex: ${claudeError.message}`);
            parsed = parseDriverItinerary(rawText);
          }
        } else {
          parsed = parseDriverItinerary(rawText);
        }
      }
    } else if (ANTHROPIC_API_KEY) {
      // Fallback: Claude (sends raw PDF bytes, best OCR accuracy)
      try {
        const llmResult = await extractWithClaude(buffer);
        parsed = llmResultToParsedTrip(llmResult, rawText);
      } catch (claudeError: any) {
        console.warn(`Claude extraction failed, trying Z.AI: ${claudeError.message}`);
        if (ZAI_API_KEY) {
          try {
            const llmResult = await extractWithLlm(rawText);
            parsed = llmResultToParsedTrip(llmResult, rawText);
          } catch (zaiError: any) {
            console.warn(`Z.AI extraction failed, falling back to regex: ${zaiError.message}`);
            parsed = parseDriverItinerary(rawText);
          }
        } else {
          parsed = parseDriverItinerary(rawText);
        }
      }
    } else if (ZAI_API_KEY) {
      try {
        const llmResult = await extractWithLlm(rawText);
        parsed = llmResultToParsedTrip(llmResult, rawText);
      } catch (llmError: any) {
        console.warn(`Z.AI extraction failed, falling back to regex: ${llmError.message}`);
        parsed = parseDriverItinerary(rawText);
      }
    } else {
      parsed = parseDriverItinerary(rawText);
    }

    if (!parsed.hasDetectedTripNumber) {
      throw new Error('Could not detect trip number in PDF. Please verify the document format.');
    }

    if (!parsed.tripNumber || !/^T\d{4,}/i.test(parsed.tripNumber)) {
      throw new Error('Parsed trip number is invalid. Please upload a valid itinerary PDF.');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tripNumber = await mergeTripAndStops(job.user_id, parsed, job.stored_path);
      await client.query(`
        UPDATE upload_jobs
        SET status = 'done',
            trip_number = $1,
            attempt_count = attempt_count + 1,
            error_message = NULL,
            processing_by = NULL,
            updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
            processed_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
        WHERE id = $2
      `, [tripNumber, job.id]);
      await client.query('COMMIT');
      return { ok: true as const, jobId: job.id, tripNumber };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    const message = String(error?.message || 'Upload processing failed');
    const retryable = isRetryableUploadError(message);

    const row = await d.get(
      'SELECT attempt_count, max_attempts FROM upload_jobs WHERE id = $1',
      [job.id]
    ) as { attempt_count: number; max_attempts: number } | undefined;
    const nextAttempt = (row?.attempt_count || 0) + 1;
    const maxAttempts = row?.max_attempts || 3;
    const shouldRetry = retryable && nextAttempt < maxAttempts;

    await d.run(`
      UPDATE upload_jobs
      SET status = $1,
          attempt_count = $2,
          error_message = $3,
          last_error_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS'),
          processing_by = NULL,
          updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
      WHERE id = $4
    `, [shouldRetry ? 'queued' : 'failed', nextAttempt, message, job.id]);

    return { ok: false as const, jobId: job.id, error: message, retryable: shouldRetry };
  }
}

export async function processNextQueuedUploadJob(owner: string) {
  const claimed = await claimQueuedUploadJob(owner);
  if (!claimed) return { ok: true as const, empty: true as const };
  return processClaimedUploadJob(claimed);
}
