import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';
import pool from '@/lib/db';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, type, amount, quantity } = body;

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      'INSERT INTO extra_pay (trip_number, type, amount, quantity, user_id) VALUES ($1, $2, $3, $4, $5)',
      [trip_number, type, amount || 0, quantity || 1, access.adminMode ? null : access.session.userId]
    );

    return NextResponse.json({ success: true, id: result.changes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const result = await db().run('DELETE FROM extra_pay WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!result.changes) return NextResponse.json({ error: 'Extra pay not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, extras } = body;

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM extra_pay WHERE trip_number = $1 AND ($2 OR user_id = $3)', [trip_number, access.adminMode ? true : false, access.session.userId]);
      for (const e of extras) {
        await client.query('INSERT INTO extra_pay (trip_number, type, amount, quantity, user_id) VALUES ($1, $2, $3, $4, $5)',
          [trip_number, e.type, e.amount, e.quantity, access.adminMode ? null : access.session.userId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
