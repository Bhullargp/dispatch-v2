import React from 'react';
import Database from 'better-sqlite3';
import path from 'path';
import { redirect } from 'next/navigation';
import FuelHistoryClient from './FuelHistoryClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

const dbPath = path.resolve(process.cwd(), 'dispatch.db');

export default async function FuelHistoryPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');

  const db = new Database(dbPath);
  const scope = userScopedWhere(access, 'user_id');

  const fuelEntries = db.prepare(`SELECT * FROM fuel WHERE ${scope.clause} ORDER BY date DESC LIMIT 200`).all(...scope.params);
  const trips = db.prepare(`SELECT trip_number, status, start_date FROM trips WHERE status != 'Cancelled' AND ${scope.clause} ORDER BY start_date DESC LIMIT 30`).all(...scope.params);

  return <FuelHistoryClient initialFuel={fuelEntries} trips={trips} />;
}
