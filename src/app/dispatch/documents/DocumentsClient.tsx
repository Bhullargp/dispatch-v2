'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import PdfUploader from '../PdfUploader';

type TripOption = {
  trip_number: string;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
};

type DocumentRow = {
  id: number;
  file_key: string | null;
  original_filename: string;
  file_type: string;
  file_size: number | null;
  description: string | null;
  trip_number: string | null;
  source_path: string | null;
  uploaded_at: string | null;
};

function formatBytes(size: number | null) {
  if (!size || size <= 0) return 'Unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatUploadedAt(value: string | null) {
  if (!value) return 'Unknown upload time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function isImageDocument(fileType: string, filename: string) {
  if (fileType.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|heic|heif|gif)$/i.test(filename);
}

export default function DocumentsClient({
  availableTrips,
  initialDocuments,
}: {
  availableTrips: TripOption[];
  initialDocuments: DocumentRow[];
}) {
  const [documents, setDocuments] = useState(initialDocuments);
  const [refreshing, setRefreshing] = useState(false);

  const refreshDocuments = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/dispatch/documents/list', { cache: 'no-store' });
      const data = await res.json().catch(() => ({ documents: [] }));
      if (res.ok) {
        setDocuments(data.documents || []);
      }
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28 md:pb-10 space-y-6">
      <section className="flex flex-col gap-3 rounded-3xl border border-white/[0.08] bg-black/30 p-5 sm:p-6 backdrop-blur-xl">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.4em] text-emerald-400">Documents</p>
            <h1 className="mt-2 text-3xl sm:text-4xl font-black tracking-tight text-white">Upload trip paperwork in one place</h1>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Drop itineraries, PDFs, receipts, and document photos here. Smart intake will classify them, open the review flow, and attach them to the right trip.
            </p>
          </div>
          <button
            type="button"
            onClick={refreshDocuments}
            disabled={refreshing}
            className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-[11px] font-black uppercase tracking-[0.25em] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh list'}
          </button>
        </div>
        <PdfUploader
          availableTrips={availableTrips}
          onTripCreated={refreshDocuments}
        />
      </section>

      <section className="rounded-3xl border border-white/[0.08] bg-zinc-950/50 p-5 sm:p-6 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.35em] text-zinc-500">Library</p>
            <h2 className="mt-2 text-xl font-black text-white">Recent uploads</h2>
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">
            {documents.length} file{documents.length === 1 ? '' : 's'}
          </div>
        </div>

        {documents.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-white/[0.08] bg-black/20 px-4 py-10 text-center text-sm text-zinc-500">
            No uploaded documents yet.
          </div>
        ) : (
          <div className="mt-6 grid gap-3">
            {documents.map((document) => {
              const sourceHref = document.source_path
                ? `/api/dispatch/documents/source?path=${encodeURIComponent(document.source_path)}`
                : document.file_key
                  ? `/api/dispatch/documents/download/${document.file_key.split('/').map(encodeURIComponent).join('/')}`
                  : null;

              return (
                <article
                  key={document.id}
                  className="grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                        {document.file_type === 'application/pdf' ? 'PDF' : isImageDocument(document.file_type, document.original_filename) ? 'Image' : 'Doc'}
                      </span>
                      {document.trip_number && (
                        <Link
                          href={`/dispatch/${document.trip_number}`}
                          className="inline-flex rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-sky-300"
                        >
                          Trip {document.trip_number}
                        </Link>
                      )}
                    </div>
                    <p className="mt-3 truncate text-base font-black text-white">{document.original_filename}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span>{formatBytes(document.file_size)}</span>
                      <span>{formatUploadedAt(document.uploaded_at)}</span>
                      {document.description && <span>{document.description}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:justify-end">
                    {sourceHref && (
                      <a
                        href={sourceHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-200 transition hover:bg-white/[0.08]"
                      >
                        Open
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
