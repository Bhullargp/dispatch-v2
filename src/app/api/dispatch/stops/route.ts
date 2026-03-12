import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { trip_number, date, location, stop_type, miles_from_last } = await request.json();
    const db = new Database(dbPath);
    
    const result = db.prepare(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last) VALUES (?, ?, ?, ?, ?)'
    ).run(trip_number, date, location, stop_type, miles_from_last || 0);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const { id, location, date, stop_type, miles_from_last } = body;
    const db = new Database(dbPath);
    
    const updates: string[] = [];
    const params: any[] = [];
    
    if (location !== undefined) { updates.push('location = ?'); params.push(location); }
    if (date !== undefined) { updates.push('date = ?'); params.push(date); }
    if (stop_type !== undefined) { updates.push('stop_type = ?'); params.push(stop_type); }
    if (miles_from_last !== undefined) { updates.push('miles_from_last = ?'); params.push(miles_from_last); }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    
    params.push(id);
    db.prepare(`UPDATE stops SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { id } = await request.json();
    const db = new Database(dbPath);
    db.prepare('DELETE FROM stops WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
