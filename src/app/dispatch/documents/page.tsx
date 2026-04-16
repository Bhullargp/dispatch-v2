export const dynamic = 'force-dynamic';

import React from 'react';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureUserDocumentsTable } from '@/lib/dispatch-documents';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';
import DocumentsClient from './DocumentsClient';

export default async function DocumentsPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/dispatch/login');
  if (access.mustChangePassword) redirect('/dispatch/login?forcePasswordChange=1');

  const database = db();
  const user = await database.get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) {
    redirect('/dispatch/setup');
  }

  await ensureUserDocumentsTable();

  const tripScope = userScopedWhere(access, 'user_id');
  const docScope = userScopedWhere(access, 'user_id');

  const [availableTrips, initialDocuments] = await Promise.all([
    database.query(`
      SELECT trip_number, start_date, end_date, status
      FROM trips
      WHERE ${tripScope.clause}
      ORDER BY
        CASE WHEN lower(coalesce(status, '')) = 'active' THEN 0 ELSE 1 END,
        trip_number DESC
      LIMIT 200
    `, tripScope.params),
    database.query(`
      SELECT id,
             s3_key AS file_key,
             filename AS original_filename,
             file_type,
             file_size,
             description,
             trip_number,
             source_path,
             uploaded_at::text AS uploaded_at
      FROM user_documents
      WHERE ${docScope.clause}
      ORDER BY uploaded_at DESC, id DESC
      LIMIT 50
    `, docScope.params),
  ]);

  return (
    <DocumentsClient
      availableTrips={availableTrips}
      initialDocuments={initialDocuments}
    />
  );
}
