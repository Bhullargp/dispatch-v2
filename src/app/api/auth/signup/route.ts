import { NextResponse } from 'next/server';
import { createUser, ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const body = await request.json();

    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const securityQuestions = Array.isArray(body.securityQuestions) ? body.securityQuestions : [];

    if (!username || !email || !password) {
      return NextResponse.json({ error: 'Username, email and password are required' }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (securityQuestions.length !== 3 || securityQuestions.some((q: any) => !q?.question || !q?.answer)) {
      return NextResponse.json({ error: 'Exactly 3 security questions and answers are required' }, { status: 400 });
    }

    const id = createUser({ username, email, password, securityQuestions });
    return NextResponse.json({ success: true, userId: id });
  } catch (error: any) {
    const msg = error?.message || 'Signup failed';
    const status = msg.includes('exists') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
