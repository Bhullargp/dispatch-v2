'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function RunUploadWorkerButton() {
  const [running, setRunning] = useState(false);
  const router = useRouter();

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch('/api/dispatch/upload/worker', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || data?.message || 'Worker run failed');
      router.refresh();
    } catch (error: any) {
      alert(error?.message || 'Worker run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={running}
      className="text-xs font-black uppercase bg-emerald-700 hover:bg-emerald-600 border border-emerald-600 px-3 py-2 rounded-xl disabled:opacity-60"
    >
      {running ? 'Running…' : 'Run Queue Worker'}
    </button>
  );
}
