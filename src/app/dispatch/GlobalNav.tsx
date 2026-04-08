'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth';
import { LogoutButton } from './AuthGuard';

const NAV_ITEMS = [
  { name: 'Dashboard', path: '/dispatch/dashboard', icon: '📊' },
  { name: 'Trips', path: '/dispatch/trips', icon: '📋' },
  { name: 'Active', path: '/dispatch/active', icon: '🚛' },
  { name: 'Fuel', path: '/dispatch/fuel-history', icon: '⛽' },
];

export default function GlobalNav() {
  const pathname = usePathname();
  const { user } = useAuth();

  // Don't show nav on login/setup pages
  if (pathname === '/dispatch/login' || pathname === '/dispatch/setup') return null;

  return (
    <>
      {/* Desktop top bar */}
      <nav className="hidden md:block sticky top-0 z-50 bg-black/40 backdrop-blur-2xl border-b border-white/[0.04]">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <span className="text-lg font-black tracking-tighter text-white mr-4">Dispatch</span>
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.path;
              return (
                <Link
                  key={item.path}
                  href={item.path}
                  className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${
                    isActive
 ? 'bg-emerald-600/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                  }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  {item.name}
                </Link>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/dispatch/settings?tab=profile"
              className="flex items-center gap-2 text-[11px] font-bold text-zinc-400 hover:text-white bg-white/[0.03] hover:bg-white/[0.06] px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.1] transition-all backdrop-blur-sm"
              title="Edit Profile"
            >
              <span className="w-6 h-6 rounded-full bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-[10px] text-emerald-400 font-black overflow-hidden">
                {(user?.email || user?.username || '?')[0].toUpperCase()}
              </span>
              <span className="hidden lg:inline">{user?.email || user?.username || '...'}</span>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-2xl border-t border-white/[0.04] safe-area-bottom">
        <div className="flex justify-around items-center py-2 px-2">
          {[...NAV_ITEMS, { name: 'Profile', path: '/dispatch/settings?tab=profile', icon: '👤' }].map((item) => {
            const isActive = pathname === item.path;
            return (
              <Link
                key={item.name}
                href={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all ${
                  isActive ? 'text-white' : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                <span className="text-[9px] font-black uppercase tracking-tighter">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
