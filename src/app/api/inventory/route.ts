import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    const { trailer_number } = await request.json();
    if (!trailer_number) {
      return NextResponse.json({ error: 'Trailer number is required' }, { status: 400 });
    }

    const db = new Database(dbPath);
    const now = new Date().toISOString();
    
    // UPSERT style: insert if not exists, otherwise update last_seen
    const query = `
      INSERT INTO trailer_inventory (trailer_number, last_seen)
      VALUES (?, ?)
      ON CONFLICT(trailer_number) DO UPDATE SET last_seen = excluded.last_seen
    `;
    
    db.prepare(query).run(trailer_number, now);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Inventory API Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const db = new Database(dbPath);
    const inventory = db.prepare('SELECT * FROM trailer_inventory ORDER BY trailer_number ASC').all();
    return NextResponse.json(inventory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
