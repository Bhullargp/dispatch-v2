import { NextResponse } from 'next/server';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { getDocumentProcessingDrafts } from '@/lib/document-processing';

export async function GET(req: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(req);
    if (response || !access) return response;

    const { searchParams } = new URL(req.url);
    const tripNumber = searchParams.get('tripNumber');

    const drafts = await getDocumentProcessingDrafts(access.session.userId, tripNumber);
    return NextResponse.json({ drafts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to load document processing drafts' }, { status: 500 });
  }
}
