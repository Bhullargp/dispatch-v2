import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import { redirect } from 'next/navigation';
import ActiveTripDataPortal from '../ActiveTripDataPortal';
import Link from 'next/link';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function ActiveTripPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const db = new Database(dbPath);
  const scope = userScopedWhere(access, 'user_id');

  const trip = db.prepare(`
    SELECT * FROM trips
    WHERE LOWER(status) = 'active' AND ${scope.clause}
    ORDER BY start_date DESC, trip_number DESC
    LIMIT 1
  `).get(...scope.params) as any;

  if (!trip) {
    return (
      <div className="min-h-screen bg-[#050505] text-zinc-100 p-4 font-sans flex flex-col items-center justify-center text-center">
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-10 max-w-sm w-full shadow-2xl">
          <div className="text-6xl mb-6">🚛</div>
          <h1 className="text-2xl font-black font-mono tracking-tighter mb-2">No Active Trip Found</h1>
          <p className="text-zinc-500 text-sm mb-8 leading-relaxed">There are currently no trips marked as <span className="text-blue-500 font-bold uppercase">Active</span> in your scope.</p>
          <Link href="/dispatch" className="block w-full bg-blue-600 hover:bg-blue-500 text-white font-black uppercase text-xs py-4 rounded-2xl transition-all active:scale-95 shadow-lg shadow-blue-600/20">Go to Trip Sheet</Link>
        </div>
      </div>
    );
  }

  const fuelEntries = db.prepare(`SELECT * FROM fuel WHERE trip_number = ? AND ${access.adminMode ? '1=1' : 'user_id = ?'}`).all(trip.trip_number, ...(access.adminMode ? [] : [access.session.userId]));
  const extraPay = db.prepare(`SELECT * FROM extra_pay WHERE trip_number = ? AND ${access.adminMode ? '1=1' : 'user_id = ?'}`).all(trip.trip_number, ...(access.adminMode ? [] : [access.session.userId]));
  const inventory = db.prepare(`SELECT * FROM trailer_inventory WHERE ${access.adminMode ? '1=1' : 'user_id = ?'} ORDER BY last_seen DESC`).all(...(access.adminMode ? [] : [access.session.userId]));

  return <ActiveTripDataPortal trip={trip} fuelEntries={fuelEntries} extraPay={extraPay} inventory={inventory} />;
}
