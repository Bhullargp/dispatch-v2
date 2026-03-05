'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth';
import AuthGuard from '../AuthGuard';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface PayRate {
  name: string;
  rate: number;
  unit: string;
}

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const pathname = usePathname();
  const [rates, setRates] = useState<PayRate[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const desktopNavItems = [
    { name: 'Trip Sheet', path: '/dispatch', icon: '📋' },
    { name: 'Active Trip', path: '/dispatch/active', icon: '🚛' },
    { name: 'Fuel History', path: '/dispatch/fuel-history', icon: '⛽' },
    { name: 'Pay Rates', path: '/dispatch/settings', icon: '💰' },
  ];

  const fetchRates = async () => {
    try {
      const res = await fetch('/api/dispatch/rates');
      const data = await res.json();
      setRates(data);
    } catch (e) {
      console.error('Failed to fetch rates:', e);
    }
  };

  useEffect(() => {
    setMounted(true);
    fetchRates();
  }, []);

  useEffect(() => {
    if (mounted && isLoggedIn === false) {
      router.push('/dispatch/login');
    }
  }, [mounted, isLoggedIn, router]);

  const handleRateChange = (index: number, field: keyof PayRate, value: string | number) => {
    const newRates = [...rates];
    if (field === 'rate') {
      newRates[index].rate = parseFloat(value as string) || 0;
    } else if (field === 'unit') {
      newRates[index].unit = value as string;
    }
    setRates(newRates);
    setSaved(false);
  };

  const saveRates = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/dispatch/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      console.error('Failed to save rates:', e);
    }
    setSaving(false);
  };

  if (!mounted || isLoggedIn === null) {
    return <div className="min-h-screen bg-[#050505]" />;
  }

  if (isLoggedIn === false) {
    return null;
  }

  return (
    <AuthGuard>
      {/* Desktop Header */}
      <header className="hidden md:block max-w-7xl mx-auto mb-8 pt-8 px-4">
        <div className="flex justify-between items-end border-b border-zinc-900 pb-6">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
                <span className="text-sm font-black">DM</span>
              </div>
              <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">Pay Rates</h1>
            </div>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] ml-11">Configuration</p>
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
        </div>
      </header>

      {/* Mobile Header */}
      <header className="md:hidden p-4 border-b border-zinc-900 flex justify-between items-center bg-black/50 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <Link href="/dispatch" className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
            <span className="text-zinc-400">←</span>
          </Link>
          <h1 className="text-xl font-black uppercase tracking-tighter">Pay Rates</h1>
        </div>
      </header>

      <main className="p-4 md:p-8 max-w-4xl mx-auto">
        {/* Rates Card */}
        <div className="bg-zinc-900/40 border border-zinc-800 rounded-[2.5rem] p-6 md:p-10">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-lg md:text-xl font-black uppercase tracking-tight">Default Pay Rates</h2>
              <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mt-1">Per-unit compensation rates</p>
            </div>
            <button
              onClick={saveRates}
              disabled={saving}
              className={`px-6 py-3 rounded-xl font-black uppercase text-xs tracking-wider transition-all ${
                saved 
                  ? 'bg-green-600 text-white' 
                  : saving 
                    ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-500 shadow-[0_0_20px_rgba(37,99,235,0.3)]'
              }`}
            >
              {saving ? 'Saving...' : saved ? '✓ Saved' : 'Save Changes'}
            </button>
          </div>

          {/* Rates Table */}
          <div className="space-y-3">
            {/* Header */}
            <div className="hidden md:grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-500">
              <div className="col-span-5">Rate Name</div>
              <div className="col-span-3">Rate ($)</div>
              <div className="col-span-4">Unit Type</div>
            </div>

            {rates.map((rate, index) => (
              <div 
                key={rate.name} 
                className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-4 items-center bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 md:p-0 md:py-4 md:px-4"
              >
                {/* Rate Name */}
                <div className="col-span-5">
                  <label className="md:hidden text-[8px] font-black uppercase text-zinc-500 mb-1 block">Rate Name</label>
                  <p className="text-sm font-black tracking-tight">{rate.name}</p>
                </div>

                {/* Rate Input */}
                <div className="col-span-3">
                  <label className="md:hidden text-[8px] font-black uppercase text-zinc-500 mb-1 block">Rate ($)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 font-black text-sm">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={rate.rate}
                      onChange={(e) => handleRateChange(index, 'rate', e.target.value)}
                      className="w-full bg-black border border-zinc-800 rounded-xl px-6 py-2 text-sm font-black outline-none focus:border-blue-500 transition-all"
                    />
                  </div>
                </div>

                {/* Unit Type */}
                <div className="col-span-4">
                  <label className="md:hidden text-[8px] font-black uppercase text-zinc-500 mb-1 block">Unit Type</label>
                  <select
                    value={rate.unit}
                    onChange={(e) => handleRateChange(index, 'unit', e.target.value)}
                    className="w-full bg-black border border-zinc-800 rounded-xl px-3 py-2 text-sm font-black outline-none focus:border-blue-500 transition-all text-zinc-300"
                  >
                    <option value="qty">Per Unit (qty)</option>
                    <option value="hour">Per Hour</option>
                    <option value="dollar">Per Dollar</option>
                    <option value="mile">Per Mile</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          {rates.length === 0 && (
            <div className="text-center py-12 border-2 border-dashed border-zinc-800 rounded-2xl">
              <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">No rates configured</p>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="mt-6 bg-blue-900/20 border border-blue-800/30 rounded-2xl p-4">
          <p className="text-zinc-400 text-xs font-medium">
            💡 <span className="font-black uppercase">Tip:</span> These rates are used as defaults when adding extra pay to trips. 
            Individual trip extras can override these rates.
          </p>
        </div>
      </main>
    </AuthGuard>
  );
}
