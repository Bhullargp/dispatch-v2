import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { requireAccess } from '@/lib/ownership';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { trip_number, date, location, stop_type, miles_from_last } = await request.json();
    const db = new Database(dbPath);

    const ownedTrip = db.prepare(`SELECT trip_number FROM trips WHERE trip_number = ? AND (? OR user_id = ?)`)
      .get(trip_number, access.adminMode ? 1 : 0, access.session.userId);
    if (!ownedTrip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = db.prepare(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(trip_number, date, location, stop_type, miles_from_last || 0, access.adminMode ? null : access.session.userId);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { id, location, date, stop_type, miles_from_last } = body;
    const db = new Database(dbPath);

    const existing = db.prepare(`SELECT id FROM stops WHERE id = ? AND (? OR user_id = ?)`)
      .get(id, access.adminMode ? 1 : 0, access.session.userId);
    if (!existing) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });

    const updates: string[] = [];
    const params: any[] = [];
    if (location !== undefined) { updates.push('location = ?'); params.push(location); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (stop_type !== undefined) { updates.push('stop_type = ?'); params.push(stop_type); }
    if (miles_from_last !== undefined) { updates.push('miles_from_last = ?'); params.push(miles_from_last); }
    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    db.prepare(`UPDATE stops SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await request.json();
    const db = new Database(dbPath);
    const result = db.prepare(`DELETE FROM stops WHERE id = ? AND (? OR user_id = ?)`).run(id, access.adminMode ? 1 : 0, access.session.userId);
    if (!result.changes) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
