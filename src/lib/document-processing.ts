import { db } from '@/lib/db';
import { buildDocumentDownloadUrl, buildSourcePathUrl, ensureUserDocumentsTable } from '@/lib/dispatch-documents';
import { extractTextFromPdf } from '@/lib/pdf-processing';

export type DocumentDraftType = 'fuel' | 'toll' | 'reimbursement' | 'other' | 'receipt' | 'unknown';
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

function normalizeDocumentType(type: DocumentDraftType | string | null | undefined): DocumentDraftType {
  if (type === 'receipt') return 'other';
  if (type === 'fuel' || type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'unknown') return type;
  return 'unknown';
}

function inferDocumentType(filename: string, description?: string | null): DocumentDraftType {
  const haystack = `${filename} ${description || ''}`.toLowerCase();
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

function getMissingFields(type: DocumentDraftType, data: DocumentDraftData) {
  if (type === 'fuel') {
    return ['date', 'amount_usd', 'odometer'].filter((field) => !data[field as keyof DocumentDraftData]);
  }
  if (type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'receipt') {
    return ['date', 'amount_usd', 'name'].filter((field) => !data[field as keyof DocumentDraftData]);
  }
  return [];
}

async function extractDocumentText(buffer: Buffer, fileType: string) {
  if (fileType === 'application/pdf') {
    return extractTextFromPdf(buffer);
  }

  if (fileType.startsWith('text/')) {
    return buffer.toString('utf8');
  }

  return '';
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
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (user_document_id) REFERENCES user_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_type TEXT').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_id INTEGER').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS linked_record_type TEXT').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS linked_record_id INTEGER').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS extracted_data JSONB').catch(() => {});
  await db().run('ALTER TABLE document_processing_drafts ADD COLUMN IF NOT EXISTS missing_fields JSONB NOT NULL DEFAULT \'' + '[]' + '\'::jsonb').catch(() => {});
}

export async function createDocumentProcessingDraftFromUpload(params: {
  userDocumentId: number;
  userId: number;
  tripNumber?: string | null;
  filename: string;
  description?: string | null;
  fileType: string;
  buffer?: Buffer | null;
}) {
  await ensureDocumentProcessingTables();

  const documentType = normalizeDocumentType(inferDocumentType(params.filename, params.description));
  const rawText = params.buffer ? await extractDocumentText(params.buffer, params.fileType) : '';

  let extractedData: DocumentDraftData = {};
  if (documentType === 'fuel') {
    extractedData = parseFuelDraft(rawText, params.filename);
  } else if (documentType === 'toll') {
    extractedData = parseTollDraft(rawText, params.filename);
  } else if (documentType === 'reimbursement') {
    extractedData = parseReimbursementDraft(rawText, params.filename);
  } else if (documentType === 'other' || documentType === 'receipt') {
    extractedData = parseOtherReceiptDraft(rawText, params.filename);
  }

  const missingFields = getMissingFields(documentType, extractedData);
  const status: DocumentDraftStatus = documentType === 'unknown'
    ? 'needs_review'
    : missingFields.length === 0
      ? 'ready'
      : 'needs_review';

  await db().run(
    `INSERT INTO document_processing_drafts (
       user_document_id, user_id, trip_number, document_type, status, extracted_data, missing_fields, error_message, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, NULL, NOW())
     ON CONFLICT (user_document_id) DO UPDATE
     SET trip_number = EXCLUDED.trip_number,
         document_type = EXCLUDED.document_type,
         status = EXCLUDED.status,
         extracted_data = EXCLUDED.extracted_data,
         missing_fields = EXCLUDED.missing_fields,
         error_message = NULL,
         updated_at = NOW()`,
    [
      params.userDocumentId,
      params.userId,
      params.tripNumber || null,
      documentType,
      status,
      JSON.stringify(extractedData || {}),
      JSON.stringify(missingFields),
    ]
  );

  return { documentType, status, extractedData, missingFields };
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
    `SELECT d.id, d.user_document_id, d.document_type, d.trip_number, u.description
     FROM document_processing_drafts d
     JOIN user_documents u ON u.id = d.user_document_id
     WHERE d.id = $1 AND d.user_id = $2`,
    [params.draftId, params.userId]
  ) as { id: number; user_document_id: number; document_type: DocumentDraftType; trip_number: string | null; description: string | null } | undefined;

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
           linked_record_id = $3
       WHERE id = $4`,
      [
        params.tripNumber || draft.trip_number || null,
        `fuel receipt • fuel #${fuelId}${extractedData.date ? ` • ${extractedData.date}` : ''}`,
        fuelId,
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
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $4`,
      [params.tripNumber || draft.trip_number || null, JSON.stringify(extractedData), fuelId, draft.id]
    );

    return { linkedRecordType: 'fuel', linkedRecordId: fuelId };
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
         linked_record_id = $3
     WHERE id = $4`,
    [
      params.tripNumber || draft.trip_number || null,
      documentType === 'toll'
        ? `toll receipt • expense #${expenseId}`
        : documentType === 'reimbursement'
          ? `reimbursement receipt • expense #${expenseId}`
          : `other receipt • expense #${expenseId}`,
      expenseId,
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
         error_message = NULL,
         updated_at = NOW()
     WHERE id = $5`,
    [params.tripNumber || draft.trip_number || null, documentType, JSON.stringify(extractedData), expenseId, draft.id]
  );

  return { linkedRecordType: 'expense', linkedRecordId: expenseId };
}
