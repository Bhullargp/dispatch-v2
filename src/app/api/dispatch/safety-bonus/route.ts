import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const row = await db().get(
      'SELECT * FROM safety_bonus WHERE user_id = $1',
      [access.session.userId]
    );

    if (!row) {
      // Return defaults
      return NextResponse.json({ safety_bonus: { rate_per_mile: 0.02, enabled: true } });
    }

    return NextResponse.json({
      safety_bonus: {
        rate_per_mile: row.rate_per_mile,
        enabled: row.enabled === 1,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { rate_per_mile, enabled } = body;

    if (rate_per_mile === undefined && enabled === undefined) {
      return NextResponse.json({ error: 'rate_per_mile or enabled required' }, { status: 400 });
    }

    // Upsert
    await db().run(
      `INSERT INTO safety_bonus (user_id, rate_per_mile, enabled, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         rate_per_mile = COALESCE($2, safety_bonus.rate_per_mile),
         enabled = COALESCE($3, safety_bonus.enabled)`,
      [
        access.session.userId,
        rate_per_mile !== undefined ? parseFloat(rate_per_mile) : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
