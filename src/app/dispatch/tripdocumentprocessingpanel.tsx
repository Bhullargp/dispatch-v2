'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type DraftStatus = 'processing' | 'needs_review' | 'ready' | 'saved' | 'error';
type DraftType = 'fuel' | 'toll' | 'receipt' | 'unknown';

type Draft = {
  id: number;
  trip_number: string | null;
  document_type: DraftType;
  status: DraftStatus;
  extracted_data: Record<string, any>;
  missing_fields: string[];
  linked_record_type: string | null;
  linked_record_id: number | null;
  error_message: string | null;
  original_filename: string;
  description: string | null;
  url: string | null;
  sourceUrl: string | null;
};

const TYPE_OPTIONS: Array<{ value: DraftType; label: string }> = [
  { value: 'fuel', label: 'Fuel receipt' },
  { value: 'toll', label: 'Toll receipt' },
  { value: 'receipt', label: 'Other receipt' },
];

function statusTone(status: DraftStatus) {
  if (status === 'saved') return 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300';
  if (status === 'ready') return 'border-cyan-700/50 bg-cyan-950/30 text-cyan-300';
  if (status === 'error') return 'border-red-700/50 bg-red-950/30 text-red-300';
  return 'border-amber-700/50 bg-amber-950/20 text-amber-200';
}

export default function TripDocumentProcessingPanel({
  tripNumber,
  onSaved,
}: {
  tripNumber: string;
  onSaved?: (message: string) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<DraftType>('fuel');
  const [draftEdits, setDraftEdits] = useState<Record<number, Record<string, any>>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dispatch/document-processing?tripNumber=${encodeURIComponent(tripNumber)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load documents');
      setDrafts(Array.isArray(data?.drafts) ? data.drafts : []);
      setDraftEdits((current) => {
        const next = { ...current };
        for (const draft of Array.isArray(data?.drafts) ? data.drafts : []) {
          next[draft.id] = next[draft.id] || { ...(draft.extracted_data || {}), document_type: draft.document_type };
        }
        return next;
      });
    } catch (error: any) {
      setPanelError(error.message || 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }, [tripNumber]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const pendingCount = useMemo(
    () => drafts.filter((draft) => draft.status !== 'saved').length,
    [drafts]
  );

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setPanelError(null);
    setPanelMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tripNumber', tripNumber);
      form.append('description', TYPE_OPTIONS.find((option) => option.value === selectedType)?.label || 'Receipt');

      const res = await fetch('/api/dispatch/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');

      setPanelMessage(data?.processingDraft?.status === 'ready'
        ? 'Document parsed and ready to save.'
        : 'Document uploaded. Review extracted fields before saving.');
      await loadDrafts();
    } catch (error: any) {
      setPanelError(error.message || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [loadDrafts, selectedType, tripNumber]);

  const updateDraftField = (draftId: number, field: string, value: any) => {
    setDraftEdits((current) => ({
      ...current,
      [draftId]: {
        ...(current[draftId] || {}),
        [field]: value,
      },
    }));
  };

  const saveDraft = useCallback(async (draft: Draft) => {
    setSavingId(draft.id);
    setPanelError(null);
    setPanelMessage(null);
    try {
      const extractedData = { ...(draft.extracted_data || {}), ...(draftEdits[draft.id] || {}) };
      const documentType = (draftEdits[draft.id]?.document_type || draft.document_type) as DraftType;

      const res = await fetch('/api/dispatch/document-processing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, tripNumber, documentType, extractedData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save document');

      const successMessage = documentType === 'fuel'
        ? 'Fuel entry created and receipt linked.'
        : 'Expense created and receipt linked.';
      setPanelMessage(successMessage);
      onSaved?.(successMessage);
      await loadDrafts();
    } catch (error: any) {
      setPanelError(error.message || 'Could not save document');
    } finally {
      setSavingId(null);
    }
  }, [draftEdits, loadDrafts, onSaved, tripNumber]);

  return (
    <section className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-6 space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-500">Document processing</p>
          <h2 className="text-xl font-black text-white mt-1">Receipt inbox</h2>
          <p className="text-xs text-zinc-500 mt-1">
            Upload trip receipts, review extracted values, fill gaps like odometer, then save directly into the trip.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          <select
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as DraftType)}
            className="bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500"
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-[10px] font-black uppercase px-4 py-3 rounded-xl border border-emerald-600 transition-all"
          >
            {uploading ? 'Uploading...' : 'Upload receipt'}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-500">
        <span>{loading ? 'Loading documents...' : `${drafts.length} documents in this trip inbox`}</span>
        <span className="text-amber-400 font-black">{pendingCount} pending</span>
      </div>

      {(panelMessage || panelError) && (
        <div className={`rounded-2xl border px-4 py-3 text-xs font-bold ${panelError ? 'border-red-700/40 bg-red-950/20 text-red-300' : 'border-emerald-700/40 bg-emerald-950/20 text-emerald-300'}`}>
          {panelError || panelMessage}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
          No receipt documents for this trip yet.
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const values = { ...(draft.extracted_data || {}), ...(draftEdits[draft.id] || {}) };
            const isFuel = (draftEdits[draft.id]?.document_type || draft.document_type) === 'fuel';
            const isSaved = draft.status === 'saved';
            const previewUrl = draft.sourceUrl || draft.url;

            return (
              <div key={draft.id} className={`rounded-2xl border p-4 ${statusTone(draft.status)}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-400">{draft.document_type}</span>
                      <span className="text-[10px] font-black uppercase tracking-[0.3em]">{draft.status.replace('_', ' ')}</span>
                      {draft.missing_fields?.length > 0 && !isSaved && (
                        <span className="text-[10px] text-amber-300">Missing: {draft.missing_fields.join(', ')}</span>
                      )}
                    </div>
                    <p className="text-sm font-black text-white truncate">{draft.original_filename}</p>
                    <p className="text-xs text-zinc-400">
                      {draft.description || 'No description yet'}
                      {draft.linked_record_type && draft.linked_record_id ? ` • linked to ${draft.linked_record_type} #${draft.linked_record_id}` : ''}
                    </p>
                    {draft.error_message && <p className="text-xs text-red-300">{draft.error_message}</p>}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={(draftEdits[draft.id]?.document_type || draft.document_type) as DraftType}
                      onChange={(event) => updateDraftField(draft.id, 'document_type', event.target.value)}
                      disabled={isSaved}
                      className="bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                    >
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {previewUrl && (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-zinc-900 hover:bg-zinc-800 text-[10px] font-black uppercase px-3 py-2 rounded-xl border border-zinc-700 transition-all"
                      >
                        Preview
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Date</span>
                    <input
                      type="date"
                      value={values.date || ''}
                      onChange={(event) => updateDraftField(draft.id, 'date', event.target.value)}
                      disabled={isSaved}
                      className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                    />
                  </label>

                  <label className="space-y-1 md:col-span-2">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{isFuel ? 'Location' : 'Name / location'}</span>
                    <input
                      value={values.location || values.name || ''}
                      onChange={(event) => updateDraftField(draft.id, isFuel ? 'location' : 'name', event.target.value)}
                      disabled={isSaved}
                      className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Amount</span>
                    <input
                      type="number"
                      step="0.01"
                      value={values.amount_usd ?? ''}
                      onChange={(event) => updateDraftField(draft.id, 'amount_usd', event.target.value)}
                      disabled={isSaved}
                      className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                    />
                  </label>

                  {isFuel ? (
                    <>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Gallons</span>
                        <input
                          type="number"
                          step="0.001"
                          value={values.gallons ?? ''}
                          onChange={(event) => updateDraftField(draft.id, 'gallons', event.target.value)}
                          disabled={isSaved}
                          className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Litres</span>
                        <input
                          type="number"
                          step="0.01"
                          value={values.liters ?? ''}
                          onChange={(event) => updateDraftField(draft.id, 'liters', event.target.value)}
                          disabled={isSaved}
                          className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Price / unit</span>
                        <input
                          type="number"
                          step="0.001"
                          value={values.price_per_unit ?? ''}
                          onChange={(event) => updateDraftField(draft.id, 'price_per_unit', event.target.value)}
                          disabled={isSaved}
                          className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Odometer</span>
                        <input
                          type="number"
                          value={values.odometer ?? ''}
                          onChange={(event) => updateDraftField(draft.id, 'odometer', event.target.value)}
                          disabled={isSaved}
                          className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                        />
                      </label>
                    </>
                  ) : (
                    <label className="space-y-1 xl:col-span-3">
                      <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Notes</span>
                      <input
                        value={values.notes || ''}
                        onChange={(event) => updateDraftField(draft.id, 'notes', event.target.value)}
                        disabled={isSaved}
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                      />
                    </label>
                  )}
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    onClick={() => saveDraft(draft)}
                    disabled={isSaved || savingId === draft.id}
                    className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-[10px] font-black uppercase px-4 py-3 rounded-xl border border-emerald-600 transition-all"
                  >
                    {isSaved ? 'Saved' : savingId === draft.id ? 'Saving...' : isFuel ? 'Create fuel entry' : 'Create expense'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
