import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed, hashSecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const user = await db().get(
      'SELECT security_q1, security_q2, security_q3 FROM users WHERE id = $1',
      [access.session.userId]
    ) as any;

    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const questions = [
      user.security_q1,
      user.security_q2,
      user.security_q3,
    ].filter(q => q && String(q).trim());

    if (questions.length === 0) {
      return NextResponse.json({ questions: [], hasQuestions: false });
    }

    return NextResponse.json({ questions, hasQuestions: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    const body = await request.json();
    const userId = access.session.userId;

    const { questions } = body;
    if (!questions || questions.length !== 3) {
      return NextResponse.json({ error: 'Exactly 3 security questions required' }, { status: 400 });
    }
    if (questions.some((q: any) => !q.answer || String(q.answer).trim().length < 3)) {
      return NextResponse.json({ error: 'Security answers must be at least 3 characters' }, { status: 400 });
    }

    await db().run(
      `UPDATE users SET
        security_q1 = $1, security_a1_hash = $2,
        security_q2 = $3, security_a2_hash = $4,
        security_q3 = $5, security_a3_hash = $6
      WHERE id = $7`,
      [
        questions[0].question, hashSecret(questions[0].answer.trim().toLowerCase()),
        questions[1].question, hashSecret(questions[1].answer.trim().toLowerCase()),
        questions[2].question, hashSecret(questions[2].answer.trim().toLowerCase()),
        userId
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
