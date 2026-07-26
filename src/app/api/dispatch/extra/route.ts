import { NextResponse } from 'next/server';
import { db, shouldRunRuntimeSchemaEnsures } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { ensureTripOwnership, requireAccess } from '@/lib/ownership';
import pool from '@/lib/db';

async function ensureExtraPayLinkColumns() {
  if (!shouldRunRuntimeSchemaEnsures()) return;

  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS linked_stop_id INTEGER'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS linked_stop_number INTEGER'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS duration_hours REAL'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS rate REAL'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS segment_start_stop_id INTEGER'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS segment_end_stop_id INTEGER'); } catch {}
  try { await db().run('ALTER TABLE extra_pay ADD COLUMN IF NOT EXISTS segment_miles REAL'); } catch {}
}

const HOURLY_RATES: Record<string, number> = {
  'City Work': 39,
  'Waiting Time': 30,
};

function toNumber(value: any): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

function inferHourlyRate(entry: any, type: string): number {
  const explicitRate = toNumber(entry.rate);
  if (explicitRate > 0) return explicitRate;

  const quantity = toNumber(entry.duration_hours) || toNumber(entry.quantity);
  const amount = toNumber(entry.amount);
  if (quantity > 0 && amount > 0) return amount / quantity;

  return HOURLY_RATES[type] || 0;
}

function inferHours(entry: any, type: string): number {
  const duration = toNumber(entry.duration_hours);
  if (duration > 0) return duration;

  const quantity = toNumber(entry.quantity);
  if (quantity > 0) return quantity;

  const rate = inferHourlyRate(entry, type);
  const amount = toNumber(entry.amount);
  if (rate > 0 && amount > 0) return amount / rate;

  return 1;
}

function normalizeExtrasForStorage(extras: any[]): any[] {
  const normalized: any[] = [];
  const hourlyBuckets = new Map<string, any[]>();

  for (const entry of Array.isArray(extras) ? extras : []) {
    const type = String(entry?.type || '');
    if (!type) continue;
    if (HOURLY_RATES[type]) {
      const bucket = hourlyBuckets.get(type) || [];
      bucket.push(entry);
      hourlyBuckets.set(type, bucket);
      continue;
    }
    normalized.push(entry);
  }

  for (const [type, entries] of hourlyBuckets.entries()) {
    const quantities = entries.map((entry) => inferHours(entry, type)).filter((hours) => hours > 0);
    if (quantities.length === 0) continue;

    const hasAggregateCityWork = type === 'City Work' && quantities.some((hours) => hours > 1);
    const hours = roundHours(hasAggregateCityWork
      ? Math.max(...quantities)
      : quantities.reduce((sum, value) => sum + value, 0));
    if (hours <= 0) continue;

    const last = entries[entries.length - 1] || {};
    const rate = inferHourlyRate(last, type) || HOURLY_RATES[type];
    normalized.push({
      ...last,
      type,
      rate,
      quantity: hours,
      duration_hours: hours,
      amount: Math.round(rate * hours * 100) / 100,
      linked_stop_id: type === 'City Work' ? null : last.linked_stop_id || null,
      linked_stop_number: type === 'City Work' ? null : last.linked_stop_number || null,
    });
  }

  return normalized;
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    await ensureExtraPayLinkColumns();
    const body = await request.json();
    const {
      trip_number, type, amount, quantity, linked_stop_id, linked_stop_number, rate, duration_hours, notes,
      segment_start_stop_id, segment_end_stop_id, segment_miles,
    } = body;

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const result = await db().run(
      `INSERT INTO extra_pay (
        trip_number, type, amount, quantity, user_id, linked_stop_id, linked_stop_number, rate, duration_hours, notes,
        segment_start_stop_id, segment_end_stop_id, segment_miles
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        trip_number, type, amount || 0, quantity || 1, access.adminMode ? null : access.session.userId,
        linked_stop_id || null, linked_stop_number || null, rate || null, duration_hours || null, notes || null,
        segment_start_stop_id || null, segment_end_stop_id || null, segment_miles || null,
      ]
    );

    return NextResponse.json({ success: true, id: result.rows?.[0]?.id || null });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const result = await db().run('DELETE FROM extra_pay WHERE id = $1 AND ($2 OR user_id = $3)', [id, access.adminMode ? true : false, access.session.userId]);
    if (!result.changes) return NextResponse.json({ error: 'Extra pay not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    await ensureExtraPayLinkColumns();
    const body = await request.json();
    const { trip_number, extras } = body;

    if (!(await ensureTripOwnership(access, trip_number))) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM extra_pay WHERE trip_number = $1 AND ($2 OR user_id = $3)', [trip_number, access.adminMode ? true : false, access.session.userId]);
      for (const e of normalizeExtrasForStorage(extras)) {
        await client.query(
          `INSERT INTO extra_pay (
            trip_number, type, amount, quantity, user_id, linked_stop_id, linked_stop_number, rate, duration_hours, notes,
            segment_start_stop_id, segment_end_stop_id, segment_miles
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            trip_number, e.type, e.amount || 0, e.quantity || 1, access.adminMode ? null : access.session.userId,
            e.linked_stop_id || null, e.linked_stop_number || null, e.rate || null, e.duration_hours || null, e.notes || null,
            e.segment_start_stop_id || null, e.segment_end_stop_id || null, e.segment_miles || null,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
