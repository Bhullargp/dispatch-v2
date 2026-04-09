import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    // Ensure bonus_type and fixed_amount columns exist
    try {
      await db().run('ALTER TABLE safety_bonus ADD COLUMN IF NOT EXISTS bonus_type TEXT DEFAULT \'per_mile\'');
      await db().run('ALTER TABLE safety_bonus ADD COLUMN IF NOT EXISTS fixed_amount REAL DEFAULT 0');
    } catch {}

    const row = await db().get(
      'SELECT * FROM safety_bonus WHERE user_id = $1',
      [access.session.userId]
    ) as any;

    if (!row) {
      return NextResponse.json({ safety_bonus: { rate_per_mile: 0.02, enabled: true, bonus_type: 'per_mile', fixed_amount: 0 } });
    }

    return NextResponse.json({
      safety_bonus: {
        rate_per_mile: row.rate_per_mile,
        enabled: row.enabled === 1,
        bonus_type: row.bonus_type || 'per_mile',
        fixed_amount: row.fixed_amount || 0,
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
    const { rate_per_mile, enabled, bonus_type, fixed_amount } = body;

    if (rate_per_mile === undefined && enabled === undefined) {
      return NextResponse.json({ error: 'rate_per_mile or enabled required' }, { status: 400 });
    }

    // Upsert
    await db().run(
      `INSERT INTO safety_bonus (user_id, rate_per_mile, enabled, bonus_type, fixed_amount, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         rate_per_mile = COALESCE($2, safety_bonus.rate_per_mile),
         enabled = COALESCE($3, safety_bonus.enabled),
         bonus_type = COALESCE($4, safety_bonus.bonus_type),
         fixed_amount = COALESCE($5, safety_bonus.fixed_amount)`,
      [
        access.session.userId,
        rate_per_mile !== undefined ? parseFloat(rate_per_mile) : null,
        enabled !== undefined ? (enabled ? 1 : 0) : null,
        bonus_type || null,
        fixed_amount !== undefined ? parseFloat(fixed_amount) : null,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
