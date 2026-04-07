import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const items = await db().query(
      'SELECT * FROM extra_pay_items WHERE user_id = $1 ORDER BY created_at DESC',
      [access.session.userId]
    );
    return NextResponse.json(items);
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
    const userId = access.session.userId;

    if (body.action === 'delete') {
      await db().run('DELETE FROM extra_pay_items WHERE id = $1 AND user_id = $2', [body.id, userId]);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'replaceAll') {
      await db().run('DELETE FROM extra_pay_items WHERE user_id = $1', [userId]);
      for (const item of (body.items || [])) {
        if (item.name && item.amount !== undefined) {
          await db().run(
            'INSERT INTO extra_pay_items (user_id, name, rate_type, amount) VALUES ($1, $2, $3, $4)',
            [userId, item.name, item.rate_type || 'fixed', item.amount]
          );
        }
      }
      return NextResponse.json({ success: true });
    }

    const { id, name, rate_type, amount } = body;
    if (!name || amount === undefined) {
      return NextResponse.json({ error: 'Name and amount are required' }, { status: 400 });
    }

    if (id) {
      await db().run(
        'UPDATE extra_pay_items SET name=$1, rate_type=$2, amount=$3 WHERE id=$4 AND user_id=$5',
        [name, rate_type || 'fixed', amount, id, userId]
      );
    } else {
      await db().run(
        'INSERT INTO extra_pay_items (user_id, name, rate_type, amount) VALUES ($1, $2, $3, $4)',
        [userId, name, rate_type || 'fixed', amount]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
