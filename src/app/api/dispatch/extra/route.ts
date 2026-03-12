import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'path';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, type, amount, quantity } = body;
    const db = new Database(dbPath);

    if (!ensureTripOwnership(db, access, trip_number)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = db.prepare(
      'INSERT INTO extra_pay (trip_number, type, amount, quantity, user_id) VALUES (?, ?, ?, ?, ?)'
    ).run(trip_number, type, amount || 0, quantity || 1, access.adminMode ? null : access.session.userId);

    return NextResponse.json({ success: true, id: result.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const db = new Database(dbPath);
    const result = db.prepare('DELETE FROM extra_pay WHERE id = ? AND (? OR user_id = ?)').run(id, access.adminMode ? 1 : 0, access.session.userId);
    if (!result.changes) return NextResponse.json({ error: 'Extra pay not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, extras } = body;
    const db = new Database(dbPath);

    if (!ensureTripOwnership(db, access, trip_number)) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const sync = db.transaction(() => {
      db.prepare('DELETE FROM extra_pay WHERE trip_number = ? AND (? OR user_id = ?)').run(trip_number, access.adminMode ? 1 : 0, access.session.userId);
      const insert = db.prepare('INSERT INTO extra_pay (trip_number, type, amount, quantity, user_id) VALUES (?, ?, ?, ?, ?)');
      for (const e of extras) {
        insert.run(trip_number, e.type, e.amount, e.quantity, access.adminMode ? null : access.session.userId);
      }
    });
    sync();

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
