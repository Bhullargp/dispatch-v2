import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed, hashSecret, verifySecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const { currentPassword, securityAnswers, securityAnswersIndexed, newPassword } = body;

    if (!newPassword || newPassword.length < 4) {
      return NextResponse.json({ error: 'New password must be at least 4 characters' }, { status: 400 });
    }

    const user = await db().get('SELECT * FROM users WHERE id = $1', [access.session.userId]) as any;
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let authorized = false;

    if (currentPassword) {
      authorized = verifySecret(currentPassword, user.password_hash);
    }

    if (!authorized && securityAnswers && securityAnswers.length === 3) {
      authorized = (
        verifySecret(securityAnswers[0].trim().toLowerCase(), user.security_a1_hash) &&
        verifySecret(securityAnswers[1].trim().toLowerCase(), user.security_a2_hash) &&
        verifySecret(securityAnswers[2].trim().toLowerCase(), user.security_a3_hash)
      );
    }

    if (!authorized && securityAnswersIndexed && Array.isArray(securityAnswersIndexed) && securityAnswersIndexed.length >= 2) {
      const hashFields = ['security_a1_hash', 'security_a2_hash', 'security_a3_hash'] as const;
      let allCorrect = true;
      for (const sa of securityAnswersIndexed) {
        const idx = sa.index;
        const answer = sa.answer.trim().toLowerCase();
        if (idx < 0 || idx > 2 || !answer) { allCorrect = false; break; }
        if (!verifySecret(answer, user[hashFields[idx]])) { allCorrect = false; break; }
      }
      authorized = allCorrect;
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Current password or security answers are incorrect' }, { status: 403 });
    }

    await db().run('UPDATE users SET password_hash = $1, force_password_change = 0 WHERE id = $2',
      [hashSecret(newPassword), access.session.userId]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
