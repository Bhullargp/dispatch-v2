import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess } from '@/lib/ownership';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { trip_number, date, location, stop_type, miles_from_last } = await request.json();

    const ownedTrip = await db().get(
      'SELECT trip_number FROM trips WHERE trip_number = $1 AND ($2 OR user_id = $3)',
      [trip_number, access.adminMode ? true : false, access.session.userId]
    );
    if (!ownedTrip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [trip_number, date, location, stop_type, miles_from_last || 0, access.adminMode ? null : access.session.userId]
    );

    return NextResponse.json({ success: true, id: result.changes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { id, location, date, stop_type, miles_from_last } = body;

    const existing = await db().get(
      'SELECT id FROM stops WHERE id = $1 AND ($2 OR user_id = $3)',
      [id, access.adminMode ? true : false, access.session.userId]
    );
    if (!existing) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (location !== undefined) { updates.push(`location = $${idx++}`); params.push(location); }
    if (date !== undefined) { updates.push(`date = $${idx++}`); params.push(date); }
    if (stop_type !== undefined) { updates.push(`stop_type = $${idx++}`); params.push(stop_type); }
    if (miles_from_last !== undefined) { updates.push(`miles_from_last = $${idx++}`); params.push(miles_from_last); }
    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    await db().run(`UPDATE stops SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await request.json();
    const result = await db().run(
      'DELETE FROM stops WHERE id = $1 AND ($2 OR user_id = $3)',
      [id, access.adminMode ? true : false, access.session.userId]
    );
    if (!result.changes) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
