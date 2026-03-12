'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
        if (res.ok) {
          setAuthed(true);
        } else {
          router.replace('/dispatch/login');
        }
      } catch {
        router.replace('/dispatch/login');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [router]);

  if (loading) {
    return <div className="min-h-screen bg-[#050505]" />;
  }

  if (!authed) return null;

  return <>{children}</>;
}

export function LogoutButton() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      router.replace('/dispatch/login');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <button
      onClick={handleLogout}
      disabled={loggingOut}
      className="text-[10px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-red-600 disabled:opacity-60 px-3 py-2 rounded-xl border border-zinc-800 hover:border-red-700 transition-all shadow-xl text-zinc-400 hover:text-white text-xs"
    >
      {loggingOut ? 'Logging out…' : 'Logout'}
    </button>
  );
}
