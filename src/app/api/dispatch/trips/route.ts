import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess, userScopedWhere } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function GET(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const db = new Database(dbPath);
    const scope = userScopedWhere(access, 'user_id');
    const trips = db.prepare(`SELECT * FROM trips WHERE ${scope.clause} ORDER BY trip_number DESC`).all(...scope.params);
    return NextResponse.json(trips);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
