import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureUserDocumentsTable } from '@/lib/dispatch-documents';
import { requireAccess } from '@/lib/ownership';
import { isR2Configured } from '@/lib/r2-storage';

// Confirm a direct browser upload and store metadata
export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    if (!isR2Configured()) {
      return NextResponse.json(
        { error: 'Document storage is not configured' },
        { status: 503 }
      );
    }

    const body = await req.json();
    const { key, originalFilename, fileType, fileSize, description, tripNumber } = body;

    if (!key || !originalFilename || !fileType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Security: Ensure the key belongs to the user
    if (!key.startsWith(`documents/${access.session.userId}/`)) {
      return NextResponse.json(
        { error: 'Invalid file key' },
        { status: 403 }
      );
    }

    const database = db();
    await ensureUserDocumentsTable();

    await database.run(`
      INSERT INTO user_documents (user_id, s3_key, filename, file_type, file_size, description, trip_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [access.session.userId, key, originalFilename, fileType, fileSize, description, tripNumber]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
