import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await params;
    const body = await request.json();
    const db = new Database(dbPath);

    if (!ensureTripOwnership(db, access, id)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    if (!body.start_odometer || body.start_odometer === 0) {
      const currentTrip = db.prepare('SELECT trip_number FROM trips WHERE trip_number = ?').get(id) as { trip_number: string } | undefined;
      if (currentTrip) {
        const prevTrip = db.prepare(`
          SELECT end_odometer FROM trips
          WHERE trip_number < ? AND end_odometer IS NOT NULL AND end_odometer > 0
          AND (? OR user_id = ?)
          ORDER BY trip_number DESC LIMIT 1
        `).get(currentTrip.trip_number, access.adminMode ? 1 : 0, access.session.userId) as { end_odometer: number } | undefined;
        if (prevTrip?.end_odometer) body.start_odometer = prevTrip.end_odometer;
      }
    }

    const fields = Object.keys(body).filter((f) => f !== 'user_id');
    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    const setClause = fields.map((field) => `${field} = ?`).join(', ');
    const values = fields.map((field) => body[field]);
    values.push(id);

    const query = `UPDATE trips SET ${setClause} WHERE trip_number = ?`;
    db.prepare(query).run(...values);

    if (body.end_date) {
      const caledonStopExists = db.prepare(`SELECT id FROM stops WHERE trip_number = ? AND location LIKE '%Caledon, ON%' AND (? OR user_id = ?)`)
        .get(id, access.adminMode ? 1 : 0, access.session.userId);
      if (!caledonStopExists) {
        db.prepare(`INSERT INTO stops (trip_number, date, location, stop_type, user_id) VALUES (?, ?, ?, ?, ?)`).run(
          id,
          body.end_date,
          'Caledon, ON',
          'Delivery',
          access.adminMode ? null : access.session.userId
        );
      }
    }

    const trailers = ['trailer', 'trailer_2', 'trailer_3', 'trailer_4', 'trailer_5', 'trailer_number'];
    trailers.forEach((f) => {
      if (body[f] && body[f] !== 'None' && body[f] !== '') {
        const existing = db.prepare('SELECT trailer_number, user_id FROM trailer_inventory WHERE trailer_number = ?').get(body[f]) as any;
        if (!existing) {
          db.prepare('INSERT INTO trailer_inventory (trailer_number, last_seen, user_id) VALUES (?, ?, ?)').run(body[f], new Date().toISOString(), access.adminMode ? null : access.session.userId);
        } else if (access.adminMode || existing.user_id === access.session.userId) {
          db.prepare('UPDATE trailer_inventory SET last_seen = ?, user_id = COALESCE(user_id, ?) WHERE trailer_number = ?').run(new Date().toISOString(), access.adminMode ? null : access.session.userId, body[f]);
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await params;
    const db = new Database(dbPath);
    if (!ensureTripOwnership(db, access, id)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    db.prepare('DELETE FROM stops WHERE trip_number = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);
    db.prepare('DELETE FROM extra_pay WHERE trip_number = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);
    db.prepare('DELETE FROM fuel WHERE trip_number = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);
    const result = db.prepare('DELETE FROM trips WHERE trip_number = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);

    if (result.changes === 0) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
