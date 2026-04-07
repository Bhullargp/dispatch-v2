import { NextResponse } from 'next/server';
import { deleteOldR2Objects, isR2Configured } from '@/lib/r2-storage';

// Called by a cron job or admin — deletes R2 objects older than 30 days
// Protect with DISPATCH_WORKER_TOKEN header
export async function POST(req: Request) {
  const token = req.headers.get('x-worker-token');
  const configured = process.env.DISPATCH_WORKER_TOKEN;
  if (!configured || token !== configured) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isR2Configured()) {
    return NextResponse.json({ skipped: true, reason: 'R2 not configured' });
  }

  // Delete all objects older than 120 days under the root prefix
  const deleted = await deleteOldR2Objects('documents/', 120);

  return NextResponse.json({ ok: true, deleted });
}
