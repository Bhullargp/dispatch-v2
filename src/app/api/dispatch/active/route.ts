import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess, userScopedWhere } from '@/lib/ownership';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const scope = userScopedWhere(access, 'user_id');
    const trip = await db().get(
      `SELECT * FROM trips
      WHERE LOWER(status) = 'active' AND ${scope.clause}
      ORDER BY start_date DESC, trip_number DESC
      LIMIT 1`,
      scope.params
    ) as any;

    if (!trip) return NextResponse.json({ error: 'Active trip not found' }, { status: 404 });
    return NextResponse.json(trip);
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
