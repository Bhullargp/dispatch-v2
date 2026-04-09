'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import AuthGuard from '../AuthGuard';
import PdfUploader from '../PdfUploader';
import { calcTripPay, PAYABLE_DEFAULTS, type PayableItem, type MileRates } from '@/lib/trip-pay';

// ── Types ───────────────────────────────────────────────────────────────────
interface Period {
  payDate: string;
  label: string;
  payLabel: string;
  startDate: string;
  endDate: string;
}

interface Stop {
  stop_type: string;
  location: string;
  date: string | null;
  miles_from_last: number;
}

interface Trip {
  trip_number: string;
  start_date: string | null;
  end_date: string | null;
  total_miles: number | null;
  manual_rate: number | null;
  rate_type: string | null;
  extra_pay_json: string | null;
  stops_json: string | null;
  first_stop: string | null;
  last_stop: string | null;
  status: string;
  pay_period: string | null;
  driver_name: string | null;
  route: string | null;
}

// Rates and ExtraItem types now imported from @/lib/trip-pay

interface Deduction {
  id: number;
  user_id: number;
  pay_period: string;
  name: string;
  amount: number;
  is_recurring: number;
  created_at: string;
}

interface Expense {
  id: number;
  trip_number: string | null;
  pay_period: string | null;
  name: string;
  amount: number;
  expense_type: string;
  category: string;
  notes: string | null;
  created_at: string;
}

interface FuelEntry {
  id: number;
  trip_number: string | null;
  date: string | null;
  location: string | null;
  quantity: number | null;
  unit: string | null;
  amount_usd: number | null;
  odometer: number | null;
}

interface SafetyBonus {
  rate_per_mile: number;
  enabled: boolean;
}

// ── Pay period color system ──────────────────────────────────────────────
const PERIOD_COLORS = [
  { accent: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.3)', label: 'emerald' },  // 15th periods
  { accent: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.3)', label: 'amber' },    // month-end periods
];

function getPeriodColor(payDate: string) {
  // Periods ending on 15th = first color, month-end = second color
  const day = parseInt(payDate.split('-')[2]);
  return day === 15 ? PERIOD_COLORS[0] : PERIOD_COLORS[1];
}

// ── Reimbursement / Deduction constants ────────────────────────────────────
const REIMBURSEMENT_OPTIONS = [
  { value: 'Tolls', emoji: '🛣️' },
  { value: 'Fax', emoji: '📠' },
  { value: 'Mischarges', emoji: '💰' },
  { value: 'Other', emoji: '📌' },
];

const REIMBURSEMENT_CATEGORY_MAP: Record<string, string> = {
  'Tolls': 'toll',
  'Fax': 'misc',
  'Mischarges': 'misc',
  'Other': 'other',
};

const DEDUCTION_OPTIONS = [
  { value: 'Insurance', emoji: '🛡️' },
  { value: 'Plates', emoji: '🔢' },
  { value: 'Disability', emoji: '🏥' },
  { value: 'Misc', emoji: '📦' },
];

// Pay calculation is now shared via @/lib/trip-pay

function spansPayCutoff(trip: Trip): boolean {
  if (!trip.start_date || !trip.end_date) return false;
  const s = new Date(trip.start_date + 'T12:00:00');
  const e = new Date(trip.end_date + 'T12:00:00');
  if (s.getFullYear() !== e.getFullYear() || s.getMonth() !== e.getMonth()) return false;
  return s.getDate() <= 15 && e.getDate() > 15;
}

function fmt(n: number) {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
}
function fmtNum(n: number) {
  return n.toLocaleString('en-CA', { maximumFractionDigits: 0 });
}

function getStopCounters(trip: Trip) {
  let stops: Stop[] = [];
  try { stops = JSON.parse(trip.stops_json || '[]'); } catch {}
  let extras: { type: string; quantity: number }[] = [];
  try { extras = JSON.parse(trip.extra_pay_json || '[]'); } catch {}

  const pickups = stops.filter(s => (s.stop_type || '').toUpperCase() === 'PICKUP').length;
  const deliveries = stops.filter(s => (s.stop_type || '').toUpperCase() === 'DELIVER' || s.stop_type === 'Delivery').length;
  const layovers = extras.filter(e => e.type === 'Layover').reduce((sum, e) => sum + (e.quantity || 1), 0);
  const extraPU = extras.filter(e => e.type === 'Extra Pickup').reduce((sum, e) => sum + (e.quantity || 1), 0);
  const extraDL = extras.filter(e => e.type === 'Extra Delivery').reduce((sum, e) => sum + (e.quantity || 1), 0);
  const switches = extras.filter(e => e.type === 'Trailer Switch').reduce((sum, e) => sum + (e.quantity || 1), 0);

  return { pickups, deliveries, layovers, extraPU, extraDL, switches, totalStops: stops.length };
}

function formatDateDisplay(dateStr: string | null) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return dateStr; }
}

// ── Main component ───────────────────────────────────────────────────────────
export default function DashboardClient({ isAdmin }: { isAdmin: boolean }) {
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [ambiguous, setAmbiguous] = useState<string[]>([]);
  const [rates, setRates] = useState<MileRates>({ us: 1.06, canadaUnder1000: 1.26, canadaOver1000: 1.16 });
  const [extraItems, setExtraItems] = useState<PayableItem[]>(PAYABLE_DEFAULTS);
  const [savingPeriod, setSavingPeriod] = useState<string | null>(null);
  const [showAllTrips, setShowAllTrips] = useState(false);
  const [periodStatuses, setPeriodStatuses] = useState<Record<string, { status: string; tripCount: number; incompleteCount: number; paidStatus: string }>>({});
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null);
  const [tripStops, setTripStops] = useState<Record<string, Stop[]>>({});
  const [tripFuel, setTripFuel] = useState<Record<string, any[]>>({});
  const [fuelLoading, setFuelLoading] = useState<string | null>(null);

  const periodScrollRef = useRef<HTMLDivElement>(null);

  // Deduction form state
  const [showDeductionForm, setShowDeductionForm] = useState(false);
  const DED_FORM_RESET: { name: string; customName: string; amount: string; date: string; is_recurring: boolean; recurring_frequency: 'weekly' | 'biweekly' | 'monthly' } = { name: '', customName: '', amount: '', date: new Date().toISOString().split('T')[0], is_recurring: false, recurring_frequency: 'monthly' };
  const [dedForm, setDedForm] = useState(DED_FORM_RESET);

  // Expense state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const EXP_FORM_RESET = {
    expense_type: 'trip' as const,
    trip_number: '',
    name: '',
    customName: '',
    amount: '',
    category: 'misc',
    date: new Date().toISOString().split('T')[0],
    pay_period: '',
    notes: '',
  };
  const [expForm, setExpForm] = useState<typeof EXP_FORM_RESET>(EXP_FORM_RESET);

  // Fuel entries state
  const [fuelEntries, setFuelEntries] = useState<FuelEntry[]>([]);

  // Safety bonus state
  const [safetyBonus, setSafetyBonus] = useState<SafetyBonus>({ rate_per_mile: 0.02, enabled: false });

  // Safety deduction state
  const [showSafetyDeductionForm, setShowSafetyDeductionForm] = useState(false);
  const [safetyDedForm, setSafetyDedForm] = useState({ amount: '', type: 'custom' });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, ratesRes, extraRes] = await Promise.all([
        fetch('/api/dispatch/dashboard'),
        fetch('/api/dispatch/rates/mileage'),
        fetch('/api/dispatch/rates'),
      ]);
      const dash = await dashRes.json();
      if (dash.periods) setPeriods(dash.periods);
      if (dash.currentPeriod) setSelectedPeriod(dash.currentPeriod);
      if (dash.allTrips) setAllTrips(dash.allTrips);
      if (dash.ambiguousTrips) setAmbiguous(dash.ambiguousTrips);
      if (dash.periodStatuses) setPeriodStatuses(dash.periodStatuses);
      if (dash.deductions) setDeductions(dash.deductions);
      if (dash.fuelEntries) setFuelEntries(dash.fuelEntries);

      // Load expenses
      try {
        const expRes = await fetch('/api/dispatch/expenses');
        const expData = await expRes.json();
        if (expData.expenses) setExpenses(expData.expenses);
      } catch {}

      // Load safety bonus
      try {
        const sbRes = await fetch('/api/dispatch/safety-bonus');
        const sbData = await sbRes.json();
        if (sbData.safety_bonus) setSafetyBonus(sbData.safety_bonus);
      } catch {}

      // Parse stops for each trip
      const stopsMap: Record<string, Stop[]> = {};
      if (dash.allTrips) {
        for (const trip of dash.allTrips) {
          try {
            stopsMap[trip.trip_number] = JSON.parse(trip.stops_json || '[]');
          } catch { stopsMap[trip.trip_number] = []; }
        }
      }
      setTripStops(stopsMap);

      const ratesData = await ratesRes.json();
      if (ratesData.mileage) {
        setRates({
          us: ratesData.mileage.us_per_mile,
          canadaUnder1000: ratesData.mileage.canada_under_1000,
          canadaOver1000: ratesData.mileage.canada_over_1000,
        });
      }

      const extraData = await extraRes.json();
      // /api/dispatch/rates now returns { mileage, rates } but we only need the extra pay items
      const extraRates = extraData.rates || (Array.isArray(extraData) ? extraData : []);
      if (Array.isArray(extraRates) && extraRates.length > 0) {
        const merged = PAYABLE_DEFAULTS.map(d => {
          const live = extraRates.find((x: any) => x.name === d.name);
          return live ? { ...d, rate: live.rate } : d;
        });
        setExtraItems(merged);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Scroll selected period into center of scrollable container
  useEffect(() => {
    if (!selectedPeriod || !periodScrollRef.current) return;
    // Small delay to ensure DOM is rendered
    const timer = setTimeout(() => {
      const container = periodScrollRef.current;
      if (!container) return;
      const selectedEl = container.querySelector(`[data-period="${selectedPeriod}"]`) as HTMLElement;
      if (selectedEl) {
        const scrollLeft = selectedEl.offsetLeft - container.offsetWidth / 2 + selectedEl.offsetWidth / 2;
        container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [selectedPeriod, periods]);

  const markPeriodPaid = async (payPeriod: string, markPaid: boolean) => {
    try {
      await fetch('/api/dispatch/pay-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pay_period: payPeriod, status: markPaid ? 'paid' : 'pending' }),
      });
      setPeriodStatuses(prev => ({
        ...prev,
        [payPeriod]: { ...prev[payPeriod], paidStatus: markPaid ? 'paid' : 'pending' }
      }));
    } catch {}
  };

  const quickAddTrip = () => {
    window.location.href = '/dispatch/trips?action=new';
  };

  const refreshDashboard = useCallback(async () => {
    try {
      const dashRes = await fetch('/api/dispatch/dashboard');
      const dash = await dashRes.json();
      if (dash.allTrips) setAllTrips(dash.allTrips);
      if (dash.periodStatuses) setPeriodStatuses(dash.periodStatuses);
      if (dash.deductions) setDeductions(dash.deductions);
      if (dash.fuelEntries) setFuelEntries(dash.fuelEntries);
    } catch {}
  }, []);

  const assignPeriod = async (tripNumber: string, payDate: string) => {
    setSavingPeriod(tripNumber);
    try {
      await fetch('/api/dispatch/dashboard', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trip_number: tripNumber, pay_period: payDate }),
      });
      setAllTrips(prev => prev.map(t =>
        t.trip_number === tripNumber ? { ...t, pay_period: payDate } : t
      ));
      setAmbiguous(prev => prev.filter(t => t !== tripNumber));
    } catch {}
    setSavingPeriod(null);
  };

  // ── Deduction handlers ──────────────────────────────────────────────────
  const periodDeductions = deductions.filter(d => d.pay_period === selectedPeriod);
  const totalDeductions = periodDeductions.reduce((sum, d) => sum + d.amount, 0);

  // Expense calculations
  const periodExpenses = expenses.filter(e => {
    if (e.expense_type === 'recurring') {
      return e.pay_period === selectedPeriod;
    }
    // Trip-level expenses: check expense's own pay_period OR the associated trip's pay_period
    if (e.pay_period === selectedPeriod) return true;
    const trip = allTrips.find(t => t.trip_number === e.trip_number);
    return trip?.pay_period === selectedPeriod;
  });
  const totalExpenses = periodExpenses.reduce((sum, e) => sum + e.amount, 0);

  // Add expense
  const addExpense = async () => {
    const resolvedName = expForm.name === 'custom' ? expForm.customName.trim() : expForm.name;
    if (!resolvedName || !expForm.amount) return;
    try {
      const payload: any = {
        name: resolvedName,
        amount: parseFloat(expForm.amount),
        expense_type: expForm.expense_type,
        category: expForm.category,
        date: expForm.date,
        notes: expForm.notes || null,
      };
      if (expForm.expense_type === 'trip') {
        payload.trip_number = expForm.trip_number || null;
      } else {
        payload.pay_period = selectedPeriod;
      }

      const res = await fetch('/api/dispatch/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const expRes = await fetch('/api/dispatch/expenses');
        const expData = await expRes.json();
        if (expData.expenses) setExpenses(expData.expenses);
        setExpForm({ ...EXP_FORM_RESET, date: new Date().toISOString().split('T')[0] });
        setShowExpenseForm(false);
      }
    } catch {}
  };

  const deleteExpense = async (id: number) => {
    try {
      await fetch(`/api/dispatch/expenses?id=${id}`, { method: 'DELETE' });
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch {}
  };

  const addDeduction = async () => {
    const resolvedName = dedForm.name === 'custom' ? dedForm.customName.trim() : dedForm.name;
    if (!resolvedName || !dedForm.amount || !selectedPeriod) return;
    try {
      const res = await fetch('/api/dispatch/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: resolvedName,
          amount: parseFloat(dedForm.amount),
          pay_period: selectedPeriod,
          is_recurring: dedForm.is_recurring,
          recurring_frequency: dedForm.is_recurring ? dedForm.recurring_frequency : null,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDeductions(prev => [...prev, {
          id: data.id,
          user_id: 0,
          pay_period: selectedPeriod,
          name: resolvedName,
          amount: parseFloat(dedForm.amount),
          is_recurring: dedForm.is_recurring ? 1 : 0,
          created_at: new Date().toISOString(),
        }]);
        setDedForm({ ...DED_FORM_RESET, date: new Date().toISOString().split('T')[0] });
        setShowDeductionForm(false);
      }
    } catch {}
  };

  const deleteDeduction = async (id: number) => {
    try {
      await fetch(`/api/dispatch/deductions?id=${id}`, { method: 'DELETE' });
      setDeductions(prev => prev.filter(d => d.id !== id));
    } catch {}
  };

  const addSafetyDeduction = async () => {
    if (!selectedPeriod) return;
    let amount = 0;
    if (safetyDedForm.type === 'full') {
      amount = safetyBonusEarned;
    } else {
      amount = parseFloat(safetyDedForm.amount);
    }
    if (!amount || amount <= 0) return;
    try {
      const res = await fetch('/api/dispatch/deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: '🛡️ Safety Bonus Deduction',
          amount,
          pay_period: selectedPeriod,
          is_recurring: false,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDeductions(prev => [...prev, {
          id: data.id,
          user_id: 0,
          pay_period: selectedPeriod,
          name: '🛡️ Safety Bonus Deduction',
          amount,
          is_recurring: 0,
          created_at: new Date().toISOString(),
        }]);
        setSafetyDedForm({ amount: '', type: 'custom' });
        setShowSafetyDeductionForm(false);
      }
    } catch {}
  };

  // ── Derived data for selected period ──────────────────────────────────────
  const periodTrips = allTrips.filter(t => t.pay_period === selectedPeriod);
  const unassigned = allTrips.filter(t => !t.pay_period && (t.start_date || t.end_date));

  let totalPay = 0;
  let totalMiles = 0;
  let usMiles = 0;
  let canadaMiles = 0;
  let totalExtras = 0;
  const extraBreakdownAgg: Record<string, number> = {};

  for (const trip of periodTrips) {
    const pay = calcTripPay(trip, rates, extraItems);
    totalPay += pay.total;
    totalMiles += trip.total_miles || 0;
    if (pay.isCanada) canadaMiles += trip.total_miles || 0;
    else usMiles += trip.total_miles || 0;
    totalExtras += pay.extras;
    for (const [k, v] of Object.entries(pay.extraBreakdown)) {
      extraBreakdownAgg[k] = (extraBreakdownAgg[k] || 0) + v;
    }
  }

  const milePay = totalPay - totalExtras;
  const safetyBonusEarned = safetyBonus.enabled ? totalMiles * safetyBonus.rate_per_mile : 0;
  const basePay = safetyBonus.enabled ? milePay - safetyBonusEarned : milePay;

  // Separate safety deductions from other deductions
  const safetyDedEntries = periodDeductions.filter(d => d.name === '🛡️ Safety Bonus Deduction');
  const safetyDeductionAmount = safetyDedEntries.reduce((sum, d) => sum + d.amount, 0);
  const otherDeductionEntries = periodDeductions.filter(d => d.name !== '🛡️ Safety Bonus Deduction');
  const otherDeductionsTotal = otherDeductionEntries.reduce((sum, d) => sum + d.amount, 0);
  const safetyBonusNet = safetyBonusEarned - safetyDeductionAmount;
  const grossPay = totalPay;
  const netPay = grossPay + totalExpenses - totalDeductions;
  const avgPay = periodTrips.length > 0 ? totalPay / periodTrips.length : 0;
  const currentPeriodObj = periods.find(p => p.payDate === selectedPeriod);

  const topExtras = Object.entries(extraBreakdownAgg)
    .sort(([, a], [, b]) => b - a);

  // ── All trips for "Unassigned" view ──────────────────────────────────────
  const displayTrips = showAllTrips ? allTrips : periodTrips;

  if (loading) {
    return (
      <AuthGuard>
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-zinc-500 text-xs font-black uppercase tracking-widest animate-pulse">Loading Dashboard...</div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <main className="px-4 pb-28 md:pb-8 max-w-7xl mx-auto space-y-6 pt-4 md:pt-8">

        {/* ── Unassigned warning ── */}
        {(unassigned.length > 0 || ambiguous.length > 0) && (
          <div className="bg-amber-900/10 border border-amber-700/40 rounded-2xl p-4 flex items-start gap-3">
            <span className="text-amber-400 text-lg mt-0.5">⚠️</span>
            <div>
              <p className="text-amber-300 text-xs font-black uppercase tracking-wider">
                {ambiguous.length > 0 ? `${ambiguous.length} trip${ambiguous.length > 1 ? 's' : ''} span the pay cut-off` : `${unassigned.length} trip${unassigned.length > 1 ? 's' : ''} need pay period assignment`}
              </p>
              <p className="text-amber-500/80 text-[10px] mt-1">Scroll down to assign them manually.</p>
            </div>
          </div>
        )}

        {/* ── Period selector (swipeable) ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Pay Periods</p>
            <p className="text-[10px] text-zinc-600 font-bold">
              {selectedPeriod && periodStatuses[selectedPeriod]?.status === 'upcoming' && '📅 Upcoming Pay'}
              {selectedPeriod && periodStatuses[selectedPeriod]?.status === 'incomplete' && '⚠️ Incomplete'}
              {selectedPeriod && periodStatuses[selectedPeriod]?.status === 'complete' && '✅ Complete'}
              {selectedPeriod && periodStatuses[selectedPeriod]?.status === 'empty' && '📭 No Trips'}
            </p>
          </div>
          <div className="relative">
            {/* Fade edges */}
            <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-zinc-950 to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-zinc-950 to-transparent z-10 pointer-events-none" />
            <div ref={periodScrollRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x snap-mandatory px-8" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {periods.map(p => {
                const ps = periodStatuses[p.payDate];
                const isSelected = selectedPeriod === p.payDate;
                const status = ps?.status || 'empty';
                const tripCount = ps?.tripCount || 0;
                const incompleteCount = ps?.incompleteCount || 0;
                const pc = getPeriodColor(p.payDate);

                return (
                  <button
                    key={p.payDate}
                    data-period={p.payDate}
                    onClick={() => setSelectedPeriod(p.payDate)}
                    className={`snap-center flex-shrink-0 px-5 py-3 rounded-2xl text-left transition-all duration-200 border relative overflow-hidden ${
                      isSelected
                        ? 'bg-zinc-900 text-white scale-105 shadow-lg'
                        : status === 'incomplete'
                          ? 'bg-amber-900/15 text-amber-400 border-amber-700/40 hover:bg-amber-900/25'
                          : status === 'upcoming'
                            ? 'bg-blue-900/15 text-blue-400 border-blue-700/40 hover:bg-blue-900/25'
                            : 'bg-zinc-900/40 text-zinc-500 hover:bg-zinc-900/60 hover:text-zinc-400'
                    }`}
                    style={{
                      borderColor: isSelected ? pc.accent : undefined,
                      borderBottomWidth: '3px',
                      borderBottomColor: isSelected ? pc.accent : `${pc.accent}44`,
                      boxShadow: isSelected ? `0 0 25px ${pc.accent}22` : undefined,
                      minWidth: '140px',
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <p className={`text-[11px] font-black uppercase tracking-wider ${isSelected ? 'text-white' : ''}`}>
                        {p.label}
                      </p>
                      {status === 'upcoming' && !isSelected && <span className="text-[7px] bg-blue-600/30 text-blue-400 px-1.5 py-0.5 rounded-full font-black">NEXT</span>}
                      {status === 'incomplete' && <span className="text-[7px] bg-amber-600/30 text-amber-400 px-1.5 py-0.5 rounded-full font-black">!</span>}
                      {status === 'complete' && !isSelected && <span className="text-[7px] bg-emerald-600/20 text-emerald-500 px-1.5 py-0.5 rounded-full font-black">✓</span>}
                      {ps?.paidStatus === 'paid' && <span className="text-[7px] bg-green-600/30 text-green-400 px-1.5 py-0.5 rounded-full font-black">PAID</span>}
                    </div>
                    <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-zinc-300' : 'text-zinc-600'}`}>
                      {p.payLabel}
                    </p>
                    {tripCount > 0 && (
                      <p className={`text-[9px] mt-1 font-black ${isSelected ? 'text-zinc-400' : 'text-zinc-600'}`}>
                        {tripCount} trip{tripCount !== 1 ? 's' : ''}
                        {incompleteCount > 0 && <span className="text-amber-500"> ({incompleteCount}!)</span>}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {selectedPeriod && periodStatuses[selectedPeriod]?.status !== 'upcoming' && (
              <button
                onClick={() => markPeriodPaid(selectedPeriod, periodStatuses[selectedPeriod]?.paidStatus !== 'paid')}
                className={`text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl transition-all ${
                  periodStatuses[selectedPeriod]?.paidStatus === 'paid'
                    ? 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600'
                    : 'bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-700/50'
                }`}
              >
                {periodStatuses[selectedPeriod]?.paidStatus === 'paid' ? '✓ Marked Paid' : '💰 Mark as Paid'}
              </button>
            )}
            <button
              onClick={() => { setExpForm({ ...EXP_FORM_RESET, date: new Date().toISOString().split('T')[0] }); setShowExpenseForm(true); }}
              className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 border border-emerald-700/50 transition-all"
            >
              + Reimbursement
            </button>
            <button
              onClick={() => { setDedForm({ ...DED_FORM_RESET, date: new Date().toISOString().split('T')[0] }); setShowDeductionForm(true); }}
              className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-700/50 transition-all"
            >
              − Deduction
            </button>
            <button
              onClick={quickAddTrip}
              className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-700/50 transition-all ml-auto"
            >
              + Quick Add Trip
            </button>
          </div>


          {/* PDF Upload */}
          <div className="mt-3">
            <PdfUploader onTripCreated={refreshDashboard} />
          </div>
        </section>

        {/* ── Big stat cards ── */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="col-span-2 bg-gradient-to-br from-emerald-950/60 to-zinc-950 border border-emerald-800/40 rounded-3xl p-6 shadow-[0_0_40px_rgba(5,150,105,0.08)]">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-500 mb-2">Net Pay (Bank Deposit)</p>
            <p className="text-4xl md:text-5xl font-black text-white tracking-tighter">{fmt(netPay)}</p>
            {totalExpenses > 0 && (
              <p className="text-[11px] text-orange-400/80 mt-0.5 font-bold">+{fmt(totalExpenses)} reimbursements</p>
            )}
            {totalDeductions > 0 && (
              <p className="text-[11px] text-red-400/80 mt-0.5 font-bold">-{fmt(totalDeductions)} deductions</p>
            )}
            <p className="text-[10px] text-zinc-500 mt-1 font-bold">Gross: {fmt(grossPay)}</p>
            {currentPeriodObj && (
              <p className="text-[10px] text-emerald-600/80 mt-2 font-bold">{currentPeriodObj.payLabel} · {periodTrips.length} trips</p>
            )}
          </div>

          <div className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Total Miles</p>
            <p className="text-3xl font-black tracking-tight">{fmtNum(totalMiles)}</p>
            <p className="text-[10px] text-zinc-600 mt-1">
              {usMiles > 0 && <span className="text-blue-400">{fmtNum(usMiles)} US</span>}
              {usMiles > 0 && canadaMiles > 0 && <span className="text-zinc-600"> · </span>}
              {canadaMiles > 0 && <span className="text-red-400">{fmtNum(canadaMiles)} CA</span>}
            </p>
          </div>

          <div className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Gross Pay</p>
            <p className="text-3xl font-black tracking-tight">{fmt(grossPay)}</p>
            <p className="text-[10px] text-zinc-600 mt-1">{fmtNum(totalMiles)} mi · {periodTrips.length} trips</p>
          </div>
        </section>

        {/* ── Progress bar ── */}
        {selectedPeriod && (() => {
          const ps = periodStatuses[selectedPeriod];
          if (!ps || ps.tripCount === 0) return null;
          const completeCount = ps.tripCount - ps.incompleteCount;
          const pct = Math.round((completeCount / ps.tripCount) * 100);
          return (
            <div className="bg-zinc-950 border border-zinc-800/60 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Trip Completion</p>
                <p className="text-[10px] font-black text-zinc-400">{completeCount}/{ps.tripCount} trips ({pct}%)</p>
              </div>
              <div className="h-3 bg-zinc-900 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-gradient-to-r from-emerald-600 to-emerald-400' : pct >= 50 ? 'bg-gradient-to-r from-blue-600 to-blue-400' : 'bg-gradient-to-r from-amber-600 to-amber-400'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              {ps.incompleteCount > 0 && (
                <p className="text-[10px] text-amber-500 font-bold mt-2">⚠️ {ps.incompleteCount} trip{ps.incompleteCount !== 1 ? 's' : ''} missing details (miles or status)</p>
              )}
            </div>
          );
        })()}

        {/* ── Pay breakdown ── */}
        <section className="grid grid-cols-1 gap-3">
          {/* Mile pay vs Extra pay */}
          <div className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">📊 Pay Breakdown{currentPeriodObj ? ` — ${currentPeriodObj.label}` : ''}</p>
            </div>

            {/* Safety deduction form */}
            {showSafetyDeductionForm && (
              <div className="mb-4 p-4 bg-zinc-900/80 rounded-2xl border border-amber-800/30 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Safety Bonus Deduction</p>
                  <button onClick={() => setShowSafetyDeductionForm(false)} className="text-zinc-600 hover:text-white text-xs">✕</button>
                </div>
                <p className="text-zinc-500 text-[10px]">
                  Safety bonus earned this period: <span className="text-emerald-400 font-black">{fmt(safetyBonusEarned)}</span>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSafetyDedForm(f => ({ ...f, type: 'full' }))}
                    className={`flex-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all ${
                      safetyDedForm.type === 'full' ? 'bg-amber-600/30 text-amber-300 border border-amber-600' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                    }`}
                  >
                    Full ({fmt(safetyBonusEarned)})
                  </button>
                  <button
                    onClick={() => setSafetyDedForm(f => ({ ...f, type: 'custom' }))}
                    className={`flex-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all ${
                      safetyDedForm.type === 'custom' ? 'bg-amber-600/30 text-amber-300 border border-amber-600' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                    }`}
                  >
                    Custom Amount
                  </button>
                </div>
                {safetyDedForm.type === 'custom' && (
                  <input
                    type="number"
                    placeholder="Deduction amount ($)"
                    value={safetyDedForm.amount}
                    onChange={e => setSafetyDedForm(f => ({ ...f, amount: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-zinc-600"
                  />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={addSafetyDeduction}
                    className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-amber-600 text-white hover:bg-amber-500 transition-all"
                  >
                    Apply Deduction
                  </button>
                  <button
                    onClick={() => { setShowSafetyDeductionForm(false); setSafetyDedForm({ amount: '', type: 'custom' }); }}
                    className="text-[10px] font-black uppercase tracking-wider px-4 py-2 rounded-xl bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* ── Clean Pay Breakdown Table ── */}
            <div className="space-y-0 font-mono">
              {/* Base Pay row */}
              <div className="flex justify-between items-baseline py-1.5">
                <span className="text-zinc-300 text-xs font-sans font-bold">Base Pay</span>
                <span className="text-zinc-500 text-[10px] font-sans mr-2">
                  {fmtNum(totalMiles)} mi × ${(rates.us - (safetyBonus.enabled ? safetyBonus.rate_per_mile : 0)).toFixed(2)}
                </span>
                <span className="text-white text-xs font-bold tabular-nums">{fmt(basePay)}</span>
              </div>

              {/* Safety Bonus row */}
              {safetyBonus.enabled && safetyBonusEarned > 0 && (
                <div className="flex justify-between items-baseline py-1.5">
                  <span className="text-emerald-400 text-xs font-sans font-bold">Safety Bonus</span>
                  <span className="text-zinc-500 text-[10px] font-sans mr-2">
                    {fmtNum(totalMiles)} mi × ${safetyBonus.rate_per_mile.toFixed(2)}
                  </span>
                  <span className="text-emerald-400 text-xs font-bold tabular-nums">+{fmt(safetyBonusEarned)}</span>
                </div>
              )}

              {/* Extra Pay section */}
              {topExtras.length > 0 && (
                <>
                  <div className="pt-3 pb-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 font-sans">Extra Pay</p>
                  </div>
                  {topExtras.map(([name, val]) => (
                    <div key={name} className="flex justify-between items-baseline py-1 pl-3">
                      <span className="text-zinc-400 text-xs font-sans">{name}</span>
                      <span className="text-white text-xs font-bold tabular-nums">{fmt(val)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-baseline py-1 pl-3 border-t border-zinc-800/50">
                    <span className="text-zinc-500 text-[10px] font-sans">Extra Pay Subtotal</span>
                    <span className="text-zinc-300 text-xs font-bold tabular-nums">{fmt(totalExtras)}</span>
                  </div>
                </>
              )}

              {/* GROSS PAY divider */}
              <div className="flex justify-between items-baseline py-3 mt-2 border-t border-zinc-700/50">
                <span className="text-white text-sm font-sans font-black uppercase tracking-wider">Gross Pay</span>
                <span className="text-white text-sm font-black tabular-nums">{fmt(grossPay)}</span>
              </div>

              {/* Reimbursements section */}
              {periodExpenses.length > 0 && (
                <>
                  <div className="pt-2 pb-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-orange-400/70 font-sans">Reimbursements</p>
                  </div>
                  {periodExpenses.map(exp => (
                    <div key={exp.id} className="flex justify-between items-baseline py-1 pl-3">
                      <span className="text-zinc-400 text-xs font-sans">
                        {exp.name}
                        {exp.trip_number && <span className="text-zinc-600"> · {exp.trip_number}</span>}
                      </span>
                      <span className="text-orange-400 text-xs font-bold tabular-nums">+{fmt(exp.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-baseline py-1 pl-3 border-t border-zinc-800/50">
                    <span className="text-zinc-500 text-[10px] font-sans">Expenses Subtotal</span>
                    <span className="text-orange-400 text-xs font-bold tabular-nums">+{fmt(totalExpenses)}</span>
                  </div>
                </>
              )}

              {/* Deductions section */}
              {periodDeductions.length > 0 && (
                <>
                  <div className="pt-3 pb-1">
                    <p className="text-[9px] font-black uppercase tracking-widest text-red-400/70 font-sans">Deductions</p>
                  </div>
                  {periodDeductions.map(ded => (
                    <div key={ded.id} className="flex justify-between items-baseline py-1 pl-3">
                      <span className="text-zinc-400 text-xs font-sans">{ded.name}</span>
                      <span className="text-red-400 text-xs font-bold tabular-nums">-{fmt(ded.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-baseline py-1 pl-3 border-t border-zinc-800/50">
                    <span className="text-zinc-500 text-[10px] font-sans">Deductions Subtotal</span>
                    <span className="text-red-400 text-xs font-bold tabular-nums">-{fmt(totalDeductions)}</span>
                  </div>
                </>
              )}

              {/* NET PAY */}
              <div className="flex justify-between items-baseline py-3 mt-2 border-t-2 border-emerald-600/40">
                <span className="text-emerald-400 text-base font-sans font-black uppercase tracking-wider">Net Pay</span>
                <span className="text-emerald-400 text-xl font-black tabular-nums">{fmt(netPay)}</span>
              </div>
            </div>

            {/* US vs Canada */}
            {(usMiles > 0 || canadaMiles > 0) && (
              <div className="mt-5 pt-4 border-t border-zinc-800 space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600">Route Split</p>
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded-full overflow-hidden bg-zinc-900 flex-1 flex">
                    {usMiles > 0 && (
                      <div className="h-full bg-blue-600" style={{ width: `${(usMiles / totalMiles) * 100}%` }} title={`US: ${fmtNum(usMiles)} mi`} />
                    )}
                    {canadaMiles > 0 && (
                      <div className="h-full bg-red-600" style={{ width: `${(canadaMiles / totalMiles) * 100}%` }} title={`Canada: ${fmtNum(canadaMiles)} mi`} />
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-[10px] font-black">
                  <span className="text-blue-400">🇺🇸 {fmtNum(usMiles)} mi</span>
                  <span className="text-red-400">🇨🇦 {fmtNum(canadaMiles)} mi</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Deductions ── */}
        <section className="bg-zinc-950 border border-red-900/30 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-red-400/80">Deductions</p>
              {totalDeductions > 0 && (
                <p className="text-lg font-black text-red-400 mt-1">-{fmt(totalDeductions)}</p>
              )}
            </div>
            <div className="flex gap-2">
              {safetyBonus.enabled && safetyBonusEarned > 0 && (
                <button
                  onClick={() => setShowSafetyDeductionForm(!showSafetyDeductionForm)}
                  className="text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-amber-600/10 text-amber-400 hover:bg-amber-600/20 border border-amber-800/30 transition-all"
                >
                  🛡️ Lost Safety Bonus
                </button>
              )}
              <button
                onClick={() => { setDedForm({ ...DED_FORM_RESET, date: new Date().toISOString().split('T')[0] }); setShowDeductionForm(true); }}
                className="text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-red-600/10 text-red-400 hover:bg-red-600/20 border border-red-800/30 transition-all"
              >
                + Add Deduction
              </button>
            </div>
          </div>

          {/* Non-safety deductions list */}
          {periodDeductions.filter(d => d.name !== '🛡️ Safety Bonus Deduction').length > 0 ? (
            <div className="space-y-2">
              {periodDeductions.filter(d => d.name !== '🛡️ Safety Bonus Deduction').map(d => (
                <div key={d.id} className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-300 font-bold">{d.name}</span>
                    {d.is_recurring ? (
                      <span className="text-[8px] font-black uppercase bg-purple-900/30 border border-purple-700/40 text-purple-400 px-1.5 py-0.5 rounded-full">Recurring</span>
                    ) : (
                      <span className="text-[8px] font-black uppercase bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5 rounded-full">Variable</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-red-400">-{fmt(d.amount)}</span>
                    <button
                      onClick={() => deleteDeduction(d.id)}
                      className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-700 text-xs font-bold">No deductions this period</p>
          )}
        </section>

        {/* ── Reimbursements ── */}
        <section className="bg-zinc-950 border border-orange-900/30 rounded-3xl p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-orange-400/80">Reimbursements</p>
              {totalExpenses > 0 && (
                <p className="text-lg font-black text-orange-400 mt-1">+{fmt(totalExpenses)}</p>
              )}
            </div>
            <button
              onClick={() => { setExpForm({ ...EXP_FORM_RESET, date: new Date().toISOString().split('T')[0] }); setShowExpenseForm(true); }}
              className="text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-orange-600/10 text-orange-400 hover:bg-orange-600/20 border border-orange-800/30 transition-all"
            >
              + Add Expense
            </button>
          </div>

          {periodExpenses.length > 0 ? (
            <div className="space-y-2">
              {periodExpenses.map(e => (
                <div key={e.id} className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-300 font-bold">{e.name}</span>
                    {e.expense_type === 'trip' ? (
                      <span className="text-[8px] font-black uppercase bg-blue-900/30 border border-blue-700/40 text-blue-400 px-1.5 py-0.5 rounded-full">
                        {e.category}
                      </span>
                    ) : (
                      <span className="text-[8px] font-black uppercase bg-purple-900/30 border border-purple-700/40 text-purple-400 px-1.5 py-0.5 rounded-full">
                        Recurring
                      </span>
                    )}
                    {e.trip_number && (
                      <span className="text-[8px] font-black text-zinc-500">#{e.trip_number}</span>
                    )}
                    {e.notes && (
                      <span className="text-[8px] text-zinc-600 truncate max-w-[120px]">{e.notes}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-orange-400">+{fmt(e.amount)}</span>
                    <button
                      onClick={() => deleteExpense(e.id)}
                      className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-700 text-xs font-bold">No expenses this period</p>
          )}
        </section>

        {/* ── Trip list ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Trips</p>
              {currentPeriodObj && !showAllTrips && (
                <p className="text-zinc-600 text-[10px] mt-0.5">{currentPeriodObj.label} · {periodTrips.length} trips</p>
              )}
            </div>
            <div className="flex gap-2 items-center">
              {unassigned.length > 0 && (
                <span className="text-[10px] font-black text-amber-400 bg-amber-900/20 border border-amber-800/30 px-2 py-1 rounded-lg">
                  {unassigned.length} unassigned
                </span>
              )}
              <button
                onClick={() => setShowAllTrips(v => !v)}
                className="text-[10px] font-black uppercase tracking-wider bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-2 rounded-xl text-zinc-400 transition-all"
              >
                {showAllTrips ? 'This Period' : 'All Trips'}
              </button>
            </div>
          </div>

          {displayTrips.length === 0 ? (
            <div className="bg-zinc-950 border border-zinc-800/60 rounded-3xl p-10 text-center">
              <p className="text-zinc-600 text-sm font-black uppercase tracking-wider">No trips in this period</p>
              <p className="text-zinc-700 text-xs mt-2">Use the period selector above or check unassigned trips</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayTrips.map(trip => {
                const pay = calcTripPay(trip, rates, extraItems);
                const isAmb = ambiguous.includes(trip.trip_number) || (spansPayCutoff(trip) && !trip.pay_period);
                const currentPeriodForTrip = periods.find(p => p.payDate === trip.pay_period);
                const counters = getStopCounters(trip);
                const isExpanded = expandedTrip === trip.trip_number;
                const stops = tripStops[trip.trip_number] || [];

                return (
                  <div
                    key={trip.trip_number}
                    className={`bg-zinc-950 rounded-2xl border transition-all ${
                      isAmb
                        ? 'border-amber-700/50 shadow-[0_0_15px_rgba(245,158,11,0.05)]'
                        : 'border-zinc-800/60'
                    }`}
                  >
                    <div
                      className="p-4 flex flex-col md:flex-row md:items-center gap-3 cursor-pointer select-none"
                      onClick={() => {
                        const next = isExpanded ? null : trip.trip_number;
                        setExpandedTrip(next);
                        if (next && !tripFuel[trip.trip_number]) {
                          setFuelLoading(trip.trip_number);
                          fetch(`/api/dispatch/fuel?trip_number=${trip.trip_number}`)
                            .then(r => r.json())
                            .then(data => {
                              setTripFuel(prev => ({ ...prev, [trip.trip_number]: Array.isArray(data) ? data : [] }));
                            })
                            .catch(() => setTripFuel(prev => ({ ...prev, [trip.trip_number]: [] })))
                            .finally(() => setFuelLoading(null));
                        }
                      }}
                    >
                      {/* Trip info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link
                            href={`/dispatch/${trip.trip_number}?from=dashboard`}
                            className="text-sm font-black text-white hover:text-blue-400 transition-colors"
                            onClick={e => e.stopPropagation()}
                          >
                            #{trip.trip_number}
                          </Link>
                          {isAmb && (
                            <span className="text-[9px] font-black uppercase bg-amber-900/30 border border-amber-700/40 text-amber-400 px-2 py-0.5 rounded-full">
                              ⚠ Spans Cut-off
                            </span>
                          )}
                          {!trip.pay_period && !isAmb && (
                            <span className="text-[9px] font-black uppercase bg-zinc-800/50 border border-zinc-700 text-zinc-500 px-2 py-0.5 rounded-full">
                              Unassigned
                            </span>
                          )}
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                            trip.status === 'Active'
                              ? 'bg-blue-900/30 border border-blue-800/40 text-blue-400'
                              : trip.status === 'Completed'
                              ? 'bg-emerald-900/30 border border-emerald-800/40 text-emerald-400'
                              : 'bg-zinc-800/50 border border-zinc-700 text-zinc-500'
                          }`}>{trip.status}</span>
                          {/* Stop counters */}
                          {counters.pickups > 0 && <span className="text-[8px] font-black bg-green-900/20 text-green-400 px-1.5 py-0.5 rounded-full">🚛{counters.pickups}PU</span>}
                          {counters.deliveries > 0 && <span className="text-[8px] font-black bg-blue-900/20 text-blue-400 px-1.5 py-0.5 rounded-full">📦{counters.deliveries}DL</span>}
                          {counters.layovers > 0 && <span className="text-[8px] font-black bg-purple-900/20 text-purple-400 px-1.5 py-0.5 rounded-full">🛏{counters.layovers}LO</span>}
                          {counters.extraPU > 0 && <span className="text-[8px] font-black bg-cyan-900/20 text-cyan-400 px-1.5 py-0.5 rounded-full">+{counters.extraPU}EPU</span>}
                          {counters.extraDL > 0 && <span className="text-[8px] font-black bg-amber-900/20 text-amber-400 px-1.5 py-0.5 rounded-full">+{counters.extraDL}EDL</span>}
                        </div>
                        <div className="flex gap-3 mt-1.5 text-[10px] text-zinc-500 font-bold flex-wrap">
                          {trip.start_date && <span>{trip.start_date}{trip.end_date ? ` → ${trip.end_date}` : ''}</span>}
                          {trip.first_stop && <span className="truncate max-w-[180px]">📍 {trip.first_stop}</span>}
                          {trip.total_miles && <span>🛣 {fmtNum(trip.total_miles)} mi</span>}
                        </div>
                      </div>

                      {/* Pay */}
                      <div className="text-right md:w-32 flex-shrink-0">
                        <p className="text-lg font-black text-white">{fmt(pay.total)}</p>
                        {pay.extras > 0 && (
                          <p className="text-[10px] text-zinc-500">+{fmt(pay.extras)} extras</p>
                        )}
                        {pay.isCanada && <p className="text-[9px] text-red-400 font-black">🇨🇦 CA Rate</p>}
                      </div>

                      {/* Period assignment */}
                      <div className="md:w-52 flex-shrink-0" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <select
                            value={trip.pay_period || ''}
                            onChange={e => assignPeriod(trip.trip_number, e.target.value)}
                            disabled={savingPeriod === trip.trip_number}
                            className={`flex-1 text-[10px] font-black uppercase tracking-wider rounded-xl px-3 py-2.5 border outline-none transition-all appearance-none cursor-pointer ${
                              !trip.pay_period
                                ? 'bg-amber-900/20 border-amber-700/50 text-amber-400 hover:border-amber-500'
                                : isAmb
                                ? 'bg-amber-900/10 border-amber-700/30 text-amber-300 hover:border-amber-500'
                                : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-600'
                            }`}
                          >
                            <option value="">— Assign Period —</option>
                            {periods.slice(0, 8).map(p => (
                              <option key={p.payDate} value={p.payDate}>
                                {p.label} ({p.payLabel})
                              </option>
                            ))}
                          </select>
                          {savingPeriod === trip.trip_number && (
                            <span className="text-[10px] text-zinc-500 font-black animate-pulse">...</span>
                          )}
                        </div>
                        {currentPeriodForTrip && (
                          <p className="text-[9px] text-zinc-600 mt-1 text-right">{currentPeriodForTrip.payLabel}</p>
                        )}
                      </div>
                    </div>

                    {/* Expanded trip details */}
                    {isExpanded && (
                      <div className="overflow-hidden transition-all duration-300 ease-in-out border-t border-zinc-800/40">
                        {/* Route Stops */}
                        {stops.length > 0 && (
                          <div className="px-4 pt-3 pb-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">
                              🛣 Route · {stops.length} stops · {counters.pickups} PU · {counters.deliveries} DL
                            </p>
                            <div className="space-y-0">
                              {stops.map((stop, i) => {
                                const isLast = i === stops.length - 1;
                                const isFirst = i === 0;
                                const stype = (stop.stop_type || 'Stop').toUpperCase();
                                let dotColor = 'bg-zinc-600';
                                if (stype === 'PICKUP') dotColor = 'bg-green-500';
                                else if (stype === 'DELIVER' || stype === 'DELIVERY') dotColor = 'bg-blue-500';
                                else if (stype === 'HOOK') dotColor = 'bg-yellow-500';
                                else if (stype === 'DROP') dotColor = 'bg-orange-500';
                                else if (stype.includes('BORDER')) dotColor = 'bg-purple-500';
                                else if (isFirst) dotColor = 'bg-emerald-500';
                                else if (isLast) dotColor = 'bg-red-500';

                                return (
                                  <div key={i} className="flex gap-3 relative">
                                    <div className="flex flex-col items-center w-3">
                                      <div className={`w-2 h-2 rounded-full ${dotColor} z-10 flex-shrink-0 mt-1.5`} />
                                      {!isLast && <div className="w-px flex-1 bg-zinc-800" />}
                                    </div>
                                    <div className={`pb-3 ${isLast ? 'pb-0' : ''}`}>
                                      <p className="text-[9px] font-black text-zinc-500 uppercase">{stop.stop_type || 'Stop'}</p>
                                      <p className="text-xs font-bold text-zinc-200">{stop.location || 'Unknown'}</p>
                                      <div className="flex gap-2 text-[9px] text-zinc-600">
                                        {stop.date && <span>{formatDateDisplay(stop.date)}</span>}
                                        {stop.miles_from_last > 0 && <span>{stop.miles_from_last} mi</span>}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Extra Pay Items */}
                        {(() => {
                          let extras: { type: string; quantity: number; rate: number; total: number }[] = [];
                          try { extras = JSON.parse(trip.extra_pay_json || '[]'); } catch {}
                          if (extras.length === 0) return null;
                          return (
                            <div className="px-4 py-2">
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">💰 Extra Pay</p>
                              <div className="space-y-1.5">
                                {extras.map((ex, i) => (
                                  <div key={i} className="flex items-center justify-between py-1.5 px-3 bg-zinc-900/60 rounded-xl">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-amber-900/20 text-amber-400 border border-amber-800/30">
                                        {ex.type}
                                      </span>
                                      <span className="text-[10px] text-zinc-500">×{ex.quantity || 1}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-zinc-500">@ {fmt(ex.rate || 0)}</span>
                                      <span className="text-xs font-bold text-emerald-400">{fmt(ex.total || (ex.quantity || 1) * (ex.rate || 0))}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Fuel Ups */}
                        {(() => {
                          const fuel = tripFuel[trip.trip_number];
                          if (fuelLoading === trip.trip_number) {
                            return (
                              <div className="px-4 py-3">
                                <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">⛽ Fuel</p>
                                <p className="text-[10px] text-zinc-600 animate-pulse">Loading fuel data...</p>
                              </div>
                            );
                          }
                          if (!fuel || fuel.length === 0) return null;
                          const fuelTotal = fuel.reduce((s: number, f: any) => s + (f.amount_usd || 0), 0);
                          const fuelGal = fuel.reduce((s: number, f: any) => s + (f.quantity || 0), 0);
                          return (
                            <div className="px-4 py-2 pb-4">
                              <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">
                                ⛽ Fuel · {fuel.length} stop{fuel.length !== 1 ? 's' : ''} · {fuelGal.toFixed(1)} gal · {fmt(fuelTotal)}
                              </p>
                              <div className="space-y-1.5">
                                {fuel.map((f: any) => (
                                  <div key={f.id || f.date} className="flex items-center justify-between py-1.5 px-3 bg-zinc-900/60 rounded-xl">
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-zinc-400 font-bold">
                                        {f.location || 'Unknown'}
                                      </span>
                                      <span className="text-[9px] text-zinc-600">{formatDateDisplay(f.date)}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[10px] text-zinc-500">{f.quantity?.toFixed(1) || '?'} gal</span>
                                      {f.quantity > 0 && f.amount_usd > 0 && (
                                        <span className="text-[9px] text-zinc-600">@ ${(f.amount_usd / f.quantity).toFixed(3)}/gal</span>
                                      )}
                                      <span className="text-xs font-bold text-orange-400">{fmt(f.amount_usd || 0)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="px-4 pb-3">
                          <Link
                            href={`/dispatch/${trip.trip_number}?from=dashboard`}
                            className="inline-block text-[10px] font-black uppercase tracking-wider text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            View Full Trip →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Fuel Ups ── */}
        {(() => {
          const periodObj = periods.find(p => p.payDate === selectedPeriod);
          if (!periodObj) return null;
          const periodFuel = fuelEntries.filter(f => {
            if (!f.date) return false;
            return f.date >= periodObj.startDate && f.date <= periodObj.endDate;
          });

          const totalGallons = periodFuel.reduce((s, f) => s + (f.quantity || 0), 0);
          const totalCost = periodFuel.reduce((s, f) => s + (f.amount_usd || 0), 0);
          const avgPerGal = totalGallons > 0 ? totalCost / totalGallons : 0;

          if (periodFuel.length === 0) return null;

          return (
            <section className="bg-zinc-950 border border-cyan-900/30 rounded-3xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400/80">⛽ Fuel Ups</p>
                  <p className="text-lg font-black text-cyan-400 mt-1">{fmt(totalCost)}</p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[10px] text-zinc-500 font-bold">
                    <span className="text-zinc-300">{totalGallons.toFixed(1)} gal</span> · avg <span className="text-cyan-400">${avgPerGal.toFixed(3)}/gal</span>
                  </p>
                  <p className="text-[10px] text-zinc-600 font-bold">{periodFuel.length} fuel up{periodFuel.length !== 1 ? 's' : ''}</p>
                </div>
              </div>

              <div className="space-y-1">
                {periodFuel.map(f => {
                  const gal = f.quantity || 0;
                  const cost = f.amount_usd || 0;
                  const ppg = gal > 0 ? cost / gal : 0;
                  return (
                    <div key={f.id} className="flex items-center justify-between py-2 px-3 bg-zinc-900/50 rounded-xl">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-[10px] text-zinc-500 font-bold flex-shrink-0">
                          {f.date ? formatDateDisplay(f.date) : '—'}
                        </span>
                        <span className="text-xs text-zinc-300 font-bold truncate">{f.location || 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        <span className="text-[10px] text-zinc-500 font-bold">{gal.toFixed(1)} gal</span>
                        <span className="text-[10px] text-cyan-400/70 font-bold">${ppg.toFixed(3)}</span>
                        <span className="text-xs font-black text-cyan-400">{fmt(cost)}</span>
                        {f.trip_number && (
                          <span className="text-[9px] text-zinc-600 font-black">#{f.trip_number}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}

        {/* ── Rates reference ── */}
        <section className="bg-zinc-950 border border-zinc-800/40 rounded-3xl p-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-3">Active Rates</p>
          <div className="flex gap-6 text-xs flex-wrap">
            <div><span className="text-zinc-500 font-bold">🇺🇸 US </span><span className="text-white font-black">${rates.us}/mi</span></div>
            <div><span className="text-zinc-500 font-bold">🇨🇦 CA &lt;1000 </span><span className="text-white font-black">${rates.canadaUnder1000}/mi</span></div>
            <div><span className="text-zinc-500 font-bold">🇨🇦 CA &gt;1000 </span><span className="text-white font-black">${rates.canadaOver1000}/mi</span></div>
            {safetyBonus.enabled && (
              <div className="text-zinc-400">
                🛡️ Safety: <span className="text-emerald-400 font-black">${safetyBonus.rate_per_mile.toFixed(2)}/mi</span>
                <span className="text-zinc-600"> (base: ${(rates.us - safetyBonus.rate_per_mile).toFixed(2)}/mi)</span>
              </div>
            )}
            <Link href="/dispatch/settings#pay-rates" className="text-blue-500 font-black hover:text-blue-400 transition-colors">Edit Rates →</Link>
          </div>
        </section>

        {/* ── Reimbursement Modal ── */}
        {showExpenseForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowExpenseForm(false)}>
            <div className="bg-zinc-950 border border-emerald-800/40 rounded-3xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-black uppercase tracking-widest text-emerald-400">+ Add Reimbursement</p>
                <button onClick={() => setShowExpenseForm(false)} className="text-zinc-600 hover:text-white text-lg">✕</button>
              </div>

              {/* Expense name dropdown */}
              <select
                value={expForm.name}
                onChange={e => {
                  const val = e.target.value;
                  const cat = REIMBURSEMENT_CATEGORY_MAP[val] || expForm.category;
                  setExpForm(f => ({ ...f, name: val, category: cat }));
                }}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-600"
              >
                <option value="">— Select Expense Type —</option>
                {REIMBURSEMENT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.emoji} {o.value}</option>
                ))}
                <option value="custom">✏️ Custom...</option>
              </select>

              {/* Custom name input */}
              {expForm.name === 'custom' && (
                <input
                  type="text"
                  placeholder="Custom expense name"
                  value={expForm.customName}
                  onChange={e => setExpForm(f => ({ ...f, customName: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-emerald-600"
                />
              )}

              {/* Amount */}
              <input
                type="number"
                placeholder="Amount ($)"
                value={expForm.amount}
                onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-emerald-600"
              />

              {/* Category (auto-filled, editable) */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Category</label>
                <select
                  value={expForm.category}
                  onChange={e => setExpForm(f => ({ ...f, category: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-600"
                >
                  <option value="toll">🛣 Toll</option>
                  <option value="fuel">⛽ Fuel</option>
                  <option value="misc">📦 Misc</option>
                  <option value="violation">⚠️ Violation</option>
                  <option value="equipment">🔧 Equipment</option>
                  <option value="other">📌 Other</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Date</label>
                <input
                  type="date"
                  value={expForm.date}
                  onChange={e => setExpForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-600"
                />
              </div>

              {/* Trip number (optional) */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Link to Trip (optional)</label>
                <select
                  value={expForm.trip_number}
                  onChange={e => setExpForm(f => ({ ...f, trip_number: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-emerald-600"
                >
                  <option value="">— No linked trip —</option>
                  {allTrips.map(t => (
                    <option key={t.trip_number} value={t.trip_number}>#{t.trip_number} {t.first_stop ? `(${t.first_stop})` : ''}</option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <input
                type="text"
                placeholder="Notes (optional)"
                value={expForm.notes}
                onChange={e => setExpForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-emerald-600"
              />

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={addExpense}
                  className="flex-1 text-[10px] font-black uppercase tracking-wider px-4 py-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-500 transition-all"
                >
                  Save Reimbursement
                </button>
                <button
                  onClick={() => setShowExpenseForm(false)}
                  className="text-[10px] font-black uppercase tracking-wider px-4 py-3 rounded-xl bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Deduction Modal ── */}
        {showDeductionForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowDeductionForm(false)}>
            <div className="bg-zinc-950 border border-red-800/40 rounded-3xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <p className="text-sm font-black uppercase tracking-widest text-red-400">− Add Deduction</p>
                <button onClick={() => setShowDeductionForm(false)} className="text-zinc-600 hover:text-white text-lg">✕</button>
              </div>

              {/* Deduction name dropdown */}
              <select
                value={dedForm.name}
                onChange={e => setDedForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-red-600"
              >
                <option value="">— Select Deduction Type —</option>
                {DEDUCTION_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.emoji} {o.value}</option>
                ))}
                <option value="custom">✏️ Custom...</option>
              </select>

              {/* Custom name input */}
              {dedForm.name === 'custom' && (
                <input
                  type="text"
                  placeholder="Custom deduction name"
                  value={dedForm.customName}
                  onChange={e => setDedForm(f => ({ ...f, customName: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-red-600"
                />
              )}

              {/* Amount */}
              <input
                type="number"
                placeholder="Amount ($)"
                value={dedForm.amount}
                onChange={e => setDedForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white placeholder-zinc-600 outline-none focus:border-red-600"
              />

              {/* Date */}
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1 block">Date</label>
                <input
                  type="date"
                  value={dedForm.date}
                  onChange={e => setDedForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 text-xs text-white outline-none focus:border-red-600"
                />
              </div>

              {/* Recurring toggle */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => setDedForm(f => ({ ...f, is_recurring: !f.is_recurring }))}
                    className={`relative w-11 h-6 rounded-full transition-colors ${dedForm.is_recurring ? 'bg-red-600' : 'bg-zinc-700'}`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${dedForm.is_recurring ? 'translate-x-5' : ''}`} />
                  </div>
                  <span className="text-xs text-zinc-300 font-bold">Recurring deduction</span>
                </label>

                {dedForm.is_recurring && (
                  <div className="flex gap-2">
                    {(['weekly', 'biweekly', 'monthly'] as const).map(freq => (
                      <button
                        key={freq}
                        onClick={() => setDedForm(f => ({ ...f, recurring_frequency: freq }))}
                        className={`flex-1 text-[10px] font-black uppercase tracking-wider px-3 py-2 rounded-xl transition-all ${
                          dedForm.recurring_frequency === freq
                            ? 'bg-red-600/30 text-red-300 border border-red-600'
                            : 'bg-zinc-900 text-zinc-500 border border-zinc-800'
                        }`}
                      >
                        {freq === 'weekly' ? 'Weekly' : freq === 'biweekly' ? 'Biweekly' : 'Monthly'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={addDeduction}
                  className="flex-1 text-[10px] font-black uppercase tracking-wider px-4 py-3 rounded-xl bg-red-600 text-white hover:bg-red-500 transition-all"
                >
                  Save Deduction
                </button>
                <button
                  onClick={() => setShowDeductionForm(false)}
                  className="text-[10px] font-black uppercase tracking-wider px-4 py-3 rounded-xl bg-zinc-800 text-zinc-400 hover:text-white transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

      </main>
    </AuthGuard>
  );
}
