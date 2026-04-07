import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const url = new URL(request.url);
    const payPeriod = url.searchParams.get('pay_period');

    let rows;
    if (payPeriod) {
      if (access.adminMode) {
        rows = await db().query('SELECT * FROM deductions WHERE pay_period = $1 ORDER BY created_at DESC', [payPeriod]);
      } else {
        rows = await db().query('SELECT * FROM deductions WHERE pay_period = $1 AND user_id = $2 ORDER BY created_at DESC', [payPeriod, access.session.userId]);
      }
    } else {
      if (access.adminMode) {
        rows = await db().query('SELECT * FROM deductions ORDER BY created_at DESC', []);
      } else {
        rows = await db().query('SELECT * FROM deductions WHERE user_id = $1 ORDER BY created_at DESC', [access.session.userId]);
      }
    }

    const recurring = access.adminMode
      ? await db().query('SELECT * FROM deductions WHERE is_recurring = 1', [])
      : await db().query('SELECT * FROM deductions WHERE is_recurring = 1 AND user_id = $1', [access.session.userId]);

    return NextResponse.json({ deductions: rows, recurring });
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
    const { name, amount, pay_period, is_recurring } = body;

    if (!name || !amount || !pay_period) {
      return NextResponse.json({ error: 'name, amount, and pay_period required' }, { status: 400 });
    }

    const result = await db().run(
      'INSERT INTO deductions (user_id, pay_period, name, amount, is_recurring) VALUES ($1, $2, $3, $4, $5)',
      [access.adminMode ? null : access.session.userId, pay_period, name, amount, is_recurring ? 1 : 0]
    );

    return NextResponse.json({ success: true, id: result.changes });
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
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const result = access.adminMode
      ? await db().run('DELETE FROM deductions WHERE id = $1', [id])
      : await db().run('DELETE FROM deductions WHERE id = $1 AND user_id = $2', [id, access.session.userId]);

    if (!result.changes) return NextResponse.json({ error: 'Deduction not found' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
