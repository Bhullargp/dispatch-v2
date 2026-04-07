import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authConfig, verifySessionToken } from '@/lib/dispatch-auth';
import { db } from '@/lib/db';

export async function GET() {
  const store = await cookies();
  const token = store.get(authConfig.sessionCookie)?.value;
  const payload = verifySessionToken(token);

  if (!payload) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Check setup_complete status
  let setupComplete = true;
  try {
    const user = await db().get('SELECT setup_complete FROM users WHERE id = $1', [payload.userId]) as any;
    setupComplete = !!user?.setup_complete;
  } catch {}

  return NextResponse.json({
    authenticated: true,
    user: {
      id: payload.userId,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      mustChangePassword: !!payload.mustChangePassword,
      setupComplete
    }
  });
}
