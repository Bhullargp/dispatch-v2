export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import TripDetailsClient from '../TripDetailsClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';

export default async function TripDetailPage({ params, searchParams }: { params: Promise<{ trip_number: string }>; searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const { trip_number } = await params;

  const trip = await db().get(
    `SELECT * FROM trips WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
    access.adminMode ? [trip_number] : [trip_number, access.session.userId]
  ) as any;
  const stops = await db().query(
    `SELECT * FROM stops WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'}) ORDER BY COALESCE(stop_order, 999999) ASC, id ASC`,
    access.adminMode ? [trip_number] : [trip_number, access.session.userId]
  );
  const extraPay = await db().query(
    `SELECT * FROM extra_pay WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
    access.adminMode ? [trip_number] : [trip_number, access.session.userId]
  );
  const inventory = await db().query(
    `SELECT * FROM trailer_inventory WHERE ${access.adminMode ? '1=1' : 'user_id = $1'} ORDER BY last_seen DESC`,
    access.adminMode ? [] : [access.session.userId]
  );

  if (!trip) {
    return (
      <div className="p-20 text-center text-white bg-black min-h-screen">
        <p className="text-xl font-bold font-mono text-emerald-400">Trip {trip_number} not found</p>
      </div>
    );
  }

  return <TripDetailsClient trip={trip} stops={stops} extraPay={extraPay} inventory={inventory} />;
}
