import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { db } from '@/lib/db';
import { writeAdminDebugLog } from '@/lib/admin-debug-logs';
import { buildDocumentDownloadUrl, buildSourcePathUrl, ensureUserDocumentsTable, getDocumentSourceFileType, resolveDocumentSourcePath } from '@/lib/dispatch-documents';
import { downloadFromR2 } from '@/lib/r2-storage';
import { ensureTripExpensesReceiptColumns } from '@/lib/trip-expenses';
import Anthropic from '@anthropic-ai/sdk';
import { getRuntimeMethodOrder, isOpenRouterVisionModel } from '@/lib/llm-config';
import {
  extractTextFromImage,
  extractTextFromPdf,
  extractWithClaude,
  extractWithLlm,
  extractWithMinimax,
  extractWithOpenRouterText,
  extractWithOpenRouterVision,
  getLlmConfig,
  llmResultToParsedTrip,
  mergeTripAndStops,
  parseDriverItinerary,
  type ParsedStop,
  type ParsedTrip,
} from '@/lib/pdf-processing';
import {
  classifyDocumentWithValidation,
  inferDocumentType,
  normalizeDocumentType,
  type DocumentDraftType,
  type SmartIntakeLlmResult,
} from '@/lib/document-classifier';

const execFileAsync = promisify(execFile);
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type DocumentDraftStatus = 'processing' | 'needs_review' | 'ready' | 'saved' | 'error' | 'ambiguous';

export type DocumentDraftData = {
  date?: string | null;
  location?: string | null;
  vendor?: string | null;
  invoice_number?: string | null;
  tax_amount?: number | null;
  receipt_type?: string | null;
  gallons?: number | null;
  liters?: number | null;
  def_gallons?: number | null;
  def_liters?: number | null;
  def_amount_usd?: number | null;
  def_price_per_unit?: number | null;
  price_per_unit?: number | null;
  amount_usd?: number | null;
  odometer?: number | null;
  fuel_type?: string | null;
  currency?: string | null;
  name?: string | null;
  category?: string | null;
  notes?: string | null;
  source?: string | null;
  trip_number?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  total_miles?: number | null;
  route?: string | null;
  driver_name?: string | null;
  lead_driver?: string | null;
  co_driver?: string | null;
  truck_number?: string | null;
  trailer_number?: string | null;
  stops?: ParsedStop[] | null;
  raw_text?: string | null;
  [key: string]: unknown;
};

export type DocumentProcessingDraft = {
  id: number;
  user_document_id: number;
  trace_id: string | null;
  trip_number: string | null;
  document_type: DocumentDraftType;
  status: DocumentDraftStatus;
  extracted_data: DocumentDraftData;
  missing_fields: string[];
  error_message: string | null;
  linked_record_type: string | null;
  linked_record_id: number | null;
  linked_record_key: string | null;
  created_at: string | null;
  updated_at: string | null;
  original_filename: string;
  description: string | null;
  file_key: string;
  source_path: string | null;
  url: string | null;
  sourceUrl: string | null;
};

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (!value) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const parsedMoney = parseMoneyCandidate(trimmed);
    if (parsedMoney !== null) return parsedMoney;

    const normalized = trimmed
      .replace(/[,\s](?=\d{3}(?:\D|$))/g, '')
      .replace(/[^0-9.+-]/g, '');

    if (!normalized || normalized === '.' || normalized === '+' || normalized === '-') return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeOcrNumerals(value: string) {
  return value
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[Il|](?=\d)/g, '1')
    .replace(/(?<=\d)[Il|]/g, '1')
    .replace(/[Ss](?=\d)/g, '5')
    .replace(/(?<=\d)[Ss]/g, '5');
}

function parseMoneyCandidate(raw: string) {
  const normalizedRaw = normalizeOcrNumerals(raw)
    .replace(/\s*[:;]\s*(?=\d{2}(?:\D|$))/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedRaw) return null;

  const decimalLike = /[.,:]\s*\d{2,3}(?:\D|$)/.test(normalizedRaw);
  let token = normalizedRaw
    .replace(/[^0-9.,\s-]/g, '')
    .replace(/\s+/g, '')
    .replace(/:(?=\d{2}(?:\D|$))/g, '.');

  if (!token) return null;

  if (token.includes(',') && token.includes('.')) {
    const lastComma = token.lastIndexOf(',');
    const lastDot = token.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    token = token.split(thousandsSeparator).join('');
    if (decimalSeparator === ',') token = token.replace(',', '.');
  } else if (token.includes(',')) {
    if (/,\d{2,3}$/.test(token) && decimalLike) token = token.replace(',', '.');
    else token = token.replace(/,/g, '');
  }

  token = token.replace(/(?!^)-/g, '');
  if (!token || token === '.' || token === '-' || token === '-.') return null;

  const parsed = Number(token);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  if (parsed > 100000) return null;
  return parsed;
}

function parseDate(text: string) {
  const normalized = normalizeOcrNumerals(text)
    .replace(/(\d)\s*[\/.\-]\s*(\d)/g, '$1/$2')
    .replace(/\s+/g, ' ');

  const iso = normalized.match(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (iso) {
    return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }

  const numeric = normalized.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    const parsed = toIsoDate(year, month, day);
    if (parsed) return parsed;
  }

  const named = normalized.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:,)?\s+(\d{2,4})\b/i);
  if (!named) return null;

  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const year = Number(named[3].length === 2 ? `20${named[3]}` : named[3]);
  return toIsoDate(year, months[named[1].slice(0, 3).toLowerCase()] || 1, Number(named[2]));
}

function pickAmount(text: string) {
  const normalized = normalizeOcrNumerals(text)
    .replace(/\s+/g, ' ')
    .trim();

  const numberPattern = /((?:USD|CAD|C\$|\$)\s*)?([0-9][0-9\s,.:;]{0,20}[0-9])/gi;
  const candidates: Array<{ value: number; score: number; index: number; explicitCurrency: boolean }> = [];

  for (const match of normalized.matchAll(numberPattern)) {
    const numeric = parseMoneyCandidate(match[2]);
    if (numeric === null) continue;

    const start = Math.max(0, (match.index || 0) - 30);
    const end = Math.min(normalized.length, (match.index || 0) + match[0].length + 30);
    const context = normalized.slice(start, end).toLowerCase();

    let score = 0;
    if (/grand\s*total|total\s*(?:due|paid)?|amount\s*(?:due|paid)?|sale\s*total|net\s*amount|balance\s*due/.test(context)) score += 7;
    else if (/\btotal\b|\bamount\b|\bdue\b|\bpaid\b/.test(context)) score += 4;
    const explicitCurrency = Boolean(match[1] || /\b(?:usd|cad|c\$)\b|\$/.test(context));
    if (explicitCurrency) score += 2;
    if (/([.,:]\s*\d{2,3})(?:\D|$)/.test(match[2])) score += 2;
    if (/\breceived\b|\bcharged\b|\bpayment\b|\bpaid by\b/.test(context)) score += 1;
    if (/price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|\bppu\b|\/(?:gal|gallon|l|liter|litre)|\bodometer\b|\bgallons?\b|\bliters?\b|\blitres?\b|\bqty\b|\bquantity\b|\btax\s*rate\b|\bamt\/vol\b|\bvol\.\s*corrected\b/.test(context)) score -= 4;

    candidates.push({ value: numeric, score, index: match.index || 0, explicitCurrency });
  }

  if (candidates.length === 0) return null;

  const bestScore = Math.max(...candidates.map((candidate) => candidate.score));
  if (bestScore < 1) return null;

  return candidates
    .filter((candidate) => candidate.score === bestScore)
    .sort((a, b) => (
      Number(b.explicitCurrency) - Number(a.explicitCurrency)
      || b.index - a.index
      || a.value - b.value
    ))[0]?.value || null;
}

function pickLocation(text: string, fallbackName: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.find((line) => {
    const compact = line.toLowerCase();
    if (compact.length < 3 || compact.length > 48) return false;
    if (/receipt|invoice|total|subtotal|tax|visa|mastercard|diesel|fuel|sale/i.test(compact)) return false;
    if (!/[a-z]/i.test(compact)) return false;
    return true;
  });

  return candidate || fallbackName || null;
}

function isLikelyFilenameValue(value: string) {
  const trimmed = value.trim();
  return /^[a-z0-9._-]+\.(?:pdf|jpe?g|png|webp|heic|heif)$/i.test(trimmed)
    || /^\d{4}-\d{2}-\d{2}[-_a-z0-9.]+$/i.test(trimmed);
}

function pickVendor(text: string, fallbackName: string, location?: string | null) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidate = lines.find((line) => {
    const compact = line.toLowerCase();
    if (compact.length < 2 || compact.length > 60) return false;
    if (!/[a-z]/i.test(line)) return false;
    if (isLikelyFilenameValue(line)) return false;
    if (location && compact === location.trim().toLowerCase()) return false;
    if (/receipt|invoice|transaction|ticket|thank you|subtotal|total|tax|date|card|auth|pump|gallons?|liters?|price|amount|due|paid|fleet data|store\s*\d+/i.test(compact)) return false;
    if (/^\d/.test(line) && /,/.test(line)) return false;
    return true;
  });

  if (candidate) return candidate;
  if (location && !isLikelyFilenameValue(location)) return location;
  return isLikelyFilenameValue(fallbackName) ? null : fallbackName || null;
}

const CAD_LOCATION_PATTERN = /\b(ontario|quebec|alberta|british columbia|manitoba|saskatchewan|new brunswick|nova scotia|prince edward island|newfoundland|labrador|yukon|nunavut|northwest territories|toronto|sarnia|windsor|ottawa|mississauga|brampton|vaughan|hamilton|montreal|calgary|edmonton|winnipeg|regina|saskatoon)\b/i;
const US_LOCATION_PATTERN = /\b(al|ak|az|ar|ca|co|ct|de|fl|ga|ia|id|il|in|ks|ky|la|ma|md|me|mi|mn|mo|ms|mt|nc|nd|ne|nh|nj|nm|nv|ny|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|va|vt|wa|wi|wv|wy|district of columbia|alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|iowa|idaho|illinois|indiana|kansas|kentucky|louisiana|massachusetts|maryland|maine|michigan|minnesota|missouri|mississippi|montana|north carolina|north dakota|nebraska|new hampshire|new jersey|new mexico|nevada|new york|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|virginia|vermont|washington|wisconsin|west virginia|wyoming)\b/i;

function inferCurrency(text: string, location?: string | null) {
  const locationText = location || '';
  const geoHint = `${locationText}\n${text.slice(0, 2000)}`;
  if (/\bCAD\b|C\$/i.test(text)) return 'CAD';
  if (/\bcanada\b/i.test(geoHint)) return 'CAD';
  if (/\b(?:united\s+states|usa|u\.s\.a\.?|u\.s\.?)\b/i.test(geoHint)) return 'USD';
  if (US_LOCATION_PATTERN.test(locationText) || /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/.test(geoHint)) return 'USD';
  if (CAD_LOCATION_PATTERN.test(locationText) || /,\s*(?:ON|QC|AB|BC|MB|SK|NB|NS|PE|NL)\b/i.test(geoHint)) return 'CAD';
  if (CAD_LOCATION_PATTERN.test(geoHint)) return 'CAD';
  return 'USD';
}

function parseIsoDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (!Number.isFinite(utc)) return null;
  return utc;
}

async function resolveTripByReceiptDate(params: {
  userId: number;
  explicitTripNumber?: string | null;
  receiptDate?: string | null;
}) {
  const explicitTripNumber = String(params.explicitTripNumber || '').trim().toUpperCase();
  if (explicitTripNumber) return explicitTripNumber;

  const receiptUtc = parseIsoDateOnly(params.receiptDate || null);
  if (receiptUtc === null) return null;

  const trips = await db().query(
    `SELECT trip_number, start_date::text AS start_date, end_date::text AS end_date
     FROM trips
     WHERE user_id = $1
       AND (start_date IS NOT NULL OR end_date IS NOT NULL)`,
    [params.userId]
  ) as Array<{ trip_number: string; start_date: string | null; end_date: string | null }>;

  const candidates = trips
    .map((trip) => {
      const startUtcRaw = parseIsoDateOnly(trip.start_date);
      const endUtcRaw = parseIsoDateOnly(trip.end_date);
      const startUtc = startUtcRaw ?? endUtcRaw;
      const endUtc = endUtcRaw ?? startUtcRaw;
      if (startUtc === null || endUtc === null) return null;
      const rangeStart = Math.min(startUtc, endUtc);
      const rangeEnd = Math.max(startUtc, endUtc);
      const inWindow = receiptUtc >= rangeStart && receiptUtc <= rangeEnd;
      const distance = inWindow ? 0 : Math.min(Math.abs(receiptUtc - rangeStart), Math.abs(receiptUtc - rangeEnd));
      const span = Math.abs(rangeEnd - rangeStart);
      const center = rangeStart + span / 2;
      return {
        tripNumber: trip.trip_number,
        inWindow,
        distance,
        span,
        centerDistance: Math.abs(receiptUtc - center),
      };
    })
    .filter(Boolean) as Array<{ tripNumber: string; inWindow: boolean; distance: number; span: number; centerDistance: number }>;

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (a.inWindow !== b.inWindow) return a.inWindow ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    if (a.span !== b.span) return a.span - b.span;
    if (a.centerDistance !== b.centerDistance) return a.centerDistance - b.centerDistance;
    return b.tripNumber.localeCompare(a.tripNumber);
  });

  return candidates[0]?.tripNumber || null;
}

function sanitizeJsonResponse(content: string) {
  return content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

const TYPE_ALLOWED_FIELDS: Record<DocumentDraftType, string[]> = {
  itinerary: [
    'trip_number', 'start_date', 'end_date', 'total_miles', 'route', 'driver_name', 'lead_driver',
    'co_driver', 'truck_number', 'trailer_number', 'stops', 'raw_text', 'notes',
    'classification_confidence', 'classification_rationale', 'classification_stage',
  ],
  fuel: [
    'date', 'location', 'vendor', 'invoice_number', 'tax_amount', 'receipt_type', 'gallons', 'liters', 'def_gallons', 'def_liters', 'def_amount_usd', 'def_price_per_unit',
    'price_per_unit', 'amount_usd', 'odometer', 'fuel_type', 'currency', 'name', 'category', 'notes', 'source', 'raw_text',
    'classification_confidence', 'classification_rationale', 'classification_stage',
  ],
  toll: ['date', 'location', 'vendor', 'invoice_number', 'tax_amount', 'receipt_type', 'amount_usd', 'currency', 'name', 'category', 'notes', 'source', 'raw_text', 'classification_confidence', 'classification_rationale', 'classification_stage'],
  reimbursement: ['date', 'location', 'vendor', 'invoice_number', 'tax_amount', 'receipt_type', 'amount_usd', 'currency', 'name', 'category', 'notes', 'source', 'raw_text', 'classification_confidence', 'classification_rationale', 'classification_stage'],
  other: ['date', 'location', 'vendor', 'invoice_number', 'tax_amount', 'receipt_type', 'amount_usd', 'currency', 'name', 'category', 'notes', 'source', 'raw_text', 'classification_confidence', 'classification_rationale', 'classification_stage'],
  receipt: ['date', 'location', 'vendor', 'invoice_number', 'tax_amount', 'receipt_type', 'amount_usd', 'currency', 'name', 'category', 'notes', 'source', 'raw_text', 'classification_confidence', 'classification_rationale', 'classification_stage'],
  unknown: ['raw_text', 'notes', 'classification_confidence', 'classification_rationale', 'classification_stage'],
};

function isMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === 'null' || normalized === 'undefined' || normalized === 'n/a' || normalized === 'na' || normalized === 'none') return false;
    return true;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function isValidIsoDateString(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(value) === value;
}

function scoreStringValue(key: string, value: string) {
  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (!normalized) return -100;
  if (['null', 'undefined', 'n/a', 'na', 'none', 'unknown'].includes(lower)) return -80;

  let score = Math.min(normalized.length, 40);

  if (key === 'date') {
    if (isValidIsoDateString(normalized)) return 100;
    if (/^\d{4}-\d{2}-$/.test(normalized) || /^\d{4}-$/.test(normalized)) return -20;
    if (/^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/.test(normalized)) return 70;
  }

  if (key === 'currency') {
    if (normalized === 'USD' || normalized === 'CAD') return 90;
    return -20;
  }

  if (key === 'location' || key === 'vendor' || key === 'name') {
    if (/^img[_-]?\d+|vendor\s*\d|receipt\s*\d/i.test(normalized) || isLikelyFilenameValue(normalized)) score -= 35;
    if (/[a-z]/i.test(normalized)) score += 12;
    if (/\d{3,}/.test(normalized) && !/[a-z]/i.test(normalized)) score -= 10;
    if ((key === 'vendor' || key === 'name') && /^\d+/.test(normalized) && /\b(st|street|rd|road|ave|avenue|dr|drive|hwy|highway|interstate|blvd|boulevard)\b/i.test(normalized)) score -= 18;
    if ((key === 'vendor' || key === 'name') && !/\d/.test(normalized)) score += 10;
  }

  if (key === 'receipt_type') {
    if (['fuel', 'toll', 'reimbursement', 'other'].includes(lower)) return 85;
    return -10;
  }

  return score;
}

function scoreValue(key: string, value: unknown) {
  if (!isMeaningfulValue(value)) return -100;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return -100;
    if (key === 'amount_usd' || key === 'tax_amount' || key === 'price_per_unit' || key === 'def_amount_usd' || key === 'def_price_per_unit') {
      if (value <= 0) return -10;
      return value >= 1 ? 90 : 75;
    }
    if (key === 'gallons' || key === 'liters' || key === 'def_gallons' || key === 'def_liters') {
      if (value <= 0) return -10;
      return 80;
    }
    if (key === 'odometer') {
      if (!Number.isInteger(value)) return -100;
      return value >= 1000 ? 85 : 25;
    }
    return 60;
  }

  if (typeof value === 'string') {
    return scoreStringValue(key, value);
  }

  if (Array.isArray(value)) return value.length ? 70 : -100;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length ? 70 : -100;
  return 50;
}

function mergePreferNonEmpty<T extends Record<string, unknown>>(base: T, override?: Record<string, unknown> | null): T {
  if (!override) return { ...base };
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!isMeaningfulValue(value)) continue;

    const current = merged[key];
    const overrideScore = scoreValue(key, value);
    const currentScore = scoreValue(key, current);

    if (overrideScore > currentScore) {
      merged[key] = value;
    }
  }
  return merged as T;
}

function normalizeByType(type: DocumentDraftType, data: DocumentDraftData): DocumentDraftData {
  const allowed = TYPE_ALLOWED_FIELDS[type] || TYPE_ALLOWED_FIELDS.unknown;
  const normalized: DocumentDraftData = {};
  for (const key of allowed) {
    if (key in data) normalized[key] = data[key];
  }

  if (type === 'fuel') {
    normalized.tax_amount = toNumber(normalized.tax_amount);
    normalized.gallons = toNumber(normalized.gallons);
    normalized.liters = toNumber(normalized.liters);
    normalized.def_gallons = toNumber(normalized.def_gallons);
    normalized.def_liters = toNumber(normalized.def_liters);
    normalized.price_per_unit = toNumber(normalized.price_per_unit);
    normalized.def_price_per_unit = toNumber(normalized.def_price_per_unit);
    normalized.amount_usd = toNumber(normalized.amount_usd);
    normalized.def_amount_usd = toNumber(normalized.def_amount_usd);
    normalized.odometer = toNumber(normalized.odometer);
  } else if (type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'receipt') {
    normalized.amount_usd = toNumber(normalized.amount_usd);
    normalized.tax_amount = toNumber(normalized.tax_amount);
  }

  if (!normalized.name && typeof normalized.vendor === 'string' && normalized.vendor.trim()) {
    normalized.name = normalized.vendor.trim();
  }
  if (!normalized.location && typeof normalized.vendor === 'string' && normalized.vendor.trim()) {
    normalized.location = normalized.vendor.trim();
  }

  return normalized;
}

function parseFuelDraft(text: string, fallbackName: string): DocumentDraftData {
  const cleaned = text || '';
  const labeledGallonsMatch = cleaned.match(/\bgallons?\s*[:#]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const inlineGallonsMatch = cleaned.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:gal|gallons?)\b/i);
  const labeledLitersMatch = cleaned.match(/(?:\bliters?\b|\blitres?\b|\bamt\/vol\b)\s*[:#]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  const inlineLitersMatch = cleaned.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:l|liters?|litres?)\b/i);
  const priceMatch = text.match(/(?:price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|ppu)\s*[: ]\s*\$?\s*([0-9]+(?:\.[0-9]{2,3})?)/i)
    || text.match(/\$\s*([0-9]+(?:\.[0-9]{2,3})?)\s*\/(?:gal|gallon|l|liter|litre)/i);
  const odometerMatch = text.match(/odo(?:meter)?\s*[:# ]\s*(\d{4,8})/i);
  const defBlock = cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)[\s\S]{0,180}/i)?.[0] || '';
  const defGallonsMatch = defBlock.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:gal|gallons?)\b/i)
    || cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)[^\d]{0,25}(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/i)
    || cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)(\d+(?:\.\d+)?)\s*(?:gal|gallons?)\b/i);
  const defLitersMatch = defBlock.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:l|liters?|litres?)\b/i)
    || cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)[^\d]{0,25}(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?)\b/i)
    || cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)(\d+(?:\.\d+)?)\s*(?:l|liters?|litres?)\b/i);
  const defAmountMatch = cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)[\s\S]{0,60}(?:total|amount|sale)?\s*[: ]?\$\s*([0-9]+(?:\.[0-9]{2})?)/i);
  const defPriceMatch = cleaned.match(/(?:def|diesel\s*exhaust\s*fluid)[\s\S]{0,60}(?:price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|ppu)?\s*[: ]?\$\s*([0-9]+(?:\.[0-9]{2,3})?)\s*(?:\/(?:gal|gallon|l|liter|litre))?/i);
  const hasDef = /\bdef\b|diesel\s*exhaust\s*fluid/i.test(cleaned);
  const location = pickLocation(text, fallbackName);
  const vendor = pickVendor(text, fallbackName, location);

  return {
    date: parseDate(text),
    location,
    vendor,
    gallons: labeledGallonsMatch ? Number(labeledGallonsMatch[1]) : inlineGallonsMatch ? Number(inlineGallonsMatch[1]) : null,
    liters: labeledLitersMatch ? Number(labeledLitersMatch[1]) : inlineLitersMatch ? Number(inlineLitersMatch[1]) : null,
    def_gallons: defGallonsMatch ? Number(defGallonsMatch[1]) : null,
    def_liters: defLitersMatch ? Number(defLitersMatch[1]) : null,
    def_amount_usd: defAmountMatch ? Number(defAmountMatch[1]) : null,
    def_price_per_unit: defPriceMatch ? Number(defPriceMatch[1]) : null,
    price_per_unit: priceMatch ? Number(priceMatch[1]) : null,
    amount_usd: pickAmount(text),
    odometer: odometerMatch ? Number(odometerMatch[1]) : null,
    fuel_type: hasDef && /\bdiesel\b/i.test(cleaned) ? 'both' : hasDef ? 'def' : 'diesel',
    currency: inferCurrency(text, location),
    category: 'fuel',
    name: 'Fuel receipt',
    receipt_type: 'fuel',
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseTollDraft(text: string, fallbackName: string): DocumentDraftData {
  const location = pickLocation(text, fallbackName);
  return {
    date: parseDate(text),
    location,
    vendor: pickVendor(text, fallbackName, location),
    amount_usd: pickAmount(text),
    name: 'Toll receipt',
    category: 'toll',
    receipt_type: 'toll',
    currency: inferCurrency(text, location),
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseReimbursementDraft(text: string, fallbackName: string): DocumentDraftData {
  const location = pickLocation(text, fallbackName);
  return {
    date: parseDate(text),
    location,
    vendor: pickVendor(text, fallbackName, location),
    amount_usd: pickAmount(text),
    name: pickVendor(text, fallbackName, location) || 'Reimbursement receipt',
    category: 'reimbursement',
    receipt_type: 'reimbursement',
    currency: inferCurrency(text, location),
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseOtherReceiptDraft(text: string, fallbackName: string): DocumentDraftData {
  const location = pickLocation(text, fallbackName);
  return {
    date: parseDate(text),
    location,
    vendor: pickVendor(text, fallbackName, location),
    amount_usd: pickAmount(text),
    name: pickVendor(text, fallbackName, location) || 'Other receipt',
    category: 'misc',
    receipt_type: 'other',
    currency: inferCurrency(text, location),
    notes: text ? text.slice(0, 1000) : null,
  };
}

const TYPE_PARSERS: Partial<Record<DocumentDraftType, (text: string, fallbackName: string) => DocumentDraftData>> = {
  fuel: parseFuelDraft,
  toll: parseTollDraft,
  reimbursement: parseReimbursementDraft,
  other: parseOtherReceiptDraft,
  receipt: parseOtherReceiptDraft,
};

function parsedTripToDraftData(parsed: ParsedTrip): DocumentDraftData {
  return {
    trip_number: parsed.tripNumber || null,
    start_date: parsed.startDate || null,
    end_date: parsed.endDate || null,
    total_miles: Number(parsed.totalMiles) || null,
    route: parsed.route || null,
    driver_name: parsed.driverName || null,
    lead_driver: parsed.leadDriver || null,
    co_driver: parsed.coDriver || null,
    truck_number: parsed.truckNumber || null,
    trailer_number: parsed.trailerNumber || null,
    stops: Array.isArray(parsed.stops) ? parsed.stops : [],
    raw_text: parsed.rawText || null,
    notes: parsed.notes || null,
  };
}

function draftDataToParsedTrip(data: DocumentDraftData): ParsedTrip {
  const stops = Array.isArray(data.stops)
    ? data.stops.map((stop, index) => ({
        stop_type: String(stop?.stop_type || 'PICKUP').toUpperCase(),
        location: String(stop?.location || '').trim(),
        miles_from_last: Number(stop?.miles_from_last) || 0,
        date: stop?.date ? String(stop.date) : null,
        event_index: Number(stop?.event_index) || index,
      }))
    : [];

  return {
    tripNumber: String(data.trip_number || '').trim().toUpperCase(),
    startDate: data.start_date ? String(data.start_date) : null,
    endDate: data.end_date ? String(data.end_date) : null,
    totalMiles: Number(data.total_miles) || 0,
    route: data.route ? String(data.route) : 'Unknown',
    rawText: data.raw_text ? String(data.raw_text) : '',
    notes: data.notes ? String(data.notes) : '',
    stops,
    placeholders: [],
    hasDetectedTripNumber: Boolean(data.trip_number),
    driverName: data.driver_name ? String(data.driver_name) : null,
    leadDriver: data.lead_driver ? String(data.lead_driver) : null,
    coDriver: data.co_driver ? String(data.co_driver) : null,
    truckNumber: data.truck_number ? String(data.truck_number) : null,
    trailerNumber: data.trailer_number ? String(data.trailer_number) : null,
  };
}

export type ModelTestProvider = 'auto' | 'minimax' | 'claude' | 'zai' | 'openrouter' | 'openrouter-vision' | 'regex';

type ModelTestOptions = {
  provider?: ModelTestProvider;
  model?: string | null;
};

type DebugLogContext = {
  traceId: string;
  userId?: number | null;
  tripNumber?: string | null;
  documentId?: number | null;
  draftId?: number | null;
  fileName?: string | null;
};

function createTraceId(prefix = 'intake') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function logDocumentProcessingEvent(
  context: DebugLogContext | undefined,
  entry: {
    event: string;
    level?: 'info' | 'warn' | 'error';
    message?: string | null;
    provider?: string | null;
    model?: string | null;
    data?: Record<string, unknown> | null;
  }
) {
  if (!context?.traceId) return;
  await writeAdminDebugLog({
    category: 'document-processing',
    event: entry.event,
    level: entry.level,
    message: entry.message,
    userId: context.userId || null,
    tripNumber: context.tripNumber || null,
    provider: entry.provider || null,
    model: entry.model || null,
    documentId: context.documentId || null,
    draftId: context.draftId || null,
    fileName: context.fileName || null,
    traceId: context.traceId,
    data: entry.data || null,
  }).catch(() => {});
}

async function callAnthropicJson(system: string, prompt: string, apiKey: string) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    temperature: 0,
    system,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .map((part: any) => (part?.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty response from Anthropic');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

async function callMinimaxJson(system: string, prompt: string, apiKey: string, model: string) {
  const response = await fetch('https://api.minimax.io/v1/text/chatcompletion_v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Minimax classification failed: ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') throw new Error('Empty response from Minimax');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

async function callZaiJson(system: string, prompt: string, apiKey: string) {
  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'glm-4.5-air',
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`ZAI classification failed: ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text || typeof text !== 'string') throw new Error('Empty response from ZAI');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

async function buildVisionInputs(buffer: Buffer, fileType: string, maxPages = 3): Promise<Array<{ type: 'image_url'; image_url: { url: string } }>> {
  if (fileType.startsWith('image/')) {
    if (fileType === 'image/heic' || fileType === 'image/heif') {
      const tmp = await mkdtemp(join(tmpdir(), 'dispatch-smart-intake-image-'));
      const input = join(tmp, fileType === 'image/heic' ? 'input.heic' : 'input.heif');
      const output = join(tmp, 'input.png');
      try {
        await writeFile(input, buffer);
        await execFileAsync('sips', ['-s', 'format', 'png', input, '--out', output]);
        const png = await readFile(output);
        return [{
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
        }];
      } catch {
        // Fall back to the original HEIC/HEIF payload if conversion is unavailable.
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    }

    return [{
      type: 'image_url',
      image_url: { url: `data:${fileType};base64,${buffer.toString('base64')}` },
    }];
  }

  if (fileType !== 'application/pdf') return [];

  const tmp = await mkdtemp(join(tmpdir(), 'dispatch-smart-intake-'));
  const input = join(tmp, 'input.pdf');
  const prefix = join(tmp, 'page');
  try {
    await writeFile(input, buffer);
    await execFileAsync('pdftoppm', ['-png', '-f', '1', '-l', String(maxPages), '-r', '220', input, prefix]);
    const files = (await readdir(tmp))
      .filter((name) => /^page-\d+\.png$/i.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const inputs: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
    for (const file of files) {
      const png = await readFile(join(tmp, file));
      inputs.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${png.toString('base64')}` },
      });
    }
    return inputs;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function callOpenRouterVisionJson(
  system: string,
  prompt: string,
  buffer: Buffer,
  fileType: string,
  apiKey: string,
  model: string
) {
  const images = await buildVisionInputs(buffer, fileType);
  if (!images.length) throw new Error('No vision inputs available for OpenRouter');

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Dispatch',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images,
          ],
        },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter vision classification failed: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
    : content;
  if (!text || typeof text !== 'string') throw new Error('Empty response from OpenRouter vision');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

async function callAnthropicVisionJson(
  system: string,
  prompt: string,
  buffer: Buffer,
  fileType: string,
  apiKey: string
) {
  const client = new Anthropic({ apiKey });
  const source = fileType === 'application/pdf'
    ? {
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: buffer.toString('base64'),
        },
      }
    : {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: (fileType || 'image/jpeg') as any,
          data: buffer.toString('base64'),
        },
      };

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    temperature: 0,
    system,
    messages: [{
      role: 'user',
      content: [
        source as any,
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content
    .map((part: any) => (part?.type === 'text' ? part.text : ''))
    .join('\n')
    .trim();
  if (!text) throw new Error('Empty response from Anthropic vision');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

async function callOpenRouterTextJson(system: string, prompt: string, apiKey: string, model: string) {
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Dispatch',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) throw new Error(`OpenRouter classification failed: ${response.status}`);
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
    : content;
  if (!text || typeof text !== 'string') throw new Error('Empty response from OpenRouter');
  return JSON.parse(sanitizeJsonResponse(text)) as SmartIntakeLlmResult;
}

function hasStrongAmountEvidence(rawText: string) {
  const normalized = normalizeOcrNumerals(rawText)
    .replace(/\s+/g, ' ')
    .trim();

  return /(?:grand\s*total|sale\s*total|amount\s*(?:due|paid)?|total|received|paid)[^0-9$cadus]{0,24}(?:USD|CAD|C\$|\$)?\s*[0-9]/i.test(normalized);
}

function hasDecimalMoneyEvidence(rawText: string) {
  const normalized = normalizeOcrNumerals(rawText)
    .replace(/\s+/g, ' ')
    .trim();

  return /(?:USD|CAD|C\$|\$)?\s*[0-9][0-9\s,.:;]{0,20}[.,:]\s*\d{2,3}\b/i.test(normalized);
}

function isSuspiciousAmountForType(documentType: DocumentDraftType, amount: number | null, rawText: string) {
  if (!amount || !Number.isFinite(amount) || documentType === 'itinerary' || documentType === 'unknown') return false;

  const normalized = normalizeOcrNumerals(rawText)
    .replace(/\s+/g, ' ')
    .trim();
  const strongAmountEvidence = hasStrongAmountEvidence(normalized);
  const decimalMoneyEvidence = hasDecimalMoneyEvidence(normalized);

  if (documentType === 'fuel') {
    if (!strongAmountEvidence && /\bamt\/vol\b|\bvol\.\s*corrected\b/i.test(normalized)) return true;
    if (amount >= 1000 && !strongAmountEvidence) return true;
    return false;
  }

  if ((documentType === 'reimbursement' || documentType === 'toll' || documentType === 'other' || documentType === 'receipt')
    && amount >= 100
    && !strongAmountEvidence
    && !decimalMoneyEvidence) {
    return true;
  }

  if (amount >= 10000 && !strongAmountEvidence) return true;
  return false;
}

function isSuspiciousLlmResult(result: SmartIntakeLlmResult | null | undefined, rawText: string) {
  const documentType = normalizeDocumentType(result?.document_type);
  const amount = toNumber(result?.extracted_data?.amount_usd);
  return isSuspiciousAmountForType(documentType, amount, rawText);
}

function sanitizeSuspiciousExtractedData(documentType: DocumentDraftType, data: DocumentDraftData, rawText: string) {
  const sanitized = { ...data };
  const amount = toNumber(sanitized.amount_usd);
  if (isSuspiciousAmountForType(documentType, amount, rawText)) {
    sanitized.amount_usd = null;
  }
  return sanitized;
}

async function classifyAndExtractWithLlm(params: {
  rawText: string;
  filename: string;
  description?: string | null;
  buffer?: Buffer | null;
  fileType?: string | null;
  options?: ModelTestOptions;
  debugLogContext?: DebugLogContext;
}) {
  const cfg = await getLlmConfig();
  const selectedProvider = params.options?.provider || 'auto';
  const selectedModel = (params.options?.model || '').trim();
  const buffer = params.buffer || null;
  const fileType = params.fileType || null;
  const hasVisionInput = Boolean(buffer && fileType && (fileType === 'application/pdf' || fileType.startsWith('image/')));
  const system = `You classify trucking dispatch uploads and extract structured data. Return JSON only with this exact shape:\n{\n  "document_type": "dispatch_itinerary" | "fuel_receipt" | "toll_receipt" | "reimbursement" | "other",\n  "confidence": 0.0-1.0,\n  "rationale": "short reason",\n  "extracted_data": { ... }\n}\n\nRules:\n- Use dispatch_itinerary only for trip itinerary / load itinerary documents.\n- Use fuel_receipt, toll_receipt, reimbursement, or other for receipts and expense documents.\n- Fuel must have strong evidence (for example gallons/liters, odometer, price per unit, diesel/DEF line items). Prefer the actual document contents over noisy OCR when they disagree.\n- Printed invoices or receipts for parking, lumper, scales, printouts, copies, fax, scan, supplies, office services, or similar trip costs should usually be reimbursement, not other.\n- When a receipt shows a subtotal, tax, and total, set amount_usd to the final total actually charged, not 0.\n- Set currency from clear receipt clues such as $, USD, CAD, C$, province/state, or merchant location. Default to USD only when the receipt gives no better clue.\n- For receipts, extract only fields you can support from the document: date, location, vendor, invoice_number, tax_amount, receipt_type, gallons, liters, def_gallons, def_liters, def_amount_usd, def_price_per_unit, price_per_unit, amount_usd, odometer, fuel_type, currency, name, category, notes.\n- Do not emit placeholder values like 0, 0.00, Vendor 01, Unknown, or partial dates unless the document explicitly shows them.\n- Do not decide where to save the document. Only classify and extract.`;
  const prompt = `Filename: ${params.filename}\nDescription: ${params.description || ''}\n\nUse the attached file as the primary source of truth when available. OCR text is fallback context only.\n\nDocument text fallback:\n${params.rawText.slice(0, 12000)}`;

  const autoOrder = getRuntimeMethodOrder(cfg.primary, cfg.customProviders);
  const attempts = selectedProvider === 'auto'
    ? [
        ...(hasVisionInput ? ['openrouter-vision', 'claude'] : []),
        ...autoOrder,
      ].filter((value, index, list) => value && list.indexOf(value) === index)
    : [selectedProvider];

  await logDocumentProcessingEvent(params.debugLogContext, {
    event: 'llm_attempt_plan',
    provider: selectedProvider,
    model: selectedModel || null,
    data: {
      fileType,
      hasVisionInput,
      attemptOrder: attempts,
      rawTextLength: params.rawText.length,
    },
  });

  for (const method of attempts) {
    try {
      await logDocumentProcessingEvent(params.debugLogContext, {
        event: 'llm_attempt_start',
        provider: method,
        model: selectedModel || null,
        data: { fileType, hasVisionInput },
      });
      if (method === 'openrouter-vision' && hasVisionInput && cfg.openrouterApiKey && fileType) {
        const openRouterModels = [
          selectedModel || cfg.openrouterVisionModel,
          cfg.openrouterFallbackModel,
        ].filter((value, index, list) => value && list.indexOf(value) === index);

        for (const modelName of openRouterModels) {
          try {
            const result = isOpenRouterVisionModel(modelName)
              ? await callOpenRouterVisionJson(system, prompt, buffer as Buffer, fileType, cfg.openrouterApiKey, modelName)
              : await callOpenRouterTextJson(system, prompt, cfg.openrouterApiKey, modelName);
            if (isSuspiciousLlmResult(result, params.rawText)) {
              await logDocumentProcessingEvent(params.debugLogContext, {
                event: 'llm_attempt_failed',
                level: 'warn',
                provider: method,
                model: modelName,
                message: 'Suspicious extracted amount; trying fallback model/provider',
                data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
              });
              continue;
            }
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_success',
              provider: method,
              model: modelName,
              data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
            });
            return result;
          } catch (error: any) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'error',
              provider: method,
              model: modelName,
              message: String(error?.message || `OpenRouter model ${modelName} failed`),
              data: { fileType, hasVisionInput },
            });
          }
        }
        continue;
      }
      if (method === 'minimax' && cfg.minimaxApiKey) {
        const result = await callMinimaxJson(system, prompt, cfg.minimaxApiKey, selectedModel || cfg.minimaxModel);
        if (isSuspiciousLlmResult(result, params.rawText)) {
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_failed',
            level: 'warn',
            provider: method,
            model: selectedModel || cfg.minimaxModel,
            message: 'Suspicious extracted amount; trying fallback model/provider',
            data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
          });
          continue;
        }
        await logDocumentProcessingEvent(params.debugLogContext, {
          event: 'llm_attempt_success',
          provider: method,
          model: selectedModel || cfg.minimaxModel,
          data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
        });
        return result;
      }
      if (method === 'claude' && cfg.anthropicApiKey) {
        if (hasVisionInput && fileType) {
          const result = await callAnthropicVisionJson(system, prompt, buffer as Buffer, fileType, cfg.anthropicApiKey);
          if (isSuspiciousLlmResult(result, params.rawText)) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'warn',
              provider: method,
              model: 'claude-sonnet-4-6',
              message: 'Suspicious extracted amount; trying fallback model/provider',
              data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
            });
            continue;
          }
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_success',
            provider: method,
            model: 'claude-sonnet-4-6',
            data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
          });
          return result;
        }
        const result = await callAnthropicJson(system, prompt, cfg.anthropicApiKey);
        if (isSuspiciousLlmResult(result, params.rawText)) {
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_failed',
            level: 'warn',
            provider: method,
            model: 'claude-sonnet-4-20250514',
            message: 'Suspicious extracted amount; trying fallback model/provider',
            data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
          });
          continue;
        }
        await logDocumentProcessingEvent(params.debugLogContext, {
          event: 'llm_attempt_success',
          provider: method,
          model: 'claude-sonnet-4-20250514',
          data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
        });
        return result;
      }
      if (method === 'zai' && cfg.zaiApiKey) {
        const result = await callZaiJson(system, prompt, cfg.zaiApiKey);
        if (isSuspiciousLlmResult(result, params.rawText)) {
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_failed',
            level: 'warn',
            provider: method,
            model: 'glm-4.5-air',
            message: 'Suspicious extracted amount; trying fallback model/provider',
            data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
          });
          continue;
        }
        await logDocumentProcessingEvent(params.debugLogContext, {
          event: 'llm_attempt_success',
          provider: method,
          model: 'glm-4.5-air',
          data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
        });
        return result;
      }
      if (method === 'openrouter' && cfg.openrouterApiKey && selectedModel) {
        const openRouterModels = [
          selectedModel,
          cfg.openrouterFallbackModel,
        ].filter((value, index, list) => value && list.indexOf(value) === index);

        for (const modelName of openRouterModels) {
          try {
            const result = isOpenRouterVisionModel(modelName) && hasVisionInput && fileType
              ? await callOpenRouterVisionJson(system, prompt, buffer as Buffer, fileType, cfg.openrouterApiKey, modelName)
              : await callOpenRouterTextJson(system, prompt, cfg.openrouterApiKey, modelName);
            if (isSuspiciousLlmResult(result, params.rawText)) {
              await logDocumentProcessingEvent(params.debugLogContext, {
                event: 'llm_attempt_failed',
                level: 'warn',
                provider: method,
                model: modelName,
                message: 'Suspicious extracted amount; trying fallback model/provider',
                data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
              });
              continue;
            }
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_success',
              provider: method,
              model: modelName,
              data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
            });
            return result;
          } catch (error: any) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'error',
              provider: method,
              model: modelName,
              message: String(error?.message || `OpenRouter model ${modelName} failed`),
              data: { fileType, hasVisionInput },
            });
          }
        }
        continue;
      }
      if (typeof method === 'string' && method.startsWith('custom:')) {
        const id = method.slice('custom:'.length);
        const entry = cfg.customProviders.find((provider) => provider.id === id && provider.enabled);
        if (!entry) continue;

        if (entry.provider === 'openrouter-vision' && hasVisionInput && entry.api_key && fileType) {
          const result = await callOpenRouterVisionJson(system, prompt, buffer as Buffer, fileType, entry.api_key, entry.model || cfg.openrouterVisionModel);
          if (isSuspiciousLlmResult(result, params.rawText)) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'warn',
              provider: method,
              model: entry.model || cfg.openrouterVisionModel,
              message: 'Suspicious extracted amount; trying fallback model/provider',
              data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
            });
            continue;
          }
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_success',
            provider: method,
            model: entry.model || cfg.openrouterVisionModel,
            data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
          });
          return result;
        }
        if (entry.provider === 'openrouter' && entry.api_key && entry.model) {
          const result = await callOpenRouterTextJson(system, prompt, entry.api_key, entry.model);
          if (isSuspiciousLlmResult(result, params.rawText)) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'warn',
              provider: method,
              model: entry.model,
              message: 'Suspicious extracted amount; trying fallback model/provider',
              data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
            });
            continue;
          }
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_success',
            provider: method,
            model: entry.model,
            data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
          });
          return result;
        }
        if (entry.provider === 'minimax' && entry.api_key) {
          const result = await callMinimaxJson(system, prompt, entry.api_key, entry.model || cfg.minimaxModel);
          if (isSuspiciousLlmResult(result, params.rawText)) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'warn',
              provider: method,
              model: entry.model || cfg.minimaxModel,
              message: 'Suspicious extracted amount; trying fallback model/provider',
              data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
            });
            continue;
          }
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_success',
            provider: method,
            model: entry.model || cfg.minimaxModel,
            data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
          });
          return result;
        }
        if (entry.provider === 'zai' && entry.api_key) {
          const result = await callZaiJson(system, prompt, entry.api_key);
          if (isSuspiciousLlmResult(result, params.rawText)) {
            await logDocumentProcessingEvent(params.debugLogContext, {
              event: 'llm_attempt_failed',
              level: 'warn',
              provider: method,
              model: 'glm-4.5-air',
              message: 'Suspicious extracted amount; trying fallback model/provider',
              data: { documentType: result?.document_type || null, amount_usd: result?.extracted_data?.amount_usd ?? null },
            });
            continue;
          }
          await logDocumentProcessingEvent(params.debugLogContext, {
            event: 'llm_attempt_success',
            provider: method,
            model: 'glm-4.5-air',
            data: { documentType: result?.document_type || null, confidence: result?.confidence || null },
          });
          return result;
        }
      }
    } catch (error: any) {
      await logDocumentProcessingEvent(params.debugLogContext, {
        event: 'llm_attempt_failed',
        level: 'error',
        provider: method,
        model: selectedModel || null,
        message: String(error?.message || `Provider ${method} failed`),
        data: { fileType, hasVisionInput },
      });
      continue;
    }
  }

  await logDocumentProcessingEvent(params.debugLogContext, {
    event: 'llm_all_attempts_exhausted',
    level: 'warn',
    provider: selectedProvider,
    model: selectedModel || null,
  });
  return null;
}

async function extractItineraryDraft(
  buffer: Buffer | null | undefined,
  fileType: string,
  rawText: string,
  options?: ModelTestOptions
): Promise<DocumentDraftData> {
  const cfg = await getLlmConfig();
  const selectedProvider = options?.provider || 'auto';
  const selectedModel = (options?.model || '').trim();
  const regexParsed = parseDriverItinerary(rawText);
  if (regexParsed?.tripNumber && ((regexParsed.stops?.length || 0) > 0 || regexParsed.route || regexParsed.totalMiles)) {
    return parsedTripToDraftData(regexParsed);
  }

  let parsed: ParsedTrip | null = regexParsed;
  const isPdf = fileType === 'application/pdf';

  const customMethods = cfg.customProviders
    .filter(entry => entry.enabled)
    .map(entry => `custom:${entry.id}`);

  const ordered = selectedProvider === 'auto'
    ? [cfg.primary, 'minimax', 'claude', 'zai', 'openrouter-vision', ...customMethods, 'regex'].filter((value, index, list) => value && list.indexOf(value) === index)
    : [selectedProvider];

  for (const method of ordered) {
    if (parsed) break;
    try {
      if (method === 'minimax' && cfg.minimaxApiKey) parsed = llmResultToParsedTrip(await extractWithMinimax(rawText, cfg.minimaxApiKey, selectedModel || cfg.minimaxModel), rawText);
      else if (method === 'claude' && cfg.anthropicApiKey && buffer && isPdf) parsed = llmResultToParsedTrip(await extractWithClaude(buffer, cfg.anthropicApiKey), rawText);
      else if (method === 'zai' && cfg.zaiApiKey) parsed = llmResultToParsedTrip(await extractWithLlm(rawText, cfg.zaiApiKey), rawText);
      else if ((method === 'openrouter' || method === 'openrouter-vision') && cfg.openrouterApiKey) {
        const openRouterModels = [
          (selectedModel || cfg.openrouterVisionModel).trim(),
          cfg.openrouterFallbackModel,
        ].filter((value, index, list) => value && list.indexOf(value) === index);

        for (const modelName of openRouterModels) {
          try {
            if (isOpenRouterVisionModel(modelName) && buffer && isPdf) {
              parsed = llmResultToParsedTrip(await extractWithOpenRouterVision(buffer, cfg.openrouterApiKey, modelName), rawText);
            } else {
              parsed = llmResultToParsedTrip(await extractWithOpenRouterText(rawText, cfg.openrouterApiKey, modelName), rawText);
            }
            if (parsed) break;
          } catch {
            continue;
          }
        }
      }
      else if (typeof method === 'string' && method.startsWith('custom:')) {
        const id = method.slice('custom:'.length);
        const entry = cfg.customProviders.find(p => p.id === id && p.enabled);
        if (!entry) continue;
        if (entry.provider === 'openrouter' && entry.api_key && entry.model) {
          parsed = llmResultToParsedTrip(await extractWithOpenRouterText(rawText, entry.api_key, entry.model), rawText);
        } else if (entry.provider === 'openrouter-vision' && buffer && isPdf && entry.api_key) {
          parsed = llmResultToParsedTrip(await extractWithOpenRouterVision(buffer, entry.api_key, entry.model || cfg.openrouterVisionModel), rawText);
        } else if (entry.provider === 'minimax' && entry.api_key) {
          parsed = llmResultToParsedTrip(await extractWithMinimax(rawText, entry.api_key, entry.model || cfg.minimaxModel), rawText);
        } else if (entry.provider === 'zai' && entry.api_key) {
          parsed = llmResultToParsedTrip(await extractWithLlm(rawText, entry.api_key), rawText);
        }
      }
      else if (method === 'regex') parsed = parseDriverItinerary(rawText);
    } catch {
      continue;
    }
  }

  parsed = parsed || parseDriverItinerary(rawText);
  return parsedTripToDraftData(parsed);
}

function getMissingFields(type: DocumentDraftType, data: DocumentDraftData) {
  const REQUIRED_FIELDS_BY_TYPE: Partial<Record<DocumentDraftType, Array<keyof DocumentDraftData>>> = {
    itinerary: ['trip_number'],
    fuel: ['date', 'amount_usd'],
    toll: ['date', 'amount_usd'],
    reimbursement: ['date', 'amount_usd'],
    other: ['date', 'amount_usd'],
    receipt: ['date', 'amount_usd'],
  };

  const hasValue = (field: keyof DocumentDraftData) => {
    const value = data[field];
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.trim().length > 0;
    return true;
  };

  const required = REQUIRED_FIELDS_BY_TYPE[type] || [];
  return required.filter((field) => !hasValue(field)).map((field) => String(field));
}

export const SMART_INTAKE_TEST_HELPERS = {
  toNumber,
  parseDate,
  pickAmount,
  getMissingFields,
  inferDocumentType,
  classifyDocumentWithValidation,
  inferCurrency,
  parseFuelDraft,
};

async function loadDocumentBinary(params: {
  buffer?: Buffer | null;
  sourcePath?: string | null;
  s3Key?: string | null;
  filename: string;
  fileType?: string | null;
}) {
  if (params.buffer) {
    return {
      buffer: params.buffer,
      fileType: params.fileType || getDocumentSourceFileType(params.filename),
    };
  }

  if (params.s3Key) {
    return {
      buffer: await downloadFromR2(params.s3Key),
      fileType: params.fileType || getDocumentSourceFileType(params.filename),
    };
  }

  if (!params.sourcePath) {
    return {
      buffer: null,
      fileType: params.fileType || getDocumentSourceFileType(params.filename),
    };
  }

  const resolvedPath = resolveDocumentSourcePath(params.sourcePath);
  return {
    buffer: await readFile(resolvedPath),
    fileType: params.fileType || getDocumentSourceFileType(resolvedPath),
  };
}

async function extractDocumentText(buffer: Buffer, fileType: string) {
  if (fileType === 'application/pdf') {
    return extractTextFromPdf(buffer);
  }

  if (fileType.startsWith('image/')) {
    return extractTextFromImage(buffer, 'upload');
  }

  if (fileType.startsWith('text/')) {
    return buffer.toString('utf8');
  }

  return '';
}

export async function generateDocumentProcessingPreview(params: {
  filename: string;
  fileType?: string | null;
  description?: string | null;
  buffer: Buffer;
  options?: ModelTestOptions;
}) {
  const debugLogContext: DebugLogContext = {
    traceId: createTraceId('preview'),
    fileName: params.filename,
  };
  await logDocumentProcessingEvent(debugLogContext, {
    event: 'preview_started',
    data: { fileType: params.fileType || null, provider: params.options?.provider || 'auto' },
  });

  const loaded = await loadDocumentBinary({
    buffer: params.buffer,
    filename: params.filename,
    fileType: params.fileType,
  });

  const rawText = await extractDocumentText(loaded.buffer as Buffer, loaded.fileType).catch(() => '');
  await logDocumentProcessingEvent(debugLogContext, {
    event: 'text_extracted',
    data: { detectedFileType: loaded.fileType, rawTextLength: rawText.length },
  });

  const llmResult = (rawText.trim() || loaded.buffer)
    ? await classifyAndExtractWithLlm({
        rawText,
        filename: params.filename,
        description: params.description,
        buffer: loaded.buffer,
        fileType: loaded.fileType,
        options: params.options,
        debugLogContext,
      }).catch(() => null)
    : null;

  const classification = classifyDocumentWithValidation({
    filename: params.filename,
    description: params.description,
    rawText,
    llm: llmResult,
  });
  let documentType = classification.documentType;
  let extractedData: DocumentDraftData = {};

  if (documentType === 'itinerary') {
    extractedData = await extractItineraryDraft(loaded.buffer, loaded.fileType, rawText, params.options);
  } else {
    const parser = TYPE_PARSERS[documentType] || parseOtherReceiptDraft;
    const heuristicData = parser(rawText, params.filename);
    extractedData = mergePreferNonEmpty(heuristicData, llmResult?.extracted_data || null);
    extractedData = sanitizeSuspiciousExtractedData(documentType, extractedData, rawText);
  }

  if (!extractedData.raw_text && rawText) extractedData.raw_text = rawText.slice(0, 12000);
  extractedData.classification_confidence = classification.confidence;
  extractedData.classification_rationale = classification.rationale;
  extractedData.classification_stage = classification.stage;
  extractedData = normalizeByType(documentType, extractedData);

  const missingFields = getMissingFields(documentType, extractedData);
  const status: DocumentDraftStatus = classification.askUserToConfirm
    ? 'ambiguous'
    : documentType === 'unknown'
      ? 'needs_review'
      : missingFields.length === 0
        ? 'ready'
        : 'needs_review';

  await logDocumentProcessingEvent(debugLogContext, {
    event: 'preview_completed',
    data: {
      documentType,
      status,
      missingFields,
      usedLlmClassification: Boolean(llmResult),
      classificationConfidence: classification.confidence,
    },
  });

  return {
    mode: 'dry-run' as const,
    documentType,
    status,
    extractedData,
    missingFields,
    rawTextPreview: rawText.slice(0, 2000),
    meta: {
      provider: params.options?.provider || 'auto',
      model: (params.options?.model || '').trim() || null,
      detectedFileType: loaded.fileType,
      usedLlmClassification: Boolean(llmResult),
      classificationConfidence: classification.confidence,
      classificationStage: classification.stage,
    },
  };
}

export async function ensureDocumentProcessingTables() {
  await ensureUserDocumentsTable();
  await ensureTripExpensesReceiptColumns();

  await db().run(`
    CREATE TABLE IF NOT EXISTS document_processing_drafts (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_document_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      trace_id TEXT,
      trip_number TEXT,
      document_type TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'needs_review',
      extracted_data JSONB,
      missing_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      linked_record_type TEXT,
      linked_record_id INTEGER,
      linked_record_key TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (user_document_id) REFERENCES user_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_type TEXT').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_id INTEGER').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_key TEXT').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS linked_record_type TEXT').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS linked_record_id INTEGER').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS linked_record_key TEXT').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS extracted_data JSONB').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT \'' + '[]' + '\'::jsonb').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS trace_id TEXT').catch(() => {});
}

export async function createDocumentProcessingDraftFromUpload(params: {
  userDocumentId: number;
  userId: number;
  tripNumber?: string | null;
  filename: string;
  description?: string | null;
  fileType?: string | null;
  buffer?: Buffer | null;
  sourcePath?: string | null;
  s3Key?: string | null;
}) {
  await ensureDocumentProcessingTables();
  const debugLogContext: DebugLogContext = {
    traceId: createTraceId('upload'),
    userId: params.userId,
    tripNumber: params.tripNumber || null,
    documentId: params.userDocumentId,
    fileName: params.filename,
  };
  let documentType: DocumentDraftType = 'unknown';
  let status: DocumentDraftStatus = 'needs_review';
  let extractedData: DocumentDraftData = {};
  let missingFields: string[] = [];
  let extractionError: string | null = null;
  let resolvedTripNumber = params.tripNumber || null;

  try {
    await logDocumentProcessingEvent(debugLogContext, {
      event: 'upload_processing_started',
      data: {
        sourcePath: params.sourcePath || null,
        hasBuffer: Boolean(params.buffer),
        hasS3Key: Boolean(params.s3Key),
        fileType: params.fileType || null,
      },
    });
    const loaded = await loadDocumentBinary({
      buffer: params.buffer,
      sourcePath: params.sourcePath,
      s3Key: params.s3Key,
      filename: params.filename,
      fileType: params.fileType,
    });

    let rawText = '';
    if (loaded.buffer) {
      try {
        rawText = await extractDocumentText(loaded.buffer, loaded.fileType);
        await logDocumentProcessingEvent(debugLogContext, {
          event: 'text_extracted',
          data: { detectedFileType: loaded.fileType, rawTextLength: rawText.length },
        });
      } catch {
        extractionError = 'Smart intake could not read this file automatically. Please review and confirm manually.';
        rawText = '';
        await logDocumentProcessingEvent(debugLogContext, {
          event: 'text_extraction_failed',
          level: 'warn',
          message: extractionError,
          data: { detectedFileType: loaded.fileType },
        });
      }
    }

    const llmResult = (rawText.trim() || loaded.buffer)
      ? await classifyAndExtractWithLlm({
          rawText,
          filename: params.filename,
          description: params.description,
          buffer: loaded.buffer,
          fileType: loaded.fileType,
          debugLogContext,
        }).catch(() => null)
      : null;
    const classification = classifyDocumentWithValidation({
      filename: params.filename,
      description: params.description,
      rawText,
      llm: llmResult,
    });
    documentType = classification.documentType;

    if (documentType === 'itinerary') {
      extractedData = await extractItineraryDraft(loaded.buffer, loaded.fileType, rawText);
    } else {
      const parser = TYPE_PARSERS[documentType] || parseOtherReceiptDraft;
      const heuristicData = parser(rawText, params.filename);
      extractedData = mergePreferNonEmpty(heuristicData, llmResult?.extracted_data || null);
      extractedData = sanitizeSuspiciousExtractedData(documentType, extractedData, rawText);
    }

    if (!extractedData.raw_text && rawText) extractedData.raw_text = rawText.slice(0, 12000);
    extractedData.classification_confidence = classification.confidence;
    extractedData.classification_rationale = classification.rationale;
    extractedData.classification_stage = classification.stage;
    if (!extractedData.source) {
      extractedData.source = loaded.buffer ? 'smart-intake' : 'stored-document';
    }
    extractedData = normalizeByType(documentType, extractedData);

    const draftReceiptDate = typeof extractedData.date === 'string' ? extractedData.date : null;
    resolvedTripNumber = await resolveTripByReceiptDate({
      userId: params.userId,
      explicitTripNumber: params.tripNumber || null,
      receiptDate: documentType === 'itinerary' ? null : draftReceiptDate,
    });

    missingFields = getMissingFields(documentType, extractedData);
    status = classification.askUserToConfirm
      ? 'ambiguous'
      : documentType === 'unknown'
        ? 'needs_review'
        : missingFields.length === 0
        ? 'ready'
        : 'needs_review';
    await logDocumentProcessingEvent(debugLogContext, {
      event: 'upload_processing_completed',
      data: {
        documentType,
        status,
        missingFields,
        usedLlmClassification: Boolean(llmResult),
        classificationConfidence: classification.confidence,
      },
    });
  } catch (error: any) {
    documentType = normalizeDocumentType(inferDocumentType(params.filename, params.description, null));
    status = 'error';
    missingFields = [];
    extractionError = String(error?.message || 'Smart intake failed to process this file. Retry extraction or review manually.');
    await logDocumentProcessingEvent(debugLogContext, {
      event: 'upload_processing_failed',
      level: 'error',
      message: extractionError,
      data: { fallbackDocumentType: documentType },
    });
  }

  await db().run(
    `INSERT INTO document_processing_drafts (
       user_document_id, user_id, trace_id, trip_number, document_type, status, extracted_data, missing_fields, error_message, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, NOW())
     ON CONFLICT (user_document_id) DO UPDATE
     SET trace_id = EXCLUDED.trace_id,
         trip_number = EXCLUDED.trip_number,
         document_type = EXCLUDED.document_type,
         status = EXCLUDED.status,
         extracted_data = EXCLUDED.extracted_data,
         missing_fields = EXCLUDED.missing_fields,
         error_message = EXCLUDED.error_message,
         updated_at = NOW()`,
    [
      params.userDocumentId,
      params.userId,
      debugLogContext.traceId,
      resolvedTripNumber,
      documentType,
      status,
      JSON.stringify(extractedData || {}),
      JSON.stringify(missingFields),
      extractionError,
    ]
  );

  if (resolvedTripNumber) {
    await db().run(
      `UPDATE user_documents
       SET trip_number = COALESCE(trip_number, $1)
       WHERE id = $2`,
      [resolvedTripNumber, params.userDocumentId]
    ).catch(() => {});
  }

  return { documentType, status, extractedData, missingFields, extractionError };
}

export async function retryDocumentProcessingDraft(params: {
  draftId: number;
  userId: number;
}) {
  await ensureDocumentProcessingTables();
  await writeAdminDebugLog({
    category: 'document-processing',
    event: 'draft_retry_requested',
    userId: params.userId,
    draftId: params.draftId,
    traceId: createTraceId('retry'),
  }).catch(() => {});

  const draft = await db().get(
    `SELECT d.id,
            d.user_document_id,
            d.trip_number,
            u.filename,
            u.description,
            u.file_type,
            u.s3_key,
            u.source_path
     FROM document_processing_drafts d
     JOIN user_documents u ON u.id = d.user_document_id
     WHERE d.id = $1 AND d.user_id = $2`,
    [params.draftId, params.userId]
  ) as {
    id: number;
    user_document_id: number;
    trip_number: string | null;
    filename: string;
    description: string | null;
    file_type: string | null;
    s3_key: string | null;
    source_path: string | null;
  } | undefined;

  if (!draft) throw new Error('Document draft not found');

  await createDocumentProcessingDraftFromUpload({
    userDocumentId: draft.user_document_id,
    userId: params.userId,
    tripNumber: null,
    filename: draft.filename,
    description: draft.description,
    fileType: draft.file_type || undefined,
    sourcePath: draft.source_path,
    s3Key: draft.s3_key,
  });

  const rows = await getDocumentProcessingDrafts(params.userId, draft.trip_number);
  return rows.find((row) => row.id === params.draftId) || rows.find((row) => row.user_document_id === draft.user_document_id) || null;
}

export async function getDocumentProcessingDrafts(userId: string | number, tripNumber?: string | null): Promise<DocumentProcessingDraft[]> {
  await ensureDocumentProcessingTables();

  const rows = await db().query(
    `SELECT d.id,
            d.user_document_id,
            d.trace_id,
            d.trip_number,
            d.document_type,
            d.status,
            d.extracted_data,
            d.missing_fields,
            d.error_message,
            d.linked_record_type,
            d.linked_record_id,
            d.linked_record_key,
            d.created_at::text AS created_at,
            d.updated_at::text AS updated_at,
            u.filename AS original_filename,
            u.description,
            u.s3_key AS file_key,
            u.source_path
     FROM document_processing_drafts d
     JOIN user_documents u ON u.id = d.user_document_id
     WHERE d.user_id = $1
       AND ($2::text IS NULL OR d.trip_number = $2)
     ORDER BY d.updated_at DESC, d.id DESC`,
    [userId, tripNumber || null]
  ) as Array<any>;

  return rows.map((row) => ({
    ...row,
    document_type: normalizeDocumentType(row.document_type),
    extracted_data: safeParseJson<DocumentDraftData>(row.extracted_data, {}),
    missing_fields: safeParseJson<string[]>(row.missing_fields, []),
    url: row.file_key ? buildDocumentDownloadUrl(row.file_key) : null,
    sourceUrl: row.source_path ? buildSourcePathUrl(row.source_path) : null,
  }));
}

export async function confirmDocumentProcessingDraft(params: {
  draftId: number;
  userId: number;
  tripNumber?: string | null;
  documentType: DocumentDraftType;
  extractedData: DocumentDraftData;
}) {
  await ensureDocumentProcessingTables();
  const traceId = createTraceId('confirm');

  const draft = await db().get(
    `SELECT d.id, d.user_document_id, d.document_type, d.trip_number, u.description, u.s3_key, u.source_path
     FROM document_processing_drafts d
     JOIN user_documents u ON u.id = d.user_document_id
     WHERE d.id = $1 AND d.user_id = $2`,
    [params.draftId, params.userId]
  ) as { id: number; user_document_id: number; document_type: DocumentDraftType; trip_number: string | null; description: string | null; s3_key: string | null; source_path: string | null } | undefined;

  if (!draft) throw new Error('Document draft not found');
  await writeAdminDebugLog({
    category: 'document-processing',
    event: 'draft_confirm_started',
    userId: params.userId,
    tripNumber: params.tripNumber || draft.trip_number || null,
    draftId: params.draftId,
    documentId: draft.user_document_id,
    traceId,
    data: { requestedDocumentType: params.documentType, originalDocumentType: draft.document_type },
  }).catch(() => {});

  const documentType = normalizeDocumentType(params.documentType || draft.document_type);
  const extractedData = normalizeByType(documentType, {
    ...params.extractedData,
    gallons: toNumber(params.extractedData.gallons),
    liters: toNumber(params.extractedData.liters),
    def_gallons: toNumber(params.extractedData.def_gallons),
    def_liters: toNumber(params.extractedData.def_liters),
    def_amount_usd: toNumber(params.extractedData.def_amount_usd),
    def_price_per_unit: toNumber(params.extractedData.def_price_per_unit),
    price_per_unit: toNumber(params.extractedData.price_per_unit),
    amount_usd: toNumber(params.extractedData.amount_usd),
    odometer: toNumber(params.extractedData.odometer),
  });

  const missingFields = getMissingFields(documentType, extractedData);
  if (missingFields.length > 0) {
    await writeAdminDebugLog({
      category: 'document-processing',
      event: 'draft_confirm_blocked',
      level: 'warn',
      userId: params.userId,
      tripNumber: params.tripNumber || draft.trip_number || null,
      draftId: params.draftId,
      documentId: draft.user_document_id,
      traceId,
      message: `Missing required fields: ${missingFields.join(', ')}`,
      data: { documentType, missingFields },
    }).catch(() => {});
    throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
  }

  if (documentType === 'itinerary') {
    const parsedTrip = draftDataToParsedTrip(extractedData);
    if (!parsedTrip.tripNumber) throw new Error('Missing required fields: trip_number');

    const effectiveTripNumber = await mergeTripAndStops(
      params.userId,
      parsedTrip,
      draft.s3_key || draft.source_path || `document-${draft.user_document_id}`
    );

    await db().run(
      `UPDATE user_documents
       SET trip_number = $1,
           description = $2,
           linked_record_type = 'trip',
           linked_record_id = NULL,
           linked_record_key = $3
       WHERE id = $4`,
      [
        effectiveTripNumber,
        `dispatch itinerary • trip ${effectiveTripNumber}`,
        effectiveTripNumber,
        draft.user_document_id,
      ]
    );

    await db().run(
      `UPDATE document_processing_drafts
       SET trip_number = $1,
           document_type = 'itinerary',
           status = 'saved',
           extracted_data = $2::jsonb,
           missing_fields = '[]'::jsonb,
           linked_record_type = 'trip',
           linked_record_id = NULL,
           linked_record_key = $3,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $4`,
      [
        effectiveTripNumber,
        JSON.stringify({ ...extractedData, trip_number: effectiveTripNumber }),
        effectiveTripNumber,
        draft.id,
      ]
    );

    await writeAdminDebugLog({
      category: 'document-processing',
      event: 'draft_confirm_saved',
      userId: params.userId,
      tripNumber: effectiveTripNumber,
      draftId: params.draftId,
      documentId: draft.user_document_id,
      traceId,
      data: { documentType: 'itinerary', linkedRecordType: 'trip', linkedRecordKey: effectiveTripNumber },
    }).catch(() => {});
    return { linkedRecordType: 'trip', linkedRecordId: null, linkedRecordKey: effectiveTripNumber, tripNumber: effectiveTripNumber };
  }

  if (documentType === 'fuel') {
    const defLiters = extractedData.def_liters ?? (extractedData.def_gallons != null ? Number(extractedData.def_gallons) * 3.78541 : null);

    const insert = await db().run(
      `INSERT INTO fuel (
         trip_number, date, location, gallons, liters, price_per_unit, amount_usd,
         unit, odometer, fuel_type, def_liters, def_cost, def_price_per_unit, currency, user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        params.tripNumber || draft.trip_number || null,
        extractedData.date || null,
        extractedData.location || null,
        extractedData.gallons || null,
        extractedData.liters || null,
        extractedData.price_per_unit || null,
        extractedData.amount_usd || null,
        extractedData.liters ? 'Litres' : 'Gallons',
        extractedData.odometer || null,
        extractedData.fuel_type || 'diesel',
        defLiters,
        extractedData.def_amount_usd ?? null,
        extractedData.def_price_per_unit ?? null,
        extractedData.currency || 'USD',
        params.userId,
      ]
    );

    const fuelId = insert.rows?.[0]?.id;
    if (!fuelId) throw new Error('Fuel entry was created without an id');

    await db().run(
      `UPDATE user_documents
       SET trip_number = COALESCE($1, trip_number),
           description = $2,
           linked_record_type = 'fuel',
           linked_record_id = $3,
           linked_record_key = $4
       WHERE id = $5`,
      [
        params.tripNumber || draft.trip_number || null,
        `fuel receipt • fuel #${fuelId}${extractedData.date ? ` • ${extractedData.date}` : ''}`,
        fuelId,
        String(fuelId),
        draft.user_document_id,
      ]
    );
    await db().run(
      `UPDATE document_processing_drafts
       SET trip_number = COALESCE($1, trip_number),
           document_type = 'fuel',
           status = 'saved',
           extracted_data = $2::jsonb,
           missing_fields = '[]'::jsonb,
           linked_record_type = 'fuel',
           linked_record_id = $3,
           linked_record_key = $4,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $5`,
      [params.tripNumber || draft.trip_number || null, JSON.stringify(extractedData), fuelId, String(fuelId), draft.id]
    );

    await writeAdminDebugLog({
      category: 'document-processing',
      event: 'draft_confirm_saved',
      userId: params.userId,
      tripNumber: params.tripNumber || draft.trip_number || null,
      draftId: params.draftId,
      documentId: draft.user_document_id,
      traceId,
      data: { documentType: 'fuel', linkedRecordType: 'fuel', linkedRecordKey: String(fuelId) },
    }).catch(() => {});
    return { linkedRecordType: 'fuel', linkedRecordId: fuelId, linkedRecordKey: String(fuelId) };
  }

  const expenseCurrency = extractedData.currency || inferCurrency(String(extractedData.raw_text || ''), extractedData.location || null);
  const insert = await db().run(
    `INSERT INTO trip_expenses (user_id, trip_number, name, amount, expense_type, category, notes, expense_date, location, currency, source)
     VALUES ($1, $2, $3, $4, 'trip', $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      params.userId,
      params.tripNumber || draft.trip_number || null,
      extractedData.name || extractedData.vendor || (documentType === 'toll'
        ? 'Toll receipt'
        : documentType === 'reimbursement'
          ? 'Reimbursement receipt'
          : 'Other receipt'),
      extractedData.amount_usd || null,
      extractedData.category || (documentType === 'toll'
        ? 'toll'
        : documentType === 'reimbursement'
          ? 'reimbursement'
          : 'misc'),
      extractedData.notes || null,
      extractedData.date || null,
      extractedData.location || null,
      expenseCurrency,
      extractedData.source || 'smart-intake',
    ]
  );

  const expenseId = insert.rows?.[0]?.id;
  if (!expenseId) throw new Error('Expense entry was created without an id');
  await db().run(
    `UPDATE user_documents
     SET trip_number = COALESCE($1, trip_number),
         description = $2,
         linked_record_type = 'expense',
         linked_record_id = $3,
         linked_record_key = $4
     WHERE id = $5`,
    [
      params.tripNumber || draft.trip_number || null,
      documentType === 'toll'
        ? `toll receipt • expense #${expenseId}`
        : documentType === 'reimbursement'
          ? `reimbursement receipt • expense #${expenseId}`
          : `other receipt • expense #${expenseId}`,
      expenseId,
      String(expenseId),
      draft.user_document_id,
    ]
  );
  await db().run(
    `UPDATE document_processing_drafts
     SET trip_number = COALESCE($1, trip_number),
         document_type = $2,
         status = 'saved',
         extracted_data = $3::jsonb,
         missing_fields = '[]'::jsonb,
         linked_record_type = 'expense',
         linked_record_id = $4,
         linked_record_key = $5,
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $6`,
    [params.tripNumber || draft.trip_number || null, documentType, JSON.stringify(extractedData), expenseId, String(expenseId), draft.id]
  );

  await writeAdminDebugLog({
    category: 'document-processing',
    event: 'draft_confirm_saved',
    userId: params.userId,
    tripNumber: params.tripNumber || draft.trip_number || null,
    draftId: params.draftId,
    documentId: draft.user_document_id,
    traceId,
    data: { documentType, linkedRecordType: 'expense', linkedRecordKey: String(expenseId) },
  }).catch(() => {});
  return { linkedRecordType: 'expense', linkedRecordId: expenseId, linkedRecordKey: String(expenseId) };
}
