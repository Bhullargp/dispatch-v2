'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_PROVIDER_DETAILS,
  BUILTIN_PROVIDER_ORDER,
  getRuntimeMethodOrder,
  getSelectableBuiltinProviders,
  getSelectablePrimaryOptions,
  normalizeSelectablePrimary,
  type BuiltinModelId,
  type BuiltinProviderId,
} from '@/lib/llm-config';

type CustomProvider = {
  id: string;
  name: string;
  provider: 'openrouter' | 'openrouter-vision' | 'minimax' | 'zai';
  model: string;
  api_key: string;
  enabled: boolean;
};

type LlmSettings = {
  llm_primary: string;
  llm_minimax_model: string;
  llm_minimax_api_key: string;
  llm_openrouter_vision_model: string;
  llm_openrouter_api_key: string;
  llm_anthropic_api_key: string;
  llm_zai_api_key: string;
  llm_custom_providers: CustomProvider[];
  llm_disabled_provider_ids: BuiltinProviderId[];
  llm_disabled_model_ids: BuiltinModelId[];
  llm_minimax_configured: string;
  llm_openrouter_configured: string;
  llm_anthropic_configured: string;
  llm_zai_configured: string;
};

const BUILTIN_PROVIDER_STYLES: Record<BuiltinProviderId, { color: string }> = {
  minimax: { color: 'text-purple-400' },
  claude: { color: 'text-amber-400' },
  zai: { color: 'text-blue-400' },
  'openrouter-vision': { color: 'text-fuchsia-400' },
  regex: { color: 'text-zinc-400' },
};

const CUSTOM_PROVIDER_OPTIONS: Array<{ value: CustomProvider['provider']; label: string }> = [
  { value: 'openrouter', label: 'OpenRouter (text model)' },
  { value: 'openrouter-vision', label: 'OpenRouter Vision (PDF/images)' },
  { value: 'minimax', label: 'Minimax' },
  { value: 'zai', label: 'Z.AI (GLM)' },
];

function createCustomProvider(): CustomProvider {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: 'Custom Provider',
    provider: 'openrouter',
    model: '',
    api_key: '',
    enabled: true,
  };
}

export default function AdminLlmSettings() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [form, setForm] = useState<Partial<LlmSettings>>({
    llm_custom_providers: [],
    llm_disabled_provider_ids: [],
    llm_disabled_model_ids: [],
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/dispatch/admin/settings')
      .then((r) => r.json())
      .then((d) => {
        if (d.settings) {
          const withProviders = {
            ...d.settings,
            llm_custom_providers: Array.isArray(d.settings.llm_custom_providers) ? d.settings.llm_custom_providers : [],
            llm_disabled_provider_ids: Array.isArray(d.settings.llm_disabled_provider_ids) ? d.settings.llm_disabled_provider_ids : [],
            llm_disabled_model_ids: Array.isArray(d.settings.llm_disabled_model_ids) ? d.settings.llm_disabled_model_ids : [],
          } as LlmSettings;
          setSettings(withProviders);
          setForm(withProviders);
        }
      });
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/dispatch/admin/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: form }),
      });
      const d = await res.json();
      if (d.success) {
        setStatus({ ok: true, msg: 'Settings saved.' });
        const fresh = await fetch('/api/dispatch/admin/settings').then((r) => r.json());
        if (fresh.settings) {
          const withProviders = {
            ...fresh.settings,
            llm_custom_providers: Array.isArray(fresh.settings.llm_custom_providers) ? fresh.settings.llm_custom_providers : [],
            llm_disabled_provider_ids: Array.isArray(fresh.settings.llm_disabled_provider_ids) ? fresh.settings.llm_disabled_provider_ids : [],
            llm_disabled_model_ids: Array.isArray(fresh.settings.llm_disabled_model_ids) ? fresh.settings.llm_disabled_model_ids : [],
          } as LlmSettings;
          setSettings(withProviders);
          setForm(withProviders);
        }
      } else {
        setStatus({ ok: false, msg: d.error || 'Save failed.' });
      }
    } catch (e: any) {
      setStatus({ ok: false, msg: e.message });
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = (provider: string) => {
    if (!settings) return false;
    return settings[`llm_${provider}_configured` as keyof LlmSettings] === 'true';
  };

  const customProviders = useMemo(() => {
    return Array.isArray(form.llm_custom_providers) ? form.llm_custom_providers : [];
  }, [form.llm_custom_providers]);
  const disabledProviderIds = useMemo(() => (
    Array.isArray(form.llm_disabled_provider_ids) ? form.llm_disabled_provider_ids : []
  ), [form.llm_disabled_provider_ids]);
  const disabledModelIds = useMemo(() => (
    Array.isArray(form.llm_disabled_model_ids) ? form.llm_disabled_model_ids : []
  ), [form.llm_disabled_model_ids]);

  const selectableBuiltinProviders = useMemo(
    () => getSelectableBuiltinProviders(disabledProviderIds, disabledModelIds),
    [disabledModelIds, disabledProviderIds]
  );
  const selectablePrimaryKeys = useMemo(
    () => getSelectablePrimaryOptions(customProviders, disabledProviderIds, disabledModelIds),
    [customProviders, disabledModelIds, disabledProviderIds]
  );

  const updateCustomProvider = (id: string, patch: Partial<CustomProvider>) => {
    setForm((f) => ({
      ...f,
      llm_custom_providers: (Array.isArray(f.llm_custom_providers) ? f.llm_custom_providers : []).map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry
      ),
    }));
  };

  const removeCustomProvider = (id: string) => {
    setForm((f) => ({
      ...f,
      llm_custom_providers: (Array.isArray(f.llm_custom_providers) ? f.llm_custom_providers : []).filter((entry) => entry.id !== id),
      llm_primary: normalizeSelectablePrimary(
        f.llm_primary === `custom:${id}` ? '' : String(f.llm_primary || ''),
        (Array.isArray(f.llm_custom_providers) ? f.llm_custom_providers : []).filter((entry) => entry.id !== id),
        Array.isArray(f.llm_disabled_provider_ids) ? f.llm_disabled_provider_ids : [],
        Array.isArray(f.llm_disabled_model_ids) ? f.llm_disabled_model_ids : []
      ),
    }));
  };

  const addCustomProvider = () => {
    setForm((f) => ({
      ...f,
      llm_custom_providers: [...(Array.isArray(f.llm_custom_providers) ? f.llm_custom_providers : []), createCustomProvider()],
    }));
  };

  if (!settings) {
    return <div className="text-zinc-500 text-sm animate-pulse">Loading LLM settings…</div>;
  }

  const primary = normalizeSelectablePrimary(
    String(form.llm_primary || ''),
    customProviders,
    disabledProviderIds,
    disabledModelIds
  );

  const primaryOptions = [
    ...selectableBuiltinProviders.map((key) => ({
      key,
      label: BUILTIN_PROVIDER_DETAILS[key].label,
      color: BUILTIN_PROVIDER_STYLES[key].color,
      desc: BUILTIN_PROVIDER_DETAILS[key].description,
      configured:
        key === 'regex'
          ? true
          : key === 'openrouter-vision'
            ? isConfigured('openrouter')
            : isConfigured(key === 'claude' ? 'anthropic' : key),
    })),
    ...customProviders
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        key: `custom:${entry.id}`,
        label: entry.name || `Custom ${entry.provider}`,
        color: 'text-cyan-300',
        desc: `${entry.provider}${entry.model ? ` · ${entry.model}` : ''}`,
        configured: Boolean(entry.api_key && !entry.api_key.includes('••')) || (entry.api_key || '').includes('••'),
      })),
  ];

  const previewOrder = getRuntimeMethodOrder(primary, customProviders);

  const resolvePreviewLabel = (key: string) => {
    if ((BUILTIN_PROVIDER_DETAILS as Record<string, { label: string }>)[key]) return (BUILTIN_PROVIDER_DETAILS as Record<string, { label: string }>)[key].label;
    if (key.startsWith('custom:')) {
      const id = key.slice('custom:'.length);
      const entry = customProviders.find((c) => c.id === id);
      return entry ? (entry.name || `Custom ${entry.provider}`) : 'Custom';
    }
    return key;
  };

  const toggleBuiltinAvailability = (providerId: BuiltinProviderId, nextEnabled: boolean) => {
    const modelId = BUILTIN_PROVIDER_DETAILS[providerId].modelId;
    setForm((current) => {
      const nextDisabledProviders = new Set(Array.isArray(current.llm_disabled_provider_ids) ? current.llm_disabled_provider_ids : []);
      const nextDisabledModels = new Set(Array.isArray(current.llm_disabled_model_ids) ? current.llm_disabled_model_ids : []);

      if (nextEnabled) {
        nextDisabledProviders.delete(providerId);
        if (modelId) nextDisabledModels.delete(modelId);
      } else {
        nextDisabledProviders.add(providerId);
        if (modelId) nextDisabledModels.add(modelId);
      }

      const nextCustomProviders = Array.isArray(current.llm_custom_providers) ? current.llm_custom_providers : [];
      return {
        ...current,
        llm_disabled_provider_ids: Array.from(nextDisabledProviders),
        llm_disabled_model_ids: Array.from(nextDisabledModels),
        llm_primary: normalizeSelectablePrimary(
          String(current.llm_primary || ''),
          nextCustomProviders,
          Array.from(nextDisabledProviders),
          Array.from(nextDisabledModels)
        ),
      };
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase font-black tracking-widest text-zinc-500 mb-3">Primary Extraction Model</p>
        <p className="text-xs text-zinc-600 mb-4">Disabled built-ins are hidden from selection here, but still remain available to the internal fallback chain.</p>
        {primaryOptions.length === 0 && (
          <p className="text-xs text-amber-300 mb-4">No selectable models are enabled right now. Re-enable a built-in or add a custom provider below.</p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {primaryOptions.map((info) => {
            const active = primary === info.key;
            return (
              <button
                key={info.key}
                onClick={() => setForm((f) => ({ ...f, llm_primary: info.key }))}
                className={`relative p-4 rounded-2xl border text-left transition-all ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
                    : 'border-zinc-700/50 bg-zinc-900/30 hover:border-zinc-600'
                }`}
              >
                {active && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 shadow shadow-emerald-400/60" />}
                <p className={`text-sm font-black ${active ? 'text-white' : info.color}`}>{info.label}</p>
                <p className="text-[10px] text-zinc-500 mt-1">{info.desc}</p>
                {info.key !== 'regex' && (
                  <p className={`text-[10px] mt-2 font-bold ${info.configured ? 'text-emerald-500' : 'text-red-500/70'}`}>
                    {info.configured ? '● Key set' : '○ No key'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-4">
        <div>
          <p className="text-xs uppercase font-black tracking-widest text-zinc-500">Built-in Availability</p>
          <p className="text-xs text-zinc-600 mt-1">Disable built-ins to remove them from admin dropdowns without deleting their config or breaking runtime fallbacks.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {BUILTIN_PROVIDER_ORDER.map((providerId) => {
            const disabled = !selectableBuiltinProviders.includes(providerId);
            const configured =
              providerId === 'regex'
                ? true
                : providerId === 'openrouter-vision'
                  ? isConfigured('openrouter')
                  : isConfigured(providerId === 'claude' ? 'anthropic' : providerId);
            return (
              <div key={providerId} className={`rounded-2xl border p-4 ${disabled ? 'border-zinc-800 bg-zinc-950/60' : 'border-zinc-700/60 bg-zinc-900/40'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className={`text-sm font-black ${disabled ? 'text-zinc-500' : BUILTIN_PROVIDER_STYLES[providerId].color}`}>
                      {BUILTIN_PROVIDER_DETAILS[providerId].label}
                    </p>
                    <p className="text-[10px] text-zinc-500 mt-1">{BUILTIN_PROVIDER_DETAILS[providerId].description}</p>
                    <p className={`text-[10px] mt-2 font-bold ${configured ? 'text-emerald-500' : 'text-red-500/70'}`}>
                      {providerId === 'regex' ? 'Always available' : (configured ? '● Key set' : '○ No key')}
                    </p>
                  </div>
                  <button
                    onClick={() => toggleBuiltinAvailability(providerId, disabled)}
                    className={`px-3 py-1.5 text-xs rounded-xl border ${disabled ? 'border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10' : 'border-red-500/40 text-red-300 hover:bg-red-500/10'}`}
                  >
                    {disabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-xs uppercase font-black tracking-widest text-zinc-500">API Keys</p>
        <p className="text-xs text-zinc-600">Keys are stored securely. Leave masked values unchanged to keep existing keys.</p>

        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-purple-400">Minimax M2.7</p>
              <p className="text-[10px] text-zinc-500">api.minimax.io, independent Dispatch default</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('minimax') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('minimax') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKeys.minimax ? 'text' : 'password'}
                value={form.llm_minimax_api_key || ''}
                onChange={(e) => setForm((f) => ({ ...f, llm_minimax_api_key: e.target.value }))}
                placeholder="Paste new Minimax API key…"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500/60"
              />
              <button onClick={() => setShowKeys((s) => ({ ...s, minimax: !s.minimax }))} className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl">
                {showKeys.minimax ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Model Name</label>
            <input
              type="text"
              value={form.llm_minimax_model || ''}
              onChange={(e) => setForm((f) => ({ ...f, llm_minimax_model: e.target.value }))}
              placeholder="MiniMax-M2.7"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500/60"
            />
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-fuchsia-400">OpenRouter Vision</p>
              <p className="text-[10px] text-zinc-500">Used for PDF/image understanding with vision models</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('openrouter') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('openrouter') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKeys.openrouter ? 'text' : 'password'}
                value={form.llm_openrouter_api_key || ''}
                onChange={(e) => setForm((f) => ({ ...f, llm_openrouter_api_key: e.target.value }))}
                placeholder="Paste OpenRouter API key (sk-or-...)"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-fuchsia-500/60"
              />
              <button onClick={() => setShowKeys((s) => ({ ...s, openrouter: !s.openrouter }))} className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl">
                {showKeys.openrouter ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Vision Model</label>
            <input
              type="text"
              value={form.llm_openrouter_vision_model || ''}
              onChange={(e) => setForm((f) => ({ ...f, llm_openrouter_vision_model: e.target.value }))}
              placeholder="qwen/qwen3-vl-32b-instruct"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-fuchsia-500/60"
            />
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-amber-400">Claude (Anthropic)</p>
              <p className="text-[10px] text-zinc-500">api.anthropic.com</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('anthropic') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('anthropic') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type={showKeys.claude ? 'text' : 'password'}
              value={form.llm_anthropic_api_key || ''}
              onChange={(e) => setForm((f) => ({ ...f, llm_anthropic_api_key: e.target.value }))}
              placeholder="Paste new Anthropic API key (sk-ant-…)"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-amber-500/60"
            />
            <button onClick={() => setShowKeys((s) => ({ ...s, claude: !s.claude }))} className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl">
              {showKeys.claude ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-blue-400">Z.AI (GLM)</p>
              <p className="text-[10px] text-zinc-500">open.bigmodel.cn</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('zai') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('zai') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type={showKeys.zai ? 'text' : 'password'}
              value={form.llm_zai_api_key || ''}
              onChange={(e) => setForm((f) => ({ ...f, llm_zai_api_key: e.target.value }))}
              placeholder="Paste new Z.AI API key…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-blue-500/60"
            />
            <button onClick={() => setShowKeys((s) => ({ ...s, zai: !s.zai }))} className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl">
              {showKeys.zai ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-cyan-300">Custom Providers</p>
              <p className="text-[10px] text-zinc-500">Custom entries are hard-deleted when removed. Disable built-ins in the section above instead of deleting them.</p>
            </div>
            <button onClick={addCustomProvider} className="px-3 py-2 text-xs rounded-xl border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10">
              + Add Provider
            </button>
          </div>

          {customProviders.length === 0 && (
            <p className="text-xs text-zinc-500">No custom providers yet.</p>
          )}

          {customProviders.map((entry) => (
            <div key={entry.id} className="border border-zinc-700/60 rounded-xl p-3 space-y-3 bg-zinc-950/50">
              <div className="flex items-center justify-between gap-2">
                <input
                  type="text"
                  value={entry.name}
                  onChange={(e) => updateCustomProvider(entry.id, { name: e.target.value })}
                  placeholder="Display name"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
                />
                <label className="text-xs text-zinc-400 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) => updateCustomProvider(entry.id, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
                <button onClick={() => removeCustomProvider(entry.id)} className="px-2 py-1 text-xs rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10">
                  Delete
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select
                  value={entry.provider}
                  onChange={(e) => updateCustomProvider(entry.id, { provider: e.target.value as CustomProvider['provider'] })}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300"
                >
                  {CUSTOM_PROVIDER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={entry.model}
                  onChange={(e) => updateCustomProvider(entry.id, { model: e.target.value })}
                  placeholder="Model name"
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-300"
                />
              </div>

              <div className="flex gap-2">
                <input
                  type={showKeys[`custom-${entry.id}`] ? 'text' : 'password'}
                  value={entry.api_key || ''}
                  onChange={(e) => updateCustomProvider(entry.id, { api_key: e.target.value })}
                  placeholder="API key"
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-300"
                />
                <button
                  onClick={() => setShowKeys((s) => ({ ...s, [`custom-${entry.id}`]: !s[`custom-${entry.id}`] }))}
                  className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-lg"
                >
                  {showKeys[`custom-${entry.id}`] ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black uppercase text-sm rounded-xl transition-all"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {status && <p className={`text-sm font-bold ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.ok ? '✓' : '✗'} {status.msg}</p>}
      </div>

      <div className="bg-zinc-900/20 border border-zinc-700/30 rounded-2xl p-4">
        <p className="text-[10px] uppercase font-black tracking-widest text-zinc-600 mb-2">Internal Fallback Order</p>
        <div className="flex items-center gap-2 flex-wrap">
          {previewOrder.map((method, i) => {
            const isPrimary = i === 0;
            const hiddenFromSelection = !selectablePrimaryKeys.includes(method);
            return (
              <React.Fragment key={method}>
                {i > 0 && <span className="text-zinc-700 text-xs">→ fallback</span>}
                <span className={`text-xs font-bold px-2 py-1 rounded-lg ${isPrimary ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : hiddenFromSelection ? 'bg-zinc-900 text-zinc-500 border border-zinc-800' : 'bg-zinc-800 text-zinc-400'}`}>
                  {isPrimary ? '★ ' : ''}{resolvePreviewLabel(method)}{hiddenFromSelection ? ' (fallback only)' : ''}
                </span>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
