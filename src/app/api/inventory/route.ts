import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAccess, userScopedWhere } from '@/lib/ownership';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const { trailer_number } = await request.json();
    if (!trailer_number) return NextResponse.json({ error: 'Trailer number is required' }, { status: 400 });

    const now = new Date().toISOString();
    const targetUserId = access.adminMode ? null : access.session.userId;

    const existing = await db().get('SELECT trailer_number FROM trailer_inventory WHERE trailer_number = $1', [trailer_number]);
    if (existing) {
      const result = await db().run(
        'UPDATE trailer_inventory SET last_seen = $1, user_id = COALESCE(user_id, $2) WHERE trailer_number = $3 AND ($4 OR user_id = $5)',
        [now, targetUserId, trailer_number, access.adminMode ? true : false, access.session.userId]
      );
      if (!result.changes && !access.adminMode) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    } else {
      await db().run('INSERT INTO trailer_inventory (trailer_number, last_seen, user_id) VALUES ($1, $2, $3)', [trailer_number, now, targetUserId]);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const scope = userScopedWhere(access, 'user_id');
    const inventory = await db().query(`SELECT * FROM trailer_inventory WHERE ${scope.clause} ORDER BY trailer_number ASC`, scope.params);
    return NextResponse.json(inventory);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
