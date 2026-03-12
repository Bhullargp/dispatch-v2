import { NextResponse } from 'next/server';
import {
  authConfig,
  createSessionToken,
  ensureDispatchAuthSchemaAndSeed,
  findUserByLogin,
  verifySecret
} from '@/lib/dispatch-auth';

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const body = await request.json();
    const login = String(body.login || body.email || '').trim();
    const password = String(body.password || '');

    if (!login || !password) {
      return NextResponse.json({ error: 'Login and password are required' }, { status: 400 });
    }

    const user = findUserByLogin(login);
    if (!user || !verifySecret(password, user.password_hash)) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    const token = createSessionToken({
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    });

    const res = NextResponse.json({ success: true, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    res.cookies.set(authConfig.sessionCookie, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: authConfig.secureCookie,
      maxAge: Math.floor(authConfig.sessionTtlMs / 1000),
      path: '/'
    });
    return res;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Login failed' }, { status: 500 });
  }
}
