import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { id } = await params;
    const body = await request.json();
    const db = new Database(dbPath);

    // Auto-fill start odometer from previous trip's end odometer (always check if empty)
    if (!body.start_odometer || body.start_odometer === 0) {
      // Find the previous trip by trip_number (max trip_number less than current)
      const currentTrip = db.prepare('SELECT trip_number FROM trips WHERE trip_number = ?').get(id) as { trip_number: string } | undefined;
      if (currentTrip) {
        const prevTrip = db.prepare(`
          SELECT end_odometer FROM trips 
          WHERE trip_number < ? 
          AND end_odometer IS NOT NULL 
          AND end_odometer > 0
          ORDER BY trip_number DESC LIMIT 1
        `).get(currentTrip.trip_number) as { end_odometer: number } | undefined;
        
        if (prevTrip && prevTrip.end_odometer) {
          body.start_odometer = prevTrip.end_odometer;
        }
      }
    }

    const fields = Object.keys(body);
    if (fields.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => body[field]);
    values.push(id);

    const query = `UPDATE trips SET ${setClause} WHERE trip_number = ?`;
    db.prepare(query).run(...values);
    
    // If end_date is being set manually, add a final stop at Caledon
    if (body.end_date) {
      const caledonStopExists = db.prepare(
        `SELECT id FROM stops WHERE trip_number = ? AND location LIKE '%Caledon, ON%'`
      ).get(id);

      if (!caledonStopExists) {
        db.prepare(
          `INSERT INTO stops (trip_number, date, location, stop_type) VALUES (?, ?, ?, ?)`
        ).run(id, body.end_date, 'Caledon, ON', 'Delivery');
      }
    }

    // Inventory Sync
    const trailers = ['trailer', 'trailer_2', 'trailer_3', 'trailer_4', 'trailer_5', 'trailer_number'];
    trailers.forEach(f => {
      if (body[f] && body[f] !== 'None' && body[f] !== '') {
        db.prepare('INSERT OR REPLACE INTO trailer_inventory (trailer_number, last_seen) VALUES (?, ?)')
          .run(body[f], new Date().toISOString());
      }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { id } = await params;
    const db = new Database(dbPath);
    
    // Delete stops first (foreign key)
    db.prepare('DELETE FROM stops WHERE trip_number = ?').run(id);
    db.prepare('DELETE FROM extra_pay WHERE trip_number = ?').run(id);
    const result = db.prepare('DELETE FROM trips WHERE trip_number = ?').run(id);

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
