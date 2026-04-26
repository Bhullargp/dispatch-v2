import { NextResponse } from 'next/server';
import { clearAdminDebugLogs, listAdminDebugLogs } from '@/lib/admin-debug-logs';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(500, Number(searchParams.get('limit') || 150)));
    const trace = searchParams.get('trace');
    const logs = await listAdminDebugLogs(limit, trace);
    return NextResponse.json({ logs });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to load logs' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    await clearAdminDebugLogs();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to clear logs' }, { status: 500 });
  }
}
