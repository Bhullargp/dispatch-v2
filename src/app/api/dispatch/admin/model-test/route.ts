import { NextResponse } from 'next/server';
import { writeAdminDebugLog } from '@/lib/admin-debug-logs';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import { generateDocumentProcessingPreview, type ModelTestProvider } from '@/lib/document-processing';
import { getDocumentUploadMimeType } from '@/lib/upload-file-types';

const ALLOWED_PROVIDERS = new Set<ModelTestProvider>(['auto', 'minimax', 'claude', 'zai', 'openrouter-vision', 'openrouter', 'regex']);
const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const form = await request.formData();
    const fileValue = form.get('file');
    const providerValue = String(form.get('provider') || 'auto').toLowerCase() as ModelTestProvider;
    const model = String(form.get('model') || '').trim().slice(0, 120);

    if (!(fileValue instanceof File)) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    if (!ALLOWED_PROVIDERS.has(providerValue)) {
      return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
    }

    if (fileValue.size <= 0 || fileValue.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'File must be between 1 byte and 15MB' }, { status: 400 });
    }

    const fileType = getDocumentUploadMimeType({ name: fileValue.name, type: fileValue.type || '' });
    if (!fileType || (fileType !== 'application/pdf' && !fileType.startsWith('image/'))) {
      return NextResponse.json({ error: 'Only PDF and image files are supported for model tests' }, { status: 400 });
    }

    const buffer = Buffer.from(await fileValue.arrayBuffer());

    const preview = await generateDocumentProcessingPreview({
      filename: fileValue.name,
      fileType,
      buffer,
      options: {
        provider: providerValue,
        model: model || null,
      },
    });

    await writeAdminDebugLog({
      category: 'admin',
      event: 'model_test_ran',
      userId: access.session.userId,
      provider: providerValue,
      model: model || null,
      fileName: fileValue.name,
      traceId: `model-test-${Date.now().toString(36)}`,
      data: {
        documentType: preview.documentType,
        status: preview.status,
        detectedFileType: preview.meta.detectedFileType,
      },
    }).catch(() => {});

    return NextResponse.json({ success: true, preview });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Model test failed' }, { status: 500 });
  }
}
