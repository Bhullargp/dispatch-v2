import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { getTripDocuments } from '@/lib/dispatch-documents';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trip_number: string }> }
) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const access = await getServerAccess();
    if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { trip_number } = await params;
    const scopeClause = access.adminMode ? '1=1' : 'user_id = $2';
    const scopeParams = access.adminMode ? [trip_number] : [trip_number, access.session.userId];

    const trip = await db().get(
      `SELECT * FROM trips WHERE trip_number = $1 AND (${scopeClause})`,
      scopeParams
    ) as any;

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const [fuelEntries, documents] = await Promise.all([
      db().query(
        `SELECT * FROM fuel WHERE trip_number = $1 AND (${scopeClause}) ORDER BY date DESC, id DESC`,
        scopeParams
      ),
      getTripDocuments(access.session.userId, trip_number),
    ]);

    return NextResponse.json({
      trip,
      fuelEntries,
      documents,
      mergedPdfDownloadUrl: `/api/dispatch/envelope/${encodeURIComponent(trip_number)}/merge-pdfs`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
