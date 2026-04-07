import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const rules = await db().query(
      'SELECT * FROM custom_pay_rules WHERE user_id = $1 ORDER BY priority DESC, created_at DESC',
      [access.session.userId]
    );
    return NextResponse.json(rules);
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
      await db().run('DELETE FROM custom_pay_rules WHERE id = $1 AND user_id = $2', [body.id, userId]);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'toggle') {
      await db().run('UPDATE custom_pay_rules SET enabled = $1 WHERE id = $2 AND user_id = $3', [body.enabled ? 1 : 0, body.id, userId]);
      return NextResponse.json({ success: true });
    }

    const { id, name, rate, rate_type, conditions_json, enabled, priority } = body;
    if (!name || rate === undefined) {
      return NextResponse.json({ error: 'Name and rate are required' }, { status: 400 });
    }

    if (id) {
      await db().run(
        `UPDATE custom_pay_rules SET name=$1, rate=$2, rate_type=$3, conditions_json=$4, enabled=$5, priority=$6 WHERE id=$7 AND user_id=$8`,
        [name, rate, rate_type || 'per_mile', JSON.stringify(conditions_json || {}), enabled !== false ? 1 : 0, priority || 0, id, userId]
      );
    } else {
      await db().run(
        `INSERT INTO custom_pay_rules (user_id, name, rate, rate_type, conditions_json, enabled, priority) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, name, rate, rate_type || 'per_mile', JSON.stringify(conditions_json || {}), enabled !== false ? 1 : 0, priority || 0]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
