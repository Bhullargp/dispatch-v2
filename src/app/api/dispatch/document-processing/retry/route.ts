import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { retryDocumentProcessingDraft } from '@/lib/document-processing';

export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const body = await req.json().catch(() => ({}));
    const draftId = Number(body?.draftId);
    if (!draftId) {
      return NextResponse.json({ error: 'draftId is required' }, { status: 400 });
    }

    const draft = await retryDocumentProcessingDraft({
      draftId,
      userId: access.session.userId,
    });

    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Failed to retry draft processing' }, { status: 400 });
  }
}
