import { NextResponse } from 'next/server';
import { authConfig, createSessionToken, ensureDispatchAuthSchemaAndSeed, getDb, hashSecret, verifySecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request, { allowWhenPasswordChangeRequired: true });
    if (response || !access) return response;

    const body = await request.json();
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current password and new password are required' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role, password_hash FROM users WHERE id = ?').get(access.session.userId) as any;
    if (!user || !verifySecret(currentPassword, user.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 });
    }

    db.prepare(`
      UPDATE users
      SET password_hash = ?,
          force_password_change = 0,
          last_password_reset_at = datetime('now')
      WHERE id = ?
    `).run(hashSecret(newPassword), user.id);

    const token = createSessionToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      mustChangePassword: false
    });

    const res = NextResponse.json({ success: true });
    res.cookies.set(authConfig.sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.secureCookie,
      maxAge: Math.floor(authConfig.sessionTtlMs / 1000),
      path: '/'
    });
    return res;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to change password' }, { status: 500 });
  }
}
