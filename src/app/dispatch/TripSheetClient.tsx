'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useIsMobile } from '../hooks/useIsMobile';
import MobileQuickAddPanel from './MobileQuickAddPanel';
import FloatingAddButton from './FloatingAddButton';
import { useAuth } from './auth';
import AuthGuard, { LogoutButton } from './AuthGuard';

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

// Canadian provinces for trip detection
const CANADIAN_PROVINCES = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE'];

// Detect if trip is Canada or US based on stops (first_stop and last_stop)
// ALL stops must be Canadian provinces for Canada rate
// If ANY stop is US → US rate ($1.06)
const detectTripCountry = (firstStop: string | null, lastStop: string | null): { isCanada: boolean; rate: number } => {
  const stops = [firstStop, lastStop].filter(Boolean);
  
  if (stops.length === 0) {
    return { isCanada: false, rate: 1.06 };
  }

  const allCanada = stops.every((location) => {
    if (!location) return true;
    // Check for province code in location (e.g., "Caledon, ON" or "Toronto ON")
    const provinceMatch = location.match(/\b([A-Z]{2})\b/);
    if (provinceMatch) {
      const province = provinceMatch[1];
      return CANADIAN_PROVINCES.includes(province);
    }
    // Also check if location contains Canadian city names
    const canadaKeywords = ['Ontario', 'Quebec', 'British Columbia', 'Alberta', 'Manitoba', 'Saskatchewan', 'Nova Scotia', 'New Brunswick', 'Newfoundland', 'Prince Edward'];
    return canadaKeywords.some(keyword => location.toLowerCase().includes(keyword.toLowerCase()));
  });

  // ALL stops are Canadian provinces → Canada rate (rate determined by mileage)
  if (allCanada) {
    return { isCanada: true, rate: 0 }; // Rate depends on mileage
  }

  // Any US stop → US rate
  return { isCanada: false, rate: 1.06 };
};

export default function TripSheet({ initialTrips }: { initialTrips: any[] }) {
  const [trips, setTrips] = useState(initialTrips);
  const [mounted, setMounted] = useState(false);
  const isMobile = useIsMobile();
  const router = useRouter();
  const pathname = usePathname();
  const { isLoggedIn, logout, user } = useAuth();
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadJobs, setUploadJobs] = useState<any[]>([]);
  const [uploadFeedback, setUploadFeedback] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Desktop navigation tabs
  const desktopNavItems = [
    { name: 'Trip Sheet', path: '/dispatch', icon: '📋' },
    { name: 'Active Trip', path: '/dispatch/active', icon: '🚛' },
    { name: 'Fuel History', path: '/dispatch/fuel-history', icon: '⛽' },
  ];

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

  const calculateTripPay = (trip: any) => {
    const totalMiles = trip.total_miles || 0;
    
    // Bhullar Protocol Pay Rates (sync with TripDetailsClient):
    // - US trips: $1.06/mile
    // - Canada trips under 1000 miles: $1.26/mile
    // - Canada trips over 1000 miles: $1.16/mile
    // Use route field first - MUST check US explicitly before Canada
    const route = (trip.route || '').toUpperCase();
    let mileRate = 1.06;
    
    // If route says US, use US rate immediately
    if (route === 'US') {
      mileRate = 1.06;
    } 
    // Check for Canada provinces in route
    else if (route.includes('CANADA') || route.includes('QC') || route.includes('ON') || route.includes('BC') || route.includes('AB') || route.includes('MB') || route.includes('SK')) {
      // Canada rate based on route field
      if (totalMiles < 1000) {
        mileRate = 1.26;
      } else {
        mileRate = 1.16;
      }
    } else {
      // Fall back to stop detection only if route is empty/unknown
      const tripInfo = detectTripCountry(trip.first_stop, trip.last_stop);
      if (tripInfo.isCanada) {
        if (totalMiles < 1000) {
          mileRate = 1.26;
        } else {
          mileRate = 1.16;
        }
      }
    }
    
    const milePay = totalMiles * mileRate;
    let extrasTotal = 0;
    try {
      const extras = JSON.parse(trip.extra_pay_json || '[]');
      extrasTotal = extras.reduce((acc: number, curr: any) => {
        const payable = PAYABLE_TYPES.find(p => p.name === curr.type);
        return payable ? acc + (payable.rate * (curr.quantity || 1)) : acc;
      }, 0);
    } catch (e) { console.error("Error parsing extras", e); }
    return milePay + extrasTotal;
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
      return <div className="min-h-screen bg-[#050505] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>;
  }

  // Redirect to login if not authenticated
  if (isLoggedIn === false) {
      return null;
  }

  return (
    <AuthGuard>
    <div className="min-h-screen bg-[#050505] text-zinc-100 p-4 md:p-10 font-sans selection:bg-blue-500/30">
      <header className="max-w-7xl mx-auto mb-16 flex justify-between items-end border-b border-zinc-900 pb-6">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(37,99,235,0.3)]">
              <span className="text-sm font-black">DM</span>
            </div>
            <h1 className="text-4xl font-black tracking-tighter uppercase leading-none">Trip Sheet</h1>
          </div>
          <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-[0.4em] ml-11">Fleet Logistics Command</p>
        </div>
        
        {/* Desktop Navigation Tabs - Show on md: and above, hide on mobile */}
        <nav className="hidden md:flex items-center gap-1 bg-zinc-900/50 rounded-2xl p-1.5 border border-zinc-800/50">
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
          <Link href="/dispatch/active" className="hidden md:inline-flex text-[10px] font-black uppercase tracking-widest bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-xl border border-blue-700 transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)]">
            ⚡ Active Trip
          </Link>
          <Link href="/dispatch/admin" className="hidden md:inline-flex text-[10px] font-black uppercase tracking-widest bg-purple-700 hover:bg-purple-600 px-6 py-3 rounded-xl border border-purple-600 transition-all shadow-[0_0_20px_rgba(147,51,234,0.2)]">
            🛡️ Admin
          </Link>
          <Link href="/" className="hidden md:inline-flex text-[10px] font-black uppercase tracking-widest bg-zinc-900 hover:bg-zinc-800 px-6 py-3 rounded-xl border border-zinc-800 transition-all shadow-xl">
            ← Dashboard
          </Link>
          <LogoutButton />
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
                {job.trip_number && <Link href={`/dispatch/${job.trip_number}`} className="text-blue-500 hover:underline">{job.trip_number}</Link>}
                {job.error_message && <span className="text-red-400">{job.error_message}</span>}
              </div>
            ))}
          </div>
        )}

        <div className="bg-zinc-900/20 border border-zinc-900 rounded-[2.5rem] overflow-hidden backdrop-blur-sm shadow-2xl">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className="bg-zinc-900/40 text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em]">
                <th className="px-8 py-6 border-b border-zinc-900">Trip Number</th>
                <th className="px-8 py-6 border-b border-zinc-900">Start Date</th>
                <th className="px-8 py-6 border-b border-zinc-900">End Date</th>
                <th className="px-8 py-6 border-b border-zinc-900">Route</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-right">Miles</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-right text-blue-500/80">Est. Pay</th>
                <th className="px-8 py-6 border-b border-zinc-900 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {trips.map((trip: any) => {
                const start = formatDate(trip.start_date);
                const end = formatDate(trip.end_date);
                const tripUrl = `/dispatch/${trip.trip_number}`;
                const stop1 = trip.first_stop?.split(',')[0] || '---';
                const stop2 = trip.last_stop?.split(',')[0];
                const routeHint = stop2 && stop2 !== stop1 ? `${stop1} → ${stop2}` : stop1;
                const totalPay = calculateTripPay(trip);

                return (
                  <tr key={trip.trip_number} className="group hover:bg-white/[0.02] transition-all cursor-pointer relative">
                    <td className="px-8 py-8 font-mono font-black text-base tracking-tighter group-hover:text-blue-500 transition-colors relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      <div className="flex items-center gap-4">
                        <div className={`w-2 h-2 rounded-full ${
                          trip.status === 'Active' ? 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.6)] animate-pulse' : 
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
                      {start || <span className="text-zinc-800 italic group-hover:text-blue-900/50 transition-colors">Pending</span>}
                    </td>
                    <td className="px-8 py-8 text-sm font-medium text-zinc-400 group/date relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      <div className="flex items-center gap-3">
                        {end || <span className="text-zinc-800 italic group-hover:text-blue-900/50 transition-colors">---</span>}
                        <button className="opacity-0 group-hover/date:opacity-100 transition-all bg-zinc-800/80 hover:bg-blue-600 p-1.5 rounded-md text-[8px] font-black uppercase text-white z-20">
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
                    <td className="px-8 py-8 text-right font-mono font-black text-blue-500 text-base tracking-tighter relative">
                      <Link href={tripUrl} className="absolute inset-0 z-10" />
                      ${totalPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-8 py-8 text-center relative z-20">
                      <div className="flex justify-center gap-3">
                        <a 
                          href={trip.pdf_path || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-zinc-800 hover:bg-blue-600 text-[10px] font-black uppercase px-4 py-2 rounded-xl border border-zinc-700 transition-all disabled:opacity-40"
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
