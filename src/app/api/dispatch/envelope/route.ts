import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import React from 'react';

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 7.5, padding: '8mm 8mm 12mm 8mm', backgroundColor: '#fff', color: '#111' },
  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 5, borderBottom: '2pt solid #cc1111', paddingBottom: 3 },
  logoBox: { width: 90 },
  logoTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#cc1111', letterSpacing: 1.5 },
  logoSub: { fontSize: 7, color: '#444', marginTop: 1 },
  subTitle: { flex: 1, textAlign: 'right', fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#cc1111', letterSpacing: 2 },
  // Truck/Trip row
  truckTripRow: { flexDirection: 'row', marginBottom: 5, alignItems: 'center', gap: 24 },
  ttLabel: { fontSize: 8, color: '#555' },
  ttValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginLeft: 4, borderBottom: '1pt solid #ccc', minWidth: 80, paddingBottom: 1 },
  // Table
  table: { border: '1pt solid #cc1111', marginBottom: 5 },
  tHead: { flexDirection: 'row', backgroundColor: '#cc1111', color: '#fff' },
  tHeadCell: { padding: '2.5pt 4pt', fontFamily: 'Helvetica-Bold', fontSize: 6.5, flex: 1, borderRight: '0.5pt solid #aa0000' },
  tRow: { flexDirection: 'row', borderTop: '0.5pt solid #e8c8c8' },
  tCell: { padding: '2.5pt 4pt', flex: 1, borderRight: '0.5pt solid #e8c8c8', minHeight: 14 },
  tCellBold: { padding: '2.5pt 4pt', flex: 1, borderRight: '0.5pt solid #e8c8c8', fontFamily: 'Helvetica-Bold', minHeight: 14 },
  locationCell: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 2 },
  locationText: { fontSize: 8, fontFamily: 'Helvetica-Bold' },
  stopTypeInline: { fontSize: 7, color: '#555' },
  stopTypeCellText: { fontSize: 7, color: '#555', fontFamily: 'Helvetica' },
  // Odometer sub-labels
  odoLabel: { fontSize: 6, color: '#888', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  // Section label
  sectionLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#cc1111', textTransform: 'uppercase', marginBottom: 2, marginTop: 3 },
  // Extras two-column table
  extrasTable: { border: '1pt solid #e8c8c8', marginBottom: 5 },
  extrasHead: { flexDirection: 'row', backgroundColor: '#fff5f5', borderBottom: '1pt solid #cc1111' },
  extrasRow: { flexDirection: 'row', borderTop: '0.5pt solid #e8c8c8', minHeight: 13 },
  extrasDesc: { flex: 3, padding: '2.5pt 6pt', fontFamily: 'Helvetica-Bold', fontSize: 7.5 },
  extrasAmt: { flex: 1, padding: '2.5pt 6pt', textAlign: 'right', fontFamily: 'Helvetica-Bold', fontSize: 7.5, color: '#cc1111' },
  extrasHeadDesc: { flex: 3, padding: '2.5pt 6pt', fontFamily: 'Helvetica-Bold', fontSize: 6.5, color: '#cc1111' },
  extrasHeadAmt: { flex: 1, padding: '2.5pt 6pt', fontFamily: 'Helvetica-Bold', fontSize: 6.5, color: '#cc1111', textAlign: 'right' },
  extrasTotalRow: { flexDirection: 'row', borderTop: '1pt solid #cc1111', backgroundColor: '#fff5f5' },
  // Footer — fixed at bottom of page
  footer: { position: 'absolute', bottom: 8, left: '8mm', right: '8mm', borderTop: '1pt solid #cc1111', paddingTop: 3, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: '#888' },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d: string | null | undefined) {
  if (!d) return '';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}/${dt.getFullYear()}`;
}

function fmtNum(n: any, dec = 0) {
  const v = parseFloat(n);
  return isNaN(v) ? '' : v.toFixed(dec);
}

function fmtStopType(stopType: string | null | undefined) {
  return (stopType || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

// ─── PDF Document ─────────────────────────────────────────────────────────────
function TripEnvelope({ trip, stops, fuel, extraPay, expenses, driverName }: {
  trip: any; stops: any[]; fuel: any[]; extraPay: any[]; expenses: any[]; driverName: string;
}) {
  const odometerEnd = trip.end_odometer || trip.odometer_end || '';
  const odometerStart = trip.start_odometer || trip.odometer_start || '';
  const odometerTotal = (odometerEnd && odometerStart)
    ? fmtNum(parseFloat(odometerEnd) - parseFloat(odometerStart), 0)
    : trip.total_miles ? fmtNum(trip.total_miles, 0) : '';

  const distUnit = 'MILES';
  const truckNum = trip.truck_number || trip.truck || '';
  const trailerNum = trip.trailer_number || trip.trailer || '';

  // Stops — pad to at least 8 rows
  const stopRows = [...stops];
  while (stopRows.length < 8) stopRows.push(null);

  // Fuel — pad to at least 4 empty rows
  const fuelRows = [...fuel];
  while (fuelRows.length < 4) fuelRows.push(null);

  // Build extras rows: { description, amount, isToll }
  type ExtraRow = { desc: string; amt: number; isToll?: boolean };
  const extraRows: ExtraRow[] = [];

  for (const e of extraPay) {
    const type = e.type || e.description || '';
    const qty = e.quantity ? parseInt(e.quantity) : 1;
    const amt = e.amount ? parseFloat(e.amount) : 0;

    if (type === 'Waiting Time') {
      extraRows.push({ desc: `Waiting Time — ${qty} Hr${qty !== 1 ? 's' : ''}`, amt });
    } else if (type === 'Tolls') {
      extraRows.push({ desc: `Toll`, amt, isToll: true });
    } else if (type === 'Layover') {
      extraRows.push({ desc: `+ ${qty} Layover${qty > 1 ? 's' : ''}`, amt });
    } else if (type === 'Trailer Switch') {
      extraRows.push({ desc: `+ ${qty} Trailer Switch${qty > 1 ? 'es' : ''}`, amt });
    } else {
      extraRows.push({ desc: `+ ${qty} ${type}`, amt });
    }
  }

  // Reimbursements/expenses (tolls receipts etc.) — shown as CAD
  for (const exp of expenses) {
    const amt = exp.amount ? parseFloat(exp.amount) : 0;
    const name = exp.name || exp.category || 'Expense';
    extraRows.push({ desc: name, amt, isToll: true });
  }

  const extrasTotal = extraRows.reduce((sum, r) => sum + r.amt, 0);
  const tollsTotal = extraRows.filter(r => r.isToll).reduce((sum, r) => sum + r.amt, 0);
  const payTotal = extraRows.filter(r => !r.isToll).reduce((sum, r) => sum + r.amt, 0);

  const pageSize: 'LETTER' | [number, number] = (stops.length > 10 || fuel.length > 4) ? [612, 1008] : 'LETTER';

  return React.createElement(
    Document,
    { title: `Trip Envelope ${trip.trip_number}` },
    React.createElement(
      Page,
      { size: pageSize, style: S.page },

      // ── Header ──
      React.createElement(View, { style: S.headerRow },
        React.createElement(View, { style: S.logoBox },
          React.createElement(Text, { style: S.logoTitle }, 'DM'),
          React.createElement(Text, { style: S.logoSub }, '1616270 ONTARIO INC.'),
          React.createElement(Text, { style: S.logoSub }, 'DBA DM TRANSPORT'),
        ),
        React.createElement(Text, { style: S.subTitle }, 'FLAT BED, REEFER AND DRY VAN'),
      ),

      // ── Truck # / Trip # ──
      React.createElement(View, { style: S.truckTripRow },
        React.createElement(View, { style: { flexDirection: 'row', alignItems: 'baseline' } },
          React.createElement(Text, { style: S.ttLabel }, 'TRUCK #'),
          React.createElement(Text, { style: S.ttValue }, truckNum),
        ),
        React.createElement(View, { style: { flexDirection: 'row', alignItems: 'baseline' } },
          React.createElement(Text, { style: S.ttLabel }, 'TRIP #'),
          React.createElement(Text, { style: S.ttValue }, trip.trip_number || ''),
        ),
      ),

      // ── Odometer / Driver / Dates table ──
      React.createElement(View, { style: S.table },
        React.createElement(View, { style: S.tHead },
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.6 }] }, `ODOMETER (${distUnit})`),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 1.4 }] }, 'DRIVER NAME'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 1, borderRight: 0 }] }, 'DATES'),
        ),
        React.createElement(View, { style: S.tRow },
          React.createElement(View, { style: [S.tCell, { flex: 0.6 }] },
            React.createElement(Text, { style: S.odoLabel }, 'ENDING'),
            React.createElement(Text, null, fmtNum(odometerEnd, 0)),
          ),
          React.createElement(View, { style: [S.tCell, { flex: 1.4 }] },
            React.createElement(Text, { style: S.odoLabel }, '1'),
            React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold', fontSize: 10 } }, driverName.toUpperCase()),
          ),
          React.createElement(View, { style: [S.tCell, { flex: 1, borderRight: 0 }] },
            React.createElement(Text, { style: S.odoLabel }, 'FROM'),
            React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, fmtDate(trip.start_date)),
          ),
        ),
        React.createElement(View, { style: S.tRow },
          React.createElement(View, { style: [S.tCell, { flex: 0.6 }] },
            React.createElement(Text, { style: S.odoLabel }, 'STARTING'),
            React.createElement(Text, null, fmtNum(odometerStart, 0)),
          ),
          React.createElement(View, { style: [S.tCell, { flex: 1.4 }] },
            React.createElement(Text, { style: S.odoLabel }, '2'),
            React.createElement(Text, null, ''),
          ),
          React.createElement(View, { style: [S.tCell, { flex: 1, borderRight: 0 }] },
            React.createElement(Text, { style: S.odoLabel }, 'TO'),
            React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, fmtDate(trip.end_date)),
          ),
        ),
        React.createElement(View, { style: S.tRow },
          React.createElement(View, { style: [S.tCell, { flex: 0.6 }] },
            React.createElement(Text, { style: S.odoLabel }, 'TOTAL'),
            React.createElement(Text, { style: { fontFamily: 'Helvetica-Bold' } }, odometerTotal),
          ),
          React.createElement(View, { style: [S.tCell, { flex: 2.4, borderRight: 0 }] },
            React.createElement(Text, null, trailerNum ? `Trailer: ${trailerNum}` : ''),
          ),
        ),
      ),

      // ── Stops table ──
      React.createElement(View, { style: S.table },
        React.createElement(View, { style: S.tHead },
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.8 }] }, 'STOP TYPE'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.6 }] }, 'TRAILER #'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 2.2 }] }, 'COMPANY, CITY, PROVINCE'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.6 }] }, 'REEFER TEMP'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.5 }] }, 'TRIP #'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.7, borderRight: 0 }] }, 'P/U DELIVER DROP'),
        ),
        ...stopRows.map((s, i) => {
          const stopType = fmtStopType(s?.stop_type);
          const location = s?.location || '';
          const stopTypeInline = stopType ? ` [${stopType}]` : '';

          return React.createElement(View, { key: i, style: S.tRow },
            React.createElement(Text, { style: [S.tCell, S.stopTypeCellText, { flex: 0.8 }] }, stopType),
            React.createElement(Text, { style: [S.tCell, { flex: 0.6 }] }, s ? (trailerNum || '') : ''),
            React.createElement(View, { style: [S.tCell, S.locationCell, { flex: 2.2 }] },
              s ? React.createElement(React.Fragment, null,
                React.createElement(Text, { style: S.locationText }, location),
                stopType ? React.createElement(Text, { style: S.stopTypeInline }, stopTypeInline) : null,
              ) : null
            ),
            React.createElement(Text, { style: [S.tCell, { flex: 0.6 }] }, ''),
            React.createElement(Text, { style: [S.tCell, { flex: 0.5 }] }, ''),
            React.createElement(Text, { style: [S.tCell, { flex: 0.7, borderRight: 0, fontFamily: s?.stop_type ? 'Helvetica-Bold' : 'Helvetica' }] },
              s ? (s.stop_type || '').toUpperCase()
                .replace('PICKUP', 'P/U')
                .replace('DELIVERY', 'D/L')
                .replace('DELIVER', 'D/L') : ''
            ),
          );
        }),
      ),

      // ── Extra Pay & Reimbursements (two-column) ──
      ...(extraRows.length > 0 ? [
        React.createElement(View, { style: { flexDirection: 'row', gap: 8 } },

          // Left: Extra Pay (payable items only)
          React.createElement(View, { style: { flex: 1 } },
            React.createElement(Text, { style: S.sectionLabel }, 'EXTRA PAY'),
            React.createElement(View, { style: S.extrasTable },
              React.createElement(View, { style: S.extrasHead },
                React.createElement(Text, { style: S.extrasHeadDesc }, 'DESCRIPTION'),
                React.createElement(Text, { style: S.extrasHeadAmt }, 'AMOUNT'),
              ),
              ...extraRows.filter(r => !r.isToll).map((r, i) =>
                React.createElement(View, { key: i, style: S.extrasRow },
                  React.createElement(Text, { style: S.extrasDesc }, r.desc),
                  React.createElement(Text, { style: S.extrasAmt }, r.amt > 0 ? `$${r.amt.toFixed(2)}` : ''),
                )
              ),
              extraRows.filter(r => !r.isToll).length === 0
                ? React.createElement(View, { style: S.extrasRow },
                    React.createElement(Text, { style: [S.extrasDesc, { color: '#aaa' }] }, '—'),
                    React.createElement(Text, { style: S.extrasAmt }, ''),
                  )
                : null,
              // Subtotal
              React.createElement(View, { style: S.extrasTotalRow },
                React.createElement(Text, { style: [S.extrasDesc, { color: '#cc1111' }] }, 'SUBTOTAL'),
                React.createElement(Text, { style: [S.extrasAmt, { color: '#cc1111' }] }, `$${payTotal.toFixed(2)}`),
              ),
            ),
          ),

          // Right: Reimbursements / Tolls
          React.createElement(View, { style: { flex: 1 } },
            React.createElement(Text, { style: S.sectionLabel }, 'REIMBURSEMENTS & TOLLS'),
            React.createElement(View, { style: S.extrasTable },
              React.createElement(View, { style: S.extrasHead },
                React.createElement(Text, { style: S.extrasHeadDesc }, 'DESCRIPTION'),
                React.createElement(Text, { style: S.extrasHeadAmt }, 'AMOUNT (CAD)'),
              ),
              ...extraRows.filter(r => r.isToll).map((r, i) =>
                React.createElement(View, { key: i, style: S.extrasRow },
                  React.createElement(Text, { style: S.extrasDesc }, r.desc),
                  React.createElement(Text, { style: S.extrasAmt }, r.amt > 0 ? `$${r.amt.toFixed(2)}` : ''),
                )
              ),
              extraRows.filter(r => r.isToll).length === 0
                ? React.createElement(View, { style: S.extrasRow },
                    React.createElement(Text, { style: [S.extrasDesc, { color: '#aaa' }] }, '—'),
                    React.createElement(Text, { style: S.extrasAmt }, ''),
                  )
                : null,
              // Subtotal
              React.createElement(View, { style: S.extrasTotalRow },
                React.createElement(Text, { style: [S.extrasDesc, { color: '#cc1111' }] }, 'SUBTOTAL'),
                React.createElement(Text, { style: [S.extrasAmt, { color: '#cc1111' }] }, `$${tollsTotal.toFixed(2)}`),
              ),
            ),
          ),
        ),
      ] : []),

      // ── Fuel table ──
      React.createElement(Text, { style: S.sectionLabel }, 'FUEL'),
      React.createElement(View, { style: S.table },
        React.createElement(View, { style: S.tHead },
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.7 }] }, 'DATE'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 1.8 }] }, 'LOCATION'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.8 }] }, 'QTY (GALLON)'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.8 }] }, 'QTY (LITRE)'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.8, borderRight: 0 }] }, 'AMT'),
        ),
        ...fuelRows.map((f, i) => {
          const gal = f ? fmtNum(f.gallons, 3) : '';
          const lit = f ? fmtNum(f.liters, 1) : '';
          const amt = f ? (f.amount_usd ? `$${fmtNum(f.amount_usd, 2)}` : '') : '';
          const loc = f ? `${f.location || ''}` : '';
          return React.createElement(View, { key: i, style: S.tRow },
            React.createElement(Text, { style: [S.tCell, { flex: 0.7 }] }, f ? fmtDate(f.date) : ''),
            React.createElement(Text, { style: [S.tCell, { flex: 1.8 }] }, loc),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right' }] }, gal),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right' }] }, lit),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, borderRight: 0, textAlign: 'right' }] }, amt),
          );
        }),
      ),

      // ── Footer ──
      React.createElement(View, { style: S.footer },
        React.createElement(Text, { style: S.footerText }, '1616270 Ontario Inc. DBA DM Transport'),
        React.createElement(Text, { style: S.footerText }, `Generated: ${new Date().toLocaleDateString('en-CA')}`),
        React.createElement(Text, { style: S.footerText }, `Trip ${trip.trip_number}`),
      ),
    )
  );
}

// ─── API Handler ─────────────────────────────────────────────────────────────
export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { searchParams } = new URL(request.url);
    const trip_number = searchParams.get('trip');
    if (!trip_number) return NextResponse.json({ error: 'Missing trip' }, { status: 400 });

    const access = await getServerAccess();
    if (!access) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const scopeClause = access.adminMode ? '1=1' : 'user_id = $2';

    const trip = await db().get(
      `SELECT * FROM trips WHERE trip_number = $1 AND (${scopeClause})`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as any;
    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    // Ensure profile columns exist on users
    for (const col of ['display_name TEXT', 'phone TEXT', 'truck_number TEXT', 'trailer_number TEXT', 'avatar_url TEXT', 'avatar_preset TEXT']) {
      await db().run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${col}`).catch(() => {});
    }

    // Use display_name from user profile if set, otherwise fall back to trip's extracted driver_name
    let driverName = '';
    try {
      const user = await db().get(
        'SELECT username, display_name FROM users WHERE id = $1',
        [access.session.userId]
      ) as any;
      driverName = user?.display_name || trip.driver_name || user?.username || '';
    } catch {
      driverName = trip.driver_name || '';
    }

    const stops = await db().query(
      `SELECT * FROM stops WHERE trip_number = $1 AND (${scopeClause}) ORDER BY COALESCE(stop_order, 999999) ASC, id ASC`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as any[];

    const fuel = await db().query(
      `SELECT * FROM fuel WHERE trip_number = $1 AND (${scopeClause}) ORDER BY date ASC`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as any[];

    const extraPay = await db().query(
      `SELECT * FROM extra_pay WHERE trip_number = $1 AND (${scopeClause}) ORDER BY created_at ASC`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as any[];

    const expenses = await db().query(
      `SELECT * FROM trip_expenses WHERE trip_number = $1 AND (${scopeClause}) ORDER BY created_at ASC`,
      access.adminMode ? [trip_number] : [trip_number, access.session.userId]
    ) as any[];

    const element = React.createElement(TripEnvelope, { trip, stops, fuel, extraPay, expenses, driverName });
    const buffer = await renderToBuffer(element as any);
    const uint8 = new Uint8Array(buffer);

    return new Response(uint8, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="trip-envelope-${trip_number}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Envelope error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
