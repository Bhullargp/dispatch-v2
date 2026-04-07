import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess, userScopedWhere } from '@/lib/ownership';

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
