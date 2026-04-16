import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { confirmDocumentProcessingDraft } from '@/lib/document-processing';

export async function POST(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const body = await req.json();
    const { draftId, tripNumber, documentType, extractedData } = body || {};

    if (!draftId || !documentType || !extractedData) {
      return NextResponse.json({ error: 'draftId, documentType, and extractedData are required' }, { status: 400 });
    }

    const result = await confirmDocumentProcessingDraft({
      draftId: Number(draftId),
      userId: access.session.userId,
      tripNumber: tripNumber || null,
      documentType,
      extractedData,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to confirm document draft' }, { status: 400 });
  }
}
