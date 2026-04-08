'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { calcTripPay, PAYABLE_DEFAULTS, type PayableItem, type MileRates, type TripPayInput } from '@/lib/trip-pay';

// User-configurable extra pay items (fetched from settings)
let userExtraPayItems: Array<{ name: string; rate: number; unit: string }> = [];

export default function TripDetailsClient({ trip, stops, extraPay, inventory }: { trip: any, stops: any[], extraPay: any[], inventory: any[] }) {
  const [currentTrip, setCurrentTrip] = useState(trip);
  const [currentStops, setCurrentStops] = useState(stops);
  const [currentExtras, setCurrentExtras] = useState(extraPay);
  const [isSaving, setIsSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showEquipmentModal, setShowEquipmentModal] = useState(false);
  const [activeEquipmentField, setActiveEquipmentField] = useState<string | null>(null);
  const [extraMinutes, setExtraMinutes] = useState<{[key: string]: number}>({});
  const [rateInput, setRateInput] = useState<string>((trip.manual_rate || 1.06).toString());
  const [showRatePicker, setShowRatePicker] = useState(false);
  const [showAddHUD, setShowAddHUD] = useState(false);
  const searchParams = useSearchParams();
  const backHref = searchParams.get('from') === 'dashboard' ? '/dispatch/dashboard' : '/dispatch/trips';
  const [showAllPayables, setShowAllPayables] = useState(false);
  const [showPayBreakdown, setShowPayBreakdown] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [addingStop, setAddingStop] = useState(false);
  const [deletingStopId, setDeletingStopId] = useState<number | null>(null);
  const [addingFuel, setAddingFuel] = useState(false);
  const [tripFuel, setTripFuel] = useState<any[]>([]);
  const [loadingFuel, setLoadingFuel] = useState(false);
  const [showNewPayableForm, setShowNewPayableForm] = useState(false);
  const [newPayableName, setNewPayableName] = useState('');
  const [newPayableRateType, setNewPayableRateType] = useState<'hourly' | 'fixed'>('fixed');
  const [newPayableAmount, setNewPayableAmount] = useState('');
  const [creatingPayable, setCreatingPayable] = useState(false);
  const [payConfig, setPayConfig] = useState<{
    baseRates: { usRate: number; canadaUnder: number; canadaOver: number };
    customRules: any[];
    tripDefaults: { freeWaitHours: number; maxWaitHours: number; maxCityWorkHours: number };
  } | null>(null);
  const [safetyBonus, setSafetyBonus] = useState<{ rate_per_mile: number; enabled: boolean }>({ rate_per_mile: 0, enabled: false });

  // Reimbursements state
  const [reimbursements, setReimbursements] = useState<any[]>([]);
  const [showReimbForm, setShowReimbForm] = useState(false);
  const [reimbName, setReimbName] = useState('');
  const [reimbAmount, setReimbAmount] = useState('');
  const [reimbCurrency, setReimbCurrency] = useState<'CAD' | 'USD'>('CAD');
  const [reimbNotes, setReimbNotes] = useState('');
  const [reimbSaving, setReimbSaving] = useState(false);
  const [editingReimbId, setEditingReimbId] = useState<number | null>(null);
  const [prevReimbNames, setPrevReimbNames] = useState<string[]>([]);

  useEffect(() => { setMounted(true); }, []);

  // Fetch fuel entries for this trip
  useEffect(() => {
    if (!trip.trip_number) return;
    setLoadingFuel(true);
    fetch(`/api/dispatch/fuel?trip_number=${encodeURIComponent(trip.trip_number)}`)
      .then(r => r.json())
      .then(data => setTripFuel(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingFuel(false));
  }, [trip.trip_number, actionSuccess]);

  // Fetch reimbursements for this trip
  useEffect(() => {
    if (!trip.trip_number) return;
    fetch(`/api/dispatch/expenses?trip_number=${trip.trip_number}&expense_type=trip`)
      .then(r => r.json())
      .then(data => {
        const exps = data.expenses || [];
        setReimbursements(exps);
        const names = [...new Set<string>(exps.map((e: any) => e.name as string))];
        setPrevReimbNames(names);
      })
      .catch(() => {});
  }, [trip.trip_number]);

  // Fetch user's pay configuration
  useEffect(() => {
    fetch('/api/dispatch/settings/pay-config')
      .then(r => r.json())
      .then(data => {
        setPayConfig({
          baseRates: data.baseRates || { usRate: 1.06, canadaUnder: 1.26, canadaOver: 1.16 },
          customRules: data.customRules || [],
          tripDefaults: data.tripDefaults || { freeWaitHours: 3, maxWaitHours: 6, maxCityWorkHours: 14 },
        });
        // Load user extra pay items
        if (data?.extraPayItems?.length > 0) {
          userExtraPayItems = data.extraPayItems.map((item: any) => ({
            name: item.name,
            rate: parseFloat(item.amount) || 0,
            unit: item.rate_type === 'hourly' ? 'hour' : item.rate_type === 'per_mile' ? 'dollar' : 'qty',
          }));
        }
      })
      .catch(() => {
        // Use defaults on error
        setPayConfig({
          baseRates: { usRate: 1.06, canadaUnder: 1.26, canadaOver: 1.16 },
          customRules: [],
          tripDefaults: { freeWaitHours: 3, maxWaitHours: 6, maxCityWorkHours: 14 },
        });
      });
    // Load safety bonus config
    fetch('/api/dispatch/safety-bonus')
      .then(r => r.json())
      .then(data => {
        if (data.safety_bonus) {
          setSafetyBonus({
            rate_per_mile: data.safety_bonus.rate_per_mile || 0.02,
            enabled: data.safety_bonus.enabled || false,
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentTrip?.manual_rate !== undefined) {
      setRateInput((currentTrip.manual_rate || 1.06).toString());
    }
  }, [currentTrip?.manual_rate]);

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

  const getPayItems = (): PayableItem[] => {
    const userItems = userExtraPayItems.map(item => ({
      ...item,
      unit: item.unit || 'qty',
    }));
    // Merge: user items override defaults with same name, plus any new user items
    const userNames = new Set(userItems.map(i => i.name));
    const defaults = PAYABLE_DEFAULTS.filter(p => !userNames.has(p.name));
    return [...defaults, ...userItems];
  };

  const createPayableType = async () => {
    if (!newPayableName.trim() || !newPayableAmount) return;
    setCreatingPayable(true);
    setActionError(null);
    try {
      const res = await fetch('/api/dispatch/settings/extra-pay-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newPayableName.trim(),
          rate_type: newPayableRateType,
          amount: parseFloat(newPayableAmount),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Failed to create payable type');
      // Add to local userExtraPayItems so it appears immediately
      const newItem = {
        name: newPayableName.trim(),
        rate: parseFloat(newPayableAmount),
        unit: newPayableRateType === 'hourly' ? 'hour' : 'qty',
      };
      userExtraPayItems = [...userExtraPayItems, newItem];
      // Reset form
      setNewPayableName('');
      setNewPayableAmount('');
      setNewPayableRateType('fixed');
      setShowNewPayableForm(false);
      setActionSuccess(`"${newItem.name}" added to payables`);
      setTimeout(() => setActionSuccess(null), 3000);
      // Force re-render
      setCurrentExtras([...currentExtras]);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to create payable type');
    } finally {
      setCreatingPayable(false);
    }
  };

  const updatePayableQty = async (typeName: string, delta: number) => {
    const existing = currentExtras.filter(e => e.type === typeName);
    const payable = getPayItems().find(p => p.name === typeName);

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
    if (!currentTrip || !currentExtras) return { milePay: 0, items: [], grandTotal: 0, ratePerMile: 0, rateLabel: '', miles: 0 };

    const baseRates = payConfig?.baseRates || { usRate: 1.06, canadaUnder: 1.26, canadaOver: 1.16 };
    const mileRates: MileRates = {
      us: baseRates.usRate,
      canadaUnder1000: baseRates.canadaUnder,
      canadaOver1000: baseRates.canadaOver,
    };

    const tripInput: TripPayInput = {
      total_miles: currentTrip.total_miles,
      manual_rate: currentTrip.manual_rate,
      extra_pay_json: JSON.stringify(currentExtras),
      route: currentTrip.route || null,
      first_stop: currentStops?.[0]?.location || null,
      last_stop: currentStops?.[currentStops.length - 1]?.location || null,
    };

    const result = calcTripPay(tripInput, mileRates, getPayItems());

    // Convert extraBreakdown record to items array for the breakdown modal
    const items = Object.entries(result.extraBreakdown).map(([name, total]) => ({ name, total }));

    return {
      milePay: result.milePay,
      items,
      grandTotal: result.total,
      ratePerMile: result.ratePerMile,
      rateLabel: result.rateLabel,
      miles: currentTrip.total_miles || 0,
    };
  }, [currentTrip?.total_miles, currentTrip?.manual_rate, currentExtras, extraMinutes, currentStops, payConfig]);

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
    return <div className="min-h-screen bg-zinc-950 text-emerald-400 font-mono p-10">Initializing Trip Data...</div>;
  }

  const startOdo = currentTrip.start_odometer;
  const endOdo = currentTrip.end_odometer;
  const totalKilos = (startOdo !== null && endOdo !== null) ? (endOdo - startOdo) : null;
  const isMileageIncomplete = !currentStops[currentStops.length - 1]?.location?.includes('Caledon, ON');

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 font-sans selection:bg-emerald-500/30">
      <header className="max-w-6xl mx-auto mb-10 flex items-center justify-between border-b border-zinc-900 pb-8">
        <div className="flex items-center gap-6">
          <Link href={backHref} className="bg-zinc-900 p-3 rounded-2xl hover:bg-zinc-800 border border-zinc-800 transition-all shadow-lg">
            <span className="text-zinc-400">←</span>
          </Link>
          <div>
            <h1 className="text-4xl font-black font-mono tracking-tighter">{currentTrip.trip_number}</h1>
            <div className="flex items-center gap-4 mt-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  currentTrip.status === 'Active' ? 'bg-emerald-500 animate-pulse' :
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
                className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1 text-[10px] font-black uppercase text-zinc-400 outline-none focus:border-emerald-500 transition-all cursor-pointer"
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
                className="bg-zinc-900/50 border border-emerald-600/30 px-6 py-3 rounded-2xl text-right hover:border-emerald-500 transition-all group"
            >
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest leading-none mb-1 group-hover:text-emerald-400">Estimated Total Pay ⓘ</p>
                <p className="text-2xl font-black text-emerald-400 font-mono tracking-tighter">{paySummary.grandTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                <p className="text-[8px] text-zinc-600 mt-1">{paySummary.rateLabel} • {currentTrip.total_miles || 0} mi</p>
            </button>
            <div className="flex flex-col gap-2">
              {/* Current Rate Display */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 bg-zinc-900/80 border border-zinc-700/50 rounded-xl px-3 py-2">
                  <span className="text-lg font-black font-mono text-emerald-400">${paySummary.ratePerMile.toFixed(2)}</span>
                  <span className="text-[10px] text-zinc-500 font-black">/mi</span>
                  <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider ${
                    currentTrip.rate_type === 'manual' || currentTrip.manual_rate
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {currentTrip.rate_type === 'manual' || currentTrip.manual_rate ? '✎ Manual' : `⚡ Auto: ${paySummary.rateLabel}`}
                  </span>
                </div>
                <button
                  onClick={() => setShowRatePicker(!showRatePicker)}
                  className={`text-[9px] font-black uppercase px-3 py-2 rounded-xl border transition-all ${
                    showRatePicker
                      ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                      : 'bg-zinc-900/50 border-zinc-700/50 text-zinc-400 hover:text-zinc-300 hover:border-zinc-600'
                  }`}
                >
                  Change Rate
                </button>
              </div>

              {/* Rate Picker Dropdown */}
              {showRatePicker && (
                <div className="bg-zinc-950/90 border border-zinc-700/50 rounded-2xl p-4 space-y-3 backdrop-blur-sm">
                  <div className="grid grid-cols-2 gap-2">
                    {/* US Rate */}
                    <button
                      onClick={async () => {
                        const rate = payConfig?.baseRates?.usRate || 1.06;
                        setIsSaving(true);
                        try {
                          const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ manual_rate: rate, rate_type: 'manual' })
                          });
                          if (!res.ok) throw new Error('Save failed');
                          setCurrentTrip({ ...currentTrip, manual_rate: rate, rate_type: 'manual' });
                          setRateInput(rate.toString());
                          setActionSuccess('Rate set to US');
                          setTimeout(() => setActionSuccess(null), 2000);
                        } catch (err: any) { setActionError(err?.message || 'Save failed'); }
                        finally { setIsSaving(false); }
                      }}
                      disabled={isSaving}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        currentTrip.rate_type !== 'manual' && !currentTrip.manual_rate && paySummary.rateLabel === 'USA'
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-zinc-500 tracking-wider">US Rate</span>
                        <span className="text-[8px] text-zinc-600">🇺🇸</span>
                      </div>
                      <p className="text-sm font-black font-mono text-zinc-200 mt-1">${(payConfig?.baseRates?.usRate || 1.06).toFixed(2)}/mi</p>
                    </button>

                    {/* Canada < 1000mi */}
                    <button
                      onClick={async () => {
                        const rate = payConfig?.baseRates?.canadaUnder || 1.26;
                        setIsSaving(true);
                        try {
                          const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ manual_rate: rate, rate_type: 'manual' })
                          });
                          if (!res.ok) throw new Error('Save failed');
                          setCurrentTrip({ ...currentTrip, manual_rate: rate, rate_type: 'manual' });
                          setRateInput(rate.toString());
                          setActionSuccess('Rate set to Canada <1000mi');
                          setTimeout(() => setActionSuccess(null), 2000);
                        } catch (err: any) { setActionError(err?.message || 'Save failed'); }
                        finally { setIsSaving(false); }
                      }}
                      disabled={isSaving}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        currentTrip.rate_type !== 'manual' && !currentTrip.manual_rate && paySummary.rateLabel === 'CAD (<1000mi)'
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-zinc-500 tracking-wider">Canada &lt;1000mi</span>
                        <span className="text-[8px] text-zinc-600">🇨🇦</span>
                      </div>
                      <p className="text-sm font-black font-mono text-zinc-200 mt-1">${(payConfig?.baseRates?.canadaUnder || 1.26).toFixed(2)}/mi</p>
                    </button>

                    {/* Canada > 1000mi */}
                    <button
                      onClick={async () => {
                        const rate = payConfig?.baseRates?.canadaOver || 1.16;
                        setIsSaving(true);
                        try {
                          const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ manual_rate: rate, rate_type: 'manual' })
                          });
                          if (!res.ok) throw new Error('Save failed');
                          setCurrentTrip({ ...currentTrip, manual_rate: rate, rate_type: 'manual' });
                          setRateInput(rate.toString());
                          setActionSuccess('Rate set to Canada >1000mi');
                          setTimeout(() => setActionSuccess(null), 2000);
                        } catch (err: any) { setActionError(err?.message || 'Save failed'); }
                        finally { setIsSaving(false); }
                      }}
                      disabled={isSaving}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        currentTrip.rate_type !== 'manual' && !currentTrip.manual_rate && paySummary.rateLabel === 'CAD (>1000mi)'
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-zinc-500 tracking-wider">Canada &gt;1000mi</span>
                        <span className="text-[8px] text-zinc-600">🇨🇦</span>
                      </div>
                      <p className="text-sm font-black font-mono text-zinc-200 mt-1">${(payConfig?.baseRates?.canadaOver || 1.16).toFixed(2)}/mi</p>
                    </button>

                    {/* Auto Reset */}
                    <button
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ manual_rate: null, rate_type: 'auto' })
                          });
                          if (!res.ok) throw new Error('Save failed');
                          setCurrentTrip({ ...currentTrip, manual_rate: null, rate_type: 'auto' });
                          setRateInput('1.06');
                          setActionSuccess('Rate reset to Auto');
                          setTimeout(() => setActionSuccess(null), 2000);
                        } catch (err: any) { setActionError(err?.message || 'Save failed'); }
                        finally { setIsSaving(false); }
                      }}
                      disabled={isSaving}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        !currentTrip.manual_rate && currentTrip.rate_type !== 'manual'
                          ? 'bg-emerald-500/10 border-emerald-500/40'
                          : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-zinc-500 tracking-wider">Auto Detect</span>
                        <span className="text-[8px] text-zinc-600">⚡</span>
                      </div>
                      <p className="text-sm font-black font-mono text-zinc-200 mt-1">Auto</p>
                    </button>
                  </div>

                  {/* Custom Rate */}
                  <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/50">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Custom:</span>
                    <span className="text-[10px] text-zinc-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={rateInput}
                      onChange={(e) => setRateInput(e.target.value)}
                      className="w-24 bg-black/40 border border-zinc-800 rounded-lg px-2 py-1.5 text-sm font-mono font-black text-emerald-400 focus:border-emerald-500 outline-none"
                    />
                    <span className="text-[10px] text-zinc-400">/mi</span>
                    <button
                      onClick={async () => {
                        const rate = parseFloat(rateInput);
                        if (!rate || rate <= 0) return;
                        setIsSaving(true);
                        setActionError(null);
                        try {
                          const res = await fetch(`/api/dispatch/${currentTrip.trip_number}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ manual_rate: rate, rate_type: 'manual' })
                          });
                          if (!res.ok) {
                            const data = await res.json().catch(() => ({}));
                            throw new Error(data?.error || 'Save failed');
                          }
                          setCurrentTrip({ ...currentTrip, manual_rate: rate, rate_type: 'manual' });
                          setActionSuccess('Custom rate saved');
                          setTimeout(() => setActionSuccess(null), 2000);
                        } catch (err: any) {
                          setActionError(err?.message || 'Save failed');
                        } finally { setIsSaving(false); }
                      }}
                      disabled={isSaving}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg transition-all"
                    >
                      {isSaving ? '...' : 'Apply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 h-full">
              <a
                href={currentTrip.pdf_path || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { if (!currentTrip.pdf_path) e.preventDefault(); }}
                className="bg-zinc-900 hover:bg-zinc-800 text-[10px] font-black uppercase px-4 py-3 rounded-xl border border-zinc-800 transition-all flex items-center gap-2"
              >
                📄 View PDF
              </a>
              <a
                href={`/api/dispatch/envelope?trip=${encodeURIComponent(currentTrip.trip_number)}`}
                download={`trip-envelope-${currentTrip.trip_number}.pdf`}
                className="bg-red-700 hover:bg-red-600 text-white text-[10px] font-black uppercase px-4 py-3 rounded-xl border border-red-600 transition-all flex items-center gap-2"
              >
                📋 Trip Envelope
              </a>
            </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8 pb-20">
        {(isSaving || actionError || actionSuccess) && (
          <div className="text-xs font-bold rounded-xl border px-4 py-3 bg-zinc-900/50 border-zinc-800">
            {isSaving && <p className="text-emerald-400">Saving changes...</p>}
            {!isSaving && actionError && <p className="text-red-400">{actionError}</p>}
            {!isSaving && !actionError && actionSuccess && <p className="text-green-400">{actionSuccess}</p>}
          </div>
        )}

        {/* Stop Counters */}
        <div className="flex flex-wrap gap-2 mt-3 mb-2">
          {(() => {
            const pickups = currentStops.filter(s => (s.stop_type || '').toUpperCase() === 'PICKUP').length;
            const deliveries = currentStops.filter(s => (s.stop_type || '').toUpperCase() === 'DELIVER' || (s.stop_type || '') === 'Delivery').length;
            const layovers = currentExtras.filter(e => e.type === 'Layover').reduce((sum, e) => sum + (e.quantity || 1), 0);
            const extraPU = currentExtras.filter(e => e.type === 'Extra Pickup').reduce((sum, e) => sum + (e.quantity || 1), 0);
            const extraDL = currentExtras.filter(e => e.type === 'Extra Delivery').reduce((sum, e) => sum + (e.quantity || 1), 0);
            const switches = currentExtras.filter(e => e.type === 'Trailer Switch').reduce((sum, e) => sum + (e.quantity || 1), 0);

            return (
              <>
                {pickups > 0 && <span className="text-[9px] font-black uppercase bg-green-900/30 border border-green-700/40 text-green-400 px-2 py-1 rounded-full">🚛 {pickups} Pickup{pickups > 1 ? 's' : ''}</span>}
                {deliveries > 0 && <span className="text-[9px] font-black uppercase bg-blue-900/30 border border-blue-700/40 text-emerald-400 px-2 py-1 rounded-full">📦 {deliveries} Deliver{deliveries > 1 ? 'ies' : 'y'}</span>}
                {layovers > 0 && <span className="text-[9px] font-black uppercase bg-purple-900/30 border border-purple-700/40 text-purple-400 px-2 py-1 rounded-full">🛏 {layovers} Layover{layovers > 1 ? 's' : ''}</span>}
                {extraPU > 0 && <span className="text-[9px] font-black uppercase bg-cyan-900/30 border border-cyan-700/40 text-cyan-400 px-2 py-1 rounded-full">➕ {extraPU} Extra PU</span>}
                {extraDL > 0 && <span className="text-[9px] font-black uppercase bg-amber-900/30 border border-amber-700/40 text-amber-400 px-2 py-1 rounded-full">➕ {extraDL} Extra DL</span>}
                {switches > 0 && <span className="text-[9px] font-black uppercase bg-orange-900/30 border border-orange-700/40 text-orange-400 px-2 py-1 rounded-full">🔄 {switches} Switch{switches > 1 ? 'es' : ''}</span>}
              </>
            );
          })()}
        </div>

        {/* OVERVIEW - Mobile View */}
        <section className="md:hidden bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 md:p-10 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-600 shadow-[2px_0_10px_rgba(16,185,129,0.4)]"></div>
          <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-10">Trip Overview</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 text-center md:text-left">
            <div className="group relative bg-black/20 p-4 rounded-3xl border border-zinc-900 transition-all hover:border-zinc-800">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">Start Date</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-lg font-black font-mono">{formatDateDisplay(currentTrip.start_date)}</p>
                <button className="text-emerald-400 text-xs">✎</button>
              </div>
              <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('start_date', e.target.value)} />
            </div>
            <div className="group relative bg-black/20 p-4 rounded-3xl border border-zinc-900 transition-all hover:border-zinc-800">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">End Date</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-lg font-black font-mono">{formatDateDisplay(currentTrip.end_date)}</p>
                <button className="text-emerald-400 text-xs">✎</button>
              </div>
              <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('end_date', e.target.value)} />
            </div>
            <div className="bg-black/20 p-4 rounded-3xl border border-zinc-900">
              <label className="text-[10px] font-bold text-zinc-600 uppercase block mb-2">PDF Miles</label>
              <div className="flex items-center justify-center md:justify-start gap-2">
                <p className="text-2xl font-black font-mono text-zinc-300">{currentTrip.total_miles || 0}</p>
                <button onClick={() => { const m = prompt('Miles:', currentTrip.total_miles); if (m) updateField('total_miles', parseFloat(m)); }} className="text-emerald-400 text-xs">✎</button>
              </div>
              {isMileageIncomplete && <p className="text-[8px] text-orange-600 font-black uppercase mt-1 tracking-widest animate-pulse">⚠️ Incomplete</p>}
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="text-sm font-black font-mono text-emerald-400">${paySummary.ratePerMile.toFixed(2)}/mi</span>
                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider ${
                  currentTrip.rate_type === 'manual' || currentTrip.manual_rate
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-emerald-500/15 text-emerald-400'
                }`}>
                  {currentTrip.rate_type === 'manual' || currentTrip.manual_rate ? 'Manual' : 'Auto'}
                </span>
              </div>
            </div>
            <div className="flex flex-col justify-center space-y-3">
              <div className="grid grid-cols-2 gap-4">
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Start KMs</label>
                    <input type="number" defaultValue={currentTrip.start_odometer} onBlur={(e) => updateField('start_odometer', parseFloat(e.target.value))} className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono font-black focus:border-emerald-500 outline-none transition-all" />
                 </div>
                 <div className="space-y-1">
                    <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">End KMs</label>
                    <input type="number" defaultValue={currentTrip.end_odometer} onBlur={(e) => updateField('end_odometer', parseFloat(e.target.value))} className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono font-black focus:border-emerald-500 outline-none transition-all" />
                 </div>
              </div>
              {totalKilos !== null && <p className="text-[11px] font-black text-green-500 font-mono text-center uppercase tracking-widest bg-green-500/5 py-2 rounded-xl border border-green-500/10">{totalKilos.toLocaleString()} Total Kilos</p>}
            </div>
          </div>
        </section>

        {/* OVERVIEW - Desktop Futuristic View */}
        <section className="hidden md:block bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 border border-zinc-800/80 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
          {/* Futuristic background elements */}
          <div className="absolute top-0 left-0 w-px h-full bg-gradient-to-b from-transparent via-emerald-500/50 to-transparent"></div>
          <div className="absolute top-0 right-0 w-px h-full bg-gradient-to-b from-transparent via-green-500/30 to-transparent"></div>
          <div className="absolute top-4 right-4 w-20 h-20 bg-emerald-500/5 rounded-full blur-2xl"></div>
          <div className="absolute bottom-4 left-4 w-32 h-32 bg-green-500/5 rounded-full blur-3xl"></div>

          <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-8">Trip Overview</h2>

          <div className="grid grid-cols-12 gap-6">
            {/* Left: Start Date & End Date */}
            <div className="col-span-3 flex flex-col gap-4">
              <div className="group relative bg-black/40 p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/40 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Start Date</label>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xl font-black font-mono text-zinc-200">{formatDateDisplay(currentTrip.start_date)}</p>
                  <button className="text-emerald-400 text-xs hover:text-emerald-400 transition-colors">✎</button>
                </div>
                <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('start_date', e.target.value)} />
              </div>

              <div className="group relative bg-black/40 p-5 rounded-2xl border border-zinc-800/60 hover:border-emerald-500/40 transition-all duration-300">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></div>
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">End Date</label>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xl font-black font-mono text-zinc-200">{formatDateDisplay(currentTrip.end_date)}</p>
                  <button className="text-emerald-400 text-xs hover:text-emerald-400 transition-colors">✎</button>
                </div>
                <input type="date" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => updateField('end_date', e.target.value)} />
              </div>
            </div>

            {/* Middle: PDF Miles - Prominently Displayed */}
            <div className="col-span-5">
              <div className="bg-gradient-to-br from-emerald-950/30 to-transparent p-6 rounded-2xl border border-emerald-500/20 h-full flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(52,211,153,1)] animate-pulse"></div>
                  <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">PDF Miles</label>
                </div>
                <div className="flex items-end justify-between">
                  <p className="text-5xl font-black font-mono text-emerald-400 tracking-tighter drop-shadow-[0_0_20px_rgba(52,211,153,0.5)]">{currentTrip.total_miles || 0}</p>
                  <button
                    onClick={() => { const m = prompt('Miles:', currentTrip.total_miles); if (m) updateField('total_miles', parseFloat(m)); }}
                    className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-xs font-black uppercase px-4 py-2 rounded-xl border border-emerald-500/30 transition-all mb-2"
                  >
                    Edit
                  </button>
                </div>
                {isMileageIncomplete && (
                  <p className="text-[9px] text-orange-500 font-black uppercase mt-3 tracking-widest bg-orange-500/10 py-2 px-3 rounded-lg border border-orange-500/20 animate-pulse">
                    ⚠️ Mileage Incomplete
                  </p>
                )}
                {/* Rate display under miles */}
                <div className="mt-3 flex items-center gap-2">
                  <span className="text-sm font-black font-mono text-emerald-400">${paySummary.ratePerMile.toFixed(2)}/mi</span>
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider ${
                    currentTrip.rate_type === 'manual' || currentTrip.manual_rate
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                      : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {currentTrip.rate_type === 'manual' || currentTrip.manual_rate ? '✎ Manual' : `⚡ Auto: ${paySummary.rateLabel}`}
                  </span>
                </div>
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
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 group">
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
                        <button onClick={() => openInventory(item.id)} className="bg-zinc-900 p-1.5 rounded-lg text-emerald-400 text-[10px] hover:bg-emerald-600 hover:text-white transition-all">✎ Edit</button>
                    </div>
                    <button onClick={() => updateField(item.id, null)} className="absolute -top-2 -right-2 bg-red-900 hover:bg-red-600 text-white w-7 h-7 rounded-full text-[12px] font-bold opacity-0 group-item:opacity-100 transition-all flex items-center justify-center shadow-xl">×</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 group">
              <div className="flex justify-between items-center mb-8">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Payables & Extras</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowNewPayableForm(!showNewPayableForm)}
                    className="bg-zinc-900/80 hover:bg-zinc-800 text-zinc-400 text-[9px] font-black uppercase px-3 py-2 rounded-lg border border-zinc-700 transition-all"
                  >
                    + New Payable Type
                  </button>
                  <button
                    onClick={() => setShowAllPayables(!showAllPayables)}
                    className="bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-400 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-emerald-500/30 transition-all"
                  >
                    {showAllPayables ? 'Show Active Only' : '+ Add Extras'}
                  </button>
                </div>
              </div>
              {/* New Payable Type Form */}
              {showNewPayableForm && (
                <div className="bg-zinc-950/80 border border-emerald-500/30 rounded-2xl p-5 mb-4 space-y-4">
                  <h3 className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Create New Payable Type</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Name</label>
                      <input
                        type="text"
                        value={newPayableName}
                        onChange={(e) => setNewPayableName(e.target.value)}
                        placeholder="e.g. Detention"
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Pay Type</label>
                      <select
                        value={newPayableRateType}
                        onChange={(e) => setNewPayableRateType(e.target.value as 'hourly' | 'fixed')}
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 transition-all"
                      >
                        <option value="fixed">Fixed Amount</option>
                        <option value="hourly">Hourly</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">
                        {newPayableRateType === 'hourly' ? '$/hour' : 'Amount ($)'}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={newPayableAmount}
                        onChange={(e) => setNewPayableAmount(e.target.value)}
                        placeholder={newPayableRateType === 'hourly' ? '30' : '75'}
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-emerald-500 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={createPayableType}
                      disabled={creatingPayable || !newPayableName.trim() || !newPayableAmount}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-emerald-500 transition-all"
                    >
                      {creatingPayable ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => { setShowNewPayableForm(false); setNewPayableName(''); setNewPayableAmount(''); }}
                      className="bg-zinc-900 hover:bg-zinc-800 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-zinc-800 text-zinc-400 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {getPayItems().filter(p => {
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
                            <button onClick={() => updatePayableQty(payable.name, 1)} className="w-9 h-9 bg-zinc-800 hover:bg-emerald-600 rounded-xl flex items-center justify-center text-sm transition-all font-black border border-zinc-700">+</button>
                         </div>
                         {payable.unit === 'hour' && (
                            <select onChange={(e) => setExtraMinutes(p => ({...p, [payable.name]: parseInt(e.target.value)}))} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-[10px] font-black uppercase text-zinc-300 focus:border-emerald-500 outline-none shadow-inner">
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
                              className="w-24 bg-zinc-900 border border-zinc-800 rounded-xl p-2 text-sm font-mono text-green-500 text-right outline-none focus:border-emerald-500 shadow-inner"
                            />
                         )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Reimbursements Section */}
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Reimbursements</h2>
                <button
                  onClick={() => { setShowReimbForm(!showReimbForm); setEditingReimbId(null); setReimbName(''); setReimbAmount(''); setReimbCurrency('CAD'); setReimbNotes(''); }}
                  className="bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-orange-500/30 transition-all"
                >
                  {showReimbForm && !editingReimbId ? 'Cancel' : '+ Add Reimbursement'}
                </button>
              </div>

              {/* Add/Edit Form */}
              {showReimbForm && (
                <div className="bg-zinc-950/80 border border-orange-500/30 rounded-2xl p-5 mb-4 space-y-4">
                  <h3 className="text-[10px] font-black uppercase text-orange-400 tracking-widest">
                    {editingReimbId ? 'Edit Reimbursement' : 'New Reimbursement'}
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="relative">
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Name / Description</label>
                      <input
                        list="reimb-name-options"
                        type="text"
                        value={reimbName}
                        onChange={(e) => setReimbName(e.target.value)}
                        placeholder="e.g. Tolls - Ohio Turnpike"
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-orange-500 transition-all"
                      />
                      <datalist id="reimb-name-options">
                        {prevReimbNames.map(n => <option key={n} value={n} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Amount</label>
                      <input
                        type="number"
                        step="0.01"
                        value={reimbAmount}
                        onChange={(e) => setReimbAmount(e.target.value)}
                        placeholder="33.00"
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-3 text-sm font-mono outline-none focus:border-orange-500 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Currency:</label>
                      <div className="flex bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                        <button
                          type="button"
                          onClick={() => setReimbCurrency('CAD')}
                          className={`px-4 py-2 text-[10px] font-black uppercase transition-all ${reimbCurrency === 'CAD' ? 'bg-orange-600/30 text-orange-400 border-r border-zinc-800' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >CAD</button>
                        <button
                          type="button"
                          onClick={() => setReimbCurrency('USD')}
                          className={`px-4 py-2 text-[10px] font-black uppercase transition-all ${reimbCurrency === 'USD' ? 'bg-orange-600/30 text-orange-400' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >USD</button>
                      </div>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block mb-1">Notes (optional)</label>
                      <input
                        type="text"
                        value={reimbNotes}
                        onChange={(e) => setReimbNotes(e.target.value)}
                        placeholder="Optional notes..."
                        className="w-full bg-black/40 border border-zinc-800 rounded-xl p-2 text-sm font-mono outline-none focus:border-orange-500 transition-all"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={async () => {
                        if (!reimbName.trim() || !reimbAmount) return;
                        setReimbSaving(true);
                        try {
                          const noteStr = reimbNotes.trim()
                            ? `${reimbNotes.trim()}${reimbCurrency === 'USD' ? ' [USD]' : ''}`
                            : (reimbCurrency === 'USD' ? '[USD]' : null);
                          if (editingReimbId) {
                            await fetch('/api/dispatch/expenses', {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ id: editingReimbId, name: reimbName.trim(), amount: reimbAmount, notes: noteStr, category: reimbCurrency })
                            });
                          } else {
                            await fetch('/api/dispatch/expenses', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                name: reimbName.trim(),
                                amount: reimbAmount,
                                expense_type: 'trip',
                                category: reimbCurrency,
                                trip_number: currentTrip.trip_number,
                                pay_period: currentTrip.pay_period,
                                notes: noteStr
                              })
                            });
                          }
                          // Refresh list
                          const res = await fetch(`/api/dispatch/expenses?trip_number=${currentTrip.trip_number}&expense_type=trip`);
                          const data = await res.json();
                          setReimbursements(data.expenses || []);
                          // Update prev names
                          const names = [...new Set<string>((data.expenses || []).map((e: any) => e.name as string))];
                          setPrevReimbNames(names);
                          setShowReimbForm(false);
                          setEditingReimbId(null);
                          setReimbName(''); setReimbAmount(''); setReimbCurrency('CAD'); setReimbNotes('');
                        } catch (err) { console.error('Reimb save error:', err); }
                        setReimbSaving(false);
                      }}
                      disabled={reimbSaving || !reimbName.trim() || !reimbAmount}
                      className="bg-orange-600 hover:bg-orange-500 disabled:opacity-40 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-orange-500 transition-all"
                    >
                      {reimbSaving ? 'Saving...' : editingReimbId ? 'Update' : 'Save'}
                    </button>
                    {editingReimbId && (
                      <button
                        onClick={() => { setShowReimbForm(false); setEditingReimbId(null); setReimbName(''); setReimbAmount(''); setReimbCurrency('CAD'); setReimbNotes(''); }}
                        className="bg-zinc-900 hover:bg-zinc-800 px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border border-zinc-800 text-zinc-400 transition-all"
                      >Cancel</button>
                    )}
                  </div>
                </div>
              )}

              {/* Reimbursements List */}
              {reimbursements.length === 0 && !showReimbForm ? (
                <p className="text-zinc-600 text-sm text-center py-4">No reimbursements yet</p>
              ) : (
                <div className="space-y-3">
                  {reimbursements.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between bg-black/20 p-4 rounded-2xl border border-zinc-800/50 hover:border-zinc-700 transition-all group/reimb">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black text-zinc-200 truncate">{r.name}</span>
                          {r.category === 'USD' && (
                            <span className="text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-md border border-emerald-500/30">USD</span>
                          )}
                          {r.category === 'CAD' && (
                            <span className="text-[9px] font-black uppercase bg-zinc-700/30 text-zinc-500 px-2 py-0.5 rounded-md border border-zinc-700/30">CAD</span>
                          )}
                        </div>
                        {r.notes && !r.notes.match(/^\[USD\]$/) && (
                          <p className="text-[11px] text-zinc-600 mt-1 truncate">{r.notes.replace(/ ?\[USD\]$/, '')}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="text-sm font-mono font-black text-orange-400">+${parseFloat(r.amount).toFixed(2)}</span>
                        <button
                          onClick={() => {
                            setEditingReimbId(r.id);
                            setReimbName(r.name);
                            setReimbAmount(r.amount);
                            setReimbCurrency(r.category === 'USD' ? 'USD' : 'CAD');
                            const cleanNotes = (r.notes || '').replace(/ ?\[USD\]$/, '');
                            setReimbNotes(cleanNotes || '');
                            setShowReimbForm(true);
                          }}
                          className="opacity-0 group-hover/reimb:opacity-100 bg-zinc-900/80 hover:bg-zinc-800 p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-[10px] font-black transition-all border border-zinc-800"
                        >✎</button>
                        <button
                          onClick={async () => {
                            try {
                              await fetch(`/api/dispatch/expenses?id=${r.id}`, { method: 'DELETE' });
                              setReimbursements(prev => prev.filter(x => x.id !== r.id));
                            } catch (err) { console.error('Delete reimb error:', err); }
                          }}
                          className="opacity-0 group-hover/reimb:opacity-100 bg-zinc-900/80 hover:bg-red-900 p-1.5 rounded-lg text-red-500 hover:text-white text-[10px] font-black transition-all border border-zinc-800"
                        >✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Total */}
              {reimbursements.length > 0 && (
                <div className="mt-4 pt-4 border-t border-zinc-800/50 flex justify-between items-center">
                  <span className="text-[10px] font-black uppercase text-zinc-500 tracking-widest">Total Reimbursements</span>
                  <span className="text-sm font-mono font-black text-orange-400">
                    +${reimbursements.reduce((sum: number, r: any) => sum + parseFloat(r.amount || 0), 0).toFixed(2)}
                  </span>
                </div>
              )}
            </section>

            <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8">
              <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">User Notes</h2>
              <textarea defaultValue={currentTrip.notes} onBlur={(e) => updateField('notes', e.target.value)} className="w-full bg-transparent text-zinc-400 text-sm leading-relaxed min-h-[120px] outline-none resize-none" placeholder="Notes..." />
            </section>
          </div>

          <div className="lg:col-span-5 space-y-8">
            <section className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 group">
              <div className="flex justify-between items-center mb-10">
                <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">Route and Stops</h2>
                <button onClick={() => setShowAddHUD(true)} className="bg-zinc-900 hover:bg-zinc-800 text-[9px] font-black uppercase px-4 py-2 rounded-lg border border-zinc-800 transition-all">+ Add Stop</button>
              </div>
              <div className="space-y-10 relative">
                {currentStops.map((stop: any, i) => (
                  <div key={stop.id || i} className="flex gap-6 relative group/stop">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full z-10 transition-transform group-hover/stop:scale-125 ${i === 0 ? 'bg-emerald-500 shadow-[0_0_12px_rgba(52,211,153,0.6)]' : i === currentStops.length - 1 ? 'bg-green-500 shadow-[0_0_12px_rgba(34,197,94,0.6)]' : 'bg-zinc-700'}`} />
                      {i !== currentStops.length - 1 && <div className="w-px h-full bg-zinc-800 absolute top-2.5" />}
                    </div>
                    <div className="-mt-1.5 flex-grow">
                      <div className="flex justify-between items-start">
                        <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-2 font-mono">{formatDateDisplay(stop.date)}</p>
                        <button
                          onClick={() => deleteStop(stop.id, i)}
                          disabled={deletingStopId === stop.id}
                          className="bg-zinc-900/50 hover:bg-red-900 disabled:opacity-60 p-1.5 rounded-lg text-red-500 hover:text-white text-[9px] font-black transition-all border border-zinc-800 shadow-md uppercase tracking-tighter"
                        >
                          {deletingStopId === stop.id ? 'Deleting...' : 'Delete'}
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

        {/* ── Fuel Entries ── */}
        <section className="bg-black border border-zinc-900 rounded-3xl p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.3em]">
              ⛽ Fuel Entries
              {tripFuel.length > 0 && (
                <span className="ml-2 text-green-400 normal-case font-mono">({tripFuel.length})</span>
              )}
            </h2>
            {tripFuel.length > 0 && (
              <div className="flex gap-4 text-xs font-mono text-zinc-500">
                {(() => {
                  const totalGal = tripFuel.reduce((s, f) => s + (parseFloat(f.gallons) || 0), 0);
                  const totalLit = tripFuel.reduce((s, f) => s + (parseFloat(f.liters) || 0), 0);
                  const totalAmt = tripFuel.reduce((s, f) => s + (parseFloat(f.amount_usd) || 0), 0);
                  return (<>
                    {totalGal > 0 && <span className="text-green-400 font-black">{totalGal.toFixed(2)} gal</span>}
                    {totalLit > 0 && <span className="text-emerald-400 font-black">{totalLit.toFixed(1)} L</span>}
                    {totalAmt > 0 && <span className="text-yellow-400 font-black">${totalAmt.toFixed(2)}</span>}
                  </>);
                })()}
              </div>
            )}
          </div>

          {loadingFuel ? (
            <p className="text-zinc-600 text-xs font-mono">Loading fuel entries...</p>
          ) : tripFuel.length === 0 ? (
            <p className="text-zinc-700 text-xs font-mono italic">No fuel entries for this trip yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-zinc-600 uppercase tracking-widest text-[9px] border-b border-zinc-900">
                    <th className="text-left pb-2 pr-4">Date</th>
                    <th className="text-left pb-2 pr-4">Location</th>
                    <th className="text-left pb-2 pr-4">Type</th>
                    <th className="text-right pb-2 pr-4">Gallons</th>
                    <th className="text-right pb-2 pr-4">Litres</th>
                    <th className="text-right pb-2 pr-4">Price/Unit</th>
                    <th className="text-right pb-2 pr-4">Total</th>
                    <th className="text-right pb-2">Odometer</th>
                  </tr>
                </thead>
                <tbody>
                  {tripFuel.map((f, i) => (
                    <tr key={f.id || i} className="border-b border-zinc-900/50 hover:bg-zinc-900/20 transition-colors">
                      <td className="py-2 pr-4 text-zinc-400">{f.date || ''}</td>
                      <td className="py-2 pr-4 text-white font-black">
                        {f.location || ''}
                        {f.province && <span className="text-zinc-500 font-normal">, {f.province}</span>}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase ${
                          f.fuel_type === 'def' ? 'bg-blue-900/50 text-blue-400' :
                          f.fuel_type === 'both' ? 'bg-purple-900/50 text-purple-400' :
                          'bg-green-900/40 text-green-400'
                        }`}>{f.fuel_type || 'diesel'}</span>
                      </td>
                      <td className="py-2 pr-4 text-right text-zinc-300">{f.gallons ? parseFloat(f.gallons).toFixed(3) : '—'}</td>
                      <td className="py-2 pr-4 text-right text-zinc-300">{f.liters ? parseFloat(f.liters).toFixed(1) : '—'}</td>
                      <td className="py-2 pr-4 text-right text-zinc-400">
                        {f.price_per_unit ? `${f.currency === 'CAD' ? 'C$' : '$'}${parseFloat(f.price_per_unit).toFixed(3)}` : '—'}
                      </td>
                      <td className="py-2 pr-4 text-right text-yellow-400 font-black">
                        {f.amount_usd ? `$${parseFloat(f.amount_usd).toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 text-right text-zinc-500">{f.odometer ? Number(f.odometer).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* DEF summary if any */}
              {tripFuel.some(f => f.def_liters) && (
                <div className="mt-4 pt-4 border-t border-zinc-900 flex gap-6 text-xs font-mono">
                  <span className="text-zinc-600 uppercase tracking-widest">DEF Total:</span>
                  <span className="text-blue-400 font-black">
                    {tripFuel.reduce((s, f) => s + (parseFloat(f.def_liters) || 0), 0).toFixed(2)} L
                  </span>
                  <span className="text-blue-300 font-black">
                    ${tripFuel.reduce((s, f) => s + (parseFloat(f.def_cost) || 0), 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="bg-black border border-zinc-900 rounded-3xl p-10">
          <h2 className="text-[10px] font-black uppercase text-zinc-700 tracking-[0.3em] mb-8">Archived Raw PDF Data</h2>
          <div className="p-10 rounded-3xl bg-zinc-950/20 border border-zinc-900/50 overflow-x-auto shadow-inner">
            <pre className="text-[11px] text-zinc-600 font-mono leading-relaxed whitespace-pre-wrap italic">{currentTrip.raw_data || 'No raw data available.'}</pre>
          </div>
        </section>
      </main>

      {/* PAY BREAKDOWN MODAL */}
      {showPayBreakdown && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[100] flex items-center justify-center p-6">
           <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-12 max-w-xl w-full shadow-[0_0_100px_rgba(16,185,129,0.15)] relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50"></div>
              <h3 className="text-4xl font-black uppercase tracking-tighter mb-2 text-emerald-400">Pay Breakdown</h3>
              <p className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.5em] mb-12">Earnings Transparency Report</p>

              <div className="space-y-6 mb-12 max-h-[450px] overflow-y-auto pr-4 custom-scrollbar">
                <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-900 flex justify-between items-center group">
                  <div>
                    <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-1">
                      {safetyBonus.enabled ? 'Base Pay' : 'Mileage Pay'}
                    </p>
                    <p className="text-xl font-mono font-black">{paySummary.miles || 0} mi × ${(paySummary.ratePerMile - (safetyBonus.enabled ? safetyBonus.rate_per_mile : 0)).toFixed(2)} ({paySummary.rateLabel})</p>
                  </div>
                  <p className="text-2xl font-black text-white font-mono">{((paySummary.ratePerMile - (safetyBonus.enabled ? safetyBonus.rate_per_mile : 0)) * (paySummary.miles || 0)).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                </div>

                {safetyBonus.enabled && safetyBonus.rate_per_mile > 0 && (
                  <div className="bg-emerald-900/10 p-6 rounded-3xl border border-emerald-800/20 flex justify-between items-center">
                    <div>
                      <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-1">Safety Bonus</p>
                      <p className="text-md font-mono font-bold text-zinc-400">{paySummary.miles || 0} mi × ${safetyBonus.rate_per_mile.toFixed(2)}/mi</p>
                    </div>
                    <p className="text-xl font-black text-emerald-500 font-mono">+ {((paySummary.miles || 0) * safetyBonus.rate_per_mile).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                  </div>
                )}

                {paySummary.items.map((item, idx) => (
                  <div key={idx} className="bg-black/40 p-6 rounded-3xl border border-zinc-900 flex justify-between items-center">
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
                  <p className="text-5xl font-black text-emerald-400 font-mono tracking-tighter">{paySummary.grandTotal.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>
                </div>
                <button onClick={() => setShowPayBreakdown(false)} className="bg-zinc-900 hover:bg-zinc-800 p-6 rounded-3xl font-black uppercase text-[11px] tracking-[0.4em] border border-zinc-800 transition-all active:scale-95">Dismiss</button>
              </div>
           </div>
        </div>
      )}

      {showEquipmentModal && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] flex items-center justify-center p-6">
           <div className="bg-zinc-950 border border-zinc-800 rounded-3xl p-12 max-w-lg w-full shadow-[0_0_100px_rgba(16,185,129,0.1)]">
              <h3 className="text-3xl font-black uppercase tracking-tighter mb-8 text-emerald-400 uppercase">Select {activeEquipmentField?.replace('_', ' ')}</h3>
              <div className="space-y-3 mb-12 max-h-[400px] overflow-y-auto pr-3 custom-scrollbar">
                {inventory?.map(item => (
                  <button key={item.trailer_number} onClick={() => selectTrailer(item.trailer_number)} className="w-full text-left bg-zinc-900/30 p-7 rounded-3xl border border-zinc-900 hover:border-emerald-600 hover:bg-emerald-600/5 group transition-all relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-100 transition-opacity">🚛</div>
                    <p className="font-mono font-black text-3xl group-hover:text-emerald-400 transition-colors tracking-tighter">{item.trailer_number}</p>
                    <p className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mt-2 group-hover:text-emerald-500 transition-colors">Select for Trip</p>
                  </button>
                ))}
                <button onClick={() => { const n = prompt('Number:'); if(n) selectTrailer(n); }} className="w-full text-center bg-emerald-600/10 p-7 rounded-3xl border border-emerald-600/20 hover:bg-emerald-600 hover:text-white transition-all font-black uppercase text-sm tracking-widest">+ Manual Entry</button>
              </div>
              <button onClick={() => { setShowEquipmentModal(false); setActiveEquipmentField(null); }} className="w-full bg-zinc-900 hover:bg-zinc-800 p-6 rounded-3xl font-black uppercase text-[11px] tracking-[0.4em] border border-zinc-800 transition-all">Close Panel</button>
           </div>
        </div>
      )}

      {/* Floating Quick Add Button - Bottom Right */}
      <button
        onClick={() => setShowAddHUD(!showAddHUD)}
        className="fixed bottom-6 right-6 z-50 bg-emerald-600 hover:bg-emerald-500 p-4 rounded-2xl border border-emerald-500 transition-all shadow-lg shadow-emerald-600/30 active:scale-95"
      >
        <span className="text-white font-black text-lg">⚡</span>
      </button>

      {showAddHUD && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-2xl z-[100] overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 pt-20">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black uppercase tracking-tighter text-emerald-400">⚡ Quick Add</h2>
              <button onClick={() => setShowAddHUD(false)} className="bg-zinc-900 hover:bg-zinc-800 p-4 rounded-2xl border border-zinc-800 text-zinc-400 font-black uppercase text-xs tracking-widest">Close</button>
            </div>

            {/* Quick Add - Stops */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 mb-6">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Stop</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input id="newStopLocation" placeholder="Location (City, Province)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <input id="newStopDate" type="date" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <input id="newStopMiles" type="number" placeholder="Miles" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
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
              }} disabled={addingStop} className="mt-4 w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 p-4 rounded-xl font-black uppercase text-xs tracking-widest border border-emerald-500 transition-all">{addingStop ? 'Adding Stop...' : '+ Add Stop'}</button>
            </div>

            {/* Quick Add - Payables */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8 mb-6">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Extra Pay</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {getPayItems().map(p => (
                  <button key={p.name} onClick={() => updatePayableQty(p.name, 1)} className="bg-black/40 border border-zinc-800 hover:border-emerald-500 p-4 rounded-xl text-xs font-black uppercase text-zinc-400 hover:text-emerald-400 transition-all">{p.name}</button>
                ))}
              </div>
            </div>

            {/* Quick Add - Fuel */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl p-8">
              <h3 className="text-xs font-black uppercase text-zinc-500 tracking-[0.3em] mb-6">Add Fuel</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <input id="fuelCity" placeholder="City" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <select id="fuelProvince" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500">
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
                <input id="fuelAmount" type="number" placeholder="Amount (L/Gal)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <input id="fuelPrice" type="number" placeholder="Price ($)" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <input id="fuelOdometer" type="number" placeholder="Odometer" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
                <input id="fuelDate" type="date" className="bg-black/40 border border-zinc-800 rounded-xl p-4 text-sm font-mono outline-none focus:border-emerald-500" />
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
              }} disabled={addingFuel} className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-60 p-4 rounded-xl font-black uppercase text-xs tracking-widest border border-green-500 transition-all">{addingFuel ? 'Adding Fuel...' : '+ Add Fuel'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
