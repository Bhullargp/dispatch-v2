export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import FuelHistoryClient from './FuelHistoryClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';
import { getTripDocuments } from '@/lib/dispatch-documents';

export default async function FuelHistoryPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) redirect('/dispatch/setup');
  const scope = userScopedWhere(access, 'user_id');

  const fuelEntries = await db().query(`SELECT * FROM fuel WHERE ${scope.clause} ORDER BY date DESC LIMIT 200`, scope.params) as any[];
  const trips = await db().query(`SELECT trip_number, status, start_date FROM trips WHERE status != 'Cancelled' AND ${scope.clause} ORDER BY start_date DESC LIMIT 30`, scope.params);

  const tripNumbers = [...new Set(fuelEntries.map((entry) => entry.trip_number).filter((tripNumber) => tripNumber && tripNumber !== 'UNLINKED'))] as string[];
  const tripDocuments = Object.fromEntries(
    await Promise.all(
      tripNumbers.map(async (tripNumber) => {
        const documents = await getTripDocuments(access.session.userId, tripNumber);
        const receipt = documents.find((document) => {
          const haystack = `${document.original_filename || ''} ${document.description || ''}`.toLowerCase();
          return haystack.includes('fuel') || haystack.includes('receipt');
        });
        return [tripNumber, receipt?.sourceUrl || receipt?.url || null] as const;
      })
    )
  );

  const fuelWithReceipts = fuelEntries.map((entry) => ({
    ...entry,
    receiptUrl: entry.trip_number ? tripDocuments[entry.trip_number] || null : null,
  }));

  return <FuelHistoryClient initialFuel={fuelWithReceipts} trips={trips} />;
}
