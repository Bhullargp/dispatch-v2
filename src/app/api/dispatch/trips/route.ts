import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess, userScopedWhere } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { trip_number, start_date, end_date, total_miles, status, truck_number, trailer_number, route, notes } = body;

    if (!trip_number) return NextResponse.json({ error: 'trip_number required' }, { status: 400 });

    // Check duplicate
    const existing = await db().get('SELECT trip_number FROM trips WHERE trip_number = $1', [trip_number]);
    if (existing) return NextResponse.json({ error: 'Trip number already exists' }, { status: 409 });

    await db().run(
      `INSERT INTO trips (trip_number, start_date, end_date, total_miles, status, truck_number, trailer_number, route, notes, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        trip_number.trim().toUpperCase(),
        start_date || null,
        end_date || null,
        total_miles ? parseFloat(total_miles) : null,
        status || 'Active',
        truck_number || null,
        trailer_number || null,
        route || null,
        notes || null,
        access.session.userId,
      ]
    );

    return NextResponse.json({ success: true, trip_number: trip_number.trim().toUpperCase() });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const scope = userScopedWhere(access, 'user_id');
    const trips = await db().query(`
      SELECT t.*,
        (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id ASC LIMIT 1) as first_stop,
        (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id DESC LIMIT 1) as last_stop,
        (SELECT json_agg(json_build_object('type', type, 'amount', amount, 'quantity', quantity)) FROM extra_pay WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as extra_pay_json
      FROM trips t WHERE ${scope.clause} ORDER BY trip_number DESC
    `, scope.params);
    return NextResponse.json(trips);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
