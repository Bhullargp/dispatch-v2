'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '../AuthGuard';

const STEPS = ['Base Pay Rates', 'Extra Pay Items', 'Trip Rules', 'Deductions'];

interface CustomRate {
  name: string;
  rate: string;
  rate_type: string;
  states: string[];
  minMiles: string;
  maxMiles: string;
}

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'];
const CA_PROVINCES = ['ON','QC','BC','AB','MB','SK','NS','NB','PE','NL','NT','YT','NU'];

export default function SetupWizard({ userId }: { userId: number }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Step 1: Base pay rates - all blank
  const [usRate, setUsRate] = useState('');
  const [canadaUnder, setCanadaUnder] = useState('');
  const [canadaOver, setCanadaOver] = useState('');
  const [customRates, setCustomRates] = useState<CustomRate[]>([]);
  const [showCustomRate, setShowCustomRate] = useState(false);
  const [newCustomRate, setNewCustomRate] = useState<CustomRate>({ name: '', rate: '', rate_type: 'per_mile', states: [], minMiles: '', maxMiles: '' });

  // Step 2: Extra pay items - editable
  const [extraItems, setExtraItems] = useState([
    { name: 'Trailer Switch', rate_type: 'fixed', amount: '30' },
    { name: 'Extra Delivery', rate_type: 'fixed', amount: '75' },
    { name: 'Extra Pickup', rate_type: 'fixed', amount: '75' },
    { name: 'Tarping', rate_type: 'fixed', amount: '75' },
    { name: 'Waiting Time', rate_type: 'hourly', amount: '30' },
    { name: 'City Work', rate_type: 'hourly', amount: '39' },
    { name: 'Tolls', rate_type: 'per_mile', amount: '1' },
    { name: 'Layover', rate_type: 'fixed', amount: '100' },
  ]);
  const [newItem, setNewItem] = useState({ name: '', rate_type: 'fixed' as string, amount: '' });

  // Step 3: Trip rules - only free wait + layover start
  const [freeWait, setFreeWait] = useState('0.00');
  const [layoverStart, setLayoverStart] = useState('0.00');

  // Step 4: Deductions
  const [setupDeductions, setSetupDeductions] = useState<{ name: string; amount: string; is_recurring: boolean }[]>([]);
  const [newDeduction, setNewDeduction] = useState({ name: '', amount: '', is_recurring: false });

  const DEDUCTION_SUGGESTIONS = [
    'Insurance', 'Phone Bill', 'Truck Payment', 'EZ Pass',
    'Child Support', 'Fuel Advance', 'Lumper Fee', 'Health Insurance',
    'Parking', 'Scale Ticket', ' Qualcomm Fee',
  ];

  const addCustomRate = () => {
    if (!newCustomRate.name || !newCustomRate.rate) return;
    setCustomRates([...customRates, { ...newCustomRate }]);
    setNewCustomRate({ name: '', rate: '', rate_type: 'per_mile', states: [], minMiles: '', maxMiles: '' });
    setShowCustomRate(false);
  };

  const removeCustomRate = (idx: number) => {
    setCustomRates(customRates.filter((_, i) => i !== idx));
  };

  const toggleState = (state: string) => {
    setNewCustomRate(r => ({
      ...r,
      states: r.states.includes(state) ? r.states.filter(s => s !== state) : [...r.states, state]
    }));
  };

  const addItem = () => {
    if (!newItem.name || !newItem.amount) return;
    setExtraItems([...extraItems, { ...newItem }]);
    setNewItem({ name: '', rate_type: 'fixed', amount: '' });
  };

  const removeItem = (idx: number) => {
    setExtraItems(extraItems.filter((_, i) => i !== idx));
  };

  const updateExtraItem = (idx: number, field: string, value: string) => {
    const updated = [...extraItems];
    updated[idx] = { ...updated[idx], [field]: value };
    setExtraItems(updated);
  };

  const saveStep = async () => {
    setSaving(true);
    setError('');
    try {
      if (step === 0) {
        // Validate base rates
        if (!usRate || !canadaUnder || !canadaOver) {
          setError('Please fill in all base pay rates');
          setSaving(false);
          return;
        }
        if (parseFloat(usRate) <= 0 || parseFloat(canadaUnder) <= 0 || parseFloat(canadaOver) <= 0) {
          setError('Base pay rates must be greater than 0');
          setSaving(false);
          return;
        }

        // Save base rates
        await fetch('/api/dispatch/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseRates: {
              usRate: parseFloat(usRate),
              canadaUnder: parseFloat(canadaUnder),
              canadaOver: parseFloat(canadaOver)
            }
          }),
        });

        // Save custom rates
        for (const cr of customRates) {
          const conditions: any = {};
          if (cr.states.length > 0) conditions.states = cr.states;
          if (cr.minMiles) conditions.minMiles = parseFloat(cr.minMiles);
          if (cr.maxMiles) conditions.maxMiles = parseFloat(cr.maxMiles);
          await fetch('/api/dispatch/settings/custom-rules', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: cr.name,
              rate: parseFloat(cr.rate),
              rate_type: cr.rate_type,
              conditions_json: conditions,
              enabled: true,
            }),
          });
        }

      } else if (step === 1) {
        // Save all extra pay items in one batch
        await fetch('/api/dispatch/settings/extra-pay-items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'replaceAll',
            items: extraItems.map(item => ({
              name: item.name,
              rate_type: item.rate_type,
              amount: parseFloat(item.amount) || 0,
            })),
          }),
        });

      } else if (step === 2) {
        // Save trip rules (don't complete setup yet)
        await fetch('/api/dispatch/settings/trip-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Free Wait Hours', rule_type: 'free_wait_hours', value: parseFloat(freeWait) || 0 }),
        });
        await fetch('/api/dispatch/settings/trip-rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Layover Start Hours', rule_type: 'layover_start_hours', value: parseFloat(layoverStart) || 0 }),
        });
      } else if (step === 3) {
        // Save deductions
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        // Current pay period: 1st-15th or 16th-end of month
        const currentPeriod = now.getDate() <= 15
          ? `${year}-${String(month + 1).padStart(2, '0')}-15`
          : `${year}-${String(month + 1).padStart(2, '0')}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, '0')}`;

        for (const d of setupDeductions) {
          await fetch('/api/dispatch/deductions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: d.name,
              amount: parseFloat(d.amount) || 0,
              pay_period: currentPeriod,
              is_recurring: d.is_recurring,
            }),
          });
        }

        // Mark setup complete
        await fetch('/api/dispatch/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'completeSetup' }),
        });
        router.push('/dispatch');
        return;
      }
      setStep(step + 1);
    } catch (e: any) {
      setError(e.message || 'Failed to save');
    }
    setSaving(false);
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl">
          {/* Progress */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                <span className="text-sm font-black">DM</span>
              </div>
              <h1 className="text-2xl font-black tracking-tighter uppercase">Setup Wizard</h1>
            </div>
            <div className="flex gap-2">
              {STEPS.map((s, i) => (
                <div key={s} className={`flex-1 h-1.5 rounded-full transition-all ${i <= step ? 'bg-emerald-600' : 'bg-zinc-800'}`} />
              ))}
            </div>
            <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mt-2">
              Step {step + 1} of {STEPS.length} — {STEPS[step]}
            </p>
          </div>

          {/* Content */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-3xl p-8">
            {error && (
              <div className="mb-6 bg-red-900/20 border border-red-800/30 rounded-xl p-3 text-red-400 text-xs font-bold">{error}</div>
            )}

            {/* STEP 1: Pay Rates */}
            {step === 0 && (
              <div className="space-y-4">
                <h2 className="text-lg font-black uppercase tracking-tight">Base Pay Rates</h2>
                <p className="text-zinc-500 text-xs">Set your default pay rates per mile for trip calculations.</p>
                <div className="grid gap-4 mt-6">
                  {[
                    { label: 'US Pay Rate ($/mile)', value: usRate, setter: setUsRate, hint: 'Pay rate for US trips' },
                    { label: 'Canada Pay Rate Under 1000mi ($/mile)', value: canadaUnder, setter: setCanadaUnder, hint: 'Pay rate for Canadian trips under 1000 miles' },
                    { label: 'Canada Pay Rate Over 1000mi ($/mile)', value: canadaOver, setter: setCanadaOver, hint: 'Pay rate for Canadian trips over 1000 miles' },
                  ].map(r => (
                    <div key={r.label} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
                      <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-2">{r.label}</label>
                      <div className="flex items-center gap-3">
                        <span className="text-zinc-500 font-black">$</span>
                        <input type="number" step="0.01" placeholder="0.00" value={r.value} onChange={e => r.setter(e.target.value)}
                          className="flex-1 bg-transparent text-lg font-black outline-none" />
                        <span className="text-zinc-600 text-xs">/mile</span>
                      </div>
                      <p className="text-zinc-600 text-[10px] mt-1">{r.hint}</p>
                    </div>
                  ))}
                </div>

                {/* Custom rates */}
                <div className="pt-4 border-t border-zinc-800 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-[10px] font-black uppercase tracking-wider text-zinc-500">Custom Pay Rates</h3>
                    <button onClick={() => setShowCustomRate(!showCustomRate)}
                      className="text-[11px] font-black uppercase tracking-wider bg-emerald-700 hover:bg-emerald-600 px-4 py-2 rounded-xl text-white transition-all">
                      {showCustomRate ? 'Cancel' : '+ Add Custom Pay Rate'}
                    </button>
                  </div>

                  {showCustomRate && (
                    <div className="bg-zinc-950 border border-emerald-800/30 rounded-2xl p-4 space-y-3 mb-3">
                      <input type="text" placeholder="Rate name (e.g. Ontario Premium)" value={newCustomRate.name}
                        onChange={e => setNewCustomRate({ ...newCustomRate, name: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-zinc-500 block mb-1">Rate Amount</label>
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500">$</span>
                            <input type="number" step="0.01" placeholder="0.00" value={newCustomRate.rate}
                              onChange={e => setNewCustomRate({ ...newCustomRate, rate: e.target.value })}
                              className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                          </div>
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-zinc-500 block mb-1">Rate Type</label>
                          <select value={newCustomRate.rate_type} onChange={e => setNewCustomRate({ ...newCustomRate, rate_type: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none">
                            <option value="per_mile">Per Mile</option>
                            <option value="per_hour">Hourly</option>
                            <option value="fixed">Fixed</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase text-zinc-500 block mb-2">Province/State (optional)</label>
                        <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                          {US_STATES.map(s => (
                            <button key={s} onClick={() => toggleState(s)}
                              className={`px-2 py-1 rounded text-[10px] font-black transition-all ${newCustomRate.states.includes(s) ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{s}</button>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {CA_PROVINCES.map(s => (
                            <button key={s} onClick={() => toggleState(s)}
                              className={`px-2 py-1 rounded text-[10px] font-black transition-all ${newCustomRate.states.includes(s) ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{s}</button>
                          ))}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-zinc-500 block mb-1">Min Miles (optional)</label>
                          <input type="number" placeholder="0" value={newCustomRate.minMiles}
                            onChange={e => setNewCustomRate({ ...newCustomRate, minMiles: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] font-black uppercase text-zinc-500 block mb-1">Max Miles (optional)</label>
                          <input type="number" placeholder="∞" value={newCustomRate.maxMiles}
                            onChange={e => setNewCustomRate({ ...newCustomRate, maxMiles: e.target.value })}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                        </div>
                      </div>
                      <button onClick={addCustomRate} disabled={!newCustomRate.name || !newCustomRate.rate}
                        className="px-6 py-2 rounded-xl font-black uppercase text-xs tracking-wider bg-emerald-700 hover:bg-emerald-600 text-white transition-all disabled:opacity-40">
                        ✓ Add Rate
                      </button>
                    </div>
                  )}

                  {customRates.map((cr, i) => (
                    <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center justify-between mb-2">
                      <div>
                        <p className="text-sm font-black">{cr.name}</p>
                        <p className="text-zinc-500 text-[10px] uppercase">
                          ${cr.rate}/{cr.rate_type === 'per_mile' ? 'mi' : cr.rate_type === 'per_hour' ? 'hr' : 'flat'}
                          {cr.states.length ? ` · ${cr.states.join(', ')}` : ''}
                          {cr.minMiles || cr.maxMiles ? ` · ${cr.minMiles || '0'}-${cr.maxMiles || '∞'}mi` : ''}
                        </p>
                      </div>
                      <button onClick={() => removeCustomRate(i)} className="text-red-500 hover:text-red-400 text-xs font-black">✕</button>
                    </div>
                  ))}

                  {customRates.length === 0 && !showCustomRate && (
                    <p className="text-zinc-600 text-[10px] text-center py-2">No custom rates added</p>
                  )}
                </div>
              </div>
            )}

            {/* STEP 2: Extra Pay Items - all editable */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-black uppercase tracking-tight">Extra Pay Items</h2>
                <p className="text-zinc-500 text-xs">Define additional pay items that can be added to trips. Edit any default item.</p>
                <div className="space-y-2 mt-4">
                  {extraItems.map((item, i) => (
                    <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <input type="text" value={item.name} onChange={e => updateExtraItem(i, 'name', e.target.value)}
                          className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                        <select value={item.rate_type} onChange={e => updateExtraItem(i, 'rate_type', e.target.value)}
                          className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-xs font-black outline-none">
                          <option value="fixed">Fixed</option>
                          <option value="hourly">Hourly</option>
                          <option value="per_mile">Per Mile</option>
                        </select>
                        <div className="flex items-center gap-1">
                          <span className="text-zinc-500 text-xs">$</span>
                          <input type="number" step="0.01" value={item.amount} onChange={e => updateExtraItem(i, 'amount', e.target.value)}
                            className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500 text-right" />
                        </div>
                        <button onClick={() => removeItem(i)} className="text-red-500 hover:text-red-400 text-xs font-black ml-1">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 mt-4">
                  <div className="flex gap-2">
                    <input type="text" placeholder="Name" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })}
                      className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                    <select value={newItem.rate_type} onChange={e => setNewItem({ ...newItem, rate_type: e.target.value })}
                      className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-2 text-xs font-black outline-none">
                      <option value="fixed">Fixed</option>
                      <option value="hourly">Hourly</option>
                      <option value="per_mile">Per Mile</option>
                    </select>
                    <input type="number" placeholder="$" value={newItem.amount} onChange={e => setNewItem({ ...newItem, amount: e.target.value })}
                      className="w-20 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500" />
                    <button onClick={addItem} className="bg-emerald-600 hover:bg-emerald-500 px-3 py-2 rounded-lg text-xs font-black transition-all">+</button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: Trip Rules - only free wait + layover */}
            {step === 2 && (
              <div className="space-y-4">
                <h2 className="text-lg font-black uppercase tracking-tight">Trip Rules</h2>
                <p className="text-zinc-500 text-xs">Set when waiting pay and layover pay start kicking in.</p>
                <div className="grid gap-4 mt-6">
                  <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-2">After how many hours does waiting pay start?</label>
                    <div className="flex items-center gap-3">
                      <input type="number" step="0.5" value={freeWait} onChange={e => setFreeWait(e.target.value)}
                        className="w-24 bg-transparent text-lg font-black outline-none" />
                      <span className="text-zinc-600 text-xs">hours</span>
                    </div>
                    <p className="text-zinc-600 text-[10px] mt-1">Free waiting time before charges apply</p>
                  </div>
                  <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4">
                    <label className="text-[10px] font-black uppercase tracking-wider text-zinc-500 block mb-2">After how many hours does layover start?</label>
                    <div className="flex items-center gap-3">
                      <input type="number" step="0.5" value={layoverStart} onChange={e => setLayoverStart(e.target.value)}
                        className="w-24 bg-transparent text-lg font-black outline-none" />
                      <span className="text-zinc-600 text-xs">hours</span>
                    </div>
                    <p className="text-zinc-600 text-[10px] mt-1">When layover pay kicks in</p>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 4: Deductions */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-lg font-black uppercase tracking-tight">Deductions</h2>
                <p className="text-zinc-500 text-xs">Add recurring or one-time deductions that come off your pay. Skip if none.</p>

                {/* Quick-add suggestions */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {DEDUCTION_SUGGESTIONS.filter(s => !setupDeductions.some(d => d.name === s) && !(newDeduction.name === s)).map(s => (
                    <button
                      key={s}
                      onClick={() => setNewDeduction(f => ({ ...f, name: s }))}
                      className="text-[10px] font-black bg-zinc-800/60 hover:bg-zinc-700/60 border border-zinc-700/50 text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>

                {/* Add deduction form */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 mt-4">
                  <div className="flex gap-2 flex-wrap">
                    <input
                      type="text"
                      placeholder="Deduction name"
                      value={newDeduction.name}
                      onChange={e => setNewDeduction(f => ({ ...f, name: e.target.value }))}
                      className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-zinc-500 text-xs">$</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={newDeduction.amount}
                        onChange={e => setNewDeduction(f => ({ ...f, amount: e.target.value }))}
                        className="w-24 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-black outline-none focus:border-emerald-500"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={newDeduction.is_recurring}
                        onChange={e => setNewDeduction(f => ({ ...f, is_recurring: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded accent-emerald-500"
                      />
                      <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Recurring</span>
                    </label>
                    <button
                      onClick={() => {
                        if (!newDeduction.name || !newDeduction.amount) return;
                        setSetupDeductions(prev => [...prev, { ...newDeduction }]);
                        setNewDeduction({ name: '', amount: '', is_recurring: false });
                      }}
                      disabled={!newDeduction.name || !newDeduction.amount}
                      className="bg-emerald-600 hover:bg-emerald-500 px-3 py-2 rounded-lg text-xs font-black transition-all disabled:opacity-40"
                    >+</button>
                  </div>
                </div>

                {/* Added deductions list */}
                {setupDeductions.length > 0 ? (
                  <div className="space-y-2 mt-3">
                    {setupDeductions.map((d, i) => (
                      <div key={i} className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black">{d.name}</span>
                          {d.is_recurring ? (
                            <span className="text-[8px] font-black uppercase bg-purple-900/30 border border-purple-700/40 text-purple-400 px-1.5 py-0.5 rounded-full">Recurring</span>
                          ) : (
                            <span className="text-[8px] font-black uppercase bg-zinc-800/50 text-zinc-500 px-1.5 py-0.5 rounded-full">One-time</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black text-red-400">${parseFloat(d.amount || '0').toFixed(2)}</span>
                          <button onClick={() => setSetupDeductions(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-400 text-xs font-black">✕</button>
                        </div>
                      </div>
                    ))}
                    <div className="pt-2 border-t border-zinc-800 flex justify-between text-xs">
                      <span className="text-zinc-500 font-bold">Total deductions</span>
                      <span className="text-red-400 font-black">
                        ${setupDeductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-zinc-600 text-[10px] text-center py-4 mt-3 border border-dashed border-zinc-800 rounded-xl">
                    No deductions added — tap a suggestion or add your own above
                  </p>
                )}
              </div>
            )}

            {/* Navigation */}
            <div className="flex justify-between mt-8">
              {step > 0 ? (
                <button onClick={() => setStep(step - 1)}
                  className="px-6 py-3 rounded-xl font-black uppercase text-xs tracking-wider bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 transition-all">
                  ← Back
                </button>
              ) : <div />}
              <button onClick={saveStep} disabled={saving}
                className="px-6 py-3 rounded-xl font-black uppercase text-xs tracking-wider bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] disabled:opacity-60 text-white transition-all">
                {saving ? 'Saving...' : step === 3 ? '✓ Complete Setup' : 'Continue →'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
