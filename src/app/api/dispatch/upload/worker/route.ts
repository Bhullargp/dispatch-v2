import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { getRequestAccess } from '@/lib/ownership';
import { acquireUploadWorkerLock, processNextQueuedUploadJob, releaseUploadWorkerLock } from '@/lib/pdf-processing';

function isAuthorized(req: Request): boolean {
  const access = getRequestAccess(req);
  if (access?.isAdmin) return true;

  const configuredToken = process.env.DISPATCH_WORKER_TOKEN;
  if (!configuredToken) return false;
  const provided = req.headers.get('x-worker-token') || new URL(req.url).searchParams.get('token') || '';
  return provided === configuredToken;
}

export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const owner = `worker-${process.pid}-${Date.now()}`;
    const acquired = await acquireUploadWorkerLock(owner, 90);
    if (!acquired) {
      return NextResponse.json({ ok: false, busy: true, message: 'Worker already running' }, { status: 409 });
    }

    try {
      const result = await processNextQueuedUploadJob(owner);
      return NextResponse.json({ ok: true, result });
    } finally {
      await releaseUploadWorkerLock(owner);
    }
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Worker run failed' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const counts = await db().get(`
      SELECT
        SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
      FROM upload_jobs
    `, []) as any;

    return NextResponse.json({ ok: true, counts });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to read worker status' }, { status: 500 });
  }
}
