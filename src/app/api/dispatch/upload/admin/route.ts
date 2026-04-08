import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    const action = String(body.action || '');
    const id = Number(body.id);

    if (!Number.isFinite(id)) return NextResponse.json({ error: 'Valid job id is required' }, { status: 400 });

    if (action === 'retry') {
      const result = await db().run(`
        UPDATE upload_jobs
        SET status = 'queued',
            error_message = NULL,
            cancel_requested = 0,
            attempt_count = 0,
            processing_by = NULL,
            updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
        WHERE id = $1 AND status = 'failed'
      `, [id]);

      if (!result.changes) return NextResponse.json({ error: 'Only failed jobs can be retried' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (action === 'cancel') {
      const result = await db().run(`
        UPDATE upload_jobs
        SET status = 'cancelled',
            cancel_requested = 1,
            updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
        WHERE id = $1 AND status = 'queued'
      `, [id]);

      if (!result.changes) return NextResponse.json({ error: 'Only queued jobs can be cancelled' }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Admin upload action failed' }, { status: 500 });
  }
}
