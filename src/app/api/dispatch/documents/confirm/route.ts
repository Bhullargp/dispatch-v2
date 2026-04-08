import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
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
        uploaded_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await database.run(`
      INSERT INTO user_documents (user_id, file_key, original_filename, file_type, file_size, description, trip_number)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [access.session.userId, key, originalFilename, fileType, fileSize, description, tripNumber]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}