import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed, getDb, hashSecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const db = getDb();
    const users = db.prepare(`
      SELECT id, username, email, role, force_password_change, last_password_reset_at, created_at
      FROM users
      ORDER BY role DESC, username ASC
    `).all();

    return NextResponse.json({ users });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to fetch users' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const userId = Number(body.userId);
    const temporaryPassword = String(body.temporaryPassword || '');
    const forcePasswordChange = body.forcePasswordChange !== false;

    if (!Number.isFinite(userId)) return NextResponse.json({ error: 'Valid userId is required' }, { status: 400 });
    if (temporaryPassword.length < 8) {
      return NextResponse.json({ error: 'Temporary password must be at least 8 characters' }, { status: 400 });
    }

    const db = getDb();
    const targetUser = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(userId) as any;
    if (!targetUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          force_password_change = ?,
          last_password_reset_at = datetime('now')
      WHERE id = ?
    `).run(hashSecret(temporaryPassword), forcePasswordChange ? 1 : 0, userId);

    db.prepare(`
      INSERT INTO admin_audit_log (
        actor_user_id,
        actor_username,
        target_user_id,
        target_username,
        action,
        metadata
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      access.session.userId,
      access.session.username,
      targetUser.id,
      targetUser.username,
      'admin_password_reset',
      JSON.stringify({
        targetEmail: targetUser.email,
        forcePasswordChange,
        resetAt: new Date().toISOString()
      })
    );

    return NextResponse.json({
      success: true,
      user: {
        id: targetUser.id,
        username: targetUser.username,
        email: targetUser.email,
        role: targetUser.role,
        force_password_change: forcePasswordChange,
        last_password_reset_at: new Date().toISOString()
      }
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to reset user password' }, { status: 500 });
  }
}
