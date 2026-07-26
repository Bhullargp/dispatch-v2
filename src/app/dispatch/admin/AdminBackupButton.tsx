'use client';

import { useState } from 'react';

export default function AdminBackupButton() {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadBackup = async () => {
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch('/api/dispatch/admin/backup', {
        cache: 'no-store',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Backup failed');
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `dispatch-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || 'Backup failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={downloadBackup}
        disabled={downloading}
        className="text-xs font-black uppercase bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 border border-amber-500/30 text-amber-300 px-4 py-2 rounded-xl transition-all"
      >
        {downloading ? 'Backing up...' : 'Backup DB'}
      </button>
      {error && <p className="max-w-[220px] text-right text-[10px] font-bold text-red-400">{error}</p>}
    </div>
  );
}
