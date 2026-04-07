export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import ActiveTripDataPortal from '../ActiveTripDataPortal';
import Link from 'next/link';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

export default async function ActiveTripPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) redirect('/dispatch/setup');
  const scope = userScopedWhere(access, 'user_id');

  const trip = await db().get(
    `SELECT * FROM trips
    WHERE LOWER(status) = 'active' AND ${scope.clause}
    ORDER BY start_date DESC, trip_number DESC
    LIMIT 1`,
    scope.params
  ) as any;

  if (!trip) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 font-sans flex flex-col items-center justify-center text-center">
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-10 max-w-sm w-full shadow-2xl">
          <div className="text-6xl mb-6">🚛</div>
          <h1 className="text-2xl font-black font-mono tracking-tighter mb-2">No Active Trip Found</h1>
          <p className="text-zinc-500 text-sm mb-8 leading-relaxed">There are currently no trips marked as <span className="text-emerald-400 font-bold uppercase">Active</span> in your scope.</p>
          <Link href="/dispatch" className="block w-full bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase text-xs py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-600/20">Go to Trip Sheet</Link>
        </div>
      </div>
    );
  }

  const fuelEntries = await db().query(
    `SELECT * FROM fuel WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
    access.adminMode ? [trip.trip_number] : [trip.trip_number, access.session.userId]
  );
  const extraPay = await db().query(
    `SELECT * FROM extra_pay WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
    access.adminMode ? [trip.trip_number] : [trip.trip_number, access.session.userId]
  );
  const inventory = await db().query(
    `SELECT * FROM trailer_inventory WHERE ${access.adminMode ? '1=1' : 'user_id = $1'} ORDER BY last_seen DESC`,
    access.adminMode ? [] : [access.session.userId]
  );

  return <ActiveTripDataPortal trip={trip} fuelEntries={fuelEntries} extraPay={extraPay} inventory={inventory} />;
}
