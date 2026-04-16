'use client';

import React, { useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  isSupportedDocumentUpload,
  SUPPORTED_DOCUMENT_ACCEPT,
  SUPPORTED_DOCUMENT_UPLOAD_ERROR,
} from '@/lib/upload-file-types';

type UploadStatus = 'idle' | 'uploading' | 'extracting' | 'saving' | 'done' | 'error';

interface UploadJob {
  id: number;
  original_filename: string;
  status: string;
  trip_number?: string;
  error_message?: string;
}

export default function PdfUploader({ onTripCreated }: { onTripCreated?: () => void }) {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [tripNumber, setTripNumber] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const upload = useCallback(async (file: File) => {
    if (!isSupportedDocumentUpload(file)) {
      setMessage(SUPPORTED_DOCUMENT_UPLOAD_ERROR);
      setStatus('error');
      return;
    }

    setStatus('uploading');
    setMessage('Uploading document...');
    setTripNumber(null);

    try {
      const form = new FormData();
      form.append('file', file);

      setMessage('Extracting trip sheet data...');
      setStatus('extracting');

      const res = await fetch('/api/dispatch/upload', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok && !data?.queued) {
        throw new Error(data?.error || 'Upload failed');
      }

      if (data?.tripNumber) {
        setMessage('Saving trip...');
        setStatus('saving');
        setTripNumber(data.tripNumber);
        setStatus('done');
        setMessage(`Trip ${data.tripNumber} imported successfully`);
        onTripCreated?.();
      } else if (data?.queued) {
        setStatus('done');
        setMessage(data?.message || 'Upload queued for background processing');
      } else {
        setStatus('done');
        setMessage('Upload accepted');
        onTripCreated?.();
      }
    } catch (error: any) {
      setStatus('error');
      setMessage(error.message || 'Upload failed');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [onTripCreated]);

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

  const isProcessing = status === 'uploading' || status === 'extracting' || status === 'saving';

  return (
    <div className="w-full">
      {/* Drop zone */}
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
            : 'border-zinc-800 bg-zinc-950/50 hover:border-zinc-600 hover:bg-zinc-900/40'
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
                {status === 'uploading' && 'Uploading document...'}
                {status === 'extracting' && 'Extracting trip sheet data...'}
                {status === 'saving' && 'Saving trip...'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-1">AI-powered extraction in progress</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-2xl">📄</div>
            <div>
              <p className="text-xs font-black uppercase tracking-widest text-zinc-400">
                Drop PDF or image here or click to upload
              </p>
              <p className="text-[10px] text-zinc-600 mt-1">
                Use this for trip sheets or itinerary images. Upload receipts inside a trip.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Status feedback */}
      {message && (
        <div className={`mt-3 rounded-xl p-3 text-xs font-bold ${
          status === 'done' && tripNumber
            ? 'bg-emerald-900/20 border border-emerald-700/40 text-emerald-300'
            : status === 'error'
            ? 'bg-red-900/20 border border-red-700/40 text-red-300'
            : status === 'done'
            ? 'bg-emerald-900/20 border border-emerald-700/40 text-emerald-300'
            : 'bg-zinc-900/40 border border-zinc-800 text-zinc-400'
        }`}>
          <div className="flex items-center justify-between">
            <span>{message}</span>
            {tripNumber && (
              <Link
                href={`/dispatch/${tripNumber}`}
                className="text-emerald-400 hover:text-emerald-300 font-black uppercase text-[10px] tracking-wider ml-2 flex-shrink-0"
              >
                View Trip →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
