import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; stopId: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number, stopId } = await params;
    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      'DELETE FROM stops WHERE id = $1 AND trip_number = $2 AND ($3 OR user_id = $4)',
      [stopId, trip_number, access.adminMode ? true : false, access.session.userId]
    );
    if (!result.changes) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; stopId: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number, stopId } = await params;
    const body = await request.json();
    const { location, date, stop_type, miles_from_last } = body;

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const updates: string[] = [];
    const params2: any[] = [];
    let idx = 1;
    if (location !== undefined) { updates.push(`location = $${idx++}`); params2.push(location); }
    if (date !== undefined) { updates.push(`date = $${idx++}`); params2.push(date); }
    if (stop_type !== undefined) { updates.push(`stop_type = $${idx++}`); params2.push(stop_type); }
    if (miles_from_last !== undefined) { updates.push(`miles_from_last = $${idx++}`); params2.push(miles_from_last); }
    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params2.push(stopId, trip_number, access.adminMode ? true : false, access.session.userId);
    const result = await db().run(`UPDATE stops SET ${updates.join(', ')} WHERE id = $${idx} AND trip_number = $${idx+1} AND ($${idx+2} OR user_id = $${idx+3})`, params2);
    if (!result.changes) return NextResponse.json({ error: 'Stop not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
