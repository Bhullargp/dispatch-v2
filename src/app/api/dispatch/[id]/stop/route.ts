import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const { id: trip_number } = await params;
    const body = await request.json();
    const { location, date, stop_type, miles_from_last } = body;
    
    const db = new Database(dbPath);
    
    const result = db.prepare(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last) VALUES (?, ?, ?, ?, ?)'
    ).run(trip_number, date || null, location, stop_type || 'Stop', miles_from_last || 0);

    db.close();
    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
