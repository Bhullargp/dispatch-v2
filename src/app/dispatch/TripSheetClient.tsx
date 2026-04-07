'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileQuickAddPanel from './MobileQuickAddPanel';
import FloatingAddButton from './FloatingAddButton';
import { useAuth } from './auth';
import AuthGuard from './AuthGuard';

import { calcTripPay as sharedCalcTripPay, PAYABLE_DEFAULTS, type PayableItem, type MileRates } from '@/lib/trip-pay';

const PAYABLE_TYPES = PAYABLE_DEFAULTS;

export default function TripSheet({ initialTrips, isAdmin = false }: { initialTrips: any[]; isAdmin?: boolean }) {
  const [trips, setTrips] = useState(initialTrips);
  const [mounted, setMounted] = useState(false);

  // Fetch live rates from API instead of hardcoded values
  const [livePayRates, setLivePayRates] = useState(PAYABLE_TYPES);
  const [liveMileRates, setLiveMileRates] = useState({ us: 1.06, canadaUnder1000: 1.26, canadaOver1000: 1.16 });

  useEffect(() => {
    // Fetch pay rates
    fetch('/api/dispatch/rates').then(r => r.json()).then(data => {
      if (Array.isArray(data)) {
        const merged = PAYABLE_TYPES.map(pt => {
          const live = data.find((d: any) => d.name === pt.name);
          return live ? { ...pt, rate: live.rate, unit: live.unit } : pt;
        });
        setLivePayRates(merged);
      }
    }).catch(() => {});

    // Fetch mileage rates
    fetch('/api/dispatch/rates/mileage').then(r => r.json()).then(data => {
      if (data.mileage) {
        setLiveMileRates({
          us: data.mileage.us_per_mile,
          canadaUnder1000: data.mileage.canada_under_1000,
          canadaOver1000: data.mileage.canada_over_1000,
        });
      }
    }).catch(() => {});
  }, []);
  const isMobile = useIsMobile();
  const router = useRouter();
  const { isLoggedIn, user } = useAuth();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<any[]>([]);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || isLoggedIn !== true) return;
    fetch('/api/dispatch/upload')
      .then((res) => res.json())
      .then((data) => setUploadJobs(data.jobs || []))
      .catch(() => setUploadJobs([]));
  }, [mounted, isLoggedIn]);

  const refreshTrips = async () => {
    const res = await fetch('/api/dispatch/trips');
    if (!res.ok) return;
    const data = await res.json();
    setTrips(data || []);
  };

  const onSelectPdf = async (file?: File) => {
    if (!file) return;
    setUploadingPdf(true);
    setUploadFeedback(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/dispatch/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok && !data?.queued) throw new Error(data?.error || 'Upload failed');
      if (data?.tripNumber) {
        setUploadFeedback(`✅ Imported ${data.tripNumber}`);
      } else if (data?.queued) {
        setUploadFeedback(`🕒 Upload queued${data?.message ? `: ${data.message}` : ''}`);
      } else {
        setUploadFeedback('✅ Upload accepted');
      }
      await Promise.all([refreshTrips(), fetch('/api/dispatch/upload').then(r => r.json()).then(d => setUploadJobs(d.jobs || []))]);
    } catch (error: any) {
      setUploadFeedback(`❌ ${error.message || 'Upload failed'}`);
    } finally {
      setUploadingPdf(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Auth check - redirect to login if not authenticated
  useEffect(() => {
    if (mounted && isLoggedIn === false) {
      router.push('/dispatch/login');
    }
  }, [mounted, isLoggedIn, router]);

  // Refresh trips when window gets focus (sync with TripDetails edits)
  useEffect(() => {
    const onFocus = () => refreshTrips();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const calculateTripPay = (trip: any) => {
    const result = sharedCalcTripPay(
      trip,
      liveMileRates as MileRates,
      livePayRates as PayableItem[]
    );
    return result.total;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    try {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      }
      return dateStr;
    } catch { return dateStr; }
  };

  const deleteTrip = async (id: string) => {
    if (!confirm(`Delete trip ${id}?`)) return;
    try {
      const res = await fetch(`/api/dispatch/${id}`, { method: 'DELETE' });
      if (res.ok) setTrips(trips.filter(t => t.trip_number !== id));
    } catch (err) { alert('Failed to delete'); }
  };

  // Show loading while checking auth
  if (!mounted || isLoggedIn === null) {
      return <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
      </div>;
  }

  // Redirect to login if not authenticated
  if (isLoggedIn === false) {
      return null;
  }

  return (
    <AuthGuard>
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-10 font-sans selection:bg-emerald-500/30">
      <header className="max-w-7xl mx-auto mb-16 flex justify-between items-end border-b border-zinc-900 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <span className="text-sm font-black">DM</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">Trip Sheet</h1>
          </div>
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] ml-11">Fleet Logistics Command</p>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => onSelectPdf(e.target.files?.[0] || undefined)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPdf}
            className="text-[10px] font-black uppercase tracking-widest bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 px-4 md:px-6 py-3 rounded-xl border border-emerald-600 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
          >
            {uploadingPdf ? 'Uploading…' : '📄 Upload PDF'}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto space-y-4">
        <div className="md:hidden bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Driver Itinerary PDF</p>
            <p className="text-[11px] text-zinc-500">Upload and auto-create/merge trip</p>
          </div>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPdf}
            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 text-[10px] font-black uppercase px-4 py-2.5 rounded-xl border border-emerald-600"
          >
            {uploadingPdf ? 'Uploading…' : 'Upload PDF'}
          </button>
        </div>

        {(uploadFeedback || uploadJobs.length > 0) && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
            {uploadFeedback && <p className="text-xs font-bold mb-2 text-zinc-200">{uploadFeedback}</p>}
            {uploadJobs.slice(0, 3).map((job) => (
              <div key={job.id} className="text-[11px] text-zinc-400 flex flex-wrap items-center gap-2 py-1">
                <span className="font-mono text-zinc-500">#{job.id}</span>
                <span className={`uppercase font-black ${job.status === 'done' ? 'text-green-500' : job.status === 'failed' ? 'text-red-500' : 'text-yellow-500'}`}>{job.status}</span>
                <span className="truncate max-w-[220px]">{job.original_filename}</span>
                {job.trip_number && <Link href={`/dispatch/${job.trip_number}?from=tripsheet`} className="text-emerald-400 hover:underline">{job.trip_number}</Link>}
                {job.error_message && <span className="text-red-400">{job.error_message}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="bg-zinc-900/20 border border-zinc-900 rounded-3xl overflow-hidden backdrop-blur-sm shadow-2xl">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className="bg-zinc-900/40 text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em]">
                <th className="px-8 py-6 border-b border-zinc-900">Trip Number</th>
                <th className="px-8 py-6 border-b border-zinc-900">Start Date</th>
                <th className="px-8 py-6 border-b border-zinc-900">End Date</th>
                <th className="px-8 py-6 border-b border-zinc-900">Route</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-right">Miles</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-right text-emerald-400/80">Est. Pay</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {trips.map((trip: any) => {
                const start = formatDate(trip.start_date);
                const end = formatDate(trip.end_date);
                const tripUrl = `/dispatch/${trip.trip_number}?from=tripsheet`;
                const stop1 = trip.first_stop?.split(',')[0] || '---';
                const stop2 = trip.last_stop?.split(',')[0];
                const routeHint = stop2 && stop2 !== stop1 ? `${stop1} → ${stop2}` : stop1;
                const totalPay = calculateTripPay(trip);

                return (
                  <tr key={trip.trip_number} className="group hover:bg-white/[0.02] transition-all cursor-pointer relative">
                    <td className="px-8 py-8 font-mono font-black text-base tracking-tighter group-hover:text-emerald-400 transition-colors relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${
                          trip.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.6)] animate-pulse' : 
                          trip.status === 'Completed' ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 
                          trip.status === 'Not Started' ? 'bg-yellow-500' : 
                          trip.status === 'Incomplete' ? 'bg-red-500' : 
                          trip.status === 'Cancelled' ? 'bg-orange-500' : 
                          'bg-zinc-500'}`} />
                        {trip.trip_number}
                      </div>
                    </td>
                    <td className="px-8 py-8 text-sm font-medium text-zinc-400 relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      {start || <span className="text-zinc-800 italic group-hover:text-emerald-900/50 transition-colors">Pending</span>}
                    </td>
                    <td className="px-8 py-8 text-sm font-medium text-zinc-400 group/date relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      <div className="flex items-center gap-3">
                        {end || <span className="text-zinc-800 italic group-hover:text-emerald-900/50 transition-colors">---</span>}
                        <button className="opacity-0 group-hover/date:opacity-100 transition-all bg-zinc-800/80 hover:bg-emerald-600 p-1.5 rounded-md text-[8px] font-black uppercase text-white z-20">
                          {end ? '✎' : '+ Add'}
                        </button>
                      </div>
                    </td>
                    <td className="px-8 py-8 text-[11px] text-zinc-500 font-black tracking-tight relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      <span className="bg-zinc-900/50 px-3 py-1.5 rounded-lg border border-zinc-800/50">{routeHint}</span>
                    </td>
                    <td className="px-8 py-8 text-right font-mono font-black text-zinc-300 text-base tracking-tighter relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      {trip.total_miles || 0}
                    </td>
                    <td className="px-8 py-8 text-right font-mono font-black text-emerald-400 text-base tracking-tighter relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      ${totalPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-8 py-8 text-center relative z-20">
                      <div className="flex justify-center gap-3 items-center">
                        <select
                          value={trip.pay_period || ''}
                          onChange={async (e) => {
                            const val = e.target.value;
                            await fetch(`/api/dispatch/${trip.trip_number}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ pay_period: val || null })
                            });
                            setTrips(trips.map(t => t.trip_number === trip.trip_number ? { ...t, pay_period: val || null } : t));
                          }}
                          className="text-[9px] font-black uppercase bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-zinc-600 transition-all appearance-none"
                          title="Assign pay period"
                        >
                          <option value="">No Period</option>
                          <option value="2026-04-15">Apr 15</option>
                          <option value="2026-04-30">Apr 30</option>
                          <option value="2026-03-15">Mar 15</option>
                          <option value="2026-03-31">Mar 31</option>
                          <option value="2026-02-15">Feb 15</option>
                          <option value="2026-02-28">Feb 28</option>
                          <option value="2026-01-15">Jan 15</option>
                          <option value="2026-01-31">Jan 31</option>
                        </select>
                        <a 
                          href={trip.pdf_path || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-zinc-800 hover:bg-emerald-600 text-[10px] font-black uppercase px-4 py-2 rounded-xl border border-zinc-700 transition-all disabled:opacity-40"
                          onClick={(e) => { if (!trip.pdf_path) e.preventDefault(); }}
                        >PDF</a>
                        <button 
                          onClick={(e) => { e.preventDefault(); deleteTrip(trip.trip_number); }}
                          className="bg-red-950/20 hover:bg-red-600 text-red-500 hover:text-white text-lg px-3 py-1.5 rounded-xl border border-red-900/30 transition-all flex items-center justify-center"
                          title="Delete Trip"
                        >🗑️</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
      <footer className="mt-20 py-10 text-center"><p className="text-[8px] font-black uppercase text-zinc-800 tracking-[1em]">Secure End-to-End Environment</p></footer>
      
      {isMobile ? (
        <>
          <FloatingAddButton onClick={() => setIsQuickAddOpen(true)} />
          <MobileQuickAddPanel 
            trips={trips.filter(t => t.status === 'Active' || t.status === 'Not Started')} 
            isOpen={isQuickAddOpen}
            onClose={() => setIsQuickAddOpen(false)}
          />
        </>
      ) : (
        <>
          <FloatingAddButton onClick={() => setIsQuickAddOpen(true)} />
          <MobileQuickAddPanel 
            trips={trips.filter(t => t.status === 'Active' || t.status === 'Not Started')} 
            isOpen={isQuickAddOpen}
            onClose={() => setIsQuickAddOpen(false)}
          />
        </>
      )}
    </div>
    </AuthGuard>
  );
}
