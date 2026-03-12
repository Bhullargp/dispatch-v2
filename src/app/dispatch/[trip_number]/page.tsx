import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import { redirect } from 'next/navigation';
import TripDetailsClient from '../TripDetailsClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function TripDetailPage({ params, searchParams }: { params: Promise<{ trip_number: string }>; searchParams?: Promise<{ adminMode?: string }> }) {
  ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const { trip_number } = await params;
  const db = new Database(dbPath);

  const trip = db.prepare(`SELECT * FROM trips WHERE trip_number = ? AND (${access.adminMode ? '1=1' : 'user_id = ?'})`).get(trip_number, ...(access.adminMode ? [] : [access.session.userId])) as any;
  const stops = db.prepare(`SELECT * FROM stops WHERE trip_number = ? AND (${access.adminMode ? '1=1' : 'user_id = ?'}) ORDER BY id ASC`).all(trip_number, ...(access.adminMode ? [] : [access.session.userId]));
  const extraPay = db.prepare(`SELECT * FROM extra_pay WHERE trip_number = ? AND (${access.adminMode ? '1=1' : 'user_id = ?'})`).all(trip_number, ...(access.adminMode ? [] : [access.session.userId]));
  const inventory = db.prepare(`SELECT * FROM trailer_inventory WHERE ${access.adminMode ? '1=1' : 'user_id = ?'} ORDER BY last_seen DESC`).all(...(access.adminMode ? [] : [access.session.userId]));

  if (!trip) {
    return (
      <div className="p-20 text-center text-white bg-black min-h-screen">
        <p className="text-xl font-bold font-mono text-blue-500">Trip {trip_number} not found</p>
      </div>
    );
  }

  return <TripDetailsClient trip={trip} stops={stops} extraPay={extraPay} inventory={inventory} />;
}
