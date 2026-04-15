import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess, userScopedWhere } from '@/lib/ownership';
import { ensureUserDocumentsTable } from '@/lib/dispatch-documents';

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
      receiptPath, receiptDescription,
    } = body;

    let target_trip = trip_number;
    if ((trip_number === 'AUTO' || !trip_number) && date) {
      const trip = await db().get(
        `SELECT trip_number FROM trips
        WHERE ($1 BETWEEN start_date AND end_date OR ($2 >= start_date AND end_date IS NULL))
        AND ($3 OR user_id = $4)
        ORDER BY start_date DESC
        LIMIT 1`,
        [date, date, access.adminMode ? true : false, access.session.userId]
      ) as { trip_number: string } | undefined;
      target_trip = trip?.trip_number || 'UNLINKED';
    }

    if (target_trip && target_trip !== 'UNLINKED' && !(await ensureTripOwnership(access, target_trip))) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const scopedUserId = access.adminMode ? null : access.session.userId;
    const gallonsNumber = gallons === undefined || gallons === null || gallons === '' ? null : Number(gallons);
    const amountUsdNumber = amount_usd === undefined || amount_usd === null || amount_usd === '' ? null : Number(amount_usd);
    const odometerNumber = odometer === undefined || odometer === null || odometer === '' ? null : Number(odometer);
    const locationValue = location || null;
    const gallonsTolerancePct = 0.02;

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
      gallons: number | string | null;
      amount_usd: number | string | null;
      odometer: number | string | null;
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
      const duplicateReason = (() => {
        const entryGallons = duplicate.gallons === null || duplicate.gallons === undefined || duplicate.gallons === '' ? null : Number(duplicate.gallons);
        if ((duplicate.location || '') === (locationValue || '') && gallonsNumber !== null && entryGallons !== null
          && Math.abs(entryGallons - gallonsNumber) <= Math.abs(gallonsNumber) * gallonsTolerancePct) {
          return `same date (${date}), location (${locationValue || 'N/A'}), and gallons within ±2% tolerance (${duplicate.gallons})`;
        }
        return `same date (${date}), amount_usd (${duplicate.amount_usd}), and odometer (${duplicate.odometer})`;
      })();

      return NextResponse.json(
        {
          error: 'DUPLICATE_FUEL_ENTRY',
          message: `Possible duplicate: a fuel entry with ${duplicateReason} already exists.`,
          existing_entry: duplicate,
          new_entry_attempted: {
            trip_number: target_trip,
            date,
            location: locationValue,
            gallons,
            amount_usd,
            odometer,
          },
          hint: 'Delete the unwanted entry via DELETE /api/dispatch/fuel with its ID, then retry the insert.',
          tolerance_note: 'Gallons duplicate checks use a ±2% tolerance.',
        },
        { status: 409 }
      );
    }

    const existing = await db().get(
      `SELECT id FROM fuel
       WHERE trip_number = $1
         AND date = $2
         AND COALESCE(location, '') = COALESCE($3, '')
         AND ($4 OR user_id = $5)
       ORDER BY id DESC
       LIMIT 1`,
      [target_trip, date, locationValue, access.adminMode ? true : false, access.session.userId]
    ) as { id: number } | undefined;

    let fuelId = existing?.id;

    if (fuelId) {
      await db().run(
        `UPDATE fuel
         SET province = $1, country = $2, gallons = $3, liters = $4, price_per_unit = $5,
             amount_usd = $6, unit = $7, odometer = $8, prev_odometer = $9, fuel_type = $10,
             def_liters = $11, def_cost = $12, def_price_per_unit = $13, currency = $14
         WHERE id = $15`,
        [
          province || null, country || null, gallons || null, liters || null, price_per_unit || null,
          amount_usd || null, unit || 'Gallons', odometer || null, prev_odometer || null, fuel_type || 'diesel',
          def_liters || null, def_cost || null, def_price_per_unit || null, currency || 'USD', fuelId,
        ]
      );
    } else {
      await db().run(
        `INSERT INTO fuel (
          trip_number, date, location, province, country,
          gallons, liters, price_per_unit, amount_usd, unit,
          odometer, prev_odometer, fuel_type,
          def_liters, def_cost, def_price_per_unit, currency, user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          target_trip, date, location, province || null, country || null,
          gallons || null, liters || null, price_per_unit || null, amount_usd || null, unit || 'Gallons',
          odometer || null, prev_odometer || null, fuel_type || 'diesel',
          def_liters || null, def_cost || null, def_price_per_unit || null,
          currency || 'USD', scopedUserId,
        ]
      );

      const inserted = await db().get(
        `SELECT id FROM fuel
         WHERE trip_number = $1
           AND date = $2
           AND COALESCE(location, '') = COALESCE($3, '')
           AND ($4 OR user_id = $5)
         ORDER BY id DESC
         LIMIT 1`,
        [target_trip, date, location || null, access.adminMode ? true : false, access.session.userId]
      ) as { id: number } | undefined;
      fuelId = inserted?.id;
    }

    if (receiptPath && target_trip && target_trip !== 'UNLINKED') {
      await ensureUserDocumentsTable();
      const existingDocument = await db().get(
        `SELECT id FROM user_documents
         WHERE user_id = $1 AND trip_number = $2 AND source_path = $3
         LIMIT 1`,
        [access.session.userId, target_trip, receiptPath]
      ) as { id: number } | undefined;

      if (!existingDocument) {
        await db().run(
          `INSERT INTO user_documents (user_id, file_key, original_filename, file_type, file_size, description, trip_number, source_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            access.session.userId,
            receiptPath,
            receiptPath.split('/').pop() || 'receipt',
            'image/jpeg',
            0,
            receiptDescription || 'Fuel receipt',
            target_trip,
            receiptPath,
          ]
        );
      }
    }

    return NextResponse.json({ success: true, id: fuelId, deduped: !!existing });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const trip_number = searchParams.get('trip_number');
  const unlinkedOnly = searchParams.get('unlinked') === 'true';

  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const scope = userScopedWhere(access, 'user_id');
    await ensureUserDocumentsTable();

    let fuel;
    const receiptJoin = `
      SELECT f.*, d.receipt_url, d.receipt_filename, d.receipt_source_url
      FROM fuel f
      LEFT JOIN LATERAL (
        SELECT
          CASE WHEN ud.source_path IS NOT NULL AND ud.source_path <> ''
            THEN '/api/dispatch/documents/source?path=' || replace(ud.source_path, ' ', '%20')
            ELSE '/api/dispatch/documents/download/' || replace(ud.file_key, '/', '%2F') || '?redirect=true'
          END AS receipt_url,
          ud.original_filename AS receipt_filename,
          CASE WHEN ud.source_path IS NOT NULL AND ud.source_path <> ''
            THEN '/api/dispatch/documents/source?path=' || replace(ud.source_path, ' ', '%20')
            ELSE NULL
          END AS receipt_source_url
        FROM user_documents ud
        WHERE ud.trip_number = f.trip_number
          AND ud.user_id::text = COALESCE(f.user_id::text, ud.user_id::text)
          AND (
            lower(COALESCE(ud.description, '')) LIKE '%fuel%'
            OR lower(COALESCE(ud.description, '')) LIKE '%receipt%'
            OR lower(COALESCE(ud.original_filename, '')) LIKE '%fuel%'
            OR lower(COALESCE(ud.original_filename, '')) LIKE '%receipt%'
          )
        ORDER BY ud.uploaded_at DESC, ud.id DESC
        LIMIT 1
      ) d ON true
    `;

    if (unlinkedOnly) {
      fuel = await db().query(`${receiptJoin} WHERE (f.trip_number = 'UNLINKED' OR f.trip_number IS NULL) AND ${scope.clause.replace(/\buser_id\b/g, 'f.user_id')} ORDER BY f.date DESC`, scope.params);
    } else if (trip_number) {
      if (trip_number !== 'UNLINKED' && !(await ensureTripOwnership(access, trip_number))) {
        return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
      }
      fuel = await db().query(`${receiptJoin} WHERE f.trip_number = $1 AND ${scope.clause.replace(/\buser_id\b/g, 'f.user_id')} ORDER BY f.date DESC`, [trip_number, ...scope.params]);
    } else {
      fuel = await db().query(`${receiptJoin} WHERE ${scope.clause.replace(/\buser_id\b/g, 'f.user_id')} ORDER BY f.date DESC`, scope.params);
    }

    return NextResponse.json(fuel.map((entry: any) => ({
      ...entry,
      receiptUrl: entry.receipt_url || entry.receipt_source_url || null,
      receiptFilename: entry.receipt_filename || null,
    })));
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

    const existing = await db().get('SELECT id FROM fuel WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
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

    params.push(id, access.adminMode ? true : false, access.session.userId);
    await db().run(`UPDATE fuel SET ${updates.join(', ')} WHERE id = $${idx} AND ($${idx+1} OR user_id = $${idx+2})`, params);
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

    const result = await db().run('DELETE FROM fuel WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!result.changes) return NextResponse.json({ error: 'Fuel record not found' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
