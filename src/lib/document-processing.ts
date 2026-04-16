import { readFile } from 'fs/promises';
import { db } from '@/lib/db';
import { buildDocumentDownloadUrl, buildSourcePathUrl, ensureUserDocumentsTable, getDocumentSourceFileType, resolveDocumentSourcePath } from '@/lib/dispatch-documents';
import { downloadFromR2 } from '@/lib/r2-storage';
import Anthropic from '@anthropic-ai/sdk';
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

export type DocumentDraftType = 'itinerary' | 'fuel' | 'toll' | 'reimbursement' | 'other' | 'receipt' | 'unknown';
export type DocumentDraftStatus = 'processing' | 'needs_review' | 'ready' | 'saved' | 'error';

export type DocumentDraftData = {
  date?: string | null;
  location?: string | null;
  gallons?: number | null;
  liters?: number | null;
  price_per_unit?: number | null;
  amount_usd?: number | null;
  odometer?: number | null;
  fuel_type?: string | null;
  currency?: string | null;
  name?: string | null;
  category?: string | null;
  notes?: string | null;
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

function parseDate(text: string) {
  const numeric = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    const month = Number(numeric[1]);
    const day = Number(numeric[2]);
    const year = Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]);
    return toIsoDate(year, month, day);
  }

  const named = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,)?\s+(\d{4})\b/i);
  if (!named) return null;

  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return toIsoDate(Number(named[3]), months[named[1].slice(0, 3).toLowerCase()] || 1, Number(named[2]));
}

function pickAmount(text: string) {
  const labeled = [...text.matchAll(/(?:total|amount|grand total|sale|net)\s*[: ]\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (labeled.length > 0) return Math.max(...labeled);

  const currencyLike = [...text.matchAll(/\$\s*([0-9]+(?:\.[0-9]{2})?)/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (currencyLike.length > 0) return Math.max(...currencyLike);

  return null;
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

function sanitizeJsonResponse(content: string) {
  return content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function normalizeDocumentType(type: DocumentDraftType | string | null | undefined): DocumentDraftType {
  if (type === 'dispatch_itinerary' || type === 'itinerary') return 'itinerary';
  if (type === 'fuel_receipt') return 'fuel';
  if (type === 'toll_receipt') return 'toll';
  if (type === 'receipt') return 'other';
  if (type === 'fuel' || type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'unknown') return type;
  return 'unknown';
}

function inferDocumentType(filename: string, description?: string | null, rawText?: string | null): DocumentDraftType {
  const haystack = `${filename} ${description || ''} ${rawText || ''}`.toLowerCase();
  if (/trip itinerary|driver trip itinerary|dispatch itinerary|\bt\d{4,}\b/.test(haystack)) return 'itinerary';
  if (/toll|ezpass|407|plate|bridge/.test(haystack)) return 'toll';
  if (/fuel|diesel|def|pump/.test(haystack)) return 'fuel';
  if (/reimb|reimbursement|expense/.test(haystack)) return 'reimbursement';
  if (/receipt|parking|scale|lumper|repair|wash/.test(haystack)) return 'other';
  return 'unknown';
}

function parseFuelDraft(text: string, fallbackName: string): DocumentDraftData {
  const gallonsMatch = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:gal|gallons?)\b/i);
  const litersMatch = text.match(/\b([0-9]+(?:\.[0-9]+)?)\s*(?:l|liters?|litres?)\b/i);
  const priceMatch = text.match(/(?:price\s*(?:\/|per)?\s*(?:unit|gal|gallon|l|liter|litre)|ppu)\s*[: ]\s*\$?\s*([0-9]+(?:\.[0-9]{2,3})?)/i)
    || text.match(/\$\s*([0-9]+(?:\.[0-9]{2,3})?)\s*\/(?:gal|gallon|l|liter|litre)/i);
  const odometerMatch = text.match(/odo(?:meter)?\s*[:# ]\s*(\d{4,8})/i);

  return {
    date: parseDate(text),
    location: pickLocation(text, fallbackName),
    gallons: gallonsMatch ? Number(gallonsMatch[1]) : null,
    liters: litersMatch ? Number(litersMatch[1]) : null,
    price_per_unit: priceMatch ? Number(priceMatch[1]) : null,
    amount_usd: pickAmount(text),
    odometer: odometerMatch ? Number(odometerMatch[1]) : null,
    fuel_type: /\bdef\b/i.test(text) ? 'def' : 'diesel',
    currency: /\bCAD\b|C\$/i.test(text) ? 'CAD' : 'USD',
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseTollDraft(text: string, fallbackName: string): DocumentDraftData {
  return {
    date: parseDate(text),
    location: pickLocation(text, fallbackName),
    amount_usd: pickAmount(text),
    name: 'Toll receipt',
    category: 'toll',
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseReimbursementDraft(text: string, fallbackName: string): DocumentDraftData {
  return {
    date: parseDate(text),
    location: pickLocation(text, fallbackName),
    amount_usd: pickAmount(text),
    name: fallbackName || 'Reimbursement receipt',
    category: 'reimbursement',
    notes: text ? text.slice(0, 1000) : null,
  };
}

function parseOtherReceiptDraft(text: string, fallbackName: string): DocumentDraftData {
  return {
    date: parseDate(text),
    location: pickLocation(text, fallbackName),
    amount_usd: pickAmount(text),
    name: fallbackName || 'Other receipt',
    category: 'misc',
    notes: text ? text.slice(0, 1000) : null,
  };
}

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

type SmartIntakeLlmResult = {
  document_type?: string | null;
  extracted_data?: Record<string, unknown> | null;
};

export type ModelTestProvider = 'auto' | 'minimax' | 'claude' | 'zai' | 'openrouter' | 'openrouter-vision' | 'regex';

type ModelTestOptions = {
  provider?: ModelTestProvider;
  model?: string | null;
};

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

async function classifyAndExtractWithLlm(
  rawText: string,
  filename: string,
  description?: string | null,
  options?: ModelTestOptions
) {
  const cfg = await getLlmConfig();
  const selectedProvider = options?.provider || 'auto';
  const selectedModel = (options?.model || '').trim();
  const system = `You classify trucking dispatch uploads and extract structured data. Return JSON only with this exact shape:\n{\n  "document_type": "dispatch_itinerary" | "fuel_receipt" | "toll_receipt" | "reimbursement" | "other",\n  "extracted_data": { ... }\n}\n\nRules:\n- Use dispatch_itinerary only for trip itinerary / load itinerary documents.\n- Use fuel_receipt, toll_receipt, reimbursement, or other for receipts and expense documents.\n- For receipts, extract only fields you can support from the text: date, location, gallons, liters, price_per_unit, amount_usd, odometer, fuel_type, currency, name, category, notes.\n- Do not decide where to save the document. Only classify and extract.`;
  const prompt = `Filename: ${filename}\nDescription: ${description || ''}\n\nDocument text:\n${rawText.slice(0, 12000)}`;

  const attempts = selectedProvider === 'auto'
    ? [cfg.primary, 'minimax', 'claude', 'zai'].filter((value, index, list) => list.indexOf(value) === index)
    : [selectedProvider === 'openrouter-vision' ? 'openrouter' : selectedProvider];

  for (const method of attempts) {
    try {
      if (method === 'minimax' && cfg.minimaxApiKey) return await callMinimaxJson(system, prompt, cfg.minimaxApiKey, selectedModel || cfg.minimaxModel);
      if (method === 'claude' && cfg.anthropicApiKey) return await callAnthropicJson(system, prompt, cfg.anthropicApiKey);
      if (method === 'zai' && cfg.zaiApiKey) return await callZaiJson(system, prompt, cfg.zaiApiKey);
    } catch {
      continue;
    }
  }

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
  let parsed: ParsedTrip | null = null;
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
      else if ((method === 'openrouter' || method === 'openrouter-vision') && buffer && isPdf && cfg.openrouterApiKey) {
        parsed = llmResultToParsedTrip(await extractWithOpenRouterVision(buffer, cfg.openrouterApiKey, selectedModel || cfg.openrouterVisionModel), rawText);
      }
      else if (method === 'openrouter' && cfg.openrouterApiKey && (selectedModel || '').trim()) {
        parsed = llmResultToParsedTrip(await extractWithOpenRouterText(rawText, cfg.openrouterApiKey, selectedModel.trim()), rawText);
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
  if (type === 'itinerary') {
    return ['trip_number'].filter((field) => !data[field as keyof DocumentDraftData]);
  }
  if (type === 'fuel') {
    return ['date', 'amount_usd', 'odometer'].filter((field) => !data[field as keyof DocumentDraftData]);
  }
  if (type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'receipt') {
    return ['date', 'amount_usd', 'name'].filter((field) => !data[field as keyof DocumentDraftData]);
  }
  return [];
}

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
  const loaded = await loadDocumentBinary({
    buffer: params.buffer,
    filename: params.filename,
    fileType: params.fileType,
  });

  const rawText = await extractDocumentText(loaded.buffer as Buffer, loaded.fileType).catch(() => '');

  const llmResult = rawText.trim()
    ? await classifyAndExtractWithLlm(rawText, params.filename, params.description, params.options).catch(() => null)
    : null;

  let documentType = normalizeDocumentType(llmResult?.document_type || inferDocumentType(params.filename, params.description, rawText));
  let extractedData: DocumentDraftData = {};

  if (documentType === 'itinerary') {
    extractedData = await extractItineraryDraft(loaded.buffer, loaded.fileType, rawText, params.options);
  } else if (documentType === 'fuel') {
    extractedData = { ...parseFuelDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
  } else if (documentType === 'toll') {
    extractedData = { ...parseTollDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
  } else if (documentType === 'reimbursement') {
    extractedData = { ...parseReimbursementDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
  } else if (documentType === 'other' || documentType === 'receipt') {
    extractedData = { ...parseOtherReceiptDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
  }

  if (!extractedData.raw_text && rawText) extractedData.raw_text = rawText.slice(0, 12000);

  const missingFields = getMissingFields(documentType, extractedData);
  const status: DocumentDraftStatus = documentType === 'unknown'
    ? 'needs_review'
    : missingFields.length === 0
      ? 'ready'
      : 'needs_review';

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
    },
  };
}

export async function ensureDocumentProcessingTables() {
  await ensureUserDocumentsTable();

  await db().run(`
    CREATE TABLE IF NOT EXISTS document_processing_drafts (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_document_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
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
  let documentType: DocumentDraftType = 'unknown';
  let status: DocumentDraftStatus = 'needs_review';
  let extractedData: DocumentDraftData = {};
  let missingFields: string[] = [];
  let extractionError: string | null = null;

  try {
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
      } catch {
        extractionError = 'Smart intake could not read this file automatically. Please review and confirm manually.';
        rawText = '';
      }
    }

    const llmResult = rawText.trim()
      ? await classifyAndExtractWithLlm(rawText, params.filename, params.description).catch(() => null)
      : null;
    documentType = normalizeDocumentType(llmResult?.document_type || inferDocumentType(params.filename, params.description, rawText));

    if (documentType === 'itinerary') {
      extractedData = await extractItineraryDraft(loaded.buffer, loaded.fileType, rawText);
    } else if (documentType === 'fuel') {
      extractedData = { ...parseFuelDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
    } else if (documentType === 'toll') {
      extractedData = { ...parseTollDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
    } else if (documentType === 'reimbursement') {
      extractedData = { ...parseReimbursementDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
    } else if (documentType === 'other' || documentType === 'receipt') {
      extractedData = { ...parseOtherReceiptDraft(rawText, params.filename), ...(llmResult?.extracted_data || {}) };
    }

    if (!extractedData.raw_text && rawText) extractedData.raw_text = rawText.slice(0, 12000);

    missingFields = getMissingFields(documentType, extractedData);
    status = documentType === 'unknown'
      ? 'needs_review'
      : missingFields.length === 0
        ? 'ready'
        : 'needs_review';
  } catch (error: any) {
    documentType = normalizeDocumentType(inferDocumentType(params.filename, params.description, null));
    status = 'error';
    missingFields = [];
    extractionError = String(error?.message || 'Smart intake failed to process this file. Retry extraction or review manually.');
  }

  await db().run(
    `INSERT INTO document_processing_drafts (
       user_document_id, user_id, trip_number, document_type, status, extracted_data, missing_fields, error_message, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, NOW())
     ON CONFLICT (user_document_id) DO UPDATE
     SET trip_number = EXCLUDED.trip_number,
         document_type = EXCLUDED.document_type,
         status = EXCLUDED.status,
         extracted_data = EXCLUDED.extracted_data,
         missing_fields = EXCLUDED.missing_fields,
         error_message = EXCLUDED.error_message,
         updated_at = NOW()`,
    [
      params.userDocumentId,
      params.userId,
      params.tripNumber || null,
      documentType,
      status,
      JSON.stringify(extractedData || {}),
      JSON.stringify(missingFields),
      extractionError,
    ]
  );

  return { documentType, status, extractedData, missingFields, extractionError };
}

export async function retryDocumentProcessingDraft(params: {
  draftId: number;
  userId: number;
}) {
  await ensureDocumentProcessingTables();

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
    tripNumber: draft.trip_number,
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

  const draft = await db().get(
    `SELECT d.id, d.user_document_id, d.document_type, d.trip_number, u.description, u.s3_key, u.source_path
     FROM document_processing_drafts d
     JOIN user_documents u ON u.id = d.user_document_id
     WHERE d.id = $1 AND d.user_id = $2`,
    [params.draftId, params.userId]
  ) as { id: number; user_document_id: number; document_type: DocumentDraftType; trip_number: string | null; description: string | null; s3_key: string | null; source_path: string | null } | undefined;

  if (!draft) throw new Error('Document draft not found');

  const documentType = normalizeDocumentType(params.documentType || draft.document_type);
  const extractedData = {
    ...params.extractedData,
    gallons: toNumber(params.extractedData.gallons),
    liters: toNumber(params.extractedData.liters),
    price_per_unit: toNumber(params.extractedData.price_per_unit),
    amount_usd: toNumber(params.extractedData.amount_usd),
    odometer: toNumber(params.extractedData.odometer),
  };

  const missingFields = getMissingFields(documentType, extractedData);
  if (missingFields.length > 0) {
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

    return { linkedRecordType: 'trip', linkedRecordId: null, linkedRecordKey: effectiveTripNumber, tripNumber: effectiveTripNumber };
  }

  if (documentType === 'fuel') {
    const insert = await db().run(
      `INSERT INTO fuel (
         trip_number, date, location, gallons, liters, price_per_unit, amount_usd,
         unit, odometer, fuel_type, currency, user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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

    return { linkedRecordType: 'fuel', linkedRecordId: fuelId, linkedRecordKey: String(fuelId) };
  }

  const insert = await db().run(
    `INSERT INTO trip_expenses (user_id, trip_number, name, amount, expense_type, category, notes)
     VALUES ($1, $2, $3, $4, 'trip', $5, $6)
     RETURNING id`,
    [
      params.userId,
      params.tripNumber || draft.trip_number || null,
      extractedData.name || (documentType === 'toll'
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
      extractedData.notes || extractedData.location || null,
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

  return { linkedRecordType: 'expense', linkedRecordId: expenseId, linkedRecordKey: String(expenseId) };
}
