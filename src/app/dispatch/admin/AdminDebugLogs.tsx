'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type DebugLog = {
  id: number;
  created_at: string;
  category: string;
  event: string;
  level: 'info' | 'warn' | 'error';
  message: string | null;
  user_id: number | null;
  trip_number: string | null;
  provider: string | null;
  model: string | null;
  document_id: number | null;
  draft_id: number | null;
  file_name: string | null;
  trace_id: string | null;
  data: Record<string, unknown> | string | null;
};

const LEVEL_STYLES: Record<string, string> = {
  info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
  warn: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/10 text-red-300 border-red-500/30',
};

export default function AdminDebugLogs() {
  const searchParams = useSearchParams();
  const traceFilter = (searchParams.get('trace') || '').trim();
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ limit: '200' });
      if (traceFilter) query.set('trace', traceFilter);
      const res = await fetch(`/api/dispatch/admin/logs?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to load logs');
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load logs');
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dispatch/admin/logs', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Failed to clear logs');
      setLogs([]);
    } catch (err: any) {
      setError(err?.message || 'Failed to clear logs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (expanded) load();
  }, [expanded, traceFilter]);

  useEffect(() => {
    if (traceFilter) setExpanded(true);
  }, [traceFilter]);

  return (
    <details
      open={expanded}
      onToggle={(event) => setExpanded((event.target as HTMLDetailsElement).open)}
      className="bg-zinc-950/60 border border-zinc-800/70 rounded-2xl"
    >
      <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-black">Hidden Admin Logs</p>
          <p className="text-sm font-black text-zinc-200">Cross-user intake and provider traces</p>
        </div>
        <div className="text-xs text-zinc-500 font-mono">{logs.length} rows</div>
      </summary>

      <div className="border-t border-zinc-800/70 px-4 py-4 space-y-4">
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-black uppercase"
          >
            {loading ? 'Loading…' : 'Refresh Logs'}
          </button>
          <button
            onClick={clear}
            disabled={loading}
            className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-xs font-black uppercase text-red-300"
          >
            Clear Logs
          </button>
          {traceFilter && (
            <span className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-[11px] font-mono text-fuchsia-200">
              trace={traceFilter}
            </span>
          )}
          {error && <span className="text-xs text-red-400 font-bold">{error}</span>}
        </div>

        <div className="max-h-[720px] overflow-auto rounded-2xl border border-zinc-800/70">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-zinc-950">
              <tr className="text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                <th className="px-3 py-2 font-black">Time</th>
                <th className="px-3 py-2 font-black">User</th>
                <th className="px-3 py-2 font-black">Event</th>
                <th className="px-3 py-2 font-black">Provider</th>
                <th className="px-3 py-2 font-black">File</th>
                <th className="px-3 py-2 font-black">Trace</th>
                <th className="px-3 py-2 font-black">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  className={`border-b border-zinc-800/60 align-top ${traceFilter && log.trace_id === traceFilter ? 'bg-fuchsia-500/5' : ''}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{log.created_at?.replace('T', ' ').slice(0, 19) || '—'}</td>
                  <td className="px-3 py-2 font-mono text-zinc-300">{log.user_id ?? '—'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-full border ${LEVEL_STYLES[log.level] || LEVEL_STYLES.info}`}>{log.level}</span>
                      <span className="font-bold text-zinc-200">{log.event}</span>
                    </div>
                    {log.message && <p className="mt-1 text-zinc-500 max-w-[280px]">{log.message}</p>}
                    <p className="mt-1 text-zinc-600">{log.category}</p>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    <div>{log.provider || '—'}</div>
                    <div className="text-zinc-500">{log.model || ''}</div>
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    <div>{log.file_name || '—'}</div>
                    <div className="text-zinc-500">doc {log.document_id ?? '—'} · draft {log.draft_id ?? '—'}</div>
                    <div className="text-zinc-600">{log.trip_number || ''}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-500">{log.trace_id || '—'}</td>
                  <td className="px-3 py-2">
                    <pre className="whitespace-pre-wrap break-words text-[11px] leading-5 text-zinc-400 max-w-[520px]">
                      {typeof log.data === 'string' ? log.data : JSON.stringify(log.data || {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-zinc-500">No logs yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
