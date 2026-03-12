import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/require-auth';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function GET(request: Request) {
  try {
    const unauthorized = requireAuth(request);
    if (unauthorized) return unauthorized;
    const db = new Database(dbPath);
    const trip = db.prepare(`
      SELECT * FROM trips 
      WHERE LOWER(status) = 'active' 
      ORDER BY start_date DESC, trip_number DESC 
      LIMIT 1
    `).get() as any;

    if (!trip) {
      return NextResponse.json({ error: 'Active trip not found' }, { status: 404 });
    }

    return NextResponse.json(trip);
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
