import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authConfig, verifySessionToken } from '@/lib/dispatch-auth';

export async function GET() {
  const store = await cookies();
  const token = store.get(authConfig.sessionCookie)?.value;
  const payload = verifySessionToken(token);

  if (!payload) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: payload.userId,
      username: payload.username,
      email: payload.email,
      role: payload.role
    }
  });
}
