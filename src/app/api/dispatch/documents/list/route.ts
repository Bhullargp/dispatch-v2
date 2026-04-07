import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { isR2Configured } from '@/lib/r2-storage';

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

    // Ensure documents table exists
    await database.run(`
      CREATE TABLE IF NOT EXISTS user_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        file_key TEXT NOT NULL,
        original_filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        description TEXT,
        trip_number TEXT,
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    const { searchParams } = new URL(req.url);
    const tripNumber = searchParams.get('tripNumber');

    let query = `
      SELECT id, file_key, original_filename, file_type, file_size, description, trip_number, uploaded_at
      FROM user_documents
      WHERE user_id = $1
    `;
    const params: any[] = [access.session.userId];

    if (tripNumber) {
      query += ` AND trip_number = $2`;
      params.push(tripNumber);
    }

    query += ` ORDER BY uploaded_at DESC`;

    const documents = await database.query(query, params);

    return NextResponse.json({ documents });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}