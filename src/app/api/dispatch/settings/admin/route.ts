import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed, hashSecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    if (!access.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const body = await request.json();

    if (body.action === 'resetPassword') {
      const { userId, defaultPassword } = body;
      if (!userId || !defaultPassword) {
        return NextResponse.json({ error: 'userId and defaultPassword required' }, { status: 400 });
      }
      await db().run('UPDATE users SET password_hash = $1, force_password_change = 1 WHERE id = $2',
        [hashSecret(defaultPassword), userId]);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'dismissResetRequest') {
      await db().run('UPDATE password_reset_requests SET status = $1 WHERE id = $2',
        ['resolved', body.requestId]);
      return NextResponse.json({ success: true });
    }

    if (body.action === 'setSystemDefaults') {
      for (const [key, value] of Object.entries(body.defaults || {})) {
        await db().run(
          `INSERT INTO system_defaults (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [key, String(value)]
        );
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    if (!access.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    const users = await db().query(`
      SELECT u.id, u.username, u.email, u.role, u.setup_complete, u.created_at,
        COUNT(DISTINCT t.trip_number) as trip_count
      FROM users u
      LEFT JOIN trips t ON t.user_id = u.id
      GROUP BY u.id
      ORDER BY u.role DESC, u.created_at DESC
    `, []);

    const resetRequests = await db().query(`
      SELECT pr.*, u.username, u.email
      FROM password_reset_requests pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.status = 'pending'
      ORDER BY pr.requested_at DESC
    `, []);

    const systemDefaults = await db().query('SELECT key, value FROM system_defaults', []);

    const totalTrips = (await db().get('SELECT COUNT(*) as c FROM trips', [])) as any;
    const totalUsers = (await db().get('SELECT COUNT(*) as c FROM users', [])) as any;
    const pendingResets = (await db().get("SELECT COUNT(*) as c FROM password_reset_requests WHERE status = 'pending'", [])) as any;

    return NextResponse.json({
      users,
      resetRequests,
      systemDefaults,
      stats: {
        totalTrips: totalTrips.c,
        totalUsers: totalUsers.c,
        pendingResets: pendingResets.c,
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
