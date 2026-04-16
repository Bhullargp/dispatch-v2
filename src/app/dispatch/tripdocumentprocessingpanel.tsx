'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type DraftStatus = 'processing' | 'needs_review' | 'ready' | 'saved' | 'error';
type DraftType = 'itinerary' | 'fuel' | 'toll' | 'reimbursement' | 'other' | 'receipt' | 'unknown';

type Draft = {
  id: number;
  user_document_id?: number;
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
  file_key?: string | null;
  url: string | null;
  sourceUrl: string | null;
};

type FieldConfig = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'textarea';
  step?: string;
  placeholder?: string;
  fullWidth?: boolean;
};

const TYPE_OPTIONS: Array<{ value: DraftType; label: string; helper: string }> = [
  { value: 'itinerary', label: 'Dispatch itinerary', helper: 'Driver trip itinerary PDFs, dispatch packets, and load sheets' },
  { value: 'fuel', label: 'Fuel receipt', helper: 'Pump slips, truck-stop invoices, diesel receipts' },
  { value: 'toll', label: 'Toll receipt', helper: 'Road tolls, bridge charges, weigh-station fees' },
  { value: 'reimbursement', label: 'Reimbursement receipt', helper: 'Driver reimbursement items and out-of-pocket spend' },
  { value: 'other', label: 'Other receipt', helper: 'Lumper, parking, scales, supplies, and other trip costs' },
];

const FIELD_LABELS: Record<string, string> = {
  amount_usd: 'Amount (USD)',
  def_amount_usd: 'DEF amount (USD)',
  date: 'Date',
  def_gallons: 'DEF gallons',
  def_liters: 'DEF litres',
  def_price_per_unit: 'DEF price / unit',
  gallons: 'Gallons',
  liters: 'Litres',
  location: 'Location',
  name: 'Name',
  notes: 'Notes',
  odometer: 'Odometer',
  price_per_unit: 'Price / unit',
  vendor: 'Vendor',
  invoice_number: 'Invoice #',
  tax_amount: 'Tax amount',
  currency: 'Currency',
  category: 'Category',
  description: 'Description',
  trip_number: 'Trip number',
  start_date: 'Start date',
  end_date: 'End date',
  total_miles: 'Total miles',
  route: 'Route',
  driver_name: 'Driver name',
  lead_driver: 'Lead driver',
  co_driver: 'Co-driver',
  truck_number: 'Truck #',
  trailer_number: 'Trailer #',
  stops: 'Stops',
  raw_text: 'Raw text',
};

const BASE_FIELDS: FieldConfig[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'amount_usd', label: 'Amount (USD)', type: 'number', step: '0.01', placeholder: '0.00' },
];

const TYPE_FIELDS: Record<'itinerary' | 'fuel' | 'toll' | 'reimbursement' | 'other', FieldConfig[]> = {
  itinerary: [
    { key: 'trip_number', label: 'Trip number', placeholder: 'T12345' },
    { key: 'start_date', label: 'Start date', type: 'date' },
    { key: 'end_date', label: 'End date', type: 'date' },
    { key: 'total_miles', label: 'Total miles', type: 'number', step: '1' },
    { key: 'route', label: 'Route', placeholder: 'Caledon, ON → Laredo, TX', fullWidth: true },
    { key: 'driver_name', label: 'Driver name', placeholder: 'Lead driver on the trip' },
    { key: 'co_driver', label: 'Co-driver', placeholder: 'Optional co-driver' },
    { key: 'truck_number', label: 'Truck #', placeholder: 'Truck unit' },
    { key: 'trailer_number', label: 'Trailer #', placeholder: 'Trailer number' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Dispatch notes or extraction corrections' },
    { key: 'stops', label: 'Stops (JSON)', type: 'textarea', fullWidth: true, placeholder: '[{"stop_type":"PICKUP","location":"..."}]' },
  ],
  fuel: [
    { key: 'location', label: 'Location', placeholder: 'TA, Flying J, Petro, etc.', fullWidth: true },
    { key: 'fuel_type', label: 'Fuel type', placeholder: 'diesel | def | both' },
    { key: 'currency', label: 'Currency', placeholder: 'USD or CAD' },
    { key: 'gallons', label: 'Gallons', type: 'number', step: '0.001' },
    { key: 'liters', label: 'Litres', type: 'number', step: '0.01' },
    { key: 'price_per_unit', label: 'Price / unit', type: 'number', step: '0.001' },
    { key: 'def_gallons', label: 'DEF gallons', type: 'number', step: '0.001' },
    { key: 'def_liters', label: 'DEF litres', type: 'number', step: '0.01' },
    { key: 'def_price_per_unit', label: 'DEF price / unit', type: 'number', step: '0.001' },
    { key: 'def_amount_usd', label: 'DEF amount (USD)', type: 'number', step: '0.01' },
    { key: 'odometer', label: 'Odometer', type: 'number', step: '1' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Optional fuel notes' },
  ],
  toll: [
    { key: 'name', label: 'Charge name', placeholder: 'Toll road or bridge name' },
    { key: 'location', label: 'Location', placeholder: 'Where this charge happened' },
    { key: 'currency', label: 'Currency', placeholder: 'USD or CAD' },
    { key: 'category', label: 'Category', placeholder: 'toll' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Lane, bridge, road, or extra context' },
  ],
  reimbursement: [
    { key: 'name', label: 'Reimbursement name', placeholder: 'Meal, hotel, parking, etc.' },
    { key: 'location', label: 'Location', placeholder: 'Store, city, or stop' },
    { key: 'currency', label: 'Currency', placeholder: 'USD or CAD' },
    { key: 'category', label: 'Category', placeholder: 'reimbursement' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'What this reimbursement is for' },
  ],
  other: [
    { key: 'name', label: 'Expense name', placeholder: 'Lumper, parking, supplies, etc.' },
    { key: 'location', label: 'Location', placeholder: 'Vendor or location' },
    { key: 'currency', label: 'Currency', placeholder: 'USD or CAD' },
    { key: 'category', label: 'Category', placeholder: 'misc' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Any extra context for dispatch/accounting' },
  ],
};

function statusTone(status: DraftStatus) {
  if (status === 'saved') return 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300';
  if (status === 'ready') return 'border-cyan-700/50 bg-cyan-950/30 text-cyan-300';
  if (status === 'error') return 'border-red-700/50 bg-red-950/30 text-red-300';
  return 'border-amber-700/50 bg-amber-950/20 text-amber-200';
}

function friendlyStatus(status: DraftStatus) {
  if (status === 'needs_review') return 'needs review';
  return status;
}

function getTypeDetails(type: DraftType) {
  return TYPE_OPTIONS.find((option) => option.value === type) || TYPE_OPTIONS[TYPE_OPTIONS.length - 1];
}

function getReviewFields(type: DraftType): FieldConfig[] {
  if (type === 'itinerary') return TYPE_FIELDS.itinerary;

  const normalizedType = (type === 'fuel' || type === 'toll' || type === 'reimbursement' || type === 'other'
    ? type
    : 'other') as 'fuel' | 'toll' | 'reimbursement' | 'other';

  return [...BASE_FIELDS, ...TYPE_FIELDS[normalizedType]];
}

function formatFieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function getPreviewKind(draft: Draft) {
  const candidate = `${draft.original_filename} ${draft.sourceUrl || ''} ${draft.url || ''}`.toLowerCase();
  if (candidate.includes('.pdf')) return 'pdf';
  if (candidate.match(/\.(png|jpg|jpeg|gif|webp|bmp|heic)/)) return 'image';
  return 'unknown';
}

function getPreferredPreviewUrl(draft: Draft) {
  if (draft.file_key?.startsWith('documents/') && draft.url) return draft.url;
  return draft.sourceUrl || draft.url;
}

function buildTypeSummary(type: DraftType, values: Record<string, any>) {
  const toText = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value).trim();
    return text || null;
  };

  const toAmount = (value: any, currency?: any) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    const currencyText = toText(currency) || 'USD';
    if (Number.isFinite(number)) return `${currencyText} ${number.toFixed(2)}`;
    return toText(value);
  };

  const base = [
    { label: 'Date', value: toText(values.date) },
    { label: 'Amount', value: toAmount(values.amount_usd, values.currency) },
    { label: 'Location', value: toText(values.location) },
    { label: 'Currency', value: toText(values.currency) },
  ];

  if (type === 'fuel') {
    return [
      ...base,
      { label: 'Fuel type', value: toText(values.fuel_type) },
      { label: 'Gallons', value: toText(values.gallons) },
      { label: 'Litres', value: toText(values.liters) },
      { label: 'PPU', value: toText(values.price_per_unit) },
      { label: 'Odometer', value: toText(values.odometer) },
      { label: 'DEF gallons', value: toText(values.def_gallons) },
      { label: 'DEF litres', value: toText(values.def_liters) },
      { label: 'DEF amount', value: toAmount(values.def_amount_usd, values.currency) },
      { label: 'DEF PPU', value: toText(values.def_price_per_unit) },
    ].filter((item) => item.value);
  }

  return [
    ...base,
    { label: 'Name', value: toText(values.name) },
    { label: 'Category', value: toText(values.category) },
  ].filter((item) => item.value);
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
  const [reviewDraftId, setReviewDraftId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dispatch/document-processing?tripNumber=${encodeURIComponent(tripNumber)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load documents');
      const nextDrafts = Array.isArray(data?.drafts) ? data.drafts : [];
      setDrafts(nextDrafts);
      setDraftEdits((current) => {
        const next = { ...current };
        for (const draft of nextDrafts) {
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

  const pendingCount = useMemo(() => drafts.filter((draft) => draft.status !== 'saved').length, [drafts]);

  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === reviewDraftId) || null,
    [drafts, reviewDraftId]
  );

  const activeType = ((draftEdits[activeDraft?.id || -1]?.document_type || activeDraft?.document_type || 'other') as DraftType);
  const activeValues = activeDraft
    ? { ...(activeDraft.extracted_data || {}), ...(draftEdits[activeDraft.id] || {}) }
    : {};
  const showTypeSummary = activeType === 'fuel' || activeType === 'toll' || activeType === 'reimbursement' || activeType === 'other' || activeType === 'receipt';
  const typeSummary = buildTypeSummary(activeType, activeValues);

  const formatFieldValue = (value: any) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  };

  const prepareExtractedData = (draft: Draft) => {
    const next = { ...(draft.extracted_data || {}), ...(draftEdits[draft.id] || {}) } as Record<string, any>;

    if (typeof next.stops === 'string' && next.stops.trim()) {
      try {
        next.stops = JSON.parse(next.stops);
      } catch {
        throw new Error('Stops must be valid JSON before confirming the itinerary');
      }
    }

    return next;
  };

  const handleUpload = useCallback(async (file: File) => {
    setUploading(true);
    setPanelError(null);
    setPanelMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('tripNumber', tripNumber);
      form.append('description', getTypeDetails(selectedType).label);

      const res = await fetch('/api/dispatch/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');

      setPanelMessage('Document uploaded. Open the review modal to confirm extracted fields before saving.');
      await loadDrafts();
      if (data?.processingDraft?.id) setReviewDraftId(data.processingDraft.id);
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
      const extractedData = prepareExtractedData(draft);
      const documentType = (draftEdits[draft.id]?.document_type || draft.document_type) as DraftType;

      const res = await fetch('/api/dispatch/document-processing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, tripNumber, documentType, extractedData }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not save document');

      const successMessage = documentType === 'itinerary'
        ? `Trip ${data?.tripNumber || extractedData.trip_number || tripNumber} updated from itinerary and linked.`
        : documentType === 'fuel'
          ? `Fuel entry #${data?.linkedRecordId} created and receipt linked.`
          : documentType === 'reimbursement'
            ? `Reimbursement #${data?.linkedRecordId} created and receipt linked.`
            : `Expense #${data?.linkedRecordId} created and receipt linked.`;
      setPanelMessage(successMessage);
      onSaved?.(successMessage);
      await loadDrafts();
      setReviewDraftId(null);
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
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-500">Smart intake</p>
          <h2 className="text-xl font-black text-white mt-1">Trip document inbox</h2>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            One place for PDFs and images, whether Boss is dropping in dispatch paperwork, fuel receipts, or reimbursement docs.
            Upload, review the extracted fields in-place, make fixes, then confirm without leaving this trip screen.
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
            {uploading ? 'Uploading...' : 'Upload file'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-zinc-500">
            <span>{loading ? 'Loading documents...' : `${drafts.length} files in this trip inbox`}</span>
            <span className="text-amber-400 font-black">{pendingCount} pending review</span>
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 text-xs text-zinc-400">
          <p className="font-black text-zinc-200 uppercase tracking-[0.25em] text-[10px] mb-1">What this handles</p>
          Smart review covers dispatch itineraries, receipts, PDFs, phone photos, and reimbursement support in one place.
        </div>
      </div>

      {(panelMessage || panelError) && (
        <div className={`rounded-2xl border px-4 py-3 text-xs font-bold ${panelError ? 'border-red-700/40 bg-red-950/20 text-red-300' : 'border-emerald-700/40 bg-emerald-950/20 text-emerald-300'}`}>
          {panelError || panelMessage}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 bg-black/20 p-6 text-sm text-zinc-500">
          No trip documents yet. Upload a PDF or image to start the smart review flow.
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => {
            const values = { ...(draft.extracted_data || {}), ...(draftEdits[draft.id] || {}) };
            const currentType = (draftEdits[draft.id]?.document_type || draft.document_type) as DraftType;
            const isSaved = draft.status === 'saved';
            const summaryName = currentType === 'itinerary'
              ? values.trip_number || values.route || values.driver_name
              : currentType === 'fuel'
                ? values.location
                : values.name || values.location;

            return (
              <div key={draft.id} className={`rounded-2xl border p-4 ${statusTone(draft.status)}`}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-black uppercase tracking-[0.25em]">
                      <span className="text-zinc-400">{getTypeDetails(currentType).label}</span>
                      <span>{friendlyStatus(draft.status)}</span>
                      {draft.missing_fields?.length > 0 && !isSaved && (
                        <span className="text-amber-300 tracking-normal normal-case text-[11px] font-mono">
                          Missing: {draft.missing_fields.join(', ')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-black text-white truncate">{draft.original_filename}</p>
                    <p className="text-xs text-zinc-400">
                      {summaryName || draft.description || getTypeDetails(currentType).helper}
                      {currentType === 'itinerary'
                        ? values.start_date ? ` • ${values.start_date}` : ''
                        : values.amount_usd ? ` • $${values.amount_usd}` : ''}
                      {currentType === 'itinerary'
                        ? values.driver_name ? ` • ${values.driver_name}` : ''
                        : values.date ? ` • ${values.date}` : ''}
                      {draft.linked_record_type && (draft.linked_record_id || draft.trip_number)
                        ? ` • linked to ${draft.linked_record_type} ${draft.linked_record_id ? `#${draft.linked_record_id}` : draft.trip_number || ''}`
                        : ''}
                    </p>
                    {draft.error_message && <p className="text-xs text-red-300">{draft.error_message}</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <select
                      value={currentType}
                      onChange={(event) => updateDraftField(draft.id, 'document_type', event.target.value)}
                      disabled={isSaved}
                      className="bg-black/40 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                    >
                      {TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => setReviewDraftId(draft.id)}
                      className="bg-zinc-900 hover:bg-zinc-800 text-[10px] font-black uppercase px-3 py-2 rounded-xl border border-zinc-700 transition-all"
                    >
                      {isSaved ? 'View' : 'Review'}
                    </button>
                    {!isSaved && (
                      <button
                        onClick={() => saveDraft(draft)}
                        disabled={savingId === draft.id}
                        className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-white text-[10px] font-black uppercase px-4 py-2 rounded-xl border border-emerald-600 transition-all"
                      >
                        {savingId === draft.id ? 'Saving...' : 'Quick save'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!activeDraft} onOpenChange={(open) => !open && setReviewDraftId(null)}>
        {activeDraft && (
          <DialogContent className="max-w-6xl border-zinc-800 bg-zinc-950 text-white p-0 overflow-hidden">
            <DialogHeader className="border-b border-zinc-800 px-6 py-5 text-left">
              <DialogTitle className="text-xl font-black">Review and confirm</DialogTitle>
              <DialogDescription className="text-zinc-400">
                Confirm the extracted values for this PDF or image, adjust anything that looks off, then save it straight into this trip.
              </DialogDescription>
            </DialogHeader>

            <div className="grid max-h-[80vh] gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="border-b border-zinc-800 bg-black/30 p-4 lg:border-b-0 lg:border-r lg:p-5 overflow-auto">
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-300">
                    {getTypeDetails(activeType).label}
                  </span>
                  <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-400">
                    {friendlyStatus(activeDraft.status)}
                  </span>
                  {activeDraft.missing_fields?.map((field) => (
                    <span key={field} className="rounded-full border border-amber-700/50 bg-amber-950/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                      Missing {formatFieldLabel(field)}
                    </span>
                  ))}
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 overflow-hidden min-h-[22rem]">
                  {(() => {
                    const previewUrl = getPreferredPreviewUrl(activeDraft);
                    const previewKind = getPreviewKind(activeDraft);
                    if (!previewUrl) {
                      return <div className="p-6 text-sm text-zinc-500">No preview available for this document yet.</div>;
                    }
                    if (previewKind === 'image') {
                      return <img src={previewUrl} alt={activeDraft.original_filename} className="w-full h-full object-contain bg-black max-h-[58vh]" />;
                    }
                    if (previewKind === 'pdf') {
                      return <iframe src={previewUrl} title={activeDraft.original_filename} className="w-full h-[58vh] bg-black" />;
                    }
                    return (
                      <div className="p-6 text-sm text-zinc-400 space-y-3">
                        <p>Preview is not embedded for this file type.</p>
                        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black uppercase text-white">
                          Open file
                        </a>
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="p-5 overflow-auto">
                <div className="space-y-4 pb-2">
                  <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Document</p>
                    <p className="mt-2 text-sm font-black text-white break-all">{activeDraft.original_filename}</p>
                    <p className="mt-1 text-xs text-zinc-400">{getTypeDetails(activeType).helper}</p>
                  </div>

                  {showTypeSummary && (
                    <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">{activeType} extracted summary</p>
                      {typeSummary.length === 0 ? (
                        <p className="mt-2 text-xs text-zinc-500">No structured fields extracted yet. You can fill them below.</p>
                      ) : (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {typeSummary.map((item) => (
                            <div key={item.label} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2">
                              <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">{item.label}</p>
                              <p className="mt-1 text-xs font-semibold text-zinc-200">{item.value}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">Document type</span>
                      <select
                        value={activeType}
                        onChange={(event) => updateDraftField(activeDraft.id, 'document_type', event.target.value)}
                        disabled={activeDraft.status === 'saved'}
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl px-3 py-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                      >
                        {TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>

                    {getReviewFields(activeType).map((field) => {
                      const value = formatFieldValue(activeValues[field.key]);
                      const className = `w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 ${activeDraft.status === 'saved' ? 'opacity-70' : ''}`;
                      const wrapperClass = field.fullWidth ? 'space-y-1 md:col-span-2' : 'space-y-1';

                      if (field.type === 'textarea') {
                        return (
                          <label key={field.key} className={wrapperClass}>
                            <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{field.label}</span>
                            <textarea
                              value={value}
                              placeholder={field.placeholder}
                              onChange={(event) => updateDraftField(activeDraft.id, field.key, event.target.value)}
                              disabled={activeDraft.status === 'saved'}
                              rows={4}
                              className={`${className} resize-y min-h-24`}
                            />
                          </label>
                        );
                      }

                      return (
                        <label key={field.key} className={wrapperClass}>
                          <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{field.label}</span>
                          <input
                            type={field.type || 'text'}
                            step={field.step}
                            value={value}
                            placeholder={field.placeholder}
                            onChange={(event) => updateDraftField(activeDraft.id, field.key, event.target.value)}
                            disabled={activeDraft.status === 'saved'}
                            className={className}
                          />
                        </label>
                      );
                    })}
                  </div>

                  {Object.keys(activeValues).filter((key) => !getReviewFields(activeType).some((field) => field.key === key) && key !== 'document_type').length > 0 && (
                    <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 space-y-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Extra extracted fields</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        {Object.keys(activeValues)
                          .filter((key) => !getReviewFields(activeType).some((field) => field.key === key) && key !== 'document_type')
                          .map((key) => (
                            <label key={key} className="space-y-1">
                              <span className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">{formatFieldLabel(key)}</span>
                              <input
                                value={formatFieldValue(activeValues[key])}
                                onChange={(event) => updateDraftField(activeDraft.id, key, event.target.value)}
                                disabled={activeDraft.status === 'saved'}
                                className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 disabled:opacity-70"
                              />
                            </label>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col-reverse gap-3 border-t border-zinc-800 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-zinc-500">
                      This review stays in the trip screen so Boss can confirm receipts, reimbursements, and future dispatch docs without bouncing to a separate page.
                    </p>
                    <div className="flex gap-2 sm:shrink-0">
                      <button
                        onClick={() => setReviewDraftId(null)}
                        className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[10px] font-black uppercase text-zinc-200 transition-all hover:bg-zinc-800"
                      >
                        Close
                      </button>
                      {activeDraft.status !== 'saved' && (
                        <button
                          onClick={() => saveDraft(activeDraft)}
                          disabled={savingId === activeDraft.id}
                          className="rounded-xl border border-emerald-600 bg-emerald-700 px-4 py-3 text-[10px] font-black uppercase text-white transition-all hover:bg-emerald-600 disabled:opacity-60"
                        >
                          {savingId === activeDraft.id
                            ? 'Saving...'
                            : activeType === 'itinerary'
                              ? 'Confirm itinerary'
                              : activeType === 'fuel'
                                ? 'Confirm fuel entry'
                                : activeType === 'reimbursement'
                                  ? 'Confirm reimbursement'
                                  : 'Confirm expense'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </section>
  );
}
