import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { trip_number, type, amount, quantity } = body;
    const db = new Database(dbPath);

    const result = db.prepare(
      'INSERT INTO extra_pay (trip_number, type, amount, quantity) VALUES (?, ?, ?, ?)'
    ).run(trip_number, type, amount || 0, quantity || 1);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const db = new Database(dbPath);
    db.prepare('DELETE FROM extra_pay WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { trip_number, extras } = body;
    const db = new Database(dbPath);

    const sync = db.transaction(() => {
      db.prepare('DELETE FROM extra_pay WHERE trip_number = ?').run(trip_number);
      const insert = db.prepare('INSERT INTO extra_pay (trip_number, type, amount, quantity) VALUES (?, ?, ?, ?)');
      for (const e of extras) {
        insert.run(trip_number, e.type, e.amount, e.quantity);
      }
    });
    sync();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

