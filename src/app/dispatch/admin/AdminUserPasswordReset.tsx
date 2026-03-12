'use client';

import { useState } from 'react';

type Props = {
  userId: number;
  username: string;
  isSelf?: boolean;
};

export default function AdminUserPasswordReset({ userId, username, isSelf = false }: Props) {
  const [open, setOpen] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const res = await fetch('/api/dispatch/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId, temporaryPassword, forcePasswordChange })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setMessage(`Password reset for ${username}.`);
      setTemporaryPassword('');
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-amber-600 px-3 py-2 rounded-xl border border-zinc-800 hover:border-amber-500 transition-all"
      >
        Reset Password
      </button>

      {open && (
        <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2 min-w-[260px]">
          <input
            type="password"
            value={temporaryPassword}
            onChange={(e) => setTemporaryPassword(e.target.value)}
            placeholder="Temporary password (min 8)"
            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
          />
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={forcePasswordChange}
              onChange={(e) => setForcePasswordChange(e.target.checked)}
            />
            Force user to change on next login
          </label>
          {isSelf && <p className="text-[10px] text-amber-400">You are resetting your own account.</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || temporaryPassword.length < 8}
              onClick={submit}
              className="text-[10px] font-black uppercase tracking-widest bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-2 py-1 rounded"
            >
              {loading ? 'Resetting…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => setOpen(false)}
              className="text-[10px] font-black uppercase tracking-widest bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
      {message && <p className="text-[10px] text-green-400">{message}</p>}
    </div>
  );
}
