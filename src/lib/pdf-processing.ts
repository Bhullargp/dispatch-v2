import { mkdtemp, writeFile, readFile, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Anthropic from '@anthropic-ai/sdk';
import pool, { db } from '@/lib/db';
import { getDocumentUploadMimeType } from '@/lib/upload-file-types';
import {
  getRuntimeMethodOrder,
  normalizeCustomProviders,
  normalizeDisabledModelIds,
  normalizeDisabledProviderIds,
  normalizeSelectablePrimary,
  type BuiltinModelId,
  type BuiltinProviderId,
  type CustomLlmProvider,
} from '@/lib/llm-config';

const execFileAsync = promisify(execFile);

const MINIMAX_API_URL = 'https://api.minimax.io/v1/text/chatcompletion_v2';
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ZAI_API_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const ZAI_MODEL = 'glm-4.5-air';

import { DISPATCH_APP_RULES, ITINERARY_LLM_RULES } from './app-rules';
import { deriveTripStatus } from './trip-status';

// Runtime LLM config — reads from DB (admin_settings), falls back to env vars
export interface LlmConfig {
  primary: string;
  minimaxApiKey: string;
  minimaxModel: string;
  openrouterApiKey: string;
  openrouterVisionModel: string;
  openrouterFallbackModel: string;
  anthropicApiKey: string;
  zaiApiKey: string;
  customProviders: CustomLlmProvider[];
  disabledProviderIds: BuiltinProviderId[];
  disabledModelIds: BuiltinModelId[];
}

export async function getLlmConfig(): Promise<LlmConfig> {
  try {
    const rows = await db().query(
      "SELECT key, value FROM system_defaults WHERE key LIKE 'llm_%'",
      []
    ) as Array<{ key: string; value: string }>;
    const s: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const customProviders = normalizeCustomProviders(s.llm_custom_providers || '[]');
    const disabledProviderIds = normalizeDisabledProviderIds(s.llm_disabled_provider_ids || '[]');
    const disabledModelIds = normalizeDisabledModelIds(s.llm_disabled_model_ids || '[]');
    return {
      primary:         normalizeSelectablePrimary(s.llm_primary || 'minimax', customProviders, disabledProviderIds, disabledModelIds),
      minimaxApiKey:   s.llm_minimax_api_key         || process.env.MINIMAX_API_KEY          || '',
      minimaxModel:    s.llm_minimax_model           || process.env.MINIMAX_MODEL            || 'MiniMax-M2.7',
      openrouterApiKey:s.llm_openrouter_api_key      || process.env.OPENROUTER_API_KEY       || '',
      openrouterVisionModel: s.llm_openrouter_vision_model || process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3-vl-235b-a22b-thinking',
      openrouterFallbackModel: s.llm_openrouter_fallback_model || process.env.OPENROUTER_FALLBACK_MODEL || 'qwen/qwen2.5-vl-72b-instruct',
      anthropicApiKey: s.llm_anthropic_api_key       || process.env.ANTHROPIC_API_KEY        || '',
      zaiApiKey:       s.llm_zai_api_key             || process.env.ZAI_API_KEY              || '',
      customProviders,
      disabledProviderIds,
      disabledModelIds,
    };
  } catch {
    return {
      primary: 'minimax',
      minimaxApiKey: process.env.MINIMAX_API_KEY || '',
      minimaxModel: process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
      openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
      openrouterVisionModel: process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3-vl-235b-a22b-thinking',
      openrouterFallbackModel: process.env.OPENROUTER_FALLBACK_MODEL || 'qwen/qwen2.5-vl-72b-instruct',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      zaiApiKey: process.env.ZAI_API_KEY || '',
      customProviders: [],
      disabledProviderIds: [],
      disabledModelIds: [],
    };
  }
}

// Keep env-based constants for backwards compat with non-DB code paths
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || '';
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2.7';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_VISION_MODEL = process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3-vl-235b-a22b-thinking';
const OPENROUTER_FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL || 'qwen/qwen2.5-vl-72b-instruct';
const ZAI_API_KEY = process.env.ZAI_API_KEY || '';

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

function cleanCapturedValue(value?: string | null) {
  if (!value) return null;
  const normalized = value
    .replace(/\s{2,}/g, ' ')
    .replace(/(?:Dispatched By|EMail|Email|Issued On).*$/i, '')
    .replace(/^Name:\s*/i, '')
    .trim();
  return normalized || null;
}

function rejectDispatcherOrHeader(value: string | null | undefined, dispatcherName?: string | null) {
  const normalized = cleanCapturedValue(value);
  if (!normalized) return null;
  if (/trip\s+itinerary|dispatched\s+by|issued\s+on|e-?mail|@|dmtransport/i.test(normalized)) return null;
  if (dispatcherName && normalized.toLowerCase() === dispatcherName.toLowerCase()) return null;
  return normalized;
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
  }

  try {
    await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', '3', '-r', '220', input, join(tmp, 'page')]);
    const files = (await readdir(tmp))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const ocrPages: string[] = [];
    for (const file of files) {
      const imagePath = join(tmp, file);
      const outputBase = imagePath.replace(/\.png$/i, '');
      try {
        await execFileAsync('tesseract', [imagePath, outputBase]);
        const pageText = await readFile(`${outputBase}.txt`, 'utf8').catch(() => '');
        if (pageText.trim()) ocrPages.push(pageText.trim());
      } catch {
        continue;
      }
    }

    if (ocrPages.length > 0) return ocrPages.join('\n\n');
  } catch {
    // fallback below
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  return '';
}

export async function extractTextFromImage(buffer: Buffer, filename: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'dispatch-image-'));
  const extension = extname(filename || '').toLowerCase() || '.jpg';
  const input = join(tmp, `input${extension}`);
  const normalized = join(tmp, 'input.png');
  const outputBase = join(tmp, 'output');

  try {
    await writeFile(input, buffer);

    let ocrInput = input;
    try {
      await execFileAsync('sips', ['-s', 'format', 'png', input, '--out', normalized]);
      ocrInput = normalized;
    } catch {
      // Fall back to the original image when conversion is unavailable for this format.
    }

    await execFileAsync('tesseract', [ocrInput, outputBase]);
    const text = await readFile(`${outputBase}.txt`, 'utf8');
    if (text.trim()) return text;
  } catch {
    // fallback below
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  return '';
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

  const dispatcherName = cleanCapturedValue(
    text.match(/Dispatched By\s+(?:Name:\s*)?(.+?)(?=\s{2,}(?:EMail|Email|Issued On)|\n|$)/i)?.[1]
      || text.match(/\bName:\s*([^\n]+?)\s+(?:EMail|Email):\s*\S+@dmtransport\./i)?.[1]
  );
  const leadDriver = rejectDispatcherOrHeader(cleanCapturedValue(
    text.match(/Lead Driver\s+(.+?)(?=\s{2,}(?:Dispatched By|Team Driver|EMail|Email|Issued On)|\n|$)/i)?.[1]
      || text.match(/(?:^|\n)\s*(?:Lead Driver|Driver)\s*[:\-]\s*([^\n]+)/i)?.[1]
      || text.match(/(?:^|\n)\s*Driver\s{2,}(.+?)(?=\s{2,}(?:Dispatched By|Team Driver|EMail|Email|Issued On)|\n|$)/i)?.[1]
  ), dispatcherName);
  const coDriver = cleanCapturedValue(
    text.match(/(?:Team Driver|Co-Driver)\s+(.+?)(?=\s{2,}(?:EMail|Email|Issued On|Dispatched By)|\n|$)/i)?.[1]
      || text.match(/(?:Team Driver|Co-Driver)\s*[:\-]?\s*([^\n]+)/i)?.[1]
  );
  const truckNumber = cleanCapturedValue(text.match(/\bTruck\s*[:#]\s*([A-Z0-9-]+)/i)?.[1]);
  const trailerNumber = cleanCapturedValue(text.match(/\bTrailer\s*[:#]\s*([A-Z0-9-]+)/i)?.[1]);

  const eventRegex = /(ACQUIRE|RELEASE|HOOK|DROP|PICKUP|DELIVER|BORDER CROSSING)\s*\(([^)]+)\)([\s\S]*?)(?=(?:\n(?:ACQUIRE|RELEASE|HOOK|DROP|PICKUP|DELIVER|BORDER CROSSING)\s*\()|$)/gi;
  const stops: ParsedStop[] = [];

  let match: RegExpExecArray | null;
  let currentDate = startDate;

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

    stops.push({
      stop_type: stopType,
      location,
      miles_from_last: Number.isFinite(miles) ? miles : 0,
      date: currentDate,
      event_index: stops.length,
    });
  }

  const finalEnd = stops.length > 0 ? (stops[stops.length - 1].date || null) : null;

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
    driverName: leadDriver,
    leadDriver,
    coDriver,
    truckNumber,
    trailerNumber,
    dispatcherName,
  };
}

// ── LLM-based extraction using Z.AI ──────────────────────────────────────────

const LLM_SYSTEM_PROMPT = `You are a dispatch itinerary parser for a Canadian trucking company (DM Transport, Ontario). Extract structured trip data from driver itinerary text.

${DISPATCH_APP_RULES}

${ITINERARY_LLM_RULES}

═══ FIELD EXTRACTION RULES ═══

PEOPLE:
- "Lead Driver:" or "Driver:" = the actual truck driver (driver_name AND lead_driver)
- "Team Driver:" or "Co-Driver:" = co-driver ONLY if a real name appears; if blank/empty → null
- "Name:" with @dmtransport.ca email = DISPATCHER, not a driver
- "Dispatched By:" = dispatcher_name
- NEVER put the dispatcher name in driver_name or co_driver

EQUIPMENT (CRITICAL — read carefully):
- "Truck #" or "Unit #" or "Tractor #" = truck_number (e.g. "598", "T598")
- "Trailer #" or "Trailer Number:" or "TRL #" or "TRL:" = trailer_number — this is a SEPARATE number from the truck
- Trailers are typically 5-6 digit numbers (e.g. "85234", "60012") or start with letters (e.g. "P85234")
- truck_number ≠ trailer_number — they are different pieces of equipment
- If you see two unit numbers, one is the tractor (truck) and one is the trailer

TRIP:
- trip_number: format like T12345 — extract EXACTLY as written (e.g. T052238)
- start_date: the trip start or dispatch date in YYYY-MM-DD format
- total_miles: from "TOTAL ROUTED MILES" or "Total Miles" field — the number only

STOPS (extract ALL of them in order):
- Types: ACQUIRE, RELEASE, HOOK, DROP, PICKUP, DELIVER, BORDER CROSSING
- location: "City, Province/State" format — ALWAYS include province/state abbreviation
- miles: miles from last stop (if shown)
- Include every stop — ACQUIRE/RELEASE are important for pay calculations

PAY RATE CONTEXT (for your reference only — do not include in output):
- If ANY stop is in a US state → trip pays at US rate ($1.06/mile)
- Only ALL-Canadian stops → Canada rate ($1.26 under 1000mi, $1.16 over 1000mi)

Return ONLY valid JSON, no markdown, no explanation:
{
  "trip_number": "string (e.g. T052238)",
  "start_date": "YYYY-MM-DD or null",
  "driver_name": "string or null",
  "lead_driver": "string or null",
  "co_driver": "string or null",
  "truck_number": "string or null (tractor/truck unit number only)",
  "trailer_number": "string or null (trailer unit number — different from truck)",
  "total_miles": number,
  "stops": [
    {
      "type": "PICKUP|DELIVER|HOOK|DROP|ACQUIRE|RELEASE|BORDER CROSSING",
      "location": "City, Province/State",
      "company": "string or null",
      "appointment_time": "HH:MM or date-time string or null",
      "miles": number,
      "cargo": "string or null",
      "bol": "string or null"
    }
  ],
  "customs_broker": "string or null",
  "dispatcher_name": "string or null"
}`;

function parseModelJson(content: string, label: string): LlmExtractResult {
  const cleaned = content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  const candidate = (jsonMatch?.[0] || cleaned).trim();

  let parsed: LlmExtractResult;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(`${label} returned invalid JSON: ${candidate.slice(0, 200)}`);
  }

  if (!parsed.trip_number || !/^T\d{4,}$/i.test(parsed.trip_number.trim())) {
    throw new Error(`${label} extracted invalid trip number: ${parsed.trip_number}`);
  }

  parsed.trip_number = parsed.trip_number.toUpperCase().trim();
  return parsed;
}

export async function extractWithLlm(text: string, apiKey?: string): Promise<LlmExtractResult> {
  const key = apiKey || ZAI_API_KEY;
  if (!key) {
    throw new Error('ZAI_API_KEY not configured. Add it to .env.local');
  }

  const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

  const response = await fetch(ZAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
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

  return parseModelJson(content, 'LLM');
}

export async function extractWithMinimax(text: string, apiKey?: string, model?: string): Promise<LlmExtractResult> {
  const key = apiKey || MINIMAX_API_KEY;
  const mdl = model || MINIMAX_MODEL;
  if (!key) {
    throw new Error('MINIMAX_API_KEY not configured. Add it to .env.local');
  }

  const truncated = text.length > 10000 ? text.slice(0, 10000) : text;

  const response = await fetch(MINIMAX_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: mdl,
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

  return parseModelJson(content, 'Minimax');
}

export async function extractWithClaude(pdfBuffer: Buffer, apiKey?: string): Promise<LlmExtractResult> {
  const key = apiKey || ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY not configured. Add it to .env.local');
  }

  const client = new Anthropic({ apiKey: key });
  const base64Pdf = pdfBuffer.toString('base64');

  const SCHEMA_PROMPT = LLM_SYSTEM_PROMPT;

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

  return parseModelJson(content.text, 'Claude');
}

async function renderPdfPagesToDataUrls(pdfBuffer: Buffer, maxPages = 3): Promise<string[]> {
  const tmp = await mkdtemp(join(tmpdir(), 'dispatch-vision-'));
  const input = join(tmp, 'input.pdf');
  const prefix = join(tmp, 'page');
  try {
    await writeFile(input, pdfBuffer);
    await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(maxPages), input, prefix]);
    const files = (await readdir(tmp))
      .filter(name => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const dataUrls: string[] = [];
    for (const file of files) {
      const png = await readFile(join(tmp, file));
      dataUrls.push(`data:image/png;base64,${png.toString('base64')}`);
    }
    return dataUrls;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export async function extractWithOpenRouterVision(pdfBuffer: Buffer, apiKey?: string, model?: string): Promise<LlmExtractResult> {
  const key = apiKey || OPENROUTER_API_KEY;
  const mdl = model || OPENROUTER_VISION_MODEL;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY not configured. Add it to .env.local');
  }

  const images = await renderPdfPagesToDataUrls(pdfBuffer, 3);
  if (!images.length) {
    throw new Error('Could not render PDF pages for OpenRouter vision extraction');
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Dispatch',
    },
    body: JSON.stringify({
      model: mdl,
      messages: [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Parse this scanned driver itinerary PDF into the required JSON schema. Use the page images as the source of truth.' },
            ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ],
        },
      ],
      temperature: 0.05,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`OpenRouter API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n')
    : content;
  if (!text || typeof text !== 'string') {
    throw new Error('Empty response from OpenRouter vision model');
  }

  return parseModelJson(text, 'OpenRouter vision');
}

export async function extractWithOpenRouterText(text: string, apiKey: string, model: string): Promise<LlmExtractResult> {
  const truncated = text.length > 10000 ? text.slice(0, 10000) : text;

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Dispatch',
    },
    body: JSON.stringify({
      model,
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
    throw new Error(`OpenRouter API error ${response.status}: ${errBody.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const normalized = Array.isArray(content)
    ? content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n')
    : content;

  if (!normalized || typeof normalized !== 'string') {
    throw new Error('Empty response from OpenRouter model');
  }

  return parseModelJson(normalized, 'OpenRouter');
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
  const dispatcherName = cleanCapturedValue(llm.dispatcher_name);
  const leadDriver = rejectDispatcherOrHeader(llm.lead_driver, dispatcherName);
  const driverName = rejectDispatcherOrHeader(llm.driver_name, dispatcherName) || leadDriver;

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
    driverName,
    leadDriver: leadDriver || driverName,
    coDriver: rejectDispatcherOrHeader(llm.co_driver, dispatcherName),
    truckNumber: cleanCapturedValue(llm.truck_number),
    trailerNumber: cleanCapturedValue(llm.trailer_number),
    customsBroker: cleanCapturedValue(llm.customs_broker),
    dispatcherName,
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
    'SELECT trip_number, status FROM trips WHERE trip_number = $1 AND user_id = $2',
    [effectiveTripNumber, userId]
  ) as { trip_number: string; status: string | null } | undefined;
  const derivedStatus = deriveTripStatus({
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    stops: parsed.stops,
    requestedStatus: existing?.status || null,
  });

  const dbg = [effectiveTripNumber, parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.route, derivedStatus, parsed.notes || '', pdfPath, parsed.rawText, userId, parsed.driverName || null, parsed.leadDriver || null, parsed.truckNumber || null, parsed.trailerNumber || null, parsed.truckNumber || null, parsed.trailerNumber || null, parsed.trailerNumber || null];
  console.log('[DEBUG] INSERT/UPDATE params:', dbg.length);
  if (!existing) {
    await d.run(
      `INSERT INTO trips (trip_number, start_date, end_date, total_miles, route, status, notes, pdf_path, raw_data, user_id, driver_name, lead_driver, truck_number, trailer_number, truck, trailer, trailer_2)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      dbg
    );
  } else {
    const upd = [parsed.startDate, parsed.endDate, parsed.totalMiles, parsed.route, derivedStatus, pdfPath, parsed.rawText, userId, parsed.driverName || null, parsed.leadDriver || null, parsed.truckNumber || null, parsed.trailerNumber || null, parsed.truckNumber || null, parsed.trailerNumber || null, parsed.trailerNumber || null, effectiveTripNumber, userId];
    console.log('[DEBUG] UPDATE params:', upd.length);
    await d.run(
      `UPDATE trips
      SET start_date = $1,
          end_date = $2,
          total_miles = $3,
          route = $4,
          status = $5,
          pdf_path = $6,
          raw_data = $7,
          user_id = $8,
          driver_name = $9,
          lead_driver = $10,
          truck_number = $11,
          trailer_number = $12,
          truck = $13,
          trailer = $14,
          trailer_2 = $15
      WHERE trip_number = $16 AND user_id = $17`,
      upd
    );
  }

  // ── Stops: always upsert (works for both new and existing trips) ──

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
    m.includes('itinerary document') ||
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
    const mimeType = getDocumentUploadMimeType({
      name: job.original_filename || cleanStoredPath,
      type: (job as UploadJob & { mime_type?: string | null }).mime_type || '',
    });
    const isPdfUpload = mimeType === 'application/pdf';
    const rawText = isPdfUpload
      ? await extractTextFromPdf(buffer)
      : await extractTextFromImage(buffer, job.original_filename || cleanStoredPath);

    // Load runtime LLM config from DB (admin can change at any time)
    const cfg = await getLlmConfig();

    let parsed: ParsedTrip;

    // Ordered extraction chain based on admin's primary model/provider selection
    const tryMinimax = async () => {
      if (!cfg.minimaxApiKey) throw new Error('Minimax API key not configured');
      const llmResult = await extractWithMinimax(rawText, cfg.minimaxApiKey, cfg.minimaxModel);
      return llmResultToParsedTrip(llmResult, rawText);
    };
    const tryClaude = async () => {
      if (!cfg.anthropicApiKey) throw new Error('Anthropic API key not configured');
      const llmResult = await extractWithClaude(buffer, cfg.anthropicApiKey);
      return llmResultToParsedTrip(llmResult, rawText);
    };
    const tryOpenRouterVision = async () => {
      if (!cfg.openrouterApiKey) throw new Error('OpenRouter API key not configured');
      const llmResult = await extractWithOpenRouterVision(buffer, cfg.openrouterApiKey, cfg.openrouterVisionModel);
      return llmResultToParsedTrip(llmResult, rawText);
    };
    const tryOpenRouterText = async (apiKey: string, model: string) => {
      if (!apiKey) throw new Error('OpenRouter API key not configured');
      if (!model) throw new Error('OpenRouter model not configured');
      const llmResult = await extractWithOpenRouterText(rawText, apiKey, model);
      return llmResultToParsedTrip(llmResult, rawText);
    };
    const tryZai = async () => {
      if (!cfg.zaiApiKey) throw new Error('Z.AI API key not configured');
      const llmResult = await extractWithLlm(rawText, cfg.zaiApiKey);
      return llmResultToParsedTrip(llmResult, rawText);
    };

    const ordered = getRuntimeMethodOrder(cfg.primary, cfg.customProviders);

    parsed = undefined as any;

    for (const method of ordered) {
      if (parsed) break;
      if (method === 'regex') { parsed = parseDriverItinerary(rawText); break; }
      try {
        if (method === 'minimax') parsed = await tryMinimax();
        else if (method === 'claude') parsed = await tryClaude();
        else if (method === 'zai') parsed = await tryZai();
        else if (method === 'openrouter-vision') {
          if (!isPdfUpload) continue;
          parsed = await tryOpenRouterVision();
        }
        else if (typeof method === 'string' && method.startsWith('custom:')) {
          const id = method.slice('custom:'.length);
          const entry = cfg.customProviders.find(p => p.id === id && p.enabled);
          if (!entry) continue;
          if (entry.provider === 'openrouter') parsed = await tryOpenRouterText(entry.api_key, entry.model);
          else if (entry.provider === 'openrouter-vision') {
            if (!isPdfUpload) continue;
            const llmResult = await extractWithOpenRouterVision(buffer, entry.api_key, entry.model || cfg.openrouterVisionModel);
            parsed = llmResultToParsedTrip(llmResult, rawText);
          }
          else if (entry.provider === 'minimax') {
            const llmResult = await extractWithMinimax(rawText, entry.api_key, entry.model || cfg.minimaxModel);
            parsed = llmResultToParsedTrip(llmResult, rawText);
          }
          else if (entry.provider === 'zai') {
            const llmResult = await extractWithLlm(rawText, entry.api_key);
            parsed = llmResultToParsedTrip(llmResult, rawText);
          }
        }
      } catch (err: any) {
        console.warn(`[pdf] ${method} failed: ${err.message}`);
      }
    }
    if (!parsed) parsed = parseDriverItinerary(rawText);

    if (!parsed.hasDetectedTripNumber) {
      throw new Error('Could not detect trip number in the itinerary document. Please verify the document format.');
    }

    if (!parsed.tripNumber || !/^T\d{4,}/i.test(parsed.tripNumber)) {
      throw new Error('Parsed trip number is invalid. Please upload a valid itinerary document.');
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
