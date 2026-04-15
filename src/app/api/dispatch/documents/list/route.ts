import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { isR2Configured } from '@/lib/r2-storage';
import { ensureUserDocumentsTable, getTripDocuments } from '@/lib/dispatch-documents';

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

    const { searchParams } = new URL(req.url);
    const tripNumber = searchParams.get('tripNumber');

    if (tripNumber) {
      const documents = await getTripDocuments(access.session.userId, tripNumber);
      return NextResponse.json({ documents });
    }

    const documents = await database.query(`
      SELECT id,
             s3_key AS file_key,
             filename AS original_filename,
             file_type,
             file_size,
             description,
             trip_number,
             source_path,
             uploaded_at::text AS uploaded_at
      FROM user_documents
      WHERE user_id = $1
      ORDER BY uploaded_at DESC, id DESC
    `, [access.session.userId]);

    return NextResponse.json({ documents });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}