'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthGuard from './AuthGuard';
import FloatingAddButton from './FloatingAddButton';
import MobileQuickAddPanel from './MobileQuickAddPanel';

interface ActiveTripDataPortalProps {
  trip: any;
  fuelEntries: any[];
  extraPay: any[];
  inventory: any[];
}

export default function ActiveTripDataPortal({ trip, fuelEntries, extraPay, inventory }: ActiveTripDataPortalProps) {
  const [currentTrip, setCurrentTrip] = useState(trip);
  const [localFuel, setLocalFuel] = useState(fuelEntries);
  const [localExtras, setLocalExtras] = useState(extraPay);
  const [isSaving, setIsSaving] = useState(false);
  const [editingFuelId, setEditingFuelId] = useState<number | null>(null);
  const [isStatusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const pathname = usePathname();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  // Desktop navigation tabs
  const desktopNavItems = [
    { name: 'Trip Sheet', path: '/dispatch', icon: '📋' },
    { name: 'Active Trip', path: '/dispatch/active', icon: '🚛' },
    { name: 'Fuel History', path: '/dispatch/fuel-history', icon: '⛽' },
  ];

  // Fuel Form State
  const [fuelForm, setFuelForm] = useState({
    date: new Date().toISOString().split('T')[0],
    city: '',
    qty: '',
    amount: '',
    odo: '',
    unit: 'G',
    currency: 'USD'
  });

  // Extra Pay Buttons
  const extraTypes = [
    { label: 'Tarping', type: 'Tarp', amount: 50 },
    { label: 'Waiting', type: 'Waiting', amount: 25 },
    { label: 'Layover', type: 'Layover', amount: 150 },
    { label: 'Detention', type: 'Detention', amount: 50 },
    { label: 'Hand Bomb', type: 'Hand Bomb', amount: 100 },
  ];

  const handleOdometerUpdate = async (field: 'start_odometer' | 'end_odometer', value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    try {
      await fetch(`/api/dispatch/${trip.trip_number}`, {
        method: 'PATCH',
        body: JSON.stringify({ [field]: numValue }),
      });
      setCurrentTrip({ ...currentTrip, [field]: numValue });
    } catch (e) {
      console.error(e);
    }
  };

  const handleTrailerUpdate = async (value: string) => {
    try {
      await fetch(`/api/dispatch/${trip.trip_number}`, {
        method: 'PATCH',
        body: JSON.stringify({ trailer_number: value }),
      });
      setCurrentTrip({ ...currentTrip, trailer_number: value });
    } catch (e) {
      console.error(e);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    try {
      await fetch(`/api/dispatch/${trip.trip_number}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
      });
      setCurrentTrip({ ...currentTrip, status: newStatus });
    } catch (e) {
      console.error(e);
    }
  };

  const submitFuel = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const amountUsd = fuelForm.currency === 'CAD' ? parseFloat(fuelForm.amount) * 0.74 : parseFloat(fuelForm.amount);
      
      if (editingFuelId) {
        const res = await fetch('/api/dispatch/fuel', {
          method: 'PATCH',
          body: JSON.stringify({
            id: editingFuelId,
            date: fuelForm.date,
            location: fuelForm.city,
            quantity: parseFloat(fuelForm.qty),
            unit: fuelForm.unit,
            amount_usd: amountUsd,
            odometer: fuelForm.odo ? parseFloat(fuelForm.odo) : undefined
          }),
        });
        if (res.ok) {
          setLocalFuel(localFuel.map(f => f.id === editingFuelId ? {
            ...f,
            date: fuelForm.date,
            location: fuelForm.city,
            quantity: parseFloat(fuelForm.qty),
            unit: fuelForm.unit,
            amount_usd: amountUsd
          } : f));
          setEditingFuelId(null);
          setFuelForm({ ...fuelForm, city: '', qty: '', amount: '', odo: '' });
        }
      } else {
        const res = await fetch('/api/dispatch/fuel', {
          method: 'POST',
          body: JSON.stringify({
            trip_number: trip.trip_number,
            date: fuelForm.date,
            location: fuelForm.city,
            quantity: parseFloat(fuelForm.qty),
            unit: fuelForm.unit,
            amount_usd: amountUsd,
            odometer: fuelForm.odo ? parseFloat(fuelForm.odo) : undefined
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setLocalFuel([...localFuel, { 
            id: data.id, 
            date: fuelForm.date,
            location: fuelForm.city, 
            quantity: parseFloat(fuelForm.qty), 
            unit: fuelForm.unit,
            amount_usd: amountUsd,
            odometer: fuelForm.odo ? parseFloat(fuelForm.odo) : undefined
          }]);
          setFuelForm({ ...fuelForm, city: '', qty: '', amount: '', odo: '' });
          
          if (fuelForm.odo) {
              handleOdometerUpdate('end_odometer', fuelForm.odo);
          }
        } else {
          const errData = await res.json();
          alert('Failed to add fuel: ' + (errData.error || res.statusText));
        }
      }
    } finally {
      setIsSaving(false);
    }
  };

  const startEditFuel = (f: any) => {
    setEditingFuelId(f.id);
    setFuelForm({
      date: f.date,
      city: f.location,
      qty: (f.quantity || 0).toString(),
      amount: (f.amount_usd || 0).toString(),
      odo: f.odometer?.toString() || '',
      unit: f.unit || 'G',
      currency: 'USD'
    });
  };

  const toggleExtra = async (type: string, amount: number) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/dispatch/extra', {
        method: 'POST',
        body: JSON.stringify({
          trip_number: trip.trip_number,
          type,
          amount,
          quantity: 1
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLocalExtras([...localExtras, { id: data.id, type, amount, quantity: 1 }]);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AuthGuard>
    {/* Desktop Header - Show on md: and above, hidden on mobile */}
    <header className="hidden md:block max-w-7xl mx-auto mb-8 pt-8 px-4">
      <div className="flex justify-between items-end border-b border-zinc-900 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
              <span className="text-sm font-black">DM</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">Active Trip</h1>
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

    {/* Mobile Summary Bar - Show only on mobile */}
    <div className="md:hidden sticky top-0 z-50 bg-blue-600 px-4 py-3 shadow-lg flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link 
            href="/dispatch" 
            className="bg-white/20 hover:bg-white/30 p-2 rounded-xl transition-colors active:scale-90"
            title="Back to Trip Sheet"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </Link>
          <div>
            <div className="text-[10px] font-black uppercase opacity-70 leading-none">Trip Active</div>
            <div className="text-lg font-black tracking-tighter leading-none">#{trip.trip_number}</div>
          </div>
        </div>
        <div className="relative">
          <button 
            onClick={() => setStatusDropdownOpen(!isStatusDropdownOpen)}
            className="text-xs font-black uppercase bg-white/20 hover:bg-white/30 p-2 rounded-xl transition-colors active:scale-90"
          >
            {currentTrip.status}
          </button>
          {isStatusDropdownOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-zinc-800 border border-zinc-700 rounded-xl shadow-lg z-50">
              <button onClick={() => { handleStatusChange('Active'); setStatusDropdownOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Active</button>
              <button onClick={() => { handleStatusChange('Completed'); setStatusDropdownOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Completed</button>
              <button onClick={() => { handleStatusChange('Incomplete'); setStatusDropdownOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Incomplete</button>
              <button onClick={() => { handleStatusChange('Cancelled'); setStatusDropdownOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Cancelled</button>
              <button onClick={() => { handleStatusChange('Not Started'); setStatusDropdownOpen(false); }} className="block w-full text-left px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-700">Not Started</button>
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black uppercase opacity-70 leading-none">Current ODO</div>
          <div className="text-lg font-black tracking-tighter leading-none">{currentTrip.end_odometer || currentTrip.start_odometer || 0}</div>
        </div>
      </div>

      <div className="p-4 space-y-6 max-w-2xl mx-auto">
        
        {/* Odometer Update */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-xs font-black uppercase text-zinc-500 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            Odometer Update
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase ml-2 mb-1 block">Start KM</label>
              <input 
                type="number"
                defaultValue={currentTrip.start_odometer}
                onBlur={(e) => handleOdometerUpdate('start_odometer', e.target.value)}
                className="w-full bg-zinc-950 border-2 border-zinc-800 rounded-2xl py-4 px-4 text-2xl font-black text-blue-500 focus:border-blue-600 outline-none transition-all"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase ml-2 mb-1 block">End KM</label>
              <input 
                type="number"
                defaultValue={currentTrip.end_odometer}
                onBlur={(e) => handleOdometerUpdate('end_odometer', e.target.value)}
                className="w-full bg-zinc-950 border-2 border-zinc-800 rounded-2xl py-4 px-4 text-2xl font-black text-green-500 focus:border-green-600 outline-none transition-all"
              />
            </div>
          </div>
        </section>

        {/* Trailer Update */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-xs font-black uppercase text-zinc-500 mb-4">Trailer Swap</h2>
          <div className="relative">
            <input 
              type="text"
              placeholder="Trailer #"
              defaultValue={currentTrip.trailer_number}
              onBlur={(e) => handleTrailerUpdate(e.target.value)}
              className="w-full bg-zinc-950 border-2 border-zinc-800 rounded-2xl py-4 px-4 text-xl font-bold focus:border-blue-600 outline-none"
            />
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                {inventory.slice(0, 5).map(t => (
                    <button 
                        key={t.trailer_number}
                        onClick={() => handleTrailerUpdate(t.trailer_number)}
                        className="bg-zinc-800 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap active:bg-blue-600"
                    >
                        {t.trailer_number}
                    </button>
                ))}
            </div>
          </div>
        </section>

        {/* Extra Payables */}
        <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-xs font-black uppercase text-zinc-500 mb-4">Extra Payables</h2>
          <div className="grid grid-cols-2 gap-2">
            {extraTypes.map(extra => (
              <button
                key={extra.type}
                onClick={() => toggleExtra(extra.type, extra.amount)}
                className="bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 py-4 rounded-2xl text-center transition-all active:scale-95 group"
              >
                <div className="text-xs font-bold uppercase text-zinc-400 group-active:text-blue-400">{extra.label}</div>
                <div className="text-lg font-black">${extra.amount}</div>
              </button>
            ))}
          </div>
          {localExtras.length > 0 && (
            <div className="mt-4 pt-4 border-t border-zinc-800 space-y-2">
              {localExtras.map((e, idx) => (
                <div key={idx} className="flex justify-between items-center bg-zinc-950/50 p-3 rounded-xl border border-zinc-800/50">
                  <span className="text-xs font-bold uppercase">{e.type}</span>
                  <span className="font-black text-blue-500">${e.amount}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Fuel Entry */}
        <section id="fuel-section" className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-5">
          <h2 className="text-xs font-black uppercase text-zinc-500 mb-4 flex justify-between items-center">
            <span>{editingFuelId ? 'Edit Fuel Entry' : 'Fuel Entry'}</span>
            {editingFuelId && (
              <button 
                onClick={() => {
                  setEditingFuelId(null);
                  setFuelForm({ ...fuelForm, city: '', qty: '', amount: '', odo: '' });
                }}
                className="text-[10px] text-red-500"
              >Cancel</button>
            )}
          </h2>
          <form onSubmit={submitFuel} className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <input 
                type="date"
                value={fuelForm.date}
                onChange={e => setFuelForm({...fuelForm, date: e.target.value})}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm font-bold outline-none focus:border-blue-500 [color-scheme:dark]"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input 
                placeholder="City/Loc"
                value={fuelForm.city}
                onChange={e => setFuelForm({...fuelForm, city: e.target.value})}
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm font-bold outline-none focus:border-blue-500"
                required
              />
              <input 
                type="number"
                step="0.01"
                placeholder="Qty"
                value={fuelForm.qty}
                onChange={e => setFuelForm({...fuelForm, qty: e.target.value})}
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm font-bold outline-none focus:border-blue-500"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input 
                type="number"
                step="0.01"
                placeholder="Amount"
                value={fuelForm.amount}
                onChange={e => setFuelForm({...fuelForm, amount: e.target.value})}
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm font-bold outline-none focus:border-blue-500"
                required
              />
              <input 
                type="number"
                placeholder="ODO at Fuel"
                value={fuelForm.odo}
                onChange={e => setFuelForm({...fuelForm, odo: e.target.value})}
                className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm font-bold outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
                <button 
                  type="button" 
                  onClick={() => setFuelForm({...fuelForm, unit: 'G'})}
                  className={`flex-1 py-3 text-[10px] font-black ${fuelForm.unit === 'G' ? 'bg-blue-600 text-white' : 'text-zinc-500'}`}
                >GAL</button>
                <button 
                  type="button" 
                  onClick={() => setFuelForm({...fuelForm, unit: 'L'})}
                  className={`flex-1 py-3 text-[10px] font-black ${fuelForm.unit === 'L' ? 'bg-blue-600 text-white' : 'text-zinc-500'}`}
                >LTR</button>
              </div>
              <div className="flex bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden">
                <button 
                  type="button" 
                  onClick={() => setFuelForm({...fuelForm, currency: 'USD'})}
                  className={`flex-1 py-3 text-[10px] font-black ${fuelForm.currency === 'USD' ? 'bg-green-600 text-white' : 'text-zinc-500'}`}
                >USD</button>
                <button 
                  type="button" 
                  onClick={() => setFuelForm({...fuelForm, currency: 'CAD'})}
                  className={`flex-1 py-3 text-[10px] font-black ${fuelForm.currency === 'CAD' ? 'bg-green-600 text-white' : 'text-zinc-500'}`}
                >CAD</button>
              </div>
            </div>
            <button 
              type="submit"
              disabled={isSaving}
              className={`w-full font-black uppercase py-4 rounded-2xl active:scale-95 transition-all disabled:opacity-50 ${editingFuelId ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-black'}`}
            >
              {isSaving ? 'Saving...' : editingFuelId ? 'Update Fuel Entry' : 'Add Fuel Entry'}
            </button>
          </form>

          {localFuel.length > 0 && (
            <div className="mt-4 space-y-2">
              {localFuel.map((f, idx) => (
                <div key={idx} className="flex justify-between items-center text-[10px] font-bold text-zinc-500 bg-zinc-950/30 p-2 rounded-lg group">
                  <div className="flex flex-col">
                    <span>{f.date} | {f.location} - {f.quantity}{f.unit}</span>
                    <span className="text-zinc-300">${f.amount_usd?.toFixed(2)} USD</span>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => {
                        startEditFuel(f);
                        document.getElementById('fuel-section')?.scrollIntoView({ behavior: 'smooth' });
                      }}
                      className="p-1 text-blue-500 hover:text-blue-400"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                    <button 
                      onClick={() => {
                        if (confirm('Delete?')) {
                          fetch('/api/dispatch/fuel', {
                            method: 'DELETE',
                            body: JSON.stringify({ id: f.id })
                          }).then(res => res.ok && setLocalFuel(localFuel.filter(fuel => fuel.id !== f.id)));
                        }
                      }}
                      className="p-1 text-red-500 hover:text-red-400"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Navigation to Full Details */}
        <Link 
            href={`/dispatch/${trip.trip_number}`}
            className="block w-full bg-zinc-900 border border-zinc-800 text-zinc-500 font-bold text-center py-4 rounded-2xl"
        >
            View Full Trip Details
        </Link>

      {/* Quick Add Button - Show on both mobile and desktop */}
      <FloatingAddButton onClick={() => setIsQuickAddOpen(true)} />
      <MobileQuickAddPanel 
        trips={[{ trip_number: trip.trip_number, status: trip.status }]} 
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />

      </div>
    </AuthGuard>
  );
}