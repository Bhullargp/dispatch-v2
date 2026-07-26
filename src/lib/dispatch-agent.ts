import { db } from '@/lib/db';

export type DispatchAgentMode = 'mock';

export type DispatchAgentAction =
  | 'daily_brief'
  | 'trip_check'
  | 'queue_check'
  | 'pay_audit';

export type DispatchAgentRequest = {
  action?: DispatchAgentAction;
  prompt?: string;
  tripNumber?: string;
};

export type DispatchAgentResponse = {
  mode: DispatchAgentMode;
  title: string;
  summary: string;
  bullets: string[];
  suggestedActions: string[];
  data: Record<string, unknown>;
};

function asInt(value: any) {
  const parsed = Number.parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMoney(value: any) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function pickAction(request: DispatchAgentRequest): DispatchAgentAction {
  if (request.action) return request.action;
  const prompt = String(request.prompt || '').toLowerCase();
  if (/queue|upload|process|worker|document/.test(prompt)) return 'queue_check';
  if (/pay|paid|money|earning|rate|extra/.test(prompt)) return 'pay_audit';
  if (/trip|load|stop|fuel/.test(prompt)) return 'trip_check';
  return 'daily_brief';
}

async function getDashboardSnapshot(userId: number, isAdmin: boolean) {
  const scopeClause = isAdmin ? '1=1' : 'user_id = $1';
  const params = isAdmin ? [] : [userId];

  const [tripCounts, queueCounts, docCounts, fuelCounts, payRows] = await Promise.all([
    db().get(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status IN ('Completed', 'Complete') THEN 1 ELSE 0 END)::int AS completed,
        SUM(CASE WHEN total_miles IS NULL OR total_miles = 0 THEN 1 ELSE 0 END)::int AS missing_miles
      FROM trips
      WHERE ${scopeClause}
    `, params) as Promise<any>,
    db().get(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END)::int AS queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END)::int AS processing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END)::int AS done
      FROM upload_jobs
      WHERE ${scopeClause}
    `, params) as Promise<any>,
    db().get(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status IN ('needs_review', 'ambiguous') THEN 1 ELSE 0 END)::int AS needs_review,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)::int AS errors,
        SUM(CASE WHEN status = 'saved' THEN 1 ELSE 0 END)::int AS saved
      FROM document_processing_drafts
      WHERE ${scopeClause}
    `, params).catch(() => ({ total: 0, needs_review: 0, errors: 0, saved: 0 })) as Promise<any>,
    db().get(`
      SELECT COUNT(*)::int AS total, SUM(COALESCE(amount_usd, 0))::float AS amount
      FROM fuel
      WHERE ${scopeClause}
    `, params) as Promise<any>,
    db().query(`
      SELECT type, COUNT(*)::int AS rows, SUM(COALESCE(amount, 0))::float AS amount
      FROM extra_pay
      WHERE ${scopeClause}
      GROUP BY type
      ORDER BY amount DESC NULLS LAST
      LIMIT 5
    `, params).catch(() => []) as Promise<any[]>,
  ]);

  return {
    trips: {
      total: asInt(tripCounts?.total),
      completed: asInt(tripCounts?.completed),
      missingMiles: asInt(tripCounts?.missing_miles),
    },
    queue: {
      queued: asInt(queueCounts?.queued),
      processing: asInt(queueCounts?.processing),
      failed: asInt(queueCounts?.failed),
      done: asInt(queueCounts?.done),
    },
    documents: {
      total: asInt(docCounts?.total),
      needsReview: asInt(docCounts?.needs_review),
      errors: asInt(docCounts?.errors),
      saved: asInt(docCounts?.saved),
    },
    fuel: {
      total: asInt(fuelCounts?.total),
      amount: toMoney(fuelCounts?.amount),
    },
    topExtras: payRows.map((row) => ({
      type: row.type,
      rows: asInt(row.rows),
      amount: toMoney(row.amount),
    })),
  };
}

async function getTripSnapshot(tripNumber: string | undefined, userId: number, isAdmin: boolean) {
  const latestTrip = await db().get(
    `SELECT trip_number FROM trips WHERE ${isAdmin ? '1=1' : 'user_id = $1'} ORDER BY trip_number DESC LIMIT 1`,
    isAdmin ? [] : [userId]
  ) as any;
  const target = tripNumber || latestTrip?.trip_number;
  if (!target) return null;

  const params = isAdmin ? [target] : [target, userId];
  const userClause = isAdmin ? '1=1' : 'user_id = $2';
  const [trip, stops, fuel, extras, docs] = await Promise.all([
    db().get(`SELECT trip_number, status, total_miles, start_date, end_date, route FROM trips WHERE trip_number = $1 AND ${userClause}`, params) as Promise<any>,
    db().get(`SELECT COUNT(*)::int AS c FROM stops WHERE trip_number = $1 AND ${userClause}`, params) as Promise<any>,
    db().get(`SELECT COUNT(*)::int AS c, SUM(COALESCE(amount_usd, 0))::float AS amount FROM fuel WHERE trip_number = $1 AND ${userClause}`, params) as Promise<any>,
    db().query(`SELECT type, SUM(COALESCE(amount, 0))::float AS amount FROM extra_pay WHERE trip_number = $1 AND ${userClause} GROUP BY type ORDER BY type`, params) as Promise<any[]>,
    db().get(`SELECT COUNT(*)::int AS c FROM upload_jobs WHERE trip_number = $1 AND ${userClause}`, params).catch(() => ({ c: 0 })) as Promise<any>,
  ]);

  if (!trip) return null;

  return {
    trip,
    stops: asInt(stops?.c),
    fuel: { rows: asInt(fuel?.c), amount: toMoney(fuel?.amount) },
    extras: extras.map((row) => ({ type: row.type, amount: toMoney(row.amount) })),
    documents: asInt(docs?.c),
  };
}

export async function runMockDispatchAgent(params: {
  request: DispatchAgentRequest;
  userId: number;
  isAdmin: boolean;
}): Promise<DispatchAgentResponse> {
  const action = pickAction(params.request);
  const dashboard = await getDashboardSnapshot(params.userId, params.isAdmin);
  const trip = action === 'trip_check'
    ? await getTripSnapshot(params.request.tripNumber, params.userId, params.isAdmin)
    : null;

  if (action === 'queue_check') {
    const busy = dashboard.queue.queued + dashboard.queue.processing;
    return {
      mode: 'mock',
      title: 'Mock Agent Queue Check',
      summary: busy > 0
        ? `${busy} upload job${busy === 1 ? '' : 's'} still need worker attention.`
        : 'Upload worker queue is clear right now.',
      bullets: [
        `Queued: ${dashboard.queue.queued}`,
        `Processing: ${dashboard.queue.processing}`,
        `Failed: ${dashboard.queue.failed}`,
        `Document drafts needing review: ${dashboard.documents.needsReview}`,
      ],
      suggestedActions: [
        dashboard.queue.queued > 0 ? 'Run the upload worker from Admin.' : 'No queue run needed right now.',
        dashboard.queue.failed > 0 ? 'Open failed upload jobs and retry after checking the error.' : 'No failed upload jobs detected.',
        dashboard.documents.needsReview > 0 ? 'Review pending document drafts before trusting extracted records.' : 'Document review queue looks clean.',
      ],
      data: { action, dashboard },
    };
  }

  if (action === 'pay_audit') {
    const extrasTotal = dashboard.topExtras.reduce((sum, row) => sum + row.amount, 0);
    return {
      mode: 'mock',
      title: 'Mock Agent Pay Audit',
      summary: `I found ${dashboard.trips.total} trips and ${formatMoney(extrasTotal)} in the top extra-pay categories.`,
      bullets: [
        `Completed trips: ${dashboard.trips.completed}/${dashboard.trips.total}`,
        `Trips missing miles: ${dashboard.trips.missingMiles}`,
        `Fuel records: ${dashboard.fuel.total} (${formatMoney(dashboard.fuel.amount)})`,
        ...dashboard.topExtras.map((row) => `${row.type}: ${row.rows} row${row.rows === 1 ? '' : 's'}, ${formatMoney(row.amount)}`),
      ],
      suggestedActions: [
        dashboard.trips.missingMiles > 0 ? 'Open trips missing miles before final payroll.' : 'Mileage completeness looks okay.',
        'Spot-check hourly City Work and Waiting Time entries before marking a period paid.',
        'Compare fuel receipts against trip envelopes for any missing receipt links.',
      ],
      data: { action, dashboard },
    };
  }

  if (action === 'trip_check') {
    if (!trip) {
      return {
        mode: 'mock',
        title: 'Mock Agent Trip Check',
        summary: 'I could not find a trip to inspect.',
        bullets: ['No matching trip was returned from the database.'],
        suggestedActions: ['Enter a trip number and run the check again.'],
        data: { action, dashboard },
      };
    }

    return {
      mode: 'mock',
      title: `Mock Agent Trip Check: ${trip.trip.trip_number}`,
      summary: `${trip.trip.trip_number} has ${trip.stops} stops, ${trip.fuel.rows} fuel rows, and ${trip.documents} uploaded document jobs.`,
      bullets: [
        `Status: ${trip.trip.status || 'unknown'}`,
        `Miles: ${trip.trip.total_miles || 0}`,
        `Dates: ${trip.trip.start_date || 'unknown'} to ${trip.trip.end_date || 'unknown'}`,
        `Fuel spend: ${formatMoney(trip.fuel.amount)}`,
        ...trip.extras.map((row) => `${row.type}: ${formatMoney(row.amount)}`),
      ],
      suggestedActions: [
        !trip.trip.total_miles ? 'Add or verify trip miles.' : 'Miles are present.',
        trip.fuel.rows === 0 ? 'Check whether this trip needs fuel receipt links.' : 'Fuel records are attached.',
        trip.stops === 0 ? 'Add stops or reprocess the itinerary.' : 'Stops are present.',
      ],
      data: { action, dashboard, trip },
    };
  }

  return {
    mode: 'mock',
    title: 'Mock Agent Daily Brief',
    summary: `Your dispatch app has ${dashboard.trips.total} trips, ${dashboard.fuel.total} fuel records, and ${dashboard.documents.needsReview} document draft${dashboard.documents.needsReview === 1 ? '' : 's'} needing review.`,
    bullets: [
      `Completed trips: ${dashboard.trips.completed}/${dashboard.trips.total}`,
      `Trips missing miles: ${dashboard.trips.missingMiles}`,
      `Upload queue: ${dashboard.queue.queued} queued, ${dashboard.queue.processing} processing, ${dashboard.queue.failed} failed`,
      `Fuel total tracked: ${formatMoney(dashboard.fuel.amount)}`,
    ],
    suggestedActions: [
      dashboard.documents.needsReview > 0 ? 'Review document drafts first.' : 'Document review queue is clear.',
      dashboard.queue.queued > 0 ? 'Run the upload worker.' : 'No upload worker run needed.',
      dashboard.trips.missingMiles > 0 ? 'Fix missing miles before payroll.' : 'Trip mileage looks complete.',
    ],
    data: { action, dashboard },
  };
}
