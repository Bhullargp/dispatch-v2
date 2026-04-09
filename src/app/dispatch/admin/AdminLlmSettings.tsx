'use client';

import React, { useState, useEffect } from 'react';

type LlmSettings = {
  llm_primary: string;
  llm_minimax_model: string;
  llm_minimax_api_key: string;
  llm_anthropic_api_key: string;
  llm_zai_api_key: string;
  llm_minimax_configured: string;
  llm_anthropic_configured: string;
  llm_zai_configured: string;
};

const PROVIDER_LABELS: Record<string, { label: string; color: string; desc: string }> = {
  minimax: { label: 'Minimax', color: 'text-purple-400', desc: 'Primary model — fast, reliable' },
  claude:  { label: 'Claude (Anthropic)', color: 'text-amber-400', desc: 'Best accuracy, vision support' },
  zai:     { label: 'Z.AI (GLM)', color: 'text-blue-400', desc: 'Alternative LLM' },
  regex:   { label: 'Regex Only', color: 'text-zinc-400', desc: 'No AI — rule-based parsing only' },
};

export default function AdminLlmSettings() {
  const [settings, setSettings] = useState<LlmSettings | null>(null);
  const [form, setForm] = useState<Partial<LlmSettings>>({});
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/dispatch/admin/settings')
      .then(r => r.json())
      .then(d => {
        if (d.settings) {
          setSettings(d.settings);
          setForm(d.settings);
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
        // Reload to get fresh masked values
        const fresh = await fetch('/api/dispatch/admin/settings').then(r => r.json());
        if (fresh.settings) { setSettings(fresh.settings); setForm(fresh.settings); }
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

  if (!settings) {
    return <div className="text-zinc-500 text-sm animate-pulse">Loading LLM settings…</div>;
  }

  const primary = form.llm_primary || 'minimax';

  return (
    <div className="space-y-6">
      {/* Primary Model Selector */}
      <div>
        <p className="text-xs uppercase font-black tracking-widest text-zinc-500 mb-3">Primary Extraction Model</p>
        <p className="text-xs text-zinc-600 mb-4">This model runs first. If it fails, the others auto-retry as fallbacks.</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(PROVIDER_LABELS).map(([key, info]) => {
            const active = primary === key;
            const configured = key === 'regex' ? true : isConfigured(key === 'claude' ? 'anthropic' : key);
            return (
              <button
                key={key}
                onClick={() => setForm(f => ({ ...f, llm_primary: key }))}
                className={`relative p-4 rounded-2xl border text-left transition-all ${
                  active
                    ? 'border-emerald-500/60 bg-emerald-500/10 shadow-lg shadow-emerald-500/10'
                    : 'border-zinc-700/50 bg-zinc-900/30 hover:border-zinc-600'
                }`}
              >
                {active && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400 shadow shadow-emerald-400/60" />
                )}
                <p className={`text-sm font-black ${active ? 'text-white' : info.color}`}>{info.label}</p>
                <p className="text-[10px] text-zinc-500 mt-1">{info.desc}</p>
                {key !== 'regex' && (
                  <p className={`text-[10px] mt-2 font-bold ${configured ? 'text-emerald-500' : 'text-red-500/70'}`}>
                    {configured ? '● Key set' : '○ No key'}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* API Key Fields */}
      <div className="space-y-4">
        <p className="text-xs uppercase font-black tracking-widest text-zinc-500">API Keys</p>
        <p className="text-xs text-zinc-600">Keys are stored securely. Leave unchanged to keep the existing key.</p>

        {/* Minimax */}
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-purple-400">Minimax</p>
              <p className="text-[10px] text-zinc-500">api.minimax.chat — fast structured extraction</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('minimax') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('minimax') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">API Key</label>
            <div className="flex gap-2">
              <input
                type={showKeys['minimax'] ? 'text' : 'password'}
                value={form.llm_minimax_api_key || ''}
                onChange={e => setForm(f => ({ ...f, llm_minimax_api_key: e.target.value }))}
                placeholder="Paste new Minimax API key…"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500/60"
              />
              <button
                onClick={() => setShowKeys(s => ({ ...s, minimax: !s.minimax }))}
                className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl"
              >
                {showKeys['minimax'] ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase mb-1 block">Model Name</label>
            <input
              type="text"
              value={form.llm_minimax_model || ''}
              onChange={e => setForm(f => ({ ...f, llm_minimax_model: e.target.value }))}
              placeholder="MiniMax-Text-01"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-purple-500/60"
            />
          </div>
        </div>

        {/* Anthropic / Claude */}
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-amber-400">Claude (Anthropic)</p>
              <p className="text-[10px] text-zinc-500">api.anthropic.com — highest accuracy, reads PDF directly</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('anthropic') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('anthropic') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type={showKeys['claude'] ? 'text' : 'password'}
              value={form.llm_anthropic_api_key || ''}
              onChange={e => setForm(f => ({ ...f, llm_anthropic_api_key: e.target.value }))}
              placeholder="Paste new Anthropic API key (sk-ant-…)"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-amber-500/60"
            />
            <button
              onClick={() => setShowKeys(s => ({ ...s, claude: !s.claude }))}
              className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl"
            >
              {showKeys['claude'] ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        {/* Z.AI */}
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-black text-blue-400">Z.AI (GLM)</p>
              <p className="text-[10px] text-zinc-500">open.bigmodel.cn — alternative LLM (glm-4.5-air)</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${isConfigured('zai') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {isConfigured('zai') ? 'Configured' : 'Not set'}
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type={showKeys['zai'] ? 'text' : 'password'}
              value={form.llm_zai_api_key || ''}
              onChange={e => setForm(f => ({ ...f, llm_zai_api_key: e.target.value }))}
              placeholder="Paste new Z.AI API key…"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-300 focus:outline-none focus:border-blue-500/60"
            />
            <button
              onClick={() => setShowKeys(s => ({ ...s, zai: !s.zai }))}
              className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-xl"
            >
              {showKeys['zai'] ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black uppercase text-sm rounded-xl transition-all"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        {status && (
          <p className={`text-sm font-bold ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {status.ok ? '✓' : '✗'} {status.msg}
          </p>
        )}
      </div>

      {/* Extraction Order Preview */}
      <div className="bg-zinc-900/20 border border-zinc-700/30 rounded-2xl p-4">
        <p className="text-[10px] uppercase font-black tracking-widest text-zinc-600 mb-2">Extraction Order When Processing PDFs</p>
        <div className="flex items-center gap-2 flex-wrap">
          {['minimax', 'claude', 'zai']
            .sort((a, b) => (a === (primary === 'regex' ? 'minimax' : primary) ? -1 : b === (primary === 'regex' ? 'minimax' : primary) ? 1 : 0))
            .map((p, i) => {
              const label = PROVIDER_LABELS[p].label;
              const isPrimary = i === 0 && primary !== 'regex';
              return (
                <React.Fragment key={p}>
                  {i > 0 && <span className="text-zinc-700 text-xs">→ fallback</span>}
                  <span className={`text-xs font-bold px-2 py-1 rounded-lg ${isPrimary ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-zinc-800 text-zinc-400'}`}>
                    {isPrimary ? '★ ' : ''}{label}
                  </span>
                </React.Fragment>
              );
            })}
          {primary === 'regex' && (
            <span className="text-xs font-bold px-2 py-1 rounded-lg bg-zinc-700 text-zinc-300">Regex Only (no LLM)</span>
          )}
          <span className="text-zinc-700 text-xs">→ fallback</span>
          <span className="text-xs font-bold px-2 py-1 rounded-lg bg-zinc-800 text-zinc-500">Regex</span>
        </div>
      </div>
    </div>
  );
}
