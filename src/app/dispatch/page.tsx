import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import { redirect } from 'next/navigation';
import TripSheetClient from './TripSheetClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function TripSheetPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');

  const db = new Database(dbPath);
  const scope = userScopedWhere(access, 't.user_id');

  const trips = db.prepare(`
    SELECT t.*,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id ASC LIMIT 1) as first_stop,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id DESC LIMIT 1) as last_stop,
    (SELECT json_group_array(json_object('type', type, 'amount', amount, 'quantity', quantity)) FROM extra_pay WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as extra_pay_json
    FROM trips t
    WHERE ${scope.clause}
    ORDER BY trip_number DESC
    LIMIT 50
  `).all(...scope.params);

  return <TripSheetClient initialTrips={trips} />;
}
