import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number } = await params;
    const body = await request.json();
    const { location, date, stop_type, miles_from_last } = body;

    const db = new Database(dbPath);
    if (!ensureTripOwnership(db, access, trip_number)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = db.prepare(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(trip_number, date || null, location, stop_type || 'Stop', miles_from_last || 0, access.adminMode ? null : access.session.userId);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
