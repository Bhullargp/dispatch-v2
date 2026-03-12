import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const { trip_number, date, location, quantity, unit, amount_usd, odometer } = body;
    
    const db = new Database(dbPath);
    
    let target_trip = trip_number;

    // If trip_number is 'AUTO' or missing, try to link based on date
    if ((trip_number === 'AUTO' || !trip_number) && date) {
      const trip = db.prepare(`
        SELECT trip_number FROM trips 
        WHERE ? BETWEEN start_date AND end_date
        OR (? >= start_date AND end_date IS NULL)
        ORDER BY start_date DESC 
        LIMIT 1
      `).get(date, date) as { trip_number: string } | undefined;
      
      if (trip) {
        target_trip = trip.trip_number;
      } else {
        target_trip = 'UNLINKED';
      }
    }

    const result = db.prepare(`
      INSERT INTO fuel (trip_number, date, location, quantity, unit, amount_usd, odometer)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(target_trip, date, location, quantity, unit, amount_usd, odometer);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    console.error('Fuel API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trip_number = searchParams.get('trip_number');
  const unlinkedOnly = searchParams.get('unlinked') === 'true';
  
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const db = new Database(dbPath);
    let fuel;
    if (unlinkedOnly) {
      fuel = db.prepare("SELECT * FROM fuel WHERE trip_number = 'UNLINKED' OR trip_number IS NULL ORDER BY date DESC").all();
    } else if (trip_number) {
      fuel = db.prepare('SELECT * FROM fuel WHERE trip_number = ? ORDER BY date DESC').all(trip_number);
    } else {
      fuel = db.prepare('SELECT * FROM fuel ORDER BY date DESC').all();
    }
    return NextResponse.json(fuel);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const { id, location, quantity, amount_usd, trip_number, date, unit, odometer } = body;
    
    if (!id) {
      return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });
    }

    const db = new Database(dbPath);
    
    // Build dynamic update
    const updates: string[] = [];
    const params: any[] = [];
    
    if (location !== undefined) { updates.push('location = ?'); params.push(location); }
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (amount_usd !== undefined) { updates.push('amount_usd = ?'); params.push(amount_usd); }
    if (trip_number !== undefined) { updates.push('trip_number = ?'); params.push(trip_number); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (unit !== undefined) { updates.push('unit = ?'); params.push(unit); }
    if (odometer !== undefined) { updates.push('odometer = ?'); params.push(odometer); }

    if (updates.length === 0) {
        return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    params.push(id);
    db.prepare(`
      UPDATE fuel 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...params);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const { id } = body;
    
    if (!id) {
      return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });
    }

    const db = new Database(dbPath);
    db.prepare('DELETE FROM fuel WHERE id = ?').run(id);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
