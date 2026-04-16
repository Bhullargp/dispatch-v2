import path from 'path';
import { readFile } from 'fs/promises';
import { db } from '../src/lib/db';
import {
  createDocumentProcessingDraftFromUpload,
  ensureDocumentProcessingTables,
  generateDocumentProcessingPreview,
  getDocumentProcessingDrafts,
  retryDocumentProcessingDraft,
} from '../src/lib/document-processing';

async function main() {
  await ensureDocumentProcessingTables();

  const user = await db().get('SELECT id FROM users ORDER BY id ASC LIMIT 1');
  if (!user?.id) throw new Error('No users found');
  const userId = Number(user.id);

  const samplePath = path.resolve(process.cwd(), 'receipts/2026-04-14-love-475-sweetwater-tx.jpg');
  const buffer = await readFile(samplePath);

  const preview = await generateDocumentProcessingPreview({
    filename: path.basename(samplePath),
    fileType: 'image/jpeg',
    buffer,
    options: { provider: 'regex' },
  });

  console.log('DRY_RUN_PREVIEW', JSON.stringify({
    documentType: preview.documentType,
    status: preview.status,
    missing: preview.missingFields,
    amount: preview.extractedData.amount_usd,
    odometer: preview.extractedData.odometer,
  }, null, 2));

  const insertResult = await db().run(
    `INSERT INTO user_documents (user_id, s3_key, filename, file_type, file_size, description, trip_number, source_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      null,
      path.basename(samplePath),
      'image/jpeg',
      buffer.length,
      'Smart intake upload',
      null,
      samplePath,
    ]
  );

  const userDocumentId = Number(insertResult.rows?.[0]?.id);
  if (!userDocumentId) throw new Error('Failed to insert user_document row');

  await createDocumentProcessingDraftFromUpload({
    userDocumentId,
    userId,
    filename: path.basename(samplePath),
    description: 'Smart intake upload',
    fileType: 'image/jpeg',
    sourcePath: samplePath,
  });

  const drafts = await getDocumentProcessingDrafts(userId, null);
  const draft = drafts.find((row) => row.user_document_id === userDocumentId);
  if (!draft) throw new Error('Draft not found after upload processing');

  console.log('INITIAL_DRAFT', JSON.stringify({
    draftId: draft.id,
    documentType: draft.document_type,
    status: draft.status,
    missing: draft.missing_fields,
    amount: draft.extracted_data?.amount_usd,
  }, null, 2));

  const retried = await retryDocumentProcessingDraft({ draftId: draft.id, userId });
  if (!retried) throw new Error('Retry did not return a draft');

  console.log('RETRIED_DRAFT', JSON.stringify({
    draftId: retried.id,
    documentType: retried.document_type,
    status: retried.status,
    missing: retried.missing_fields,
    amount: retried.extracted_data?.amount_usd,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
