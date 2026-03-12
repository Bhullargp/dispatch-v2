import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess, userScopedWhere } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, date, location, quantity, unit, amount_usd, odometer } = body;
    const db = new Database(dbPath);

    let target_trip = trip_number;
    if ((trip_number === 'AUTO' || !trip_number) && date) {
      const trip = db.prepare(`
        SELECT trip_number FROM trips
        WHERE (? BETWEEN start_date AND end_date OR (? >= start_date AND end_date IS NULL))
        AND (? OR user_id = ?)
        ORDER BY start_date DESC
        LIMIT 1
      `).get(date, date, access.adminMode ? 1 : 0, access.session.userId) as { trip_number: string } | undefined;
      target_trip = trip?.trip_number || 'UNLINKED';
    }

    if (target_trip && target_trip !== 'UNLINKED' && !ensureTripOwnership(db, access, target_trip)) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const result = db.prepare(`
      INSERT INTO fuel (trip_number, date, location, quantity, unit, amount_usd, odometer, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(target_trip, date, location, quantity, unit, amount_usd, odometer, access.adminMode ? null : access.session.userId);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trip_number = searchParams.get('trip_number');
  const unlinkedOnly = searchParams.get('unlinked') === 'true';

  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const db = new Database(dbPath);
    const scope = userScopedWhere(access, 'user_id');
    let fuel;

    if (unlinkedOnly) {
      fuel = db.prepare(`SELECT * FROM fuel WHERE (trip_number = 'UNLINKED' OR trip_number IS NULL) AND ${scope.clause} ORDER BY date DESC`).all(...scope.params);
    } else if (trip_number) {
      if (trip_number !== 'UNLINKED' && !ensureTripOwnership(db, access, trip_number)) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      }
      fuel = db.prepare(`SELECT * FROM fuel WHERE trip_number = ? AND ${scope.clause} ORDER BY date DESC`).all(trip_number, ...scope.params);
    } else {
      fuel = db.prepare(`SELECT * FROM fuel WHERE ${scope.clause} ORDER BY date DESC`).all(...scope.params);
    }

    return NextResponse.json(fuel);
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
    const { id, location, quantity, amount_usd, trip_number, date, unit, odometer } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const db = new Database(dbPath);
    const existing = db.prepare('SELECT id FROM fuel WHERE id = ? AND (? OR user_id = ?)').get(id, access.adminMode ? 1 : 0, access.session.userId);
    if (!existing) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    if (trip_number && trip_number !== 'UNLINKED' && !ensureTripOwnership(db, access, trip_number)) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    if (location !== undefined) { updates.push('location = ?'); params.push(location); }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (amount_usd !== undefined) { updates.push('amount_usd = ?'); params.push(amount_usd); }
    if (trip_number !== undefined) { updates.push('trip_number = ?'); params.push(trip_number); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (unit !== undefined) { updates.push('unit = ?'); params.push(unit); }
    if (odometer !== undefined) { updates.push('odometer = ?'); params.push(odometer); }
    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id, access.adminMode ? 1 : 0, access.session.userId);
    db.prepare(`UPDATE fuel SET ${updates.join(', ')} WHERE id = ? AND (? OR user_id = ?)`).run(...params);
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

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const db = new Database(dbPath);
    const result = db.prepare('DELETE FROM fuel WHERE id = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);
    if (!result.changes) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
