import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';

// Keys that hold sensitive values — mask them in GET responses
const SENSITIVE_KEYS = new Set([
  'llm_minimax_api_key',
  'llm_openrouter_api_key',
  'llm_anthropic_api_key',
  'llm_zai_api_key',
]);

type CustomProviderEntry = {
  id: string;
  name: string;
  provider: 'openrouter' | 'openrouter-vision' | 'minimax' | 'zai';
  model: string;
  api_key: string;
  enabled: boolean;
};

function maskKey(val: string): string {
  if (!val || val.length < 8) return val ? '••••••••' : '';
  return val.slice(0, 6) + '••••••••' + val.slice(-4);
}

function normalizeCustomProviders(value: unknown): CustomProviderEntry[] {
  let parsed: unknown = [];
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = [];
    }
  } else if (Array.isArray(value)) {
    parsed = value;
  }

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((entry) => {
      const item = (entry || {}) as Record<string, unknown>;
      const provider = String(item.provider || '').trim() as CustomProviderEntry['provider'];
      if (!['openrouter', 'openrouter-vision', 'minimax', 'zai'].includes(provider)) return null;
      const id = String(item.id || '').trim();
      if (!id) return null;
      return {
        id,
        name: String(item.name || '').trim() || `Custom ${provider}`,
        provider,
        model: String(item.model || '').trim(),
        api_key: String(item.api_key || ''),
        enabled: item.enabled === false ? false : true,
      } satisfies CustomProviderEntry;
    })
    .filter(Boolean) as CustomProviderEntry[];
}

function serializeCustomProviders(value: CustomProviderEntry[]): string {
  return JSON.stringify(value);
}

export async function GET(request: Request) {
  try {
    await ensureDispatchAuthSchemaAndSeed();
    const { access, response } = requireAccess(request);
    if (response || !access) return response;
    if (!access.isAdmin) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const rows = await db().query('SELECT key, value FROM system_defaults', []) as Array<{ key: string; value: string }>;
    const raw: Record<string, string> = Object.fromEntries(rows.map(r => [r.key, r.value]));
    const customProviders = normalizeCustomProviders(raw.llm_custom_providers || '[]');
    const maskedCustomProviders = customProviders.map((entry) => ({ ...entry, api_key: maskKey(entry.api_key || '') }));

    // Merge env fallbacks for display (masked)
    const display: Record<string, unknown> = {
      llm_primary:             raw.llm_primary || 'minimax',
      llm_minimax_model:       raw.llm_minimax_model || process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
      llm_minimax_api_key:     maskKey(raw.llm_minimax_api_key || process.env.MINIMAX_API_KEY || ''),
      llm_openrouter_vision_model: raw.llm_openrouter_vision_model || process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3-vl-32b-instruct',
      llm_openrouter_api_key:  maskKey(raw.llm_openrouter_api_key || process.env.OPENROUTER_API_KEY || ''),
      llm_anthropic_api_key:   maskKey(raw.llm_anthropic_api_key || process.env.ANTHROPIC_API_KEY || ''),
      llm_zai_api_key:         maskKey(raw.llm_zai_api_key || process.env.ZAI_API_KEY || ''),
      llm_custom_providers:    maskedCustomProviders,
      llm_minimax_configured:  String(!!(raw.llm_minimax_api_key || process.env.MINIMAX_API_KEY)),
      llm_openrouter_configured:String(!!(raw.llm_openrouter_api_key || process.env.OPENROUTER_API_KEY)),
      llm_anthropic_configured:String(!!(raw.llm_anthropic_api_key || process.env.ANTHROPIC_API_KEY)),
      llm_zai_configured:      String(!!(raw.llm_zai_api_key || process.env.ZAI_API_KEY)),
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
    const { settings } = body as { settings: Record<string, unknown> };

    const existingRows = await db().query('SELECT key, value FROM system_defaults WHERE key = $1', ['llm_custom_providers']) as Array<{ key: string; value: string }>;
    const existingCustomProviders = normalizeCustomProviders(existingRows[0]?.value || '[]');
    const existingById = new Map(existingCustomProviders.map((entry) => [entry.id, entry]));

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'llm_custom_providers') {
        const incoming = normalizeCustomProviders(value as unknown);
        const merged = incoming.map((entry) => {
          if (entry.api_key.includes('••')) {
            const existing = existingById.get(entry.id);
            return { ...entry, api_key: existing?.api_key || '' };
          }
          return entry;
        });
        if (!merged.length) {
          await db().run('DELETE FROM system_defaults WHERE key = $1', [key]);
        } else {
          await db().run(
            `INSERT INTO system_defaults (key, value) VALUES ($1, $2)
             ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
            [key, serializeCustomProviders(merged)]
          );
        }
        continue;
      }

      // Skip masked values (user didn't change them)
      if (SENSITIVE_KEYS.has(key) && String(value).includes('••')) continue;
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
