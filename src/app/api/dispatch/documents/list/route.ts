import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { isR2Configured } from '@/lib/r2-storage';
import { ensureUserDocumentsTable, getTripDocuments } from '@/lib/dispatch-documents';
import { ensureDocumentProcessingTables } from '@/lib/document-processing';

// GET - List user's documents with metadata
export async function GET(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Document storage is not configured. Please set R2 environment variables.' },
        { status: 503 }
      );
    }

    const database = db();
    await ensureUserDocumentsTable();
    await ensureDocumentProcessingTables();

    const { searchParams } = new URL(req.url);
    const tripNumber = searchParams.get('tripNumber');

    if (tripNumber) {
      const documents = await getTripDocuments(access.session.userId, tripNumber);
      return NextResponse.json({ documents });
    }

    const documents = await database.query(`
      SELECT u.id,
             u.s3_key AS file_key,
             u.filename AS original_filename,
             u.file_type,
             u.file_size,
             u.description,
             u.trip_number,
             u.source_path,
             u.uploaded_at::text AS uploaded_at,
             d.id AS processing_draft_id
      FROM user_documents u
      LEFT JOIN document_processing_drafts d
        ON d.user_document_id = u.id
       AND d.user_id = u.user_id
      WHERE u.user_id = $1
      ORDER BY u.uploaded_at DESC, u.id DESC
    `, [access.session.userId]);

    return NextResponse.json({ documents });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
