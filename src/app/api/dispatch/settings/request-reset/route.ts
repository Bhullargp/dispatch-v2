import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;

    await db().run(
      `INSERT INTO password_reset_requests (user_id, status) VALUES ($1, 'pending')`,
      [access.session.userId]
    );

    return NextResponse.json({ success: true, message: 'Password reset request submitted to admin' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
