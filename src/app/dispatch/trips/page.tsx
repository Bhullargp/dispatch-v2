export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import TripSheetClient from '../TripSheetClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

export default async function TripsPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) {
    redirect('/dispatch/setup');
  }

  const scope = userScopedWhere(access, 't.user_id');

  const trips = await db().query(`
    SELECT t.*,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id ASC LIMIT 1) as first_stop,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id DESC LIMIT 1) as last_stop,
    (SELECT json_agg(json_build_object('type', type, 'amount', amount, 'quantity', quantity)) FROM extra_pay WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as extra_pay_json
    FROM trips t
    WHERE ${scope.clause}
    ORDER BY trip_number DESC
    LIMIT 50
  `, scope.params);

  return <TripSheetClient initialTrips={trips} isAdmin={access.isAdmin} />;
}
