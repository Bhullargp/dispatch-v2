'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  isSupportedDocumentUpload,
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_UPLOAD_ERROR,
} from '@/lib/upload-file-types';

type UploadStatus = 'idle' | 'uploading' | 'saving' | 'done' | 'error';
type DraftStatus = 'processing' | 'needs_review' | 'ready' | 'saved' | 'error';
type DraftType = 'itinerary' | 'fuel' | 'toll' | 'reimbursement' | 'other' | 'receipt' | 'unknown';

type UploadDraft = {
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

type TripOption = {
  trip_number: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

const TYPE_OPTIONS: Array<{ value: Exclude<DraftType, 'receipt' | 'unknown'>; label: string; helper: string }> = [
  { value: 'itinerary', label: 'Dispatch itinerary', helper: 'Trip sheets, rate cons, driver itinerary packets, and trip paperwork' },
  { value: 'fuel', label: 'Fuel receipt', helper: 'Pump slips, truck-stop invoices, diesel receipts' },
  { value: 'toll', label: 'Toll receipt', helper: 'Road tolls, bridge charges, weigh-station fees' },
  { value: 'reimbursement', label: 'Reimbursement receipt', helper: 'Driver reimbursement items and out-of-pocket spend' },
  { value: 'other', label: 'Other receipt', helper: 'Lumper, parking, scales, supplies, and other trip costs' },
];

const FIELD_LABELS: Record<string, string> = {
  amount_usd: 'Amount (USD)',
  date: 'Date',
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
};

const ITINERARY_FIELDS: FieldConfig[] = [
  { key: 'trip_number', label: 'Trip number', placeholder: 'T12345' },
  { key: 'start_date', label: 'Start date', type: 'date' },
  { key: 'end_date', label: 'End date', type: 'date' },
  { key: 'total_miles', label: 'Total miles', type: 'number', step: '1' },
  { key: 'route', label: 'Route', placeholder: 'AB to CA', fullWidth: true },
  { key: 'driver_name', label: 'Driver name' },
  { key: 'co_driver', label: 'Co-driver' },
  { key: 'truck_number', label: 'Truck #' },
  { key: 'trailer_number', label: 'Trailer #' },
  { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Optional trip notes' },
];

const BASE_RECEIPT_FIELDS: FieldConfig[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'amount_usd', label: 'Amount (USD)', type: 'number', step: '0.01', placeholder: '0.00' },
];

const RECEIPT_FIELDS: Record<'fuel' | 'toll' | 'reimbursement' | 'other', FieldConfig[]> = {
  fuel: [
    { key: 'location', label: 'Location', placeholder: 'TA, Flying J, Petro, etc.', fullWidth: true },
    { key: 'gallons', label: 'Gallons', type: 'number', step: '0.001' },
    { key: 'liters', label: 'Litres', type: 'number', step: '0.01' },
    { key: 'price_per_unit', label: 'Price / unit', type: 'number', step: '0.001' },
    { key: 'odometer', label: 'Odometer', type: 'number', step: '1' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Optional fuel notes' },
  ],
  toll: [
    { key: 'name', label: 'Charge name', placeholder: 'Toll road or bridge name' },
    { key: 'location', label: 'Location', placeholder: 'Where this charge happened' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Lane, bridge, road, or extra context' },
  ],
  reimbursement: [
    { key: 'name', label: 'Reimbursement name', placeholder: 'Meal, hotel, parking, etc.' },
    { key: 'location', label: 'Location', placeholder: 'Store, city, or stop' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'What this reimbursement is for' },
  ],
  other: [
    { key: 'name', label: 'Expense name', placeholder: 'Lumper, parking, supplies, etc.' },
    { key: 'location', label: 'Location', placeholder: 'Vendor or location' },
    { key: 'notes', label: 'Notes', type: 'textarea', fullWidth: true, placeholder: 'Any extra context for dispatch/accounting' },
  ],
};

function getTypeDetails(type: DraftType) {
  return TYPE_OPTIONS.find((option) => option.value === type) || TYPE_OPTIONS[4];
}

function formatFieldLabel(key: string) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function friendlyStatus(status: DraftStatus) {
  if (status === 'needs_review') return 'needs review';
  return status;
}

function getPreviewKind(draft: UploadDraft) {
  const candidate = `${draft.original_filename} ${draft.sourceUrl || ''} ${draft.url || ''}`.toLowerCase();
  if (candidate.includes('.pdf')) return 'pdf';
  if (candidate.match(/\.(png|jpg|jpeg|gif|webp|bmp|heic|heif)/)) return 'image';
  return 'unknown';
}

function getPreferredPreviewUrl(draft: UploadDraft) {
  if (draft.file_key?.startsWith('documents/') && draft.url) return draft.url;
  return draft.sourceUrl || draft.url;
}

function getReviewFields(type: DraftType): FieldConfig[] {
  if (type === 'itinerary') return ITINERARY_FIELDS;
  const normalizedType = (type === 'fuel' || type === 'toll' || type === 'reimbursement' || type === 'other'
    ? type
    : 'other') as 'fuel' | 'toll' | 'reimbursement' | 'other';
  return [...BASE_RECEIPT_FIELDS, ...RECEIPT_FIELDS[normalizedType]];
}

function formatTripOption(trip: TripOption) {
  const bits = [trip.trip_number];
  if (trip.status) bits.push(trip.status);
  if (trip.start_date || trip.end_date) bits.push([trip.start_date, trip.end_date].filter(Boolean).join(' → '));
  return bits.join(' • ');
}

function buildSuccessMessage(params: {
  documentType: DraftType;
  linkedRecordType?: string | null;
  linkedRecordId?: number | null;
  tripNumber?: string | null;
}) {
  const { documentType, linkedRecordType, linkedRecordId, tripNumber } = params;

  if (linkedRecordType === 'trip') {
    return `Trip ${tripNumber || 'draft'} created from smart intake.`;
  }

  if (documentType === 'fuel') {
    return `Fuel entry #${linkedRecordId} saved${tripNumber ? ` to trip ${tripNumber}` : ''}.`;
  }

  if (documentType === 'reimbursement') {
    return `Reimbursement receipt saved as expense #${linkedRecordId}${tripNumber ? ` for trip ${tripNumber}` : ''}.`;
  }

  if (documentType === 'toll') {
    return `Toll receipt saved as expense #${linkedRecordId}${tripNumber ? ` for trip ${tripNumber}` : ''}.`;
  }

  return `Receipt saved as expense #${linkedRecordId}${tripNumber ? ` for trip ${tripNumber}` : ''}.`;
}

function buildBasicReceiptSummary(values: Record<string, any>) {
  const toText = (value: any) => {
    if (value === null || value === undefined || value === '') return null;
    return String(value).trim() || null;
  };

  const amountRaw = values.amount_usd;
  const amount = amountRaw === null || amountRaw === undefined || amountRaw === ''
    ? null
    : Number(amountRaw);
  const amountNumber = typeof amount === 'number' && Number.isFinite(amount) ? amount : null;
  const amountText = amountNumber !== null ? `$${amountNumber.toFixed(2)}` : toText(amountRaw);

  const notes = toText(values.notes);

  return [
    { label: 'Date', value: toText(values.date) },
    { label: 'Amount', value: amountText },
    { label: 'Name', value: toText(values.name) },
    { label: 'Location', value: toText(values.location) },
    { label: 'Category', value: toText(values.category) },
    { label: 'Notes', value: notes ? (notes.length > 80 ? `${notes.slice(0, 80)}…` : notes) : null },
  ].filter((item) => item.value);
}

export default function PdfUploader({
  onTripCreated,
  availableTrips = [],
}: {
  onTripCreated?: () => void;
  availableTrips?: TripOption[];
}) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [tripNumber, setTripNumber] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [reviewDraft, setReviewDraft] = useState<UploadDraft | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, any>>({});
  const [assignedTripNumber, setAssignedTripNumber] = useState<string>('');
  const [retryingDraft, setRetryingDraft] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const orderedTrips = useMemo(() => {
    return [...availableTrips].sort((a, b) => {
      const aActive = (a.status || '').toLowerCase() === 'active' ? 1 : 0;
      const bActive = (b.status || '').toLowerCase() === 'active' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return b.trip_number.localeCompare(a.trip_number);
    });
  }, [availableTrips]);

  const activeType = ((draftEdits.document_type || reviewDraft?.document_type || 'other') as DraftType);
  const activeValues = reviewDraft
    ? { ...(reviewDraft.extracted_data || {}), ...draftEdits }
    : {};
  const reviewFields = getReviewFields(activeType);
  const requiresTripAssignment = !!reviewDraft && activeType !== 'itinerary';
  const showBasicReceiptSummary = activeType === 'toll' || activeType === 'reimbursement' || activeType === 'other';
  const basicReceiptSummary = buildBasicReceiptSummary(activeValues);

  const updateDraftField = useCallback((field: string, value: any) => {
    setDraftEdits((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);

  const resetFileInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const upload = useCallback(async (file: File) => {
    if (!isSupportedDocumentUpload(file)) {
      setMessage(SUPPORTED_DOCUMENT_UPLOAD_ERROR);
      setStatus('error');
      return;
    }

    setStatus('uploading');
    setMessage('Uploading into smart intake...');
    setTripNumber(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('description', 'Smart intake upload');

      const res = await fetch('/api/dispatch/documents', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Upload failed');

      if (data?.processingDraft) {
        const nextDraft = data.processingDraft as UploadDraft;
        setReviewDraft(nextDraft);
        setDraftEdits({ ...(nextDraft.extracted_data || {}), document_type: nextDraft.document_type });
        setAssignedTripNumber(nextDraft.trip_number || orderedTrips[0]?.trip_number || '');
        setStatus('done');
        setMessage(`Uploaded ${file.name}. Review the extracted ${nextDraft.document_type === 'itinerary' ? 'trip' : 'receipt'} details below before confirming.`);
      } else {
        setStatus('done');
        setMessage('Upload accepted. Smart intake did not return a review draft yet.');
      }
    } catch (error: any) {
      setStatus('error');
      setMessage(error.message || 'Upload failed');
    } finally {
      resetFileInput();
    }
  }, [orderedTrips]);

  const saveDraft = useCallback(async () => {
    if (!reviewDraft) return;

    const documentType = (draftEdits.document_type || reviewDraft.document_type || 'other') as DraftType;
    const selectedTrip = documentType === 'itinerary'
      ? null
      : assignedTripNumber || reviewDraft.trip_number || null;

    if (documentType !== 'itinerary' && !selectedTrip) {
      setStatus('error');
      setMessage('Pick the trip this receipt belongs to before confirming.');
      return;
    }

    setStatus('saving');
    setMessage(null);

    try {
      const extractedData = { ...(reviewDraft.extracted_data || {}), ...draftEdits };
      const res = await fetch('/api/dispatch/document-processing/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: reviewDraft.id,
          tripNumber: selectedTrip,
          documentType,
          extractedData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not confirm document');

      const resolvedTripNumber = data?.tripNumber || selectedTrip || reviewDraft.trip_number || null;
      setTripNumber(resolvedTripNumber);
      setStatus('done');
      setMessage(buildSuccessMessage({
        documentType,
        linkedRecordType: data?.linkedRecordType,
        linkedRecordId: data?.linkedRecordId,
        tripNumber: resolvedTripNumber,
      }));
      setReviewDraft(null);
      setDraftEdits({});
      onTripCreated?.();
    } catch (error: any) {
      setStatus('error');
      setMessage(error.message || 'Could not confirm document');
    }
  }, [assignedTripNumber, draftEdits, onTripCreated, reviewDraft]);

  const retryDraftProcessing = useCallback(async () => {
    if (!reviewDraft) return;

    setRetryingDraft(true);
    setStatus('saving');
    setMessage('Retrying smart intake extraction from stored file...');
    try {
      const res = await fetch('/api/dispatch/document-processing/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: reviewDraft.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Could not retry document processing');

      if (data?.draft) {
        const nextDraft = data.draft as UploadDraft;
        setReviewDraft(nextDraft);
        setDraftEdits({ ...(nextDraft.extracted_data || {}), document_type: nextDraft.document_type });
        setAssignedTripNumber(nextDraft.trip_number || orderedTrips[0]?.trip_number || '');
      }

      setStatus('done');
      setMessage('Retry complete. Review extracted details and confirm.');
    } catch (error: any) {
      setStatus('error');
      setMessage(error?.message || 'Could not retry document processing');
    } finally {
      setRetryingDraft(false);
    }
  }, [orderedTrips, reviewDraft]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) upload(file);
  }, [upload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload(file);
  }, [upload]);

  const isProcessing = status === 'uploading' || status === 'saving' || retryingDraft;
  const extraFieldKeys = Object.keys(activeValues).filter((key) => !reviewFields.some((field) => field.key === key) && key !== 'document_type');

  return (
    <div className="w-full space-y-3">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-1">
          <p className="text-[10px] font-black uppercase tracking-[0.35em] text-emerald-500">Single smart intake</p>
          <p className="text-sm font-black text-white">Drop trip PDFs, itinerary images, or receipt photos in one place.</p>
          <p className="text-[11px] text-zinc-500">Smart intake will auto-detect whether this should create a trip or open a receipt review flow.</p>
        </div>

        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          className={`
            relative border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all
            ${isProcessing ? 'pointer-events-none opacity-60' : ''}
            ${isDragging
              ? 'border-emerald-500 bg-emerald-900/20 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
              : 'border-zinc-800 bg-black/20 hover:border-zinc-600 hover:bg-zinc-900/40'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPORTED_DOCUMENT_ACCEPT}
            className="hidden"
            onChange={handleFileSelect}
          />

          {isProcessing ? (
            <div className="space-y-3">
              <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-emerald-400">
                  {status === 'uploading' ? 'Reading upload...' : 'Saving confirmed document...'}
                </p>
                <p className="text-[10px] text-zinc-500 mt-1">Smart intake is classifying the file and preparing review</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-2xl">📄</div>
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-zinc-300">
                  Drop PDF or image here or click to upload
                </p>
                <p className="text-[10px] text-zinc-500 mt-1">
                  One upload area for dispatch itineraries, fuel receipts, tolls, and reimbursements.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className={`rounded-xl p-3 text-xs font-bold ${
          status === 'error'
            ? 'bg-red-900/20 border border-red-700/40 text-red-300'
            : 'bg-emerald-900/20 border border-emerald-700/40 text-emerald-300'
        }`}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span>{message}</span>
            {tripNumber && (
              <Link
                href={`/dispatch/${tripNumber}`}
                className="text-emerald-400 hover:text-emerald-300 font-black uppercase text-[10px] tracking-wider flex-shrink-0"
              >
                Open Trip →
              </Link>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!reviewDraft} onOpenChange={(open) => !open && setReviewDraft(null)}>
        {reviewDraft && (
          <DialogContent className="w-[min(96vw,1280px)] max-w-none border-zinc-800 bg-zinc-950 p-0 text-white shadow-2xl">
            <div className="flex h-[min(92vh,900px)] min-h-[620px] flex-col overflow-hidden max-sm:h-[94vh] max-sm:min-h-0">
              <DialogHeader className="border-b border-zinc-800 px-5 py-4 text-left sm:px-6 sm:py-5">
                <DialogTitle className="text-xl font-black sm:text-2xl">Review smart intake</DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-zinc-400">
                  Confirm whether this upload should create a trip or save a receipt, fix any extracted fields, then submit without leaving the dashboard.
                </DialogDescription>
              </DialogHeader>

              <div className="grid flex-1 min-h-0 gap-0 xl:grid-cols-[1.15fr_0.85fr]">
                <div className="flex min-h-0 flex-col border-b border-zinc-800 bg-black/30 p-4 sm:p-5 xl:border-b-0 xl:border-r xl:p-6">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-300">
                      {getTypeDetails(activeType).label}
                    </span>
                    <span className="rounded-full border border-zinc-700 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-400">
                      {friendlyStatus(reviewDraft.status)}
                    </span>
                    {reviewDraft.missing_fields?.map((field) => (
                      <span key={field} className="rounded-full border border-amber-700/50 bg-amber-950/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                        Missing {formatFieldLabel(field)}
                      </span>
                    ))}
                    {reviewDraft.status === 'error' && (
                      <button
                        type="button"
                        onClick={retryDraftProcessing}
                        disabled={retryingDraft || status === 'saving'}
                        className="rounded-full border border-red-600/50 bg-red-950/30 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-red-200 transition hover:bg-red-950/50 disabled:opacity-60"
                      >
                        {retryingDraft ? 'Retrying...' : 'Retry extraction'}
                      </button>
                    )}
                  </div>

                  <div className="min-h-[280px] flex-1 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/80">
                    {(() => {
                      const previewUrl = getPreferredPreviewUrl(reviewDraft);
                      const previewKind = getPreviewKind(reviewDraft);
                      if (!previewUrl) {
                        return <div className="p-6 text-sm text-zinc-500">No preview available for this document yet.</div>;
                      }
                      if (previewKind === 'image') {
                        return <img src={previewUrl} alt={reviewDraft.original_filename} className="h-full w-full bg-black object-contain" />;
                      }
                      if (previewKind === 'pdf') {
                        return <iframe src={previewUrl} title={reviewDraft.original_filename} className="h-full min-h-[320px] w-full bg-black" />;
                      }
                      return (
                        <div className="space-y-3 p-6 text-sm text-zinc-400">
                          <p>Preview is not embedded for this file type.</p>
                          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black uppercase text-white">
                            Open file
                          </a>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="flex min-h-0 flex-col">
                  <div className="flex-1 overflow-auto px-4 py-4 sm:px-5 sm:py-5 xl:px-6 xl:py-6">
                    <div className="space-y-4 pb-2">
                      <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Document</p>
                        <p className="mt-2 break-all text-sm font-black text-white sm:text-base">{reviewDraft.original_filename}</p>
                        <p className="mt-1 text-xs text-zinc-400 sm:text-sm">{getTypeDetails(activeType).helper}</p>
                      </div>

                      {showBasicReceiptSummary && (
                        <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Basic extracted info</p>
                            {reviewDraft.status === 'error' && (
                              <button
                                type="button"
                                onClick={retryDraftProcessing}
                                disabled={retryingDraft || status === 'saving'}
                                className="rounded-lg border border-amber-600/40 bg-amber-900/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200 transition hover:bg-amber-900/35 disabled:opacity-60"
                              >
                                {retryingDraft ? 'Retrying...' : 'Retry extract'}
                              </button>
                            )}
                          </div>
                          {basicReceiptSummary.length === 0 ? (
                            <p className="mt-2 text-xs text-zinc-500">No basic fields were extracted yet. You can fill them below.</p>
                          ) : (
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              {basicReceiptSummary.map((item) => (
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
                          <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Document type</span>
                          <select
                            value={TYPE_OPTIONS.some((option) => option.value === activeType) ? activeType : 'other'}
                            onChange={(event) => updateDraftField('document_type', event.target.value)}
                            className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-3 text-sm font-mono outline-none focus:border-emerald-500"
                          >
                            {TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </label>

                        {requiresTripAssignment && (
                          <label className="space-y-1 md:col-span-2">
                            <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Save receipt into trip</span>
                            <select
                              value={assignedTripNumber}
                              onChange={(event) => setAssignedTripNumber(event.target.value)}
                              className="w-full rounded-xl border border-zinc-800 bg-black/40 px-3 py-3 text-sm font-mono outline-none focus:border-emerald-500"
                            >
                              <option value="">Select trip</option>
                              {orderedTrips.map((trip) => (
                                <option key={trip.trip_number} value={trip.trip_number}>{formatTripOption(trip)}</option>
                              ))}
                            </select>
                          </label>
                        )}

                        {reviewFields.map((field) => {
                          const value = activeValues[field.key] ?? '';
                          const className = 'w-full rounded-xl border border-zinc-800 bg-black/40 p-3 text-sm font-mono outline-none focus:border-emerald-500';
                          const wrapperClass = field.fullWidth ? 'space-y-1 md:col-span-2' : 'space-y-1';

                          if (field.type === 'textarea') {
                            return (
                              <label key={field.key} className={wrapperClass}>
                                <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{field.label}</span>
                                <textarea
                                  value={value}
                                  placeholder={field.placeholder}
                                  onChange={(event) => updateDraftField(field.key, event.target.value)}
                                  rows={4}
                                  className={`${className} min-h-24 resize-y`}
                                />
                              </label>
                            );
                          }

                          return (
                            <label key={field.key} className={wrapperClass}>
                              <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{field.label}</span>
                              <input
                                type={field.type || 'text'}
                                step={field.step}
                                value={value}
                                placeholder={field.placeholder}
                                onChange={(event) => updateDraftField(field.key, event.target.value)}
                                className={className}
                              />
                            </label>
                          );
                        })}
                      </div>

                      {extraFieldKeys.length > 0 && (
                        <div className="space-y-3 rounded-2xl border border-zinc-800 bg-black/20 p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.3em] text-zinc-500">Extra extracted fields</p>
                          <div className="grid gap-3 md:grid-cols-2">
                            {extraFieldKeys.map((key) => (
                              <label key={key} className="space-y-1">
                                <span className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">{formatFieldLabel(key)}</span>
                                <input
                                  value={activeValues[key] ?? ''}
                                  onChange={(event) => updateDraftField(key, event.target.value)}
                                  className="w-full rounded-xl border border-zinc-800 bg-black/40 p-3 text-sm font-mono outline-none focus:border-emerald-500"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {reviewDraft.error_message && (
                        <div className="rounded-2xl border border-red-700/40 bg-red-950/20 p-4 text-xs text-red-300">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span>{reviewDraft.error_message}</span>
                            <button
                              type="button"
                              onClick={retryDraftProcessing}
                              disabled={retryingDraft || status === 'saving'}
                              className="rounded-lg border border-red-500/40 bg-red-900/20 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-red-100 transition hover:bg-red-900/35 disabled:opacity-60"
                            >
                              {retryingDraft ? 'Retrying...' : 'Retry'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="sticky bottom-0 border-t border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur sm:px-5 sm:py-4 xl:px-6">
                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
                      <button
                        onClick={() => setReviewDraft(null)}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-zinc-200 transition-all hover:bg-zinc-800 sm:w-auto"
                      >
                        Close
                      </button>
                      <button
                        onClick={saveDraft}
                        disabled={status === 'saving'}
                        className="w-full rounded-xl border border-emerald-600 bg-emerald-700 px-4 py-3 text-xs font-black uppercase tracking-[0.2em] text-white transition-all hover:bg-emerald-600 disabled:opacity-60 sm:w-auto"
                      >
                        {status === 'saving'
                          ? 'Saving...'
                          : activeType === 'itinerary'
                            ? 'Create or update trip'
                            : activeType === 'fuel'
                              ? 'Confirm fuel receipt'
                              : activeType === 'reimbursement'
                                ? 'Confirm reimbursement'
                                : 'Confirm receipt'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
