import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { auditLog } from '@/lib/audit-log';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const url = new URL(request.url);
    const payPeriod = url.searchParams.get('pay_period');
    if (!payPeriod) return NextResponse.json({ error: 'pay_period required' }, { status: 400 });

    const row = await db().get(
      'SELECT status FROM pay_period_status WHERE user_id = $1 AND pay_period = $2',
      [access.session.userId, payPeriod]
    ) as any;

    return NextResponse.json({ status: row?.status || 'pending' });
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
    const { pay_period, status } = body;
    if (!pay_period || !['paid', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'pay_period and status (paid/pending) required' }, { status: 400 });
    }

    await db().run(
      `INSERT INTO pay_period_status (user_id, pay_period, status)
      VALUES ($1, $2, $3)
      ON CONFLICT(user_id, pay_period) DO UPDATE SET status = EXCLUDED.status`,
      [access.session.userId, pay_period, status]
    );

    await auditLog({ userId: access.session.userId, action: 'pay_period_mark_paid', details: `${pay_period} → ${status}` });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
