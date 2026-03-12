import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/dispatch-auth';

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(authConfig.sessionCookie, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: authConfig.secureCookie,
    expires: new Date(0),
    path: '/'
  });
  return res;
}
