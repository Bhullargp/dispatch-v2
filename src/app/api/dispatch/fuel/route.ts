import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess, userScopedWhere } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, date, location, quantity, unit, amount_usd, odometer } = body;

    let target_trip = trip_number;
    if ((trip_number === 'AUTO' || !trip_number) && date) {
      const trip = await db().get(
        `SELECT trip_number FROM trips
        WHERE ($1 BETWEEN start_date AND end_date OR ($2 >= start_date AND end_date IS NULL))
        AND ($3 OR user_id = $4)
        ORDER BY start_date DESC
        LIMIT 1`,
        [date, date, access.adminMode ? true : false, access.session.userId]
      ) as { trip_number: string } | undefined;
      target_trip = trip?.trip_number || 'UNLINKED';
    }

    if (target_trip && target_trip !== 'UNLINKED' && !(await ensureTripOwnership(access, target_trip))) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const result = await db().run(
      `INSERT INTO fuel (trip_number, date, location, quantity, unit, amount_usd, odometer, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [target_trip, date, location, quantity, unit, amount_usd, odometer, access.adminMode ? null : access.session.userId]
    );

    return NextResponse.json({ success: true, id: result.changes });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trip_number = searchParams.get('trip_number');
  const unlinkedOnly = searchParams.get('unlinked') === 'true';

  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const scope = userScopedWhere(access, 'user_id');
    let fuel;

    if (unlinkedOnly) {
      fuel = await db().query(`SELECT * FROM fuel WHERE (trip_number = 'UNLINKED' OR trip_number IS NULL) AND ${scope.clause} ORDER BY date DESC`, scope.params);
    } else if (trip_number) {
      if (trip_number !== 'UNLINKED' && !(await ensureTripOwnership(access, trip_number))) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      }
      fuel = await db().query(`SELECT * FROM fuel WHERE trip_number = $1 AND ${scope.clause} ORDER BY date DESC`, [trip_number, ...scope.params]);
    } else {
      fuel = await db().query(`SELECT * FROM fuel WHERE ${scope.clause} ORDER BY date DESC`, scope.params);
    }

    return NextResponse.json(fuel);
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
    const { id, location, quantity, amount_usd, trip_number, date, unit, odometer } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const existing = await db().get('SELECT id FROM fuel WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!existing) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    if (trip_number && trip_number !== 'UNLINKED' && !(await ensureTripOwnership(access, trip_number))) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;
    if (location !== undefined) { updates.push(`location = $${idx++}`); params.push(location); }
    if (quantity !== undefined) { updates.push(`quantity = $${idx++}`); params.push(quantity); }
    if (amount_usd !== undefined) { updates.push(`amount_usd = $${idx++}`); params.push(amount_usd); }
    if (trip_number !== undefined) { updates.push(`trip_number = $${idx++}`); params.push(trip_number); }
    if (date !== undefined) { updates.push(`date = $${idx++}`); params.push(date); }
    if (unit !== undefined) { updates.push(`unit = $${idx++}`); params.push(unit); }
    if (odometer !== undefined) { updates.push(`odometer = $${idx++}`); params.push(odometer); }
    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id, access.adminMode ? true : false, access.session.userId);
    await db().run(`UPDATE fuel SET ${updates.join(', ')} WHERE id = $${idx} AND ($${idx+1} OR user_id = $${idx+2})`, params);
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

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const result = await db().run('DELETE FROM fuel WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!result.changes) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
