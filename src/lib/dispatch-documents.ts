import path from 'path';
import { db } from '@/lib/db';
import { getDocumentUploadMimeType } from '@/lib/upload-file-types';

export type TripDocument = {
  id: number;
  file_key: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  description: string | null;
  trip_number: string | null;
  source_path: string | null;
  linked_record_type?: string | null;
  linked_record_id?: number | null;
  linked_record_key?: string | null;
  uploaded_at: string | null;
  url: string | null;
  sourceUrl: string | null;
};

export type FuelEntryLike = {
  id: number;
  trip_number?: string | null;
  date?: string | null;
  location?: string | null;
  odometer?: string | number | null;
};

export const RECEIPTS_DIR = path.resolve(process.cwd(), 'receipts');

function documentHaystack(document: Partial<TripDocument>) {
  return `${document.original_filename || ''} ${document.description || ''} ${document.source_path || ''}`.toLowerCase();
}

function normalizeLocationToken(location: string | null | undefined) {
  return String(location || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function documentIdentity(document: Partial<TripDocument>) {
  return document.file_key || document.source_path || `${document.trip_number || ''}:${document.original_filename || ''}`;
}

export function isFuelReceiptDocument(document: Partial<TripDocument>) {
  if (document.linked_record_type === 'fuel') return true;

  const haystack = documentHaystack(document);
  const hasFuelSignal =
    haystack.includes('fuel') ||
    haystack.includes("love") ||
    haystack.includes('diesel') ||
    haystack.includes('petro') ||
    haystack.includes('truck stop');
  const hasNonFuelSignal = haystack.includes('toll') || haystack.includes('lumper') || haystack.includes('scale');

  return hasFuelSignal && !hasNonFuelSignal;
}

export function dedupeTripDocuments(documents: TripDocument[]) {
  const seen = new Set<string>();
  const deduped: TripDocument[] = [];

  for (const document of documents) {
    const identity = documentIdentity(document);
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(document);
  }

  return deduped;
}

export function pickFuelReceiptDocument(entry: FuelEntryLike, documents: TripDocument[]) {
  let best: TripDocument | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const document of documents) {
    if (!isFuelReceiptDocument(document)) continue;

    let score = 0;
    const haystack = documentHaystack(document);
    const entryId = String(entry.id);
    const entryDate = String(entry.date || '');
    const locationToken = normalizeLocationToken(entry.location);
    const odometerToken = entry.odometer == null || entry.odometer === '' ? '' : String(Math.trunc(Number(entry.odometer)));

    if (document.linked_record_type === 'fuel' && String(document.linked_record_id || '') === entryId) score += 1000;
    if (String(document.linked_record_key || '') === entryId) score += 900;
    if (document.trip_number && entry.trip_number && document.trip_number === entry.trip_number) score += 50;
    if (entryDate && haystack.includes(entryDate.toLowerCase())) score += 120;
    if (locationToken && haystack.includes(locationToken)) score += 80;
    if (odometerToken && haystack.includes(odometerToken)) score += 40;
    if (document.linked_record_type === 'fuel') score += 25;

    if (score > bestScore) {
      best = document;
      bestScore = score;
    }
  }

  return best;
}

export function resolveDocumentSourceUrl(document: Partial<TripDocument>) {
  if (document.source_path) return buildSourcePathUrl(document.source_path);
  if (document.file_key) return buildDocumentDownloadUrl(document.file_key);
  return null;
}

export function mapTripDocumentRow(document: Omit<TripDocument, 'url' | 'sourceUrl'>): TripDocument {
  return {
    ...document,
    url: document.file_key ? buildDocumentDownloadUrl(document.file_key) : null,
    sourceUrl: document.source_path ? buildSourcePathUrl(document.source_path) : null,
  };
}

export function resolveDocumentSourcePath(sourcePath: string) {
  const resolvedPath = path.resolve(String(sourcePath || ''));
  const receiptsPrefix = `${RECEIPTS_DIR}${path.sep}`;
  if (resolvedPath !== RECEIPTS_DIR && !resolvedPath.startsWith(receiptsPrefix)) {
    throw new Error('Access denied');
  }
  return resolvedPath;
}

export function getDocumentSourceFileType(sourcePath: string) {
  return getDocumentUploadMimeType({ name: sourcePath }) || 'application/octet-stream';
}

export async function ensureUserDocumentsTable() {
  await db().run(`
    CREATE TABLE IF NOT EXISTS user_documents (
      id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id INTEGER NOT NULL,
      trip_number TEXT,
      filename TEXT NOT NULL,
      file_type TEXT NOT NULL,
      s3_key TEXT NOT NULL,
      file_size BIGINT NOT NULL,
      description TEXT,
      source_path TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS source_path TEXT').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS description TEXT').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_type TEXT').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_id INTEGER').catch(() => {});
  await db().run('ALTER TABLE user_documents ADD COLUMN IF NOT EXISTS linked_record_key TEXT').catch(() => {});
}

export function buildDocumentDownloadUrl(fileKey: string) {
  const encodedKey = fileKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  return `/api/dispatch/documents/download/${encodedKey}?redirect=true`;
}

export function buildSourcePathUrl(sourcePath: string) {
  return `/api/dispatch/documents/source?path=${encodeURIComponent(sourcePath)}`;
}

export async function getTripDocuments(userId: string | number, tripNumber: string): Promise<TripDocument[]> {
  await ensureUserDocumentsTable();

  const documents = await db().query(
    `SELECT id,
            s3_key AS file_key,
            filename AS original_filename,
            file_type,
            file_size,
            description,
            trip_number,
            source_path,
            linked_record_type,
            linked_record_id,
            linked_record_key,
            uploaded_at::text AS uploaded_at
     FROM user_documents
     WHERE user_id = $1 AND trip_number = $2
     ORDER BY uploaded_at DESC, id DESC`,
    [userId, tripNumber]
  ) as Array<Omit<TripDocument, 'url' | 'sourceUrl'>>;

  return documents.map(mapTripDocumentRow);
}

export async function getTripDocumentsForTrips(userId: string | number, tripNumbers: string[]): Promise<TripDocument[]> {
  await ensureUserDocumentsTable();
  if (!tripNumbers.length) return [];

  const documents = await db().query(
    `SELECT id,
            s3_key AS file_key,
            filename AS original_filename,
            file_type,
            file_size,
            description,
            trip_number,
            source_path,
            linked_record_type,
            linked_record_id,
            linked_record_key,
            uploaded_at::text AS uploaded_at
     FROM user_documents
     WHERE user_id = $1 AND trip_number = ANY($2::text[])
     ORDER BY uploaded_at DESC, id DESC`,
    [userId, tripNumbers]
  ) as Array<Omit<TripDocument, 'url' | 'sourceUrl'>>;

  return documents.map(mapTripDocumentRow);
}

export async function getTripReceiptDocuments(userId: string | number, tripNumber: string) {
  const documents = dedupeTripDocuments(await getTripDocuments(userId, tripNumber));
  const linkedFuelDocuments = documents.filter((document) => document.linked_record_type === 'fuel');

  if (linkedFuelDocuments.length) {
    return linkedFuelDocuments.sort((a, b) => (a.linked_record_id || 0) - (b.linked_record_id || 0) || a.id - b.id);
  }

  return documents.filter(isFuelReceiptDocument);
}
