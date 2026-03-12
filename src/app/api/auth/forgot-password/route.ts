import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed, resetPasswordBySecurityAnswers } from '@/lib/dispatch-auth';

export async function POST(request: Request) {
  try {
    ensureDispatchAuthSchemaAndSeed();
    const body = await request.json();

    const email = String(body.email || '').trim().toLowerCase();
    const answers = Array.isArray(body.answers) ? body.answers.map((a: any) => String(a || '')) : [];
    const newPassword = String(body.newPassword || '');

    if (!email || answers.length !== 3 || !newPassword) {
      return NextResponse.json({ error: 'Email, 3 answers and new password are required' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    const ok = resetPasswordBySecurityAnswers(email, answers, newPassword);
    if (!ok) {
      return NextResponse.json({ error: 'Invalid email or security answers' }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Reset failed' }, { status: 500 });
  }
}
