import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const { id: trip_number, stopId } = await params;
    const db = new Database(dbPath);
    
    db.prepare('DELETE FROM stops WHERE id = ? AND trip_number = ?').run(stopId, trip_number);
    
    db.close();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; stopId: string }> }
) {
  try {
    const { id: trip_number, stopId } = await params;
    const body = await request.json();
    const { location, date, stop_type, miles_from_last } = body;
    
    const db = new Database(dbPath);
    
    const updates: string[] = [];
    const params2: any[] = [];
    
    if (location !== undefined) { updates.push('location = ?'); params2.push(location); }
    if (date !== undefined) { updates.push('date = ?'); params2.push(date); }
    if (stop_type !== undefined) { updates.push('stop_type = ?'); params2.push(stop_type); }
    if (miles_from_last !== undefined) { updates.push('miles_from_last = ?'); params2.push(miles_from_last); }
    
    if (updates.length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }
    
    params2.push(stopId);
    db.prepare(`UPDATE stops SET ${updates.join(', ')} WHERE id = ? AND trip_number = ?`).run(...params2, trip_number);
    
    db.close();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
