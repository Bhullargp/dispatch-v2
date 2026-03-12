import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { requireAccess, userScopedWhere } from '@/lib/ownership';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { trailer_number } = await request.json();
    if (!trailer_number) return NextResponse.json({ error: 'Trailer number is required' }, { status: 400 });

    const db = new Database(dbPath);
    const now = new Date().toISOString();
    const targetUserId = access.adminMode ? null : access.session.userId;

    const existing = db.prepare('SELECT trailer_number FROM trailer_inventory WHERE trailer_number = ?').get(trailer_number);
    if (existing) {
      const result = db.prepare(`UPDATE trailer_inventory SET last_seen = ?, user_id = COALESCE(user_id, ?) WHERE trailer_number = ? AND (? OR user_id = ?)`) 
        .run(now, targetUserId, trailer_number, access.adminMode ? 1 : 0, access.session.userId);
      if (!result.changes && !access.adminMode) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      db.prepare('INSERT INTO trailer_inventory (trailer_number, last_seen, user_id) VALUES (?, ?, ?)').run(trailer_number, now, targetUserId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const db = new Database(dbPath);
    const scope = userScopedWhere(access, 'user_id');
    const inventory = db.prepare(`SELECT * FROM trailer_inventory WHERE ${scope.clause} ORDER BY trailer_number ASC`).all(...scope.params);
    return NextResponse.json(inventory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
