import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const {
      trip_number, date, location, province, country,
      gallons, liters, price_per_unit, amount_usd, unit,
      odometer, prev_odometer, fuel_type,
      def_liters, def_cost, def_price_per_unit, currency,
    } = body;

    let target_trip = trip_number;

    if (target_trip && target_trip !== 'UNLINKED') {
      const tripExists = await db().get('SELECT trip_number FROM trips WHERE trip_number = $1', [target_trip]);
      if (!tripExists) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const scopedUserId = access.adminMode ? null : access.session.userId;
    const gallonsNumber = gallons === undefined || gallons === null || gallons === '' ? null : Number(gallons);
    const amountUsdNumber = amount_usd === undefined || amount_usd === null || amount_usd === '' ? null : Number(amount_usd);
    const odometerNumber = odometer === undefined || odometer === null || odometer === '' ? null : Number(odometer);
    const locationValue = location || null;
    const gallonsTolerancePct = 0.02;

    // Duplicate check
    const duplicateCandidates = await db().query(
      `SELECT id, trip_number, date, location, gallons, amount_usd, odometer
       FROM fuel
       WHERE date = $1
         AND ($2 OR user_id = $3)
       ORDER BY id DESC`,
      [date, access.adminMode ? true : false, access.session.userId]
    ) as Array<{
      id: number;
      trip_number: string | null;
      date: string;
      location: string | null;
      gallons: string | number | null;
      amount_usd: string | number | null;
      odometer: string | number | null;
    }>;

    const duplicate = duplicateCandidates.find((entry) => {
      const sameLocation = (entry.location || '') === (locationValue || '');
      const entryGallons = entry.gallons === null || entry.gallons === undefined || entry.gallons === '' ? null : Number(entry.gallons);
      const gallonsMatch = sameLocation
        && gallonsNumber !== null
        && entryGallons !== null
        && Math.abs(entryGallons - gallonsNumber) <= Math.abs(gallonsNumber) * gallonsTolerancePct;
      const amountMatch = amountUsdNumber !== null
        && entry.amount_usd !== null
        && entry.amount_usd !== undefined
        && entry.amount_usd !== ''
        && Number(entry.amount_usd) === amountUsdNumber;
      const odometerMatch = odometerNumber !== null
        && entry.odometer !== null
        && entry.odometer !== undefined
        && entry.odometer !== ''
        && Number(entry.odometer) === odometerNumber;

      return gallonsMatch || (amountMatch && odometerMatch);
    });

    if (duplicate) {
      return NextResponse.json({
        error: 'DUPLICATE_FUEL_ENTRY',
        message: `Possible duplicate: a fuel entry with same date (${date}), location (${locationValue || 'N/A'}), and similar gallons (${duplicate.gallons}) already exists.`,
        existing_entry: {
          id: duplicate.id,
          trip_number: duplicate.trip_number,
          date: duplicate.date,
          location: duplicate.location,
          gallons: duplicate.gallons,
          amount_usd: duplicate.amount_usd,
          odometer: duplicate.odometer,
        },
        new_entry_attempted: { date, location: locationValue, gallons: gallonsNumber, amount_usd: amountUsdNumber, odometer: odometerNumber },
        hint: 'Delete the unwanted entry via DELETE /api/dispatch/fuel with its ID, then retry the insert.',
      }, { status: 409 });
    }

    const result = await db().run(
      `INSERT INTO fuel (
        trip_number, date, location, province, country,
        gallons, liters, price_per_unit, amount_usd, unit,
        odometer, prev_odometer, fuel_type,
        def_liters, def_cost, def_price_per_unit, currency, user_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      RETURNING id`,
      [
        target_trip, date, location, province || null, country || null,
        gallons || null, liters || null, price_per_unit || null, amount_usd || null, unit || 'Gallons',
        odometer || null, prev_odometer || null, fuel_type || 'diesel',
        def_liters || null, def_cost || null, def_price_per_unit || null,
        currency || 'USD',
        scopedUserId,
      ]
    );

    return NextResponse.json({ success: true, id: result.rows?.[0]?.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trip_number = searchParams.get('trip_number');

  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const isAdmin = access.adminMode;
    const userId = access.session.userId;

    let fuel;
    if (trip_number) {
      if (!isAdmin && !(await ensureTripOwnership(access, trip_number))) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      }
      fuel = await db().query(
        isAdmin
          ? `SELECT * FROM fuel WHERE trip_number = $1 ORDER BY date DESC`
          : `SELECT * FROM fuel WHERE trip_number = $1 AND user_id = $2 ORDER BY date DESC`,
        isAdmin ? [trip_number] : [trip_number, userId]
      );
    } else {
      fuel = await db().query(
        isAdmin
          ? `SELECT * FROM fuel ORDER BY date DESC LIMIT 100`
          : `SELECT * FROM fuel WHERE user_id = $1 ORDER BY date DESC LIMIT 100`,
        isAdmin ? [] : [userId]
      );
    }

    // Attach receipt URL for each fuel entry (from documents table)
    const enriched = await Promise.all(fuel.map(async (entry: any) => {
      const receiptRow = await db().get(
        `SELECT
          CASE WHEN source_path IS NOT NULL AND source_path <> ''
            THEN '/api/dispatch/documents/source?path=' || REPLACE(source_path, ' ', '%20')
            ELSE '/api/dispatch/documents/download/' || REPLACE(s3_key, '/', '%2F') || '?redirect=true'
          END AS receipt_url,
          filename AS receipt_filename
        FROM user_documents
        WHERE trip_number = $1
          AND (lower(description) LIKE '%fuel%' OR lower(description) LIKE '%receipt%' OR lower(filename) LIKE '%fuel%' OR lower(filename) LIKE '%receipt%')
        ORDER BY uploaded_at DESC
        LIMIT 1`,
        [entry.trip_number || 'UNLINKED']
      );
      return {
        ...entry,
        receiptUrl: receiptRow?.receipt_url || null,
        receiptFilename: receiptRow?.receipt_filename || null,
      };
    }));

    return NextResponse.json(enriched);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const {
      id, trip_number, date, location, province, country,
      gallons, liters, price_per_unit, amount_usd, unit,
      odometer, prev_odometer, fuel_type,
      def_liters, def_cost, def_price_per_unit, currency,
    } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const isAdmin = access.adminMode;
    const existing = await db().get(
      isAdmin
        ? 'SELECT id FROM fuel WHERE id = $1'
        : 'SELECT id FROM fuel WHERE id = $1 AND user_id = $2',
      isAdmin ? [id] : [id, access.session.userId]
    );
    if (!existing) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    if (trip_number && trip_number !== 'UNLINKED' && !(await ensureTripOwnership(access, trip_number))) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    const fields: [string, any][] = [
      ['trip_number', trip_number], ['date', date], ['location', location],
      ['province', province], ['country', country], ['gallons', gallons],
      ['liters', liters], ['price_per_unit', price_per_unit], ['amount_usd', amount_usd],
      ['unit', unit], ['odometer', odometer], ['prev_odometer', prev_odometer],
      ['fuel_type', fuel_type], ['def_liters', def_liters], ['def_cost', def_cost],
      ['def_price_per_unit', def_price_per_unit], ['currency', currency],
    ];

    for (const [col, val] of fields) {
      if (val !== undefined) { updates.push(`${col} = $${idx++}`); params.push(val); }
    }

    if (updates.length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    params.push(id);
    await db().run(`UPDATE fuel SET ${updates.join(', ')} WHERE id = $${idx}`, params);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'Missing fuel record id' }, { status: 400 });

    const isAdmin = access.adminMode;
    const result = await db().run(
      isAdmin
        ? 'DELETE FROM fuel WHERE id = $1'
        : 'DELETE FROM fuel WHERE id = $1 AND user_id = $2',
      isAdmin ? [id] : [id, access.session.userId]
    );
    if (!result.changes) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}