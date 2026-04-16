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

export const RECEIPTS_DIR = path.resolve(process.cwd(), 'receipts');

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

  return documents.map((document) => ({
    ...document,
    url: document.file_key ? buildDocumentDownloadUrl(document.file_key) : null,
    sourceUrl: document.source_path ? buildSourcePathUrl(document.source_path) : null,
  }));
}

export async function getTripReceiptDocuments(userId: string | number, tripNumber: string) {
  const documents = await getTripDocuments(userId, tripNumber);

  return documents.filter((document) => {
    const haystack = `${document.original_filename || ''} ${document.description || ''}`.toLowerCase();
    return haystack.includes('fuel') || haystack.includes('receipt');
  });
}
