'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useIsMobile } from '../../hooks/useIsMobile';
import { usePathname } from 'next/navigation';
import AuthGuard from '../AuthGuard';
import FloatingAddButton from '../FloatingAddButton';
import MobileQuickAddPanel from '../MobileQuickAddPanel';

export default function FuelHistoryClient({ initialFuel, trips }: { initialFuel: any[], trips: any[] }) {
  const [fuel, setFuel] = useState(initialFuel);
  const [filter, setFilter] = useState('ALL'); // ALL, UNLINKED, LINKED
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Desktop navigation tabs
  const desktopNavItems = [
    { name: 'Trip Sheet', path: '/dispatch', icon: '📋' },
    { name: 'Active Trip', path: '/dispatch/active', icon: '🚛' },
    { name: 'Fuel History', path: '/dispatch/fuel-history', icon: '⛽' },
  ];

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredFuel = fuel.filter(f => {
    if (filter === 'UNLINKED') return f.trip_number === 'UNLINKED' || !f.trip_number;
    if (filter === 'LINKED') return f.trip_number && f.trip_number !== 'UNLINKED';
    return true;
  });

  const attachToTrip = async (fuelId: number, tripNumber: string) => {
    try {
      const res = await fetch('/api/dispatch/fuel', {
        method: 'PATCH',
        body: JSON.stringify({ id: fuelId, trip_number: tripNumber })
      });
      if (res.ok) {
        setFuel(fuel.map(f => f.id === fuelId ? { ...f, trip_number: tripNumber } : f));
      }
    } catch (e) {
      alert('Failed to attach trip');
    }
  };

  const deleteFuel = async (id: number) => {
    if (!confirm('Delete fuel entry?')) return;
    try {
      const res = await fetch('/api/dispatch/fuel', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });
      if (res.ok) {
        setFuel(fuel.filter(f => f.id !== id));
      }
    } catch (e) {
      alert('Delete failed');
    }
  };

  if (!mounted) return <div className="min-h-screen bg-[#050505]" />;

  return (
    <AuthGuard>
    {/* Desktop Header - Show on md: and above */}
    <header className="hidden md:block max-w-7xl mx-auto mb-8 pt-8 px-4">
      <div className="flex justify-between items-end border-b border-zinc-900 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
              <span className="text-sm font-black">DM</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">Fuel History</h1>
          </div>
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] ml-11">Fleet Logistics Command</p>
        </div>
        
        {/* Desktop Navigation Tabs */}
        <nav className="flex items-center gap-1 bg-zinc-900/50 rounded-2xl p-1.5 border border-zinc-800/50">
          {desktopNavItems.map((item) => (
            <Link 
              key={item.path} 
              href={item.path}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wider transition-all ${
                pathname === item.path 
                  ? 'bg-blue-600 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]' 
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>
        
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[10px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-zinc-800 px-6 py-3 rounded-xl border border-zinc-800 transition-all shadow-xl">
            ← Dashboard
          </Link>
        </div>
      </div>
    </header>

    {/* Mobile Header - Show only on mobile */}
    <header className="md:hidden p-4 border-b border-zinc-900 flex justify-between items-center bg-black/50 sticky top-0 z-40 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <Link href="/dispatch" className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
          <span className="text-zinc-400">←</span>
        </Link>
        <h1 className="text-xl font-black uppercase tracking-tighter">Fuel History</h1>
      </div>
      <div className="flex bg-zinc-900 rounded-xl p-1 border border-zinc-800">
        {['ALL', 'UNLINKED', 'LINKED'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${filter === f ? 'bg-blue-600 text-white' : 'text-zinc-500'}`}
          >
            {f}
          </button>
        ))}
      </div>
      </header>

      <main className="p-4 md:p-8 max-w-5xl mx-auto space-y-4">
        {filteredFuel.map(f => (
          <div key={f.id} className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4 md:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 group">
            <div className="flex items-center gap-4">
              <div className="bg-black/40 p-3 rounded-xl border border-zinc-800 text-center min-w-[80px]">
                <p className="text-[8px] font-black text-zinc-600 uppercase mb-1">Date</p>
                <p className="text-xs font-bold">{f.date}</p>
              </div>
              <div>
                <h3 className="text-sm md:text-lg font-black tracking-tight">{f.location}</h3>
                <p className="text-[10px] font-mono text-zinc-500">
                  {f.quantity} {f.unit} • ${f.amount_usd?.toFixed(2)} USD
                  {f.odometer && ` • ODO: ${f.odometer}`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 md:flex-none">
                <p className="text-[8px] font-black text-zinc-600 uppercase mb-1 ml-1">Assigned Trip</p>
                <select
                  value={f.trip_number || 'UNLINKED'}
                  onChange={(e) => attachToTrip(f.id, e.target.value)}
                  className={`w-full md:w-48 bg-black border rounded-xl px-3 py-2 text-xs font-black outline-none transition-all ${
                    f.trip_number === 'UNLINKED' || !f.trip_number 
                      ? 'border-orange-500/50 text-orange-500 bg-orange-500/5' 
                      : 'border-zinc-800 text-blue-500'
                  }`}
                >
                  <option value="UNLINKED">⚠️ UNLINKED</option>
                  {trips.map(t => (
                    <option key={t.trip_number} value={t.trip_number}>
                      #{t.trip_number} ({t.status})
                    </option>
                  ))}
                </select>
              </div>
              
              <div className="flex items-center gap-2 self-end">
                {f.trip_number && f.trip_number !== 'UNLINKED' && (
                  <Link 
                    href={`/dispatch/${f.trip_number}`}
                    className="p-2 bg-zinc-800 text-zinc-400 rounded-xl hover:text-white border border-zinc-700"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </Link>
                )}
                <button 
                  onClick={() => deleteFuel(f.id)}
                  className="p-2 bg-zinc-900 text-red-500/50 hover:text-red-500 rounded-xl border border-zinc-800 hover:border-red-500/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>
          </div>
        ))}

        {filteredFuel.length === 0 && (
          <div className="text-center py-20 border-2 border-dashed border-zinc-900 rounded-[2rem]">
            <p className="text-zinc-600 font-black uppercase tracking-widest text-xs">No entries found matching filter</p>
          </div>
        )}
      </main>

      {/* Quick Add Button - Show on both mobile and desktop */}
      <FloatingAddButton onClick={() => setIsQuickAddOpen(true)} />
      <MobileQuickAddPanel 
        trips={trips.filter((t: any) => t.status === 'Active' || t.status === 'Not Started')} 
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />
    </AuthGuard>
  );
}
