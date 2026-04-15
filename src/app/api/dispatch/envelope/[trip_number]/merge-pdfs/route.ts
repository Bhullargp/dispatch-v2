import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { getTripReceiptDocuments } from '@/lib/dispatch-documents';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trip_number: string }> }
) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const access = await getServerAccess();
    if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { trip_number } = await params;
    const trip = await db().get(
      `SELECT trip_number FROM trips WHERE trip_number = $1 AND (${access.adminMode ? '1=1' : 'user_id = $2'})`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as { trip_number: string } | undefined;

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const receiptDocuments = await getTripReceiptDocuments(access.session.userId, trip_number);

    return NextResponse.json({
      trip_number,
      receiptUrls: receiptDocuments.map((document) => document.sourceUrl || document.url).filter(Boolean),
      receipts: receiptDocuments,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
