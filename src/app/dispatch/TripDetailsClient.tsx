'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

const PAYABLE_TYPES = [
  { name: 'Trailer Switch', rate: 30, unit: 'qty' },
  { name: 'Extra Delivery', rate: 75, unit: 'qty' },
  { name: 'Extra Pickup', rate: 75, unit: 'qty' },
  { name: 'Self Delivery', rate: 75, unit: 'qty' },
  { name: 'Self Pickup', rate: 75, unit: 'qty' },
  { name: 'Tarping', rate: 75, unit: 'qty' },
  { name: 'Untarping', rate: 25, unit: 'qty' },
  { name: 'Tolls', rate: 1, unit: 'dollar' },
  { name: 'Waiting Time', rate: 30, unit: 'hour', increments: 0.25, max: 6, freeLimit: 3 },
  { name: 'City Work', rate: 39, unit: 'hour', increments: 0.25, max: 14 },
  { name: 'Trailer Drop', rate: 30, unit: 'qty' },
  { name: 'Layover', rate: 100, unit: 'hour', increments: 0.5 }
];

export default function TripDetailsClient({ trip, stops, extraPay, inventory }: { trip: any, stops: any[], extraPay: any[], inventory: any[] }) {
  const [currentTrip, setCurrentTrip] = useState(trip);
  const [currentStops, setCurrentStops] = useState(stops);
  const [currentExtras, setCurrentExtras] = useState(extraPay);
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [showPayBreakdown, setShowPayBreakdown] = useState(false);
  const [activeEquipmentField, setActiveEquipmentField] = useState<string | null>(null);
  const [extraMinutes, setExtraMinutes] = useState<{[key: string]: number}>({});
  const [showAddHUD, setShowAddHUD] = useState(false);
  const [showAllPayables, setShowAllPayables] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [addingStop, setAddingStop] = useState(false);
  const [deletingStopId, setDeletingStopId] = useState<number | null>(null);
  const [addingFuel, setAddingFuel] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const formatDateDisplay = (dateStr: string | null) => {
    if (!dateStr) return '---';
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
      return dateStr;
    } catch { return dateStr; }
  };

  const updateField = async (field: string, value: any) => {
    setIsSaving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Save failed');
      }
      setCurrentTrip({ ...currentTrip, [field]: value });
    } catch (err: any) {
      setActionError(err?.message || 'Save failed');
    } finally { setIsSaving(false); }
  };

  const deleteStop = async (stopId: number, index: number) => {
    if (!confirm('Delete this stop?')) return;
    setActionError(null);
    setDeletingStopId(stopId);
    try {
      const res = await fetch(`/api/dispatch/${currentTrip.trip_number}/stop?stopId=${stopId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Delete failed');
      }
      const newStops = currentStops.filter((_: any, i: number) => i !== index);
      setCurrentStops(newStops);
      setActionSuccess('Stop deleted');
    } catch (err: any) {
      setActionError(err?.message || 'Delete failed');
    } finally {
      setDeletingStopId(null);
    }
  };

  const updatePayableQty = async (typeName: string, delta: number) => {
    const existing = currentExtras.filter(e => e.type === typeName);
    const payable = PAYABLE_TYPES.find(p => p.name === typeName);
    
    let nextExtras = [...currentExtras];
    if (delta > 0) {
      const newItem = { type: typeName, amount: payable?.rate || 0, quantity: 1 };
      nextExtras = [...currentExtras, newItem];
    } else if (delta < 0 && existing.length > 0) {
      const index = currentExtras.findLastIndex(e => e.type === typeName);
      nextExtras.splice(index, 1);
    }

    setCurrentExtras(nextExtras);

    // Auto-save to backend
    try {
      await fetch('/api/dispatch/extra', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trip_number: currentTrip.trip_number,
          extras: nextExtras
        })
      });
    } catch (err) {
      console.error('Failed to save payables:', err);
    }
  };

  const calculatePayableTotal = (payable: any) => {
    if (!currentExtras) return "0.00";
    const qty = currentExtras.filter(e => e.type === payable.name).length;
    const mins = extraMinutes[payable.name] || 0;
    if (payable.unit === 'hour') {
        const totalHours = qty + (mins / 60);
        return (totalHours * payable.rate).toFixed(2);
    }
    return (qty * payable.rate).toFixed(2);
  };

  const paySummary = useMemo(() => {
    if (!currentTrip || !currentExtras) return { milePay: 0, items: [], grandTotal: 0 };
    
    // Bhullar Protocol Pay Rates:
    // - US trips: $1.06/mile
    // - Canada trips under 1000 miles: $1.26/mile
    // - Canada trips over 1000 miles: $1.16/mile
    const miles = currentTrip.total_miles || 0;
    const route = (currentTrip.route || '').toUpperCase();
    
    let ratePerMile = 1.06; // Default US rate
    
    // If route says US, use US rate immediately
    if (route === 'US') {
      ratePerMile = 1.06;
    }
    // Check for Canada provinces in route
    else if (route.includes('CANADA') || route.includes('QC') || route.includes('ON') || route.includes('BC') || route.includes('AB') || route.includes('MB') || route.includes('SK')) {
      // Canada rate
      if (miles < 1000) {
        ratePerMile = 1.26;
      } else {
        ratePerMile = 1.16;
      }
    }
    
    const milePay = miles * ratePerMile;
    const items = PAYABLE_TYPES.map(p => ({
        name: p.name,
        total: parseFloat(calculatePayableTotal(p))
    })).filter(i => i.total > 0);
    
    const extrasTotal = items.reduce((acc, curr) => acc + curr.total, 0);
    const grandTotal = milePay + extrasTotal;

    return {
        milePay,
        items,
        grandTotal
    };
  }, [currentTrip?.total_miles, currentExtras, extraMinutes]);

  const openInventory = (field: string) => {
    setActiveEquipmentField(field);
    setShowEquipmentModal(true);
  };

  const selectTrailer = (num: string) => {
    if (activeEquipmentField) {
      updateField(activeEquipmentField, num);
      setShowEquipmentModal(false);
      setActiveEquipmentField(null);
    }
  };

  if (!mounted) return <div className="min-h-screen bg-black" />;

  if (!currentTrip || !currentStops || !currentExtras) {
    return <div className="min-h-screen bg-[#050505] text-blue-500 font-mono p-10">Initializing Trip Data...</div>;
  }

  const startOdo = currentTrip.start_odometer;
  const endOdo = currentTrip.end_odometer;
  const totalKilos = (startOdo !== null && endOdo !== null) ? (endOdo - startOdo) : null;
  const isMileageIncomplete = !currentStops[currentStops.length - 1]?.location?.includes('Caledon, ON');

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 p-4 md:p-8 font-sans selection:bg-blue-500/30">
      <header className="max-w-6xl mx-auto mb-10 flex items-center justify-between border-b border-zinc-900 pb-8">
        <div className="flex items-center gap-6">
          <button onClick={() => setShowAddHUD(!showAddHUD)} className="bg-blue-600 hover:bg-blue-500 p-3 rounded-2xl border border-blue-500 transition-all shadow-lg shadow-blue-600/20">
            <span className="text-white font-black text-lg">⚡</span>
          </button>
          <Link href="/dispatch" className="bg-zinc-900 p-3 rounded-2xl hover:bg-zinc-800 border border-zinc-800 transition-all shadow-lg">
            <span className="text-zinc-400">←</span>
          </Link>
          <div>
            <h1 className="text-4xl font-black font-mono tracking-tighter">{currentTrip.trip_number}</h1>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  currentTrip.status === 'Active' ? 'bg-blue-500 animate-pulse' : 
                  currentTrip.status === 'Completed' ? 'bg-green-500' : 
                  currentTrip.status === 'Not Started' ? 'bg-yellow-500' : 
                  currentTrip.status === 'Incomplete' ? 'bg-red-500' : 
                  currentTrip.status === 'Cancelled' ? 'bg-orange-500' : 
                  'bg-zinc-500'}`} />
                <span className="text-[10px] font-bold uppercase text-zinc-500 tracking-widest">{currentTrip.status}</span>
              </div>
              <select 
                value={currentTrip.status || 'Active'} 
                onChange={(e) => updateField('status', e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[10px] font-black uppercase text-zinc-400 outline-none focus:border-blue-500 transition-all cursor-pointer"
              >
                <option value="Active">Active</option>
                <option value="Completed">Completed</option>
                <option value="Not Started">Not Started</option>
                <option value="Incomplete">Incomplete</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Unknown">Unknown</option>
              </select>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
            <button 
                onClick={() => setShowPayBreakdown(true)}
                className="bg-zinc-900/50 border border-blue-600/30 px-6 py-3 rounded-2xl text-right hover:border-blue-500 transition-all group"
            >
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1 group-hover:text-blue-400">Estimated Total Pay ⓘ</p>
                <p className="text-2xl font-black text-blue-500 font-mono tracking-tighter">{paySummary.grandTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
            </button>
            <a 
              href={currentTrip.pdf_path || '#'}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { if (!currentTrip.pdf_path) e.preventDefault(); }}
              className="bg-zinc-900 hover:bg-zinc-800 text-[10px] font-black uppercase px-6 py-3 rounded-xl border border-zinc-800 transition-all flex items-center gap-2 h-full"
            >
              📄 View PDF
            </a>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8 pb-20">
        {(isSaving || actionError || actionSuccess) && (
          <div className="text-xs font-bold rounded-xl border px-4 py-3 bg-zinc-900/50 border-zinc-800">
            {isSaving && <p className="text-blue-400">Saving changes…</p>}
            {!isSaving && actionError && <p className="text-red-400">{actionError}</p>}
            {!isSaving && !actionError && actionSuccess && <p className="text-green-400">{actionSuccess}</p>}
          </div>
        )}
        
        {/* OVERVIEW - Mobile View */}
        <section className="md:hidden bg-zinc-900/30 border border-zinc-800 rounded-[2.5rem] p-8 md:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-600 shadow-[2px_0_10px_rgba(37,99,235,0.4)]"></div>
          <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-10">Trip Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 text-center md:text-left">
            <div className="group relative bg-black/20 p-4 rounded-3xl border border-zinc-900 transition-all hover:border-zinc-800">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">Start Date</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-lg font-black font-mono">{formatDateDisplay(currentTrip.start_date)}</p>
                <button className="text-blue-500 text-xs">✎</button>
              </div>
              <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('start_date', e.target.value)} />
            </div>
            <div className="group relative bg-black/20 p-4 rounded-3xl border border-zinc-900 transition-all hover:border-zinc-800">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">End Date</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-lg font-black font-mono">{formatDateDisplay(currentTrip.end_date)}</p>
                <button className="text-blue-500 text-xs">✎</button>
              </div>
              <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('end_date', e.target.value)} />
            </div>
            <div className="bg-black/20 p-4 rounded-3xl border border-zinc-900">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">PDF Miles</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-2xl font-black font-mono text-zinc-300">{currentTrip.total_miles || 0}</p>
                <button onClick={() => { const m = prompt('Miles:', currentTrip.total_miles); if (m) updateField('total_miles', parseFloat(m)); }} className="text-blue-500 text-xs">✎</button>
              </div>
              {isMileageIncomplete && <p className="text-[8px] text-orange-600 font-black uppercase mt-1 tracking-widest animate-pulse">⚠️ Incomplete</p>}
            </div>
            <div className="flex flex-col justify-center space-y-3">
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Start KMs</label>
                    <input type="number" defaultValue={currentTrip.start_odometer} onBlur={(e) => updateField('start_odometer', parseFloat(e.target.value))} className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono font-black focus:border-blue-500 outline-none transition-all" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">End KMs</label>
                    <input type="number" defaultValue={currentTrip.end_odometer} onBlur={(e) => updateField('end_odometer', parseFloat(e.target.value))} className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono font-black focus:border-blue-500 outline-none transition-all" />
                 </div>
              </div>
              {totalKilos !== null && <p className="text-[11px] font-black text-green-500 font-mono text-center uppercase tracking-widest bg-green-500/5 py-2 rounded-xl border border-green-500/10">{totalKilos.toLocaleString()} Total Kilos</p>}
            </div>
          </div>
        </section>

        {/* OVERVIEW - Desktop Futuristic View */}
        <section className="hidden md:block bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 border border-zinc-800/80 rounded-[2.5rem] p-6 shadow-2xl relative overflow-hidden">
          {/* Futuristic background elements */}
          <div className="absolute top-0 left-0 w-px h-full bg-gradient-to-b from-transparent via-blue-500/50 to-transparent"></div>
          <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-green-500/30 to-transparent"></div>
          <div className="absolute top-4 right-4 w-20 h-20 bg-blue-500/5 rounded-full blur-2xl"></div>
          <div className="absolute bottom-4 left-4 w-32 h-32 bg-green-500/5 rounded-full blur-3xl"></div>
          
          <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-8">Trip Overview</h2>
          
          <div className="grid grid-cols-12 gap-6">
            {/* Left: Start Date & End Date */}
            <div className="col-span-3 flex flex-col gap-4">
              <div className="group relative bg-black/40 p-5 rounded-2xl border border-zinc-800/60 hover:border-blue-500/40 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Start Date</label>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xl font-black font-mono text-zinc-200">{formatDateDisplay(currentTrip.start_date)}</p>
                  <button className="text-blue-500 text-xs hover:text-blue-400 transition-colors">✎</button>
                </div>
                <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('start_date', e.target.value)} />
              </div>
              
              <div className="group relative bg-black/40 p-5 rounded-2xl border border-zinc-800/60 hover:border-blue-500/40 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]"></div>
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">End Date</label>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xl font-black font-mono text-zinc-200">{formatDateDisplay(currentTrip.end_date)}</p>
                  <button className="text-blue-500 text-xs hover:text-blue-400 transition-colors">✎</button>
                </div>
                <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('end_date', e.target.value)} />
              </div>
            </div>
            
            {/* Middle: PDF Miles - Prominently Displayed */}
            <div className="col-span-5">
              <div className="bg-gradient-to-br from-blue-950/30 to-transparent p-6 rounded-2xl border border-blue-500/20 h-full flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,1)] animate-pulse"></div>
                  <label className="text-[10px] font-black text-blue-400 uppercase tracking-widest">PDF Miles</label>
                </div>
                <div className="flex items-end justify-between">
                  <p className="text-5xl font-black font-mono text-blue-500 tracking-tighter drop-shadow-[0_0_20px_rgba(59,130,246,0.5)]">{currentTrip.total_miles || 0}</p>
                  <button 
                    onClick={() => { const m = prompt('Miles:', currentTrip.total_miles); if (m) updateField('total_miles', parseFloat(m)); }} 
                    className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-xs font-black uppercase px-4 py-2 rounded-xl border border-blue-500/30 transition-all mb-2"
                  >
                    Edit
                  </button>
                </div>
                {isMileageIncomplete && (
                  <p className="text-[9px] text-orange-500 font-black uppercase mt-3 tracking-widest bg-orange-500/10 py-2 px-3 rounded-lg border border-orange-500/20 animate-pulse">
                    ⚠️ Mileage Incomplete
                  </p>
                )}
              </div>
            </div>
            
            {/* Right: Odometers & Total Distance */}
            <div className="col-span-4 flex flex-col gap-3">
              <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/60">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]"></div>
                  <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Start Odometer</label>
                </div>
                <input 
                  type="number" 
                  defaultValue={currentTrip.start_odometer} 
                  onBlur={(e) => updateField('start_odometer', parseFloat(e.target.value))} 
                  className="w-full bg-transparent border-b border-zinc-700 pb-2 text-2xl font-mono font-black text-green-400 focus:border-green-500 outline-none transition-all placeholder-zinc-700" 
                  placeholder="---"
                />
              </div>
              
              <div className="bg-black/40 p-4 rounded-2xl border border-zinc-800/60">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-1 h-1 rounded-full bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]"></div>
                  <label className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">End Odometer</label>
                </div>
                <input 
                  type="number" 
                  defaultValue={currentTrip.end_odometer} 
                  onBlur={(e) => updateField('end_odometer', parseFloat(e.target.value))} 
                  className="w-full bg-transparent border-b border-zinc-700 pb-2 text-2xl font-mono font-black text-green-400 focus:border-green-500 outline-none transition-all placeholder-zinc-700" 
                  placeholder="---"
                />
              </div>
              
              {totalKilos !== null && (
                <div className="bg-gradient-to-r from-green-950/40 to-transparent p-4 rounded-2xl border border-green-500/30 mt-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,1)]"></div>
                      <label className="text-[9px] font-black text-green-400 uppercase tracking-widest">Total Distance</label>
                    </div>
                    <p className="text-2xl font-black font-mono text-green-500 tracking-tight drop-shadow-[0_0_10px_rgba(34,197,94,0.5)]">{totalKilos.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 space-y-8">
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 group">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Equipment Used</h2>
                <button onClick={() => openInventory('trailer_2')} className="bg-zinc-900 hover:bg-zinc-800 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-zinc-800 transition-all">+ Add Equipment</button>
              </div>
              <div className="flex flex-wrap gap-4">
                {[
                  { id: 'truck', label: 'Truck', val: currentTrip.truck || currentTrip.truck_number },
                  { id: 'trailer', label: 'Trailer 1', val: currentTrip.trailer || currentTrip.trailer_number },
                  { id: 'trailer_2', label: 'Trailer 2', val: currentTrip.trailer_2 }
                ].filter(i => i.val && i.val !== 'None').map((item) => (
                  <div key={item.id} className="bg-black/20 border border-zinc-800/50 p-5 rounded-2xl relative group/item min-w-[150px]">
                    <label className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest block mb-2">{item.label}</label>
                    <div className="flex items-center justify-between">
                        <p className="text-lg font-black font-mono">{item.val}</p> 
                        <button onClick={() => openInventory(item.id)} className="bg-zinc-900 p-1.5 rounded-lg text-blue-500 text-[10px] hover:bg-blue-600 hover:text-white transition-all">✎ Edit</button>
                    </div>
                    <button onClick={() => updateField(item.id, null)} className="absolute -top-2 -right-2 bg-red-900 hover:bg-red-600 text-white w-7 h-7 rounded-full text-[12px] font-bold opacity-0 group-item:opacity-100 transition-all flex items-center justify-center shadow-xl">×</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 group">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Payables & Extras</h2>
                <button 
                  onClick={() => setShowAllPayables(!showAllPayables)} 
                  className="bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-blue-500/30 transition-all"
                >
                  {showAllPayables ? 'Show Active Only' : '+ Add Extras'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {PAYABLE_TYPES.filter(p => {
                  const qty = currentExtras.filter(e => e.type === p.name).length;
                  return showAllPayables || qty > 0;
                }).map(payable => {
                  const qty = currentExtras.filter(e => e.type === payable.name).length;
                  const total = calculatePayableTotal(payable);
                  const isZero = parseFloat(total) === 0;
                  return (
                    <div key={payable.name} className="flex flex-col bg-black/20 p-5 rounded-2xl border border-zinc-800/50 hover:border-zinc-700 transition-all shadow-lg group/item">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-[11px] font-black uppercase tracking-tight text-zinc-400">{payable.name}</span>
                        <div className={`${isZero ? 'bg-zinc-500/10' : 'bg-green-500/10'} px-2 py-1 rounded-lg border ${isZero ? 'border-zinc-500/20' : 'border-green-500/20'}`}>
                           <span className={`text-sm font-mono font-black ${isZero ? 'text-zinc-500' : 'text-green-500'}`}>${total}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                         <div className="flex items-center gap-1.5">
                            <button onClick={() => updatePayableQty(payable.name, -1)} className="w-9 h-9 bg-zinc-800 hover:bg-red-900 rounded-xl flex items-center justify-center text-sm transition-all font-black border border-zinc-700">-</button>
                            <span className="text-sm font-mono font-black w-10 text-center">{qty}</span>
                            <button onClick={() => updatePayableQty(payable.name, 1)} className="w-9 h-9 bg-zinc-800 hover:bg-blue-600 rounded-xl flex items-center justify-center text-sm transition-all font-black border border-zinc-700">+</button>
                         </div>
                         {payable.unit === 'hour' && (
                            <select onChange={(e) => setExtraMinutes(p => ({...p, [payable.name]: parseInt(e.target.value)}))} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-[10px] font-black uppercase text-zinc-300 focus:border-blue-500 outline-none shadow-inner">
                               <option value="0">00m</option><option value="15">15m</option><option value="30">30m</option><option value="45">45m</option>
                            </select>
                         )}
                         {payable.unit === 'dollar' && (
                            <input 
                              type="number" 
                              placeholder="$" 
                              defaultValue={currentExtras.find(e => e.type === payable.name)?.amount || ''}
                              onBlur={async (e) => {
                                const val = parseFloat(e.target.value) || 0;
                                const otherExtras = currentExtras.filter(ex => ex.type !== payable.name);
                                const nextExtras = [...otherExtras, { type: payable.name, amount: val, quantity: 1 }];
                                setCurrentExtras(nextExtras);
                                try {
                                  await fetch('/api/dispatch/extra', {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      trip_number: currentTrip.trip_number,
                                      extras: nextExtras
                                    })
                                  });
                                } catch (err) { console.error(err); }
                              }}
                              className="w-24 bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-sm font-mono text-green-500 text-right outline-none focus:border-blue-500 shadow-inner" 
                            />
                         )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8">
              <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">User Notes</h2>
              <textarea defaultValue={currentTrip.notes} onBlur={(e) => updateField('notes', e.target.value)} className="w-full bg-transparent text-zinc-400 text-sm leading-relaxed min-h-[120px] outline-none resize-none" placeholder="Notes..." />
            </section>
          </div>

          <div className="lg:col-span-5 space-y-8">
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 group">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Route and Stops</h2>
                <button onClick={() => setShowAddHUD(true)} className="bg-zinc-900 hover:bg-zinc-800 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-zinc-800 transition-all">+ Add Stop</button>
              </div>
              <div className="space-y-10 relative">
                {currentStops.map((stop: any, i) => (
                  <div key={stop.id || i} className="flex gap-6 relative group/stop">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full z-10 transition-transform group-hover/stop:scale-125 ${i === 0 ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)]' : i === currentStops.length - 1 ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-zinc-700'}`} />
                      {i !== currentStops.length - 1 && <div className="w-px h-full bg-zinc-800 absolute top-2.5" />}
                    </div>
                    <div className="-mt-1.5 flex-grow">
                      <div className="flex justify-between items-start">
                        <p className="text-[9px] font-black text-blue-500 uppercase tracking-widest mb-2 font-mono">{formatDateDisplay(stop.date)}</p>
                        <button
                          onClick={() => deleteStop(stop.id, i)}
                          disabled={deletingStopId === stop.id}
                          className="bg-zinc-900/50 hover:bg-red-900 disabled:opacity-60 p-1.5 rounded-lg text-red-500 hover:text-white text-[9px] font-black transition-all border border-zinc-800 shadow-md uppercase tracking-tighter"
                        >
                          {deletingStopId === stop.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                      <p className="text-md font-black text-zinc-100 leading-tight mb-2 tracking-tight">{stop.location}</p>
                      <span className="text-[9px] font-black text-zinc-500 uppercase bg-black/40 px-3 py-1.5 rounded-xl border border-zinc-800/50">{stop.stop_type || 'Stop'} • {stop.miles_from_last || 0} mi</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <section className="bg-black border border-zinc-900 rounded-[2.5rem] p-10">
          <h2 className="text-[10px] font-black uppercase text-zinc-700 tracking-[0.3em] mb-8">Archived Raw PDF Data</h2>
          <div className="p-10 rounded-3xl bg-zinc-950/20 border border-zinc-900/50 overflow-x-auto shadow-inner">
            <pre className="text-[11px] text-zinc-600 font-mono leading-relaxed whitespace-pre-wrap italic">{currentTrip.raw_data || 'No raw data available.'}</pre>
          </div>
        </section>
      </main>

      {/* PAY BREAKDOWN MODAL */}
      {showPayBreakdown && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[100] flex items-center justify-center p-6">
           <div className="bg-zinc-950 border border-zinc-800 rounded-[3.5rem] p-12 max-w-xl w-full shadow-[0_0_100px_rgba(37,99,235,0.15)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50"></div>
              <h3 className="text-4xl font-black uppercase tracking-tighter mb-2 text-blue-500">Pay Breakdown</h3>
              <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] mb-12">Earnings Transparency Report</p>
              
              <div className="space-y-6 mb-12 max-h-[450px] overflow-y-auto pr-4 custom-scrollbar">
                <div className="bg-zinc-900/50 p-6 rounded-[2rem] border border-zinc-900 flex justify-between items-center group">
                  <div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">Base Mileage Pay</p>
                    <p className="text-xl font-mono font-black">{currentTrip.total_miles || 0} mi × $1.06</p>
                  </div>
                  <p className="text-2xl font-black text-white font-mono">{paySummary.milePay.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                </div>

                {paySummary.items.map((item, idx) => (
                  <div key={idx} className="bg-black/40 p-6 rounded-[2rem] border border-zinc-900 flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">{item.name}</p>
                      <p className="text-md font-mono font-bold text-zinc-400">Extra Payable Item</p>
                    </div>
                    <p className="text-xl font-black text-green-500 font-mono">+ {item.total.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                  </div>
                ))}
              </div>

              <div className="pt-8 border-t border-zinc-900 flex justify-between items-end">
                <div>
                  <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest mb-1">Final Estimated Payout</p>
                  <p className="text-5xl font-black text-blue-500 font-mono tracking-tighter">{paySummary.grandTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                </div>
                <button onClick={() => setShowPayBreakdown(false)} className="bg-zinc-900 hover:bg-zinc-800 p-6 rounded-[2rem] font-black uppercase text-[11px] tracking-[0.4em] border border-zinc-800 transition-all active:scale-95">Dismiss</button>
              </div>
           </div>
        </div>
      )}

      {showEquipmentModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
           <div className="bg-zinc-950 border border-zinc-800 rounded-[3rem] p-12 max-w-lg w-full shadow-[0_0_100px_rgba(37,99,235,0.1)]">
              <h3 className="text-3xl font-black uppercase tracking-tighter mb-8 text-blue-500 uppercase">Select {activeEquipmentField?.replace('_', ' ')}</h3>
              <div className="space-y-3 mb-12 max-h-[400px] overflow-y-auto pr-3 custom-scrollbar">
                {inventory?.map(item => (
                  <button key={item.trailer_number} onClick={() => selectTrailer(item.trailer_number)} className="w-full text-left bg-zinc-900/30 p-7 rounded-[2rem] border border-zinc-900 hover:border-blue-600 hover:bg-blue-600/5 group transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">🚛</div>
                    <p className="font-mono font-black text-3xl group-hover:text-blue-400 transition-colors tracking-tighter">{item.trailer_number}</p>
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-2 group-hover:text-blue-600 transition-colors">Select for Trip</p>
                  </button>
                ))}
                <button onClick={() => { const n = prompt('Number:'); if(n) selectTrailer(n); }} className="w-full text-center bg-blue-600/10 p-7 rounded-[2rem] border border-blue-600/20 hover:bg-blue-600 hover:text-white transition-all font-black uppercase text-sm tracking-widest">+ Manual Entry</button>
              </div>
              <button onClick={() => { setShowEquipmentModal(false); setActiveEquipmentField(null); }} className="w-full bg-zinc-900 hover:bg-zinc-800 p-6 rounded-[2rem] font-black uppercase text-[11px] tracking-[0.4em] border border-zinc-800 transition-all">Close Panel</button>
           </div>
        </div>
      )}

      {showAddHUD && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 pt-20">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black uppercase tracking-tighter text-blue-500">⚡ Quick Add</h2>
              <button onClick={() => setShowAddHUD(false)} className="bg-zinc-900 hover:bg-zinc-800 p-4 rounded-2xl border border-zinc-800 text-zinc-400 font-black uppercase text-xs tracking-widest">Close</button>
            </div>
            
            {/* Quick Add - Stops */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 mb-6">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Stop</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input id="newStopLocation" placeholder="Location (City, Province)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <input id="newStopDate" type="date" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <input id="newStopMiles" type="number" placeholder="Miles" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
              </div>
              <button onClick={async () => {
                setActionError(null);
                setActionSuccess(null);
                setAddingStop(true);
                const loc = (document.getElementById('newStopLocation') as HTMLInputElement).value;
                const date = (document.getElementById('newStopDate') as HTMLInputElement).value;
                const miles = parseFloat((document.getElementById('newStopMiles') as HTMLInputElement).value) || 0;
                if (!loc?.trim()) {
                  setActionError('Stop location is required');
                  setAddingStop(false);
                  return;
                }
                try {
                  const res = await fetch(`/api/dispatch/${currentTrip.trip_number}/stop`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ location: loc.trim(), date: date || null, miles_from_last: miles, stop_type: 'Stop' })
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data?.error || 'Unable to add stop');
                  setCurrentStops([...currentStops, data]);
                  (document.getElementById('newStopLocation') as HTMLInputElement).value = '';
                  (document.getElementById('newStopMiles') as HTMLInputElement).value = '';
                  setActionSuccess('Stop added');
                } catch (err: any) { setActionError(err?.message || 'Unable to add stop'); }
                finally { setAddingStop(false); }
              }} disabled={addingStop} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 p-4 rounded-xl font-black uppercase text-xs tracking-widest border border-blue-500 transition-all">{addingStop ? 'Adding Stop…' : '+ Add Stop'}</button>
            </div>

            {/* Quick Add - Payables */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8 mb-6">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Extra Pay</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {PAYABLE_TYPES.map(p => (
                  <button key={p.name} onClick={() => updatePayableQty(p.name, 1)} className="bg-black/40 border border-zinc-800 hover:border-blue-500 p-4 rounded-xl text-xs font-black uppercase text-zinc-400 hover:text-blue-400 transition-all">{p.name}</button>
                ))}
              </div>
            </div>

            {/* Quick Add - Fuel */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-[2rem] p-8">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Fuel</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <input id="fuelCity" placeholder="City" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <select id="fuelProvince" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500">
                  <option value="">Select Province/State</option>
                  <optgroup label="Canada">
                    <option value="ON">Ontario (Litres)</option>
                    <option value="BC">British Columbia (Litres)</option>
                    <option value="AB">Alberta (Litres)</option>
                    <option value="QC">Quebec (Litres)</option>
                    <option value="MB">Manitoba (Litres)</option>
                    <option value="SK">Saskatchewan (Litres)</option>
                    <option value="NB">New Brunswick (Litres)</option>
                    <option value="NS">Nova Scotia (Litres)</option>
                    <option value="PE">Prince Edward (Litres)</option>
                  </optgroup>
                  <optgroup label="USA">
                    <option value="NY">New York (Gallons)</option>
                    <option value="CA">California (Gallons)</option>
                    <option value="TX">Texas (Gallons)</option>
                    <option value="FL">Florida (Gallons)</option>
                    <option value="IL">Illinois (Gallons)</option>
                    <option value="PA">Pennsylvania (Gallons)</option>
                    <option value="OH">Ohio (Gallons)</option>
                    <option value="GA">Georgia (Gallons)</option>
                    <option value="NC">North Carolina (Gallons)</option>
                    <option value="MI">Michigan (Gallons)</option>
                  </optgroup>
                </select>
                <input id="fuelAmount" type="number" placeholder="Amount (L/Gal)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <input id="fuelPrice" type="number" placeholder="Price ($)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <input id="fuelOdometer" type="number" placeholder="Odometer" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
                <input id="fuelDate" type="date" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-blue-500" />
              </div>
              <button onClick={async () => {
                setActionError(null);
                setActionSuccess(null);
                setAddingFuel(true);
                const city = (document.getElementById('fuelCity') as HTMLInputElement).value;
                const province = (document.getElementById('fuelProvince') as HTMLSelectElement).value;
                const amount = parseFloat((document.getElementById('fuelAmount') as HTMLInputElement).value) || 0;
                const price = parseFloat((document.getElementById('fuelPrice') as HTMLInputElement).value) || 0;
                const odometer = parseFloat((document.getElementById('fuelOdometer') as HTMLInputElement).value) || 0;
                const date = (document.getElementById('fuelDate') as HTMLInputElement).value || new Date().toISOString().split('T')[0];
                if (!city || !province || !amount) {
                  setActionError('City, province, and amount are required');
                  setAddingFuel(false);
                  return;
                }
                const isCanada = ['ON','BC','AB','QC','MB','SK','NB','NS','PE'].includes(province);
                const unit = isCanada ? 'L' : 'Gal';
                try {
                  const res = await fetch('/api/dispatch/fuel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ trip_number: currentTrip.trip_number, city, province, amount, price_per_unit: price, odometer, date, unit })
                  });
                  const data = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(data?.error || 'Failed to add fuel');
                  setActionSuccess('Fuel entry added');
                } catch (err: any) { setActionError(err?.message || 'Failed to add fuel'); }
                finally { setAddingFuel(false); }
              }} disabled={addingFuel} className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-60 p-4 rounded-xl font-black uppercase text-xs tracking-widest border border-green-500 transition-all">{addingFuel ? 'Adding Fuel…' : '+ Add Fuel'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
