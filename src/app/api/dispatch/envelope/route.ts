import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getServerAccess } from '@/lib/ownership';
import { renderToBuffer, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import React from 'react';

// ─── Styles ──────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 8, padding: '10mm 8mm', backgroundColor: '#fff', color: '#111' },
  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, borderBottom: '2pt solid #cc1111', paddingBottom: 4 },
  logoBox: { width: 90 },
  logoTitle: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: '#cc1111', letterSpacing: 1.5 },
  logoSub: { fontSize: 7, color: '#444', marginTop: 1 },
  subTitle: { flex: 1, textAlign: 'right', fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#cc1111', letterSpacing: 2 },
  // Truck/Trip row
  truckTripRow: { flexDirection: 'row', marginBottom: 6, alignItems: 'center', gap: 30 },
  ttLabel: { fontSize: 8, color: '#555' },
  ttValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginLeft: 4, borderBottom: '1pt solid #ccc', minWidth: 80, paddingBottom: 1 },
  // Table
  table: { border: '1pt solid #cc1111', marginBottom: 6 },
  tHead: { flexDirection: 'row', backgroundColor: '#cc1111', color: '#fff' },
  tHeadCell: { padding: '3pt 4pt', fontFamily: 'Helvetica-Bold', fontSize: 7, flex: 1, borderRight: '0.5pt solid #aa0000' },
  tRow: { flexDirection: 'row', borderTop: '0.5pt solid #e8c8c8' },
  tCell: { padding: '3pt 4pt', flex: 1, borderRight: '0.5pt solid #e8c8c8', minHeight: 16 },
  tCellBold: { padding: '3pt 4pt', flex: 1, borderRight: '0.5pt solid #e8c8c8', fontFamily: 'Helvetica-Bold', minHeight: 16 },
  // Odometer sub-labels
  odoLabel: { fontSize: 6, color: '#888', fontFamily: 'Helvetica-Bold', textTransform: 'uppercase' },
  // Section label
  sectionLabel: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: '#cc1111', textTransform: 'uppercase', marginBottom: 2, marginTop: 4 },
  // Notes row
  noteRow: { flexDirection: 'row', borderTop: '0.5pt solid #e8c8c8', minHeight: 16, alignItems: 'center', paddingLeft: 4, paddingVertical: 2 },
  // Footer
  footer: { marginTop: 8, borderTop: '1pt solid #cc1111', paddingTop: 3, flexDirection: 'row', justifyContent: 'space-between' },
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

// ─── PDF Document ─────────────────────────────────────────────────────────────
function TripEnvelope({ trip, stops, fuel, extraPay }: { trip: any; stops: any[]; fuel: any[]; extraPay: any[] }) {
  const odometerEnd = trip.end_odometer || trip.odometer_end || '';
  const odometerStart = trip.start_odometer || trip.odometer_start || '';
  const odometerTotal = (odometerEnd && odometerStart)
    ? fmtNum(parseFloat(odometerEnd) - parseFloat(odometerStart), 0)
    : trip.total_miles ? fmtNum(trip.total_miles, 0) : '';

  const distUnit = 'MILES';
  const driverName = trip.driver_name || trip.lead_driver || '';
  const truckNum = trip.truck_number || trip.truck || '';
  const trailerNum = trip.trailer_number || trip.trailer || '';

  // Stops — pad to at least 8 rows
  const stopRows = [...stops];
  while (stopRows.length < 8) stopRows.push(null);

  // Fuel — pad to at least 10 rows
  const fuelRows = [...fuel];
  while (fuelRows.length < 10) fuelRows.push(null);

  // Extra pay notes
  const extraNotes: string[] = extraPay.map(e => {
    const qty = e.quantity ? `x${e.quantity}` : '';
    const amt = e.amount ? ` = $${parseFloat(e.amount).toFixed(2)}` : '';
    return `${e.type || e.description}${qty ? ' ' + qty : ''}${amt}`;
  });
  if (trip.notes) extraNotes.push(trip.notes);

  return React.createElement(
    Document,
    { title: `Trip Envelope ${trip.trip_number}` },
    React.createElement(
      Page,
      { size: 'LETTER', style: S.page },

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
        // ENDING / FROM row
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
        // STARTING / TO row
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
        // TOTAL row
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
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.6 }] }, 'TRAILER #'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 2 }] }, 'COMPANY, CITY, PROVINCE'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.6 }] }, 'REEFER TEMP'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.5 }] }, 'TRIP #'),
          React.createElement(Text, { style: [S.tHeadCell, { flex: 0.7, borderRight: 0 }] }, 'P/U DELIVER DROP'),
        ),
        ...stopRows.map((s, i) =>
          React.createElement(View, { key: i, style: S.tRow },
            React.createElement(Text, { style: [S.tCell, { flex: 0.6 }] }, s ? (trailerNum || '') : ''),
            React.createElement(Text, { style: [S.tCell, { flex: 2, fontFamily: s ? 'Helvetica-Bold' : 'Helvetica' }] },
              s ? `${s.location || ''}` : ''
            ),
            React.createElement(Text, { style: [S.tCell, { flex: 0.6 }] }, ''),
            React.createElement(Text, { style: [S.tCell, { flex: 0.5 }] }, ''),
            React.createElement(Text, { style: [S.tCell, { flex: 0.7, borderRight: 0, fontFamily: s?.stop_type ? 'Helvetica-Bold' : 'Helvetica' }] },
              s ? (s.stop_type || '').toUpperCase().replace('PICKUP', 'P/U').replace('DELIVERY', 'D/L').replace('DROP', 'DROP') : ''
            ),
          )
        ),
      ),

      // ── Extra pay / notes ──
      ...extraNotes.map((note, i) =>
        React.createElement(View, { key: i, style: S.noteRow },
          React.createElement(Text, null, `+ ${note}`),
        )
      ),
      extraNotes.length === 0
        ? React.createElement(View, { style: { height: 32 } }, React.createElement(Text, null, ''))
        : null,

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
          const isLitre = f && (f.unit === 'Litres' || (f.liters && !f.gallons));
          const gal = f ? (f.gallons ? fmtNum(f.gallons, 3) : '') : '';
          const lit = f ? (f.liters ? fmtNum(f.liters, 1) : '') : '';
          const amt = f ? (f.amount_usd ? `$${fmtNum(f.amount_usd, 2)}` : '') : '';
          const loc = f ? `${f.location || ''}${f.province ? ', ' + f.province : ''}` : '';
          return React.createElement(View, { key: i, style: S.tRow },
            React.createElement(Text, { style: [S.tCell, { flex: 0.7 }] }, f ? fmtDate(f.date) : ''),
            React.createElement(Text, { style: [S.tCell, { flex: 1.8 }] }, loc),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right' }] }, gal),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right' }] }, lit),
            React.createElement(Text, { style: [S.tCell, { flex: 0.8, borderRight: 0, textAlign: 'right' }] }, amt),
          );
        }),
        // Totals row
        React.createElement(View, { style: [S.tRow, { backgroundColor: '#fff5f5' }] },
          React.createElement(Text, { style: [S.tCell, { flex: 0.7, fontFamily: 'Helvetica-Bold' }] }, 'TOTAL'),
          React.createElement(Text, { style: [S.tCell, { flex: 1.8 }] }, ''),
          React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right', fontFamily: 'Helvetica-Bold' }] },
            fmtNum(fuel.reduce((s, f) => s + (parseFloat(f.gallons) || 0), 0), 3)
          ),
          React.createElement(Text, { style: [S.tCell, { flex: 0.8, textAlign: 'right', fontFamily: 'Helvetica-Bold' }] },
            fmtNum(fuel.reduce((s, f) => s + (parseFloat(f.liters) || 0), 0), 1)
          ),
          React.createElement(Text, { style: [S.tCell, { flex: 0.8, borderRight: 0, textAlign: 'right', fontFamily: 'Helvetica-Bold' }] },
            `$${fmtNum(fuel.reduce((s, f) => s + (parseFloat(f.amount_usd) || 0), 0), 2)}`
          ),
        ),
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

    const stops = await db().query(
      `SELECT * FROM stops WHERE trip_number = $1 AND (${scopeClause}) ORDER BY stop_order ASC, id ASC`,
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

    const element = React.createElement(TripEnvelope, { trip, stops, fuel, extraPay });
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
