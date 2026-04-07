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
      'SELECT * FROM trip_rules WHERE user_id = $1 ORDER BY created_at DESC',
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
      await db().run('DELETE FROM trip_rules WHERE id = $1 AND user_id = $2', [body.id, userId]);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'toggle') {
      await db().run('UPDATE trip_rules SET enabled = $1 WHERE id = $2 AND user_id = $3', [body.enabled ? 1 : 0, body.id, userId]);
      return NextResponse.json({ success: true });
    }

    const { id, name, rule_type, value, enabled } = body;
    if (!name || value === undefined || !rule_type) {
      return NextResponse.json({ error: 'Name, type, and value are required' }, { status: 400 });
    }

    if (id) {
      await db().run(
        'UPDATE trip_rules SET name=$1, rule_type=$2, value=$3, enabled=$4 WHERE id=$5 AND user_id=$6',
        [name, rule_type, value, enabled !== false ? 1 : 0, id, userId]
      );
    } else {
      await db().run(
        'INSERT INTO trip_rules (user_id, name, rule_type, value, enabled) VALUES ($1, $2, $3, $4, $5)',
        [userId, name, rule_type, value, enabled !== false ? 1 : 0]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
