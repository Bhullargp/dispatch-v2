'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useIsMobile } from '../../hooks/useIsMobile';
import AuthGuard from '../AuthGuard';
import FloatingAddButton from '../FloatingAddButton';
import MobileQuickAddPanel from '../MobileQuickAddPanel';
import { formatFuelOdometerInput } from '@/lib/fuel-format';

interface EditFuelForm {
  id: number;
  date: string;
  location: string;
  quantity: string;
  amount_usd: string;
  odometer: string;
  unit: string;
}

const unitIsLitres = (unit?: string | null) => /^(l|litres?|liters?)$/i.test(String(unit || '').trim());

const getFuelQuantity = (f: any) => {
  if (unitIsLitres(f.unit)) return f.liters ?? f.quantity ?? f.gallons ?? '';
  return f.gallons ?? f.quantity ?? f.liters ?? '';
};

export default function FuelHistoryClient({ initialFuel, trips }: { initialFuel: any[], trips: any[] }) {
  const [fuel, setFuel] = useState(initialFuel);
  const [filter, setFilter] = useState('ALL'); // ALL, UNLINKED, LINKED
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [editingFuel, setEditingFuel] = useState<EditFuelForm | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [previewReceipt, setPreviewReceipt] = useState<{ url: string; filename: string | null } | null>(null);

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

  const startEdit = (f: any) => {
    const quantity = getFuelQuantity(f);
    setEditingFuel({
      id: f.id,
      date: f.date || '',
      location: f.location || '',
      quantity: quantity === null || quantity === undefined ? '' : quantity.toString(),
      amount_usd: f.amount_usd?.toString() || '',
      odometer: formatFuelOdometerInput(f.odometer),
      unit: f.unit || (f.liters ? 'L' : 'Gallons'),
    });
  };

  const saveEdit = async () => {
    if (!editingFuel) return;
    setIsSavingEdit(true);
    try {
      const quantity = editingFuel.quantity ? parseFloat(editingFuel.quantity) : undefined;
      const saveAsLitres = unitIsLitres(editingFuel.unit);
      const res = await fetch('/api/dispatch/fuel', {
        method: 'PATCH',
        body: JSON.stringify({
          id: editingFuel.id,
          date: editingFuel.date || undefined,
          location: editingFuel.location || undefined,
          gallons: saveAsLitres ? undefined : quantity,
          liters: saveAsLitres ? quantity : undefined,
          amount_usd: editingFuel.amount_usd ? parseFloat(editingFuel.amount_usd) : undefined,
          odometer: editingFuel.odometer ? parseFloat(editingFuel.odometer) : undefined,
          unit: editingFuel.unit || undefined,
        })
      });
      if (res.ok) {
        setFuel(fuel.map(f => f.id === editingFuel.id ? {
          ...f,
          date: editingFuel.date,
          location: editingFuel.location,
          gallons: saveAsLitres ? f.gallons : quantity,
          liters: saveAsLitres ? quantity : f.liters,
          amount_usd: editingFuel.amount_usd ? parseFloat(editingFuel.amount_usd) : f.amount_usd,
          odometer: editingFuel.odometer ? parseFloat(editingFuel.odometer) : f.odometer,
          unit: editingFuel.unit,
        } : f));
        setEditingFuel(null);
      } else {
        alert('Failed to save');
      }
    } catch (e) {
      alert('Save failed');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const isImageReceipt = (filename: string | null | undefined, url: string) => {
    const target = `${filename || ''} ${url}`;
    return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(target);
  };

  if (!mounted) return <div className="min-h-screen bg-zinc-950" />;

  return (
    <AuthGuard>
    {/* Receipt Preview Modal */}
    {previewReceipt && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setPreviewReceipt(null)}>
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800">
            <div className="min-w-0">
              <h2 className="font-black text-sm md:text-lg uppercase tracking-tighter">Receipt Preview</h2>
              <p className="text-[10px] md:text-xs text-zinc-500 truncate">{previewReceipt.filename || 'Fuel receipt'}</p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={previewReceipt.url}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 text-[10px] md:text-xs font-black uppercase hover:border-zinc-500"
              >
                Open New Tab
              </a>
              <button onClick={() => setPreviewReceipt(null)} className="text-zinc-500 hover:text-white text-xl px-2">✕</button>
            </div>
          </div>
          <div className="flex-1 bg-black/40 overflow-auto p-2 md:p-4">
            {isImageReceipt(previewReceipt.filename, previewReceipt.url) ? (
              <img src={previewReceipt.url} alt={previewReceipt.filename || 'Fuel receipt'} className="max-w-full max-h-full mx-auto rounded-xl" />
            ) : (
              <iframe src={previewReceipt.url} title={previewReceipt.filename || 'Fuel receipt'} className="w-full h-full rounded-xl bg-white" />
            )}
          </div>
        </div>
      </div>
    )}

    {/* Edit Fuel Modal */}
    {editingFuel && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md space-y-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-black text-lg uppercase tracking-tighter">Edit Fuel Entry</h2>
            <button onClick={() => setEditingFuel(null)} className="text-zinc-500 hover:text-white text-xl">✕</button>
          </div>
          <input
            type="date"
            value={editingFuel.date}
            onChange={e => setEditingFuel({ ...editingFuel, date: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-bold outline-none focus:border-green-600 [color-scheme:dark]"
          />
          <input
            type="text"
            placeholder="City"
            value={editingFuel.location}
            onChange={e => setEditingFuel({ ...editingFuel, location: e.target.value })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-bold outline-none focus:border-green-600"
          />
          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <input
                type="number"
                step="0.01"
                placeholder="Quantity"
                value={editingFuel.quantity}
                onChange={e => setEditingFuel({ ...editingFuel, quantity: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-bold outline-none focus:border-green-600 pr-10"
              />
              <select
                value={editingFuel.unit}
                onChange={e => setEditingFuel({ ...editingFuel, unit: e.target.value })}
                className="absolute right-1 top-1/2 -translate-y-1/2 bg-transparent text-[10px] font-black text-zinc-400 outline-none cursor-pointer"
              >
                <option>Gallons</option>
                <option>Litres</option>
              </select>
            </div>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                placeholder="Amount USD"
                value={editingFuel.amount_usd}
                onChange={e => setEditingFuel({ ...editingFuel, amount_usd: e.target.value })}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-bold outline-none focus:border-green-600 pl-5"
              />
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500">$</span>
            </div>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Odometer (optional)"
            value={editingFuel.odometer}
            onChange={e => setEditingFuel({ ...editingFuel, odometer: e.target.value.replace(/[^0-9]/g, '') })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 font-bold outline-none focus:border-green-600"
          />
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setEditingFuel(null)}
              className="flex-1 py-3 rounded-xl border border-zinc-700 text-zinc-400 font-black uppercase text-sm hover:border-zinc-600"
            >Cancel</button>
            <button
              onClick={saveEdit}
              disabled={isSavingEdit}
              className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-black uppercase text-sm"
            >{isSavingEdit ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </div>
      </div>
    )}

    {/* Mobile Header - Show only on mobile */}
    <header className="md:hidden p-4 border-b border-zinc-900 flex justify-between items-center bg-black/50 sticky top-0 z-40 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="bg-zinc-900 p-2 rounded-xl border border-zinc-800">
          <span className="text-zinc-400">←</span>
        </Link>
        <h1 className="text-xl font-black uppercase tracking-tighter">Fuel History</h1>
      </div>
      <div className="flex bg-zinc-900 rounded-xl p-1 border border-zinc-800">
        {['ALL', 'UNLINKED', 'LINKED'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all ${filter === f ? 'bg-emerald-600 text-white' : 'text-zinc-500'}`}
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
                  {(getFuelQuantity(f) || '—')} {f.unit} • ${Number(f.amount_usd || 0).toFixed(2)} USD
                  {f.odometer && ` • ODO: ${f.odometer}`}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-black uppercase">
                  {f.receiptUrl ? (
                    <button
                      onClick={() => setPreviewReceipt({ url: f.receiptUrl, filename: f.receiptFilename || null })}
                      className="text-amber-400 hover:text-amber-300"
                    >
                      🧾 Receipt
                    </button>
                  ) : (
                    <span className="text-zinc-700">No receipt</span>
                  )}
                  {f.trip_number && f.trip_number !== 'UNLINKED' && (
                    <a
                      href={`/api/dispatch/envelope/${encodeURIComponent(f.trip_number)}/merge-pdfs`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-zinc-400 hover:text-white"
                    >
                      📦 Envelope
                    </a>
                  )}
                </div>
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
                      : 'border-zinc-800 text-emerald-400'
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
                    href={`/${f.trip_number}`}
                    className="p-2 bg-zinc-800 text-zinc-400 rounded-xl hover:text-white border border-zinc-700"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </Link>
                )}
                <button
                  onClick={() => startEdit(f)}
                  className="p-2 bg-zinc-800 text-zinc-400 hover:text-blue-400 rounded-xl border border-zinc-700 hover:border-blue-500/30"
                  title="Edit entry"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
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
          <div className="text-center py-20 border-2 border-dashed border-zinc-900 rounded-3xl">
            <p className="text-zinc-600 font-black uppercase tracking-widest text-xs">No entries found matching filter</p>
          </div>
        )}
      </main>

      {/* Quick add handled by root layout MobileQuickAddWrapper */}
    </AuthGuard>
  );
}
