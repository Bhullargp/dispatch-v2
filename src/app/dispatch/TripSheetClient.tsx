'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileQuickAddPanel from './MobileQuickAddPanel';
import FloatingAddButton from './FloatingAddButton';
import { useAuth } from './auth';
import AuthGuard from './AuthGuard';

import { calcTripPay as sharedCalcTripPay, PAYABLE_DEFAULTS, type PayableItem, type MileRates } from '@/lib/trip-pay';

const PAYABLE_TYPES = PAYABLE_DEFAULTS;

// ── Pay period color system (matches dashboard) ──────────────────────────────
const PERIOD_COLORS = [
  { accent: '#10b981', bg: 'rgba(16,185,129,0.22)', border: 'rgba(16,185,129,0.7)', label: 'emerald' },  // month-end periods
  { accent: '#f59e0b', bg: 'rgba(245,158,11,0.22)', border: 'rgba(245,158,11,0.7)', label: 'amber' },    // 15th periods
];

function getPeriodColor(payDate: string) {
  const day = parseInt(payDate.split('-')[2]);
  return day === 15 ? PERIOD_COLORS[1] : PERIOD_COLORS[0];
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatPeriodLabel(payDate: string) {
  const d = new Date(payDate + 'T12:00:00');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function generatePayPeriods() {
  const periods: string[] = [];
  const now = new Date();
  for (let offset = -1; offset <= 6; offset++) {
    let month = now.getMonth() - offset;
    let year = now.getFullYear();
    while (month < 0) { month += 12; year -= 1; }
    const mm = String(month + 1).padStart(2, '0');
    const lastDay = new Date(year, month + 1, 0).getDate();
    periods.push(`${year}-${mm}-${lastDay}`);
    const nm = month === 11 ? 0 : month + 1;
    const ny = month === 11 ? year + 1 : year;
    periods.push(`${ny}-${String(nm + 1).padStart(2, '0')}-15`);
  }
  const seen = new Set<string>();
  return periods.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; });
}

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
  // Generate pay periods
  const payPeriods = useMemo(() => generatePayPeriods(), []);

  // Per-trip PDF dropdown
  const [openPdfDropdownId, setOpenPdfDropdownId] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || isLoggedIn !== true) return;
    const loadJobs = () =>
      fetch('/api/dispatch/upload')
        .then((res) => res.json())
        .then((data) => setUploadJobs(data.jobs || []))
        .catch(() => {});
    loadJobs();
    // Poll every 4 seconds while there are active jobs
    const interval = setInterval(async () => {
      const res = await fetch('/api/dispatch/upload').then(r => r.json()).catch(() => ({ jobs: [] }));
      const jobs = res.jobs || [];
      setUploadJobs(jobs);
      const hasActive = jobs.some((j: any) => j.status === 'queued' || j.status === 'processing');
      if (hasActive) {
        // Refresh trip list when a job finishes
        refreshTrips();
      }
    }, 4000);
    return () => clearInterval(interval);
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
          {/* Floating status pill — top-right, shows only when something is pending/processing/failed */}
          {(() => {
            const activeJobs = uploadJobs.filter(j => j.status === 'queued' || j.status === 'processing');
            const failedJobs = uploadJobs.filter(j => j.status === 'failed');
            if (uploadingPdf || activeJobs.length > 0 || failedJobs.length > 0) {
              return (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-wider transition-all"
                  style={
                    uploadingPdf || activeJobs.length > 0
                      ? { background: 'rgba(234,179,8,0.12)', borderColor: 'rgba(234,179,8,0.5)', color: '#facc15' }
                      : { background: 'rgba(239,68,68,0.12)', borderColor: 'rgba(239,68,68,0.5)', color: '#f87171' }
                  }
                >
                  {(uploadingPdf || activeJobs.length > 0) && (
                    <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse inline-block" />
                  )}
                  {uploadingPdf ? 'Uploading…'
                    : activeJobs.length > 0 ? `Processing ${activeJobs.length} PDF${activeJobs.length > 1 ? 's' : ''}…`
                    : `${failedJobs.length} failed`}
                  {failedJobs.length > 0 && !uploadingPdf && activeJobs.length === 0 && (
                    <span className="ml-1 text-red-400 truncate max-w-[120px]">{failedJobs[0].error_message?.slice(0, 40)}</span>
                  )}
                </div>
              );
            }
            return null;
          })()}
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

        {/* Only show failed jobs or recent feedback — completed jobs disappear automatically */}
        {(uploadFeedback || uploadJobs.some(j => j.status === 'failed')) && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-4">
            {uploadFeedback && <p className="text-xs font-bold mb-2 text-zinc-200">{uploadFeedback}</p>}
            {uploadJobs.filter(j => j.status === 'failed').map((job) => (
              <div key={job.id} className="text-[11px] text-red-400 flex flex-wrap items-center gap-2 py-1">
                <span className="font-mono text-zinc-500">#{job.id}</span>
                <span className="uppercase font-black text-red-500">FAILED</span>
                <span className="truncate max-w-[200px]">{job.original_filename}</span>
                {job.error_message && <span className="text-red-400/80">{job.error_message}</span>}
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
                  <tr key={trip.trip_number} className="group hover:bg-white/[0.02] transition-all cursor-pointer relative" style={trip.pay_period ? { borderLeftWidth: '3px', borderLeftColor: getPeriodColor(trip.pay_period).accent } : undefined}>
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
                          className="text-[9px] font-black uppercase rounded-lg px-2 py-1.5 outline-none cursor-pointer transition-all appearance-none"
                          title="Assign pay period"
                          style={trip.pay_period ? {
                            backgroundColor: getPeriodColor(trip.pay_period).bg,
                            borderWidth: '1.5px',
                            borderStyle: 'solid',
                            borderColor: getPeriodColor(trip.pay_period).accent,
                            color: getPeriodColor(trip.pay_period).accent,
                            fontWeight: '900',
                            textShadow: `0 0 8px ${getPeriodColor(trip.pay_period).accent}66`,
                          } : {
                            backgroundColor: 'rgb(24 24 27)',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: 'rgb(63 63 70)',
                            color: 'rgb(161 161 170)',
                          }}
                        >
                          <option value="">No Period</option>
                          {payPeriods.map(p => (
                            <option key={p} value={p}>{formatPeriodLabel(p)}</option>
                          ))}
                        </select>
                        {(() => {
                          let pdfs: Array<{path: string; filename: string; id: number}> = [];
                          try { pdfs = trip.trip_pdfs_json ? JSON.parse(trip.trip_pdfs_json) : []; } catch {}
                          if (pdfs.length === 0 && trip.pdf_path) {
                            pdfs = [{ path: trip.pdf_path, filename: 'Itinerary PDF', id: 0 }];
                          }
                          if (pdfs.length === 0) {
                            return (
                              <button disabled className="text-[10px] font-black uppercase px-4 py-2 rounded-xl border bg-zinc-900/50 border-zinc-800/50 text-zinc-700 cursor-not-allowed">
                                PDF
                              </button>
                            );
                          }
                          if (pdfs.length === 1) {
                            return (
                              <a href={pdfs[0].path} target="_blank" rel="noopener noreferrer"
                                className="text-[10px] font-black uppercase px-4 py-2 rounded-xl border bg-zinc-800 hover:bg-emerald-600 border-zinc-700 hover:border-emerald-500 transition-all">
                                📄 PDF
                              </a>
                            );
                          }
                          const isOpen = openPdfDropdownId === trip.trip_number;
                          return (
                            <div className="relative">
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenPdfDropdownId(isOpen ? null : trip.trip_number); }}
                                className="text-[10px] font-black uppercase px-4 py-2 rounded-xl border bg-zinc-800 hover:bg-emerald-600 border-zinc-700 hover:border-emerald-500 transition-all flex items-center gap-1.5"
                              >
                                📄 <span className="text-emerald-400">{pdfs.length}</span>
                              </button>
                              {isOpen && (
                                <div className="absolute right-0 top-full mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 py-1 overflow-hidden">
                                  {pdfs.map((pdf, i) => (
                                    <a key={pdf.id || i} href={pdf.path} target="_blank" rel="noopener noreferrer"
                                      className="flex items-center gap-2 px-3 py-2.5 hover:bg-zinc-800 transition-colors group/pdf border-b border-zinc-800 last:border-0">
                                      <span className="text-zinc-500 text-xs shrink-0">📄</span>
                                      <span className="text-xs text-zinc-300 group-hover/pdf:text-emerald-400 truncate flex-1">{pdf.filename || `PDF ${i + 1}`}</span>
                                      <span className="text-zinc-600 group-hover/pdf:text-emerald-500 shrink-0">↗</span>
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
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
      
      <FloatingAddButton onClick={() => setIsQuickAddOpen(true)} />
      <MobileQuickAddPanel 
        trips={trips.filter(t => t.status === 'Active' || t.status === 'Not Started')} 
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
      />
    </div>
    </AuthGuard>
  );
}
