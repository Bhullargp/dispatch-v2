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
    const location = String(body.location || '').trim();
    const date = body.date ? String(body.date) : null;
    const stop_type = String(body.stop_type || 'Stop').trim();
    const miles_from_last = Number(body.miles_from_last || 0);

    if (!location) {
      return NextResponse.json({ error: 'Stop location is required' }, { status: 400 });
    }

    const db = new Database(dbPath);
    if (!ensureTripOwnership(db, access, trip_number)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = db.prepare(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last, user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(trip_number, date || null, location, stop_type || 'Stop', Number.isFinite(miles_from_last) ? miles_from_last : 0, access.adminMode ? null : access.session.userId);

    const stop = db.prepare('SELECT * FROM stops WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(stop);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number } = await params;
    const { searchParams } = new URL(request.url);
    const stopId = Number(searchParams.get('stopId'));

    if (!Number.isFinite(stopId) || stopId <= 0) {
      return NextResponse.json({ error: 'Valid stopId is required' }, { status: 400 });
    }

    const db = new Database(dbPath);
    if (!ensureTripOwnership(db, access, trip_number)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = db.prepare('DELETE FROM stops WHERE id = ? AND trip_number = ? AND (? OR user_id = ?)')
      .run(stopId, trip_number, access.adminMode ? 1 : 0, access.session.userId);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
