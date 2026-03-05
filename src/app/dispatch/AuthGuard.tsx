'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated, logout, getSession } from './auth';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/dispatch/login');
    } else {
      setAuthed(true);
    }
  }, [router]);

  if (!authed) {
    return <div className="min-h-screen bg-[#050505]" />;
  }

  return <>{children}</>;
}

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace('/dispatch/login');
  };

  return (
    <button
      onClick={handleLogout}
      className="text-[10px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-red-600 px-3 py-2 rounded-xl border border-zinc-800 hover:border-red-700 transition-all shadow-xl text-zinc-400 hover:text-white text-xs"
    >
      Logout
    </button>
  );
}
