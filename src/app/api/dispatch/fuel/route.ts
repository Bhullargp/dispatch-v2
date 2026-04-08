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
    const {
      trip_number, date, location, province, country,
      gallons, liters, price_per_unit, amount_usd, unit,
      odometer, prev_odometer, fuel_type,
      def_liters, def_cost, def_price_per_unit, currency,
    } = body;

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

    await db().run(
      `INSERT INTO fuel (
        trip_number, date, location, province, country,
        gallons, liters, price_per_unit, amount_usd, unit,
        odometer, prev_odometer, fuel_type,
        def_liters, def_cost, def_price_per_unit, currency, user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
        target_trip, date, location, province || null, country || null,
        gallons || null, liters || null, price_per_unit || null, amount_usd || null, unit || 'Gallons',
        odometer || null, prev_odometer || null, fuel_type || 'diesel',
        def_liters || null, def_cost || null, def_price_per_unit || null,
        currency || 'USD',
        access.adminMode ? null : access.session.userId,
      ]
    );

    return NextResponse.json({ success: true });
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
    const {
      id, trip_number, date, location, province, country,
      gallons, liters, price_per_unit, amount_usd, unit,
      odometer, prev_odometer, fuel_type,
      def_liters, def_cost, def_price_per_unit, currency,
    } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const existing = await db().get('SELECT id FROM fuel WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!existing) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    if (trip_number && trip_number !== 'UNLINKED' && !(await ensureTripOwnership(access, trip_number))) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const fields: [string, any][] = [
      ['trip_number', trip_number], ['date', date], ['location', location],
      ['province', province], ['country', country], ['gallons', gallons],
      ['liters', liters], ['price_per_unit', price_per_unit], ['amount_usd', amount_usd],
      ['unit', unit], ['odometer', odometer], ['prev_odometer', prev_odometer],
      ['fuel_type', fuel_type], ['def_liters', def_liters], ['def_cost', def_cost],
      ['def_price_per_unit', def_price_per_unit], ['currency', currency],
    ];

    for (const [col, val] of fields) {
      if (val !== undefined) { updates.push(`${col} = $${idx++}`); params.push(val); }
    }

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
