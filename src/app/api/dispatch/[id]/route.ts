import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await params;
    const body = await request.json();

    if (!(await ensureTripOwnership(access, id))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    if (!body.start_odometer || body.start_odometer === 0) {
      const currentTrip = await db().get('SELECT trip_number FROM trips WHERE trip_number = $1', [id]) as { trip_number: string } | undefined;
      if (currentTrip) {
        const prevTrip = await db().get(
          `SELECT end_odometer FROM trips
          WHERE trip_number < $1 AND end_odometer IS NOT NULL AND end_odometer > 0
          AND ($2 OR user_id = $3)
          ORDER BY trip_number DESC LIMIT 1`,
          [currentTrip.trip_number, access.adminMode ? true : false, access.session.userId]
        ) as { end_odometer: number } | undefined;
        if (prevTrip?.end_odometer) body.start_odometer = prevTrip.end_odometer;
      }
    }

    const fields = Object.keys(body).filter((f) => f !== 'user_id');
    if (fields.length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 });

    const setParts: string[] = [];
    const values: any[] = [];
    let idx = 1;
    for (const field of fields) {
      setParts.push(`${field} = $${idx++}`);
      values.push(body[field]);
    }
    values.push(id);

    await db().run(`UPDATE trips SET ${setParts.join(', ')} WHERE trip_number = $${idx}`, values);

    if (body.end_date) {
      const caledonStopExists = await db().get(
        'SELECT id FROM stops WHERE trip_number = $1 AND location LIKE \'%Caledon, ON%\' AND ($2 OR user_id = $3)',
        [id, access.adminMode ? true : false, access.session.userId]
      );
      if (!caledonStopExists) {
        await db().run(
          'INSERT INTO stops (trip_number, date, location, stop_type, user_id) VALUES ($1, $2, $3, $4, $5)',
          [id, body.end_date, 'Caledon, ON', 'Delivery', access.adminMode ? null : access.session.userId]
        );
      }
    }

    const trailers = ['trailer', 'trailer_2', 'trailer_3', 'trailer_4', 'trailer_5', 'trailer_number'];
    for (const f of trailers) {
      if (body[f] && body[f] !== 'None' && body[f] !== '') {
        const existing = await db().get('SELECT trailer_number, user_id FROM trailer_inventory WHERE trailer_number = $1', [body[f]]) as any;
        if (!existing) {
          await db().run('INSERT INTO trailer_inventory (trailer_number, last_seen, user_id) VALUES ($1, $2, $3)', [body[f], new Date().toISOString(), access.adminMode ? null : access.session.userId]);
        } else if (access.adminMode || existing.user_id === access.session.userId) {
          await db().run('UPDATE trailer_inventory SET last_seen = $1, user_id = COALESCE(user_id, $2) WHERE trailer_number = $3', [new Date().toISOString(), access.adminMode ? null : access.session.userId, body[f]]);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id } = await params;
    if (!(await ensureTripOwnership(access, id))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    await db().run('DELETE FROM stops WHERE trip_number = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    await db().run('DELETE FROM extra_pay WHERE trip_number = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    await db().run('DELETE FROM fuel WHERE trip_number = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    const result = await db().run('DELETE FROM trips WHERE trip_number = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);

    if (result.changes === 0) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
