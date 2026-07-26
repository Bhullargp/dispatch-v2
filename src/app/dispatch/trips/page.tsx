export const dynamic = 'force-dynamic';

import React from 'react';
import { db } from '@/lib/db';
import { redirect } from 'next/navigation';
import TripSheetClient from '../TripSheetClient';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { buildDocumentDownloadUrl, buildSourcePathUrl } from '@/lib/dispatch-documents';
import { getServerAccess, userScopedWhere } from '@/lib/ownership';

export default async function TripsPage({ searchParams }: { searchParams?: Promise<{ adminMode?: string }> }) {
  await ensureDispatchAuthSchemaAndSeed();
  const sp = searchParams ? await searchParams : undefined;
  const access = await getServerAccess(sp?.adminMode);
  if (!access) redirect('/login');
  if (access.mustChangePassword) redirect('/login?forcePasswordChange=1');

  const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [access.session.userId]) as any;
  if (!user?.setup_complete) {
    redirect('/setup');
  }

  const scope = userScopedWhere(access, 't.user_id');

  const trips = await db().query(`
    SELECT t.*,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT ILIKE '%caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY COALESCE(stop_order, 999999), id ASC LIMIT 1) as first_stop,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT ILIKE '%caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY COALESCE(stop_order, 999999) DESC, id DESC LIMIT 1) as last_stop,
    (SELECT json_agg(json_build_object('type', type, 'amount', amount, 'quantity', quantity, 'rate', rate, 'duration_hours', duration_hours)) FROM extra_pay WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as extra_pay_json,
    (SELECT json_agg(json_build_object('stop_type', stop_type, 'location', location, 'date', date, 'miles_from_last', miles_from_last) ORDER BY COALESCE(stop_order, 999999) ASC, id ASC) FROM stops WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as stops_json,
    (SELECT json_agg(json_build_object(
        'path', ud.s3_key,
        'source_path', ud.source_path,
        'filename', ud.filename,
        'id', ud.id,
        'description', ud.description,
        'linked_record_type', ud.linked_record_type,
        'document_type', dpd.document_type
      ) ORDER BY ud.id DESC)
      FROM user_documents ud
      LEFT JOIN document_processing_drafts dpd ON dpd.user_document_id = ud.id
      WHERE ud.trip_number = t.trip_number
        AND ud.user_id = t.user_id
        AND (ud.file_type = 'application/pdf' OR ud.filename ILIKE '%.pdf')) as trip_pdfs_json
    FROM trips t
    WHERE ${scope.clause}
    ORDER BY trip_number DESC
    LIMIT 50
  `, scope.params);

  return <TripSheetClient initialTrips={trips.map((trip: any) => ({
    ...trip,
    trip_pdfs_json: normalizeTripPdfJson(trip.trip_pdfs_json),
  }))} isAdmin={access.isAdmin} />;
}

function normalizeTripPdfJson(value: unknown) {
  const documents = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? JSON.parse(value || '[]')
      : [];

  return JSON.stringify(documents.map((document: any) => ({
    id: document.id,
    filename: document.filename || 'Itinerary PDF',
    description: document.description || null,
    linkedRecordType: document.linked_record_type || null,
    documentType: document.document_type || null,
    path: document.path?.startsWith('documents/')
      ? buildDocumentDownloadUrl(document.path)
      : document.source_path
        ? buildSourcePathUrl(document.source_path)
        : document.path || null,
  })).filter((document: any) => document.path));
}
