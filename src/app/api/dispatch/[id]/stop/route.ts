import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number } = await params;
    const body = await request.json();
    const location = String(body.location || '').trim();
    const date = body.date ? String(body.date) : null;
    const stop_type = String(body.stop_type || 'Stop').trim();
    const miles_from_last = Number(body.miles_from_last || 0);

    if (!location) {
      return NextResponse.json({ error: 'Stop location is required' }, { status: 400 });
    }

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      'INSERT INTO stops (trip_number, date, location, stop_type, miles_from_last, user_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [trip_number, date || null, location, stop_type || 'Stop', Number.isFinite(miles_from_last) ? miles_from_last : 0, access.adminMode ? null : access.session.userId]
    );

    const stop = await db().get('SELECT * FROM stops WHERE id = (SELECT MAX(id) FROM stops WHERE trip_number = $1)', [trip_number]);
    return NextResponse.json(stop);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { id: trip_number } = await params;
    const { searchParams } = new URL(request.url);
    const stopId = Number(searchParams.get('stopId'));

    if (!Number.isFinite(stopId) || stopId <= 0) {
      return NextResponse.json({ error: 'Valid stopId is required' }, { status: 400 });
    }

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      'DELETE FROM stops WHERE id = $1 AND trip_number = $2 AND ($3 OR user_id = $4)',
      [stopId, trip_number, access.adminMode ? true : false, access.session.userId]
    );

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Stop not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
