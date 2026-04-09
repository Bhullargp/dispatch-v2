import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed, hashSecret } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

// Keys that hold sensitive values — mask them in GET responses
const SENSITIVE_KEYS = new Set([
  'llm_minimax_api_key',
  'llm_anthropic_api_key',
  'llm_zai_api_key',
]);

function maskKey(val: string): string {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 6) + '••••••••' + val.slice(-4);
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const rows = await db().query('SELECT key, value FROM system_defaults', []) as Array<{ key: string; value: string }>;
    const raw: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value]));

    // Merge env fallbacks for display (masked)
    const display: Record<string, string> = {
      llm_primary:           raw.llm_primary           || 'minimax',
      llm_minimax_model:     raw.llm_minimax_model     || process.env.MINIMAX_MODEL || 'MiniMax-Text-01',
      llm_minimax_api_key:   maskKey(raw.llm_minimax_api_key || process.env.MINIMAX_API_KEY || ''),
      llm_anthropic_api_key: maskKey(raw.llm_anthropic_api_key || process.env.ANTHROPIC_API_KEY || ''),
      llm_zai_api_key:       maskKey(raw.llm_zai_api_key || process.env.ZAI_API_KEY || ''),
      // Flags showing whether keys are actually set
      llm_minimax_configured:   String(!!(raw.llm_minimax_api_key || process.env.MINIMAX_API_KEY)),
      llm_anthropic_configured: String(!!(raw.llm_anthropic_api_key || process.env.ANTHROPIC_API_KEY)),
      llm_zai_configured:       String(!!(raw.llm_zai_api_key || process.env.ZAI_API_KEY)),
    };

    return NextResponse.json({ settings: display });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const body = await request.json();
    const { settings } = body as { settings: Record<string, string> };

    for (const [key, value] of Object.entries(settings)) {
      // Skip masked values (user didn't change them)
      if (SENSITIVE_KEYS.has(key) && value.includes('••')) continue;
      if (value === null || value === undefined || value === '') {
        await db().run('DELETE FROM system_defaults WHERE key = $1', [key]);
      } else {
        await db().run(
          `INSERT INTO system_defaults (key, value) VALUES ($1, $2)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [key, String(value)]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
