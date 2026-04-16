import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureDispatchAuthSchemaAndSeed } from '@/lib/dispatch-auth';
import { requireAccess } from '@/lib/ownership';
import {
  normalizeCustomProviders,
  normalizeDisabledModelIds,
  normalizeDisabledProviderIds,
  normalizeSelectablePrimary,
  serializeCustomProviders,
} from '@/lib/llm-config';

// Keys that hold sensitive values — mask them in GET responses
const SENSITIVE_KEYS = new Set([
  'llm_minimax_api_key',
  'llm_openrouter_api_key',
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
    const customProviders = normalizeCustomProviders(raw.llm_custom_providers || '[]');
    const disabledProviderIds = normalizeDisabledProviderIds(raw.llm_disabled_provider_ids || '[]');
    const disabledModelIds = normalizeDisabledModelIds(raw.llm_disabled_model_ids || '[]');
    const maskedCustomProviders = customProviders.map((entry) => ({ ...entry, api_key: maskKey(entry.api_key || '') }));

    // Merge env fallbacks for display (masked)
    const display: Record<string, unknown> = {
      llm_primary:             normalizeSelectablePrimary(raw.llm_primary || 'minimax', customProviders, disabledProviderIds, disabledModelIds),
      llm_minimax_model:       raw.llm_minimax_model || process.env.MINIMAX_MODEL || 'MiniMax-M2.7',
      llm_minimax_api_key:     maskKey(raw.llm_minimax_api_key || process.env.MINIMAX_API_KEY || ''),
      llm_openrouter_vision_model: raw.llm_openrouter_vision_model || process.env.OPENROUTER_VISION_MODEL || 'qwen/qwen3-vl-32b-instruct',
      llm_openrouter_api_key:  maskKey(raw.llm_openrouter_api_key || process.env.OPENROUTER_API_KEY || ''),
      llm_anthropic_api_key:   maskKey(raw.llm_anthropic_api_key || process.env.ANTHROPIC_API_KEY || ''),
      llm_zai_api_key:         maskKey(raw.llm_zai_api_key || process.env.ZAI_API_KEY || ''),
      llm_custom_providers:    maskedCustomProviders,
      llm_disabled_provider_ids: disabledProviderIds,
      llm_disabled_model_ids: disabledModelIds,
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
    const normalizedCustomProviders = normalizeCustomProviders(settings.llm_custom_providers || '[]');
    const normalizedDisabledProviderIds = normalizeDisabledProviderIds(settings.llm_disabled_provider_ids || '[]');
    const normalizedDisabledModelIds = normalizeDisabledModelIds(settings.llm_disabled_model_ids || '[]');
    const normalizedPrimary = normalizeSelectablePrimary(
      String(settings.llm_primary || 'minimax'),
      normalizedCustomProviders,
      normalizedDisabledProviderIds,
      normalizedDisabledModelIds
    );

    for (const [key, value] of Object.entries(settings)) {
      if (key === 'llm_custom_providers') {
        const incoming = normalizedCustomProviders;
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

      if (key === 'llm_disabled_provider_ids') {
        const serialized = JSON.stringify(normalizedDisabledProviderIds);
        if (!normalizedDisabledProviderIds.length) await db().run('DELETE FROM system_defaults WHERE key = $1', [key]);
        else {
          await db().run(
            `INSERT INTO system_defaults (key, value) VALUES ($1, $2)
             ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
            [key, serialized]
          );
        }
        continue;
      }

      if (key === 'llm_disabled_model_ids') {
        const serialized = JSON.stringify(normalizedDisabledModelIds);
        if (!normalizedDisabledModelIds.length) await db().run('DELETE FROM system_defaults WHERE key = $1', [key]);
        else {
          await db().run(
            `INSERT INTO system_defaults (key, value) VALUES ($1, $2)
             ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
            [key, serialized]
          );
        }
        continue;
      }

      if (key === 'llm_primary') {
        await db().run(
          `INSERT INTO system_defaults (key, value) VALUES ($1, $2)
           ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
          [key, normalizedPrimary]
        );
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
