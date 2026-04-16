'use client';

import { useEffect, useMemo, useState } from 'react';
import { SUPPORTED_DOCUMENT_ACCEPT } from '@/lib/upload-file-types';
import {
  BUILTIN_PROVIDER_DETAILS,
  getSelectableBuiltinProviders,
  type BuiltinModelId,
  type BuiltinProviderId,
} from '@/lib/llm-config';

type PreviewResponse = {
  mode: 'dry-run';
  documentType: string;
  status: string;
  extractedData: Record<string, unknown>;
  missingFields: string[];
  rawTextPreview: string;
  meta: {
    provider: string;
    model: string | null;
    detectedFileType: string;
    usedLlmClassification: boolean;
  };
};

type AdminSettingsResponse = {
  llm_disabled_provider_ids: BuiltinProviderId[];
  llm_disabled_model_ids: BuiltinModelId[];
};

export default function AdminModelTestUtility() {
  const [provider, setProvider] = useState<string>('auto');
  const [model, setModel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [adminSettings, setAdminSettings] = useState<AdminSettingsResponse>({
    llm_disabled_provider_ids: [],
    llm_disabled_model_ids: [],
  });

  useEffect(() => {
    fetch('/api/dispatch/admin/settings')
      .then((res) => res.json())
      .then((data) => {
        if (!data?.settings) return;
        setAdminSettings({
          llm_disabled_provider_ids: Array.isArray(data.settings.llm_disabled_provider_ids) ? data.settings.llm_disabled_provider_ids : [],
          llm_disabled_model_ids: Array.isArray(data.settings.llm_disabled_model_ids) ? data.settings.llm_disabled_model_ids : [],
        });
      })
      .catch(() => {});
  }, []);

  const providerOptions = useMemo(() => {
    const builtins = getSelectableBuiltinProviders(
      adminSettings.llm_disabled_provider_ids || [],
      adminSettings.llm_disabled_model_ids || []
    );

    return [
      { value: 'auto', label: 'Auto chain (configured fallback)' },
      ...builtins.map((providerId) => ({
        value: providerId,
        label: providerId === 'regex' ? 'Regex only (no LLM)' : BUILTIN_PROVIDER_DETAILS[providerId].label,
      })),
    ];
  }, [adminSettings.llm_disabled_model_ids, adminSettings.llm_disabled_provider_ids]);

  useEffect(() => {
    if (!providerOptions.some((option) => option.value === provider)) {
      setProvider('auto');
    }
  }, [provider, providerOptions]);

  const runTest = async () => {
    if (!file) {
      setError('Choose an image or PDF first.');
      return;
    }

    setLoading(true);
    setError(null);
    setPreview(null);

    try {
      const form = new FormData();
      form.set('provider', provider);
      form.set('model', model);
      form.set('file', file);

      const res = await fetch('/api/dispatch/admin/model-test', {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Test failed');
      setPreview(data.preview || null);
    } catch (err: any) {
      setError(err?.message || 'Model test failed');
    } finally {
      setLoading(false);
    }
  };

  const toText = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    return text || null;
  };

  const toAmount = (value: unknown, currency?: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    const prefix = toText(currency) || 'USD';
    if (Number.isFinite(num)) return `${prefix} ${num.toFixed(2)}`;
    return toText(value);
  };

  const buildSummary = (type: string, data: Record<string, unknown>) => {
    if (type === 'fuel') {
      return [
        ['Date', toText(data.date)],
        ['Amount', toAmount(data.amount_usd, data.currency)],
        ['Odometer', toText(data.odometer)],
        ['Gallons', toText(data.gallons)],
        ['Litres', toText(data.liters)],
        ['PPU', toText(data.price_per_unit)],
        ['DEF gallons', toText(data.def_gallons)],
        ['DEF litres', toText(data.def_liters)],
        ['DEF amount', toAmount(data.def_amount_usd, data.currency)],
        ['DEF PPU', toText(data.def_price_per_unit)],
        ['Location', toText(data.location)],
        ['Currency', toText(data.currency)],
      ].filter((item) => item[1]);
    }

    if (type === 'toll' || type === 'reimbursement' || type === 'other' || type === 'receipt') {
      return [
        ['Date', toText(data.date)],
        ['Amount', toAmount(data.amount_usd, data.currency)],
        ['Name', toText(data.name)],
        ['Location', toText(data.location)],
        ['Category', toText(data.category)],
        ['Currency', toText(data.currency)],
      ].filter((item) => item[1]);
    }

    return [] as string[][];
  };

  const summaryRows = preview ? buildSummary(preview.documentType, preview.extractedData || {}) : [];

  return (
    <div className="space-y-4">
      <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-widest font-black text-zinc-500">Dry-run model test</p>
          <p className="text-[11px] text-zinc-600 mt-1">Tests extraction/classification only. No rows are written to trips, fuel, or expenses.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] uppercase text-zinc-500 font-black block mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
            >
              {providerOptions.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase text-zinc-500 font-black block mb-1">Model override (optional)</label>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. MiniMax-M2.7"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm font-mono text-zinc-200"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase text-zinc-500 font-black block mb-1">Image/PDF</label>
            <input
              type="file"
              accept={SUPPORTED_DOCUMENT_ACCEPT}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1 file:text-xs file:font-bold file:text-zinc-200"
            />
          </div>
          <button
            onClick={runTest}
            disabled={loading || !file}
            className="px-5 py-2.5 rounded-xl bg-fuchsia-500 hover:bg-fuchsia-400 disabled:opacity-50 text-black text-xs uppercase font-black"
          >
            {loading ? 'Testing…' : 'Run Dry Test'}
          </button>
        </div>

        {error && <p className="text-sm text-red-400 font-bold">✗ {error}</p>}
      </div>

      {preview && (
        <div className="bg-zinc-900/20 border border-zinc-700/40 rounded-2xl p-4 space-y-3">
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300">type: {preview.documentType}</span>
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300">status: {preview.status}</span>
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300">provider: {preview.meta.provider}</span>
            <span className="px-2 py-1 rounded-lg bg-zinc-800 text-zinc-300">mime: {preview.meta.detectedFileType}</span>
          </div>

          {preview.missingFields.length > 0 && (
            <p className="text-xs text-amber-300">Missing fields: {preview.missingFields.join(', ')}</p>
          )}

          {summaryRows.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-black mb-1">{preview.documentType} summary</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {summaryRows.map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</p>
                    <p className="text-xs font-semibold text-zinc-200 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-black mb-1">Extracted preview</p>
            <pre className="text-xs bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-auto max-h-80 text-zinc-300">{JSON.stringify(preview.extractedData, null, 2)}</pre>
          </div>

          {preview.rawTextPreview && (
            <details>
              <summary className="text-[10px] uppercase tracking-widest font-black text-zinc-500 cursor-pointer">Raw text preview</summary>
              <pre className="mt-2 text-xs bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-auto max-h-56 text-zinc-400 whitespace-pre-wrap">{preview.rawTextPreview}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
