import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess, userScopedWhere } from '@/lib/ownership';
import pool from '@/lib/db';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function autoPeriodForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();
  if (day <= 15) {
    const last = lastDayOfMonth(year, month);
    return `${year}-${String(month + 1).padStart(2, '0')}-${last}`;
  } else {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-15`;
  }
}

function isAmbiguous(startDate: string | null, endDate: string | null): boolean {
  if (!startDate || !endDate) return false;
  const s = new Date(startDate + 'T12:00:00');
  const e = new Date(endDate + 'T12:00:00');
  if (s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth()) return false;
  return s.getDate() <= 15 && e.getDate() > 15;
}

function generatePeriods() {
  const periods: Array<{ payDate: string; label: string; payLabel: string; startDate: string; endDate: string }> = [];
  const now = new Date();

  for (let offset = -1; offset <= 6; offset++) {
    let month = now.getMonth() - offset;
    let year = now.getFullYear();
    while (month < 0) { month += 12; year -= 1; }
    while (month > 11) { month -= 12; year += 1; }

    const mm = String(month + 1).padStart(2, '0');
    const last = lastDayOfMonth(year, month);

    periods.push({
      payDate: `${year}-${mm}-${last}`,
      label: `${MONTHS[month]} 1–15`,
      payLabel: `Paid ${MONTHS[month]} ${last}`,
      startDate: `${year}-${mm}-01`,
      endDate: `${year}-${mm}-15`,
    });

    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    const nm2 = String(nm + 1).padStart(2, '0');
    periods.push({
      payDate: `${ny}-${nm2}-15`,
      label: `${MONTHS[month]} 16–${last}`,
      payLabel: `Paid ${MONTHS[nm]} 15`,
      startDate: `${year}-${mm}-16`,
      endDate: `${year}-${mm}-${last}`,
    });
  }

  const seen = new Set<string>();
  const unique = periods.filter(p => { if (seen.has(p.payDate)) return false; seen.add(p.payDate); return true; });
  unique.sort((a, b) => b.payDate.localeCompare(a.payDate));

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const firstPast = unique.findIndex(p => p.payDate <= todayStr);
  const startIdx = Math.max(0, firstPast - 1);
  const window = unique.slice(startIdx, startIdx + 10);

  const upcomingIdx = window.findIndex(p => p.payDate >= todayStr);
  if (upcomingIdx > 0) {
    const upcoming = window.splice(upcomingIdx, 1)[0];
    window.unshift(upcoming);
  }

  return window;
}

async function autoAssignMissingPeriods(userId: number, adminMode: boolean) {
  const scope = adminMode ? { clause: '1=1', params: [] } : { clause: 'user_id = $1', params: [userId] };
  const trips = await db().query(
    `SELECT trip_number, start_date, end_date FROM trips
    WHERE pay_period IS NULL AND (start_date IS NOT NULL OR end_date IS NOT NULL)
    AND (${scope.clause})`,
    scope.params
  ) as Array<{ trip_number: string; start_date: string | null; end_date: string | null }>;

  for (const trip of trips) {
    const dateToUse = trip.end_date || trip.start_date;
    if (!dateToUse) continue;
    if (isAmbiguous(trip.start_date, trip.end_date)) continue;
    const period = autoPeriodForDate(dateToUse);
    await db().run('UPDATE trips SET pay_period = $1 WHERE trip_number = $2', [period, trip.trip_number]);
  }
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    await autoAssignMissingPeriods(access.session.userId, access.adminMode);

    const url = new URL(request.url);
    const selectedPeriod = url.searchParams.get('period');

    const scope = userScopedWhere(access, 'user_id');
    const periods = generatePeriods();

    const baseQuery = `
  SELECT t.*,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id ASC LIMIT 1) as first_stop,
    (SELECT location FROM stops WHERE trip_number = t.trip_number AND location NOT LIKE '%Caledon%' AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'}) ORDER BY id DESC LIMIT 1) as last_stop,
    (SELECT json_agg(json_build_object('type', type, 'amount', amount, 'quantity', quantity)) FROM extra_pay WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as extra_pay_json,
    (SELECT json_agg(json_build_object('stop_type', stop_type, 'location', location, 'date', date, 'miles_from_last', miles_from_last) ORDER BY id ASC) FROM stops WHERE trip_number = t.trip_number AND (${access.adminMode ? '1=1' : 'user_id = t.user_id'})) as stops_json
  FROM trips t WHERE ${scope.clause} ORDER BY trip_number DESC
`;
    const allTrips = await db().query(baseQuery, scope.params) as any[];

    const ambiguousTrips = allTrips.filter(t =>
      !t.pay_period && isAmbiguous(t.start_date, t.end_date)
    );

    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    let defaultPeriod = periods[0]?.payDate;
    const upcomingIdx = periods.findIndex(p => p.payDate >= todayStr);
    if (upcomingIdx >= 0) {
      defaultPeriod = periods[upcomingIdx].payDate;
    }
    const currentPeriod = selectedPeriod || defaultPeriod;

    const periodStatuses: Record<string, { status: string; tripCount: number; incompleteCount: number; paidStatus: string }> = {};
    let paidRows: any[] = [];
    try {
      paidRows = await db().query('SELECT pay_period, status FROM pay_period_status WHERE user_id = $1', [access.session.userId]) as any[];
    } catch {}
    const paidMap = Object.fromEntries(paidRows.map(r => [r.pay_period, r.status]));

    for (const p of periods) {
      const pTrips = allTrips.filter((t: any) => t.pay_period === p.payDate);
      const incomplete = pTrips.filter((t: any) => !t.total_miles || t.status !== 'Completed');
      let status = 'upcoming';
      if (p.payDate < todayStr && pTrips.length === 0) status = 'empty';
      else if (p.payDate < todayStr && incomplete.length > 0) status = 'incomplete';
      else if (p.payDate < todayStr) status = 'complete';
      else if (p.payDate >= todayStr) status = 'upcoming';
      periodStatuses[p.payDate] = { status, tripCount: pTrips.length, incompleteCount: incomplete.length, paidStatus: paidMap[p.payDate] || 'pending' };
    }

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastM = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const lastMY = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const lastMonth = `${lastMY}-${String(lastM + 1).padStart(2, '0')}`;

    const thisMonthTrips = allTrips.filter((t: any) => t.start_date?.startsWith(thisMonth) || t.end_date?.startsWith(thisMonth));
    const lastMonthTrips = allTrips.filter((t: any) => t.start_date?.startsWith(lastMonth) || t.end_date?.startsWith(lastMonth));

    let deductions: any[] = [];
    try {
      if (access.adminMode) {
        deductions = await db().query('SELECT * FROM deductions ORDER BY created_at DESC', []) as any[];
      } else {
        deductions = await db().query('SELECT * FROM deductions WHERE user_id = $1 ORDER BY created_at DESC', [access.session.userId]) as any[];
      }
    } catch {}

    return NextResponse.json({
      periods,
      currentPeriod,
      todayStr,
      periodStatuses,
      monthlyComparison: {
        thisMonth: { month: thisMonth, trips: thisMonthTrips.length },
        lastMonth: { month: lastMonth, trips: lastMonthTrips.length },
      },
      allTrips,
      ambiguousTrips: ambiguousTrips.map(t => t.trip_number),
      deductions,
    });
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
    const { trip_number, pay_period } = body;

    if (!trip_number) return NextResponse.json({ error: 'trip_number required' }, { status: 400 });

    const scope = access.adminMode ? '1=1' : 'user_id = $3';
    const params = access.adminMode ? [pay_period, trip_number] : [pay_period, trip_number, access.session.userId];
    await db().run(`UPDATE trips SET pay_period = $1 WHERE trip_number = $2 AND (${scope})`, params);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
