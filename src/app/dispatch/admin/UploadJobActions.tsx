'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function UploadJobActions({ id, status }: { id: number; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async (action: 'retry' | 'cancel') => {
    setLoading(true);
    try {
      const res = await fetch('/api/dispatch/upload/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Action failed');
      router.refresh();
    } catch (error: any) {
      alert(error?.message || 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {status === 'failed' && (
        <button
          disabled={loading}
          onClick={() => run('retry')}
          className="text-[10px] font-black uppercase px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 border border-blue-600 disabled:opacity-60"
        >
          Retry
        </button>
      )}
      {status === 'queued' && (
        <button
          disabled={loading}
          onClick={() => run('cancel')}
          className="text-[10px] font-black uppercase px-2 py-1 rounded bg-red-800 hover:bg-red-700 border border-red-700 disabled:opacity-60"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
