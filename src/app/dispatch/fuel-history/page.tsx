export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import FuelHistoryClient from './FuelHistoryClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';
import {
  dedupeTripDocuments,
  getTripDocumentsForTrips,
  pickFuelReceiptDocument,
  resolveDocumentSourceUrl,
} from '@/lib/dispatch-documents';

export default async function FuelHistoryPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/login');
  if (access.mustChangePassword) redirect('/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) redirect('/setup');
  const scope = userScopedWhere(access, 'user_id');

  const fuelEntries = await db().query(`SELECT * FROM fuel WHERE ${scope.clause} ORDER BY date DESC, id DESC LIMIT 200`, scope.params) as any[];
  const trips = await db().query(`SELECT trip_number, status, start_date FROM trips WHERE status != 'Cancelled' AND ${scope.clause} ORDER BY start_date DESC LIMIT 30`, scope.params);

  const tripNumbers = Array.from(new Set(
    fuelEntries
      .map((entry) => entry.trip_number)
      .filter((tripNumber) => !!tripNumber && tripNumber !== 'UNLINKED') as string[]
  ));
  const documents = dedupeTripDocuments(await getTripDocumentsForTrips(access.session.userId, tripNumbers));

  const fuelWithReceipts = fuelEntries.map((entry) => {
    const receipt = pickFuelReceiptDocument(
      entry,
      documents.filter((document) => document.trip_number === entry.trip_number)
    );

    return {
      ...entry,
      receiptUrl: receipt ? resolveDocumentSourceUrl(receipt) : null,
      receiptFilename: receipt?.original_filename || null,
    };
  });

  return <FuelHistoryClient initialFuel={fuelWithReceipts} trips={trips} />;
}
