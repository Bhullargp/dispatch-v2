'use client';

import React, { useState, useEffect, useMemo } from 'react';

const LOCATIONS = {
  // Canadian Provinces (top)
  'ON': { name: 'Ontario', country: 'CA', unit: 'Litres' },
  'BC': { name: 'British Columbia', country: 'CA', unit: 'Litres' },
  'AB': { name: 'Alberta', country: 'CA', unit: 'Litres' },
  'QC': { name: 'Quebec', country: 'CA', unit: 'Litres' },
  'MB': { name: 'Manitoba', country: 'CA', unit: 'Litres' },
  'SK': { name: 'Saskatchewan', country: 'CA', unit: 'Litres' },
  'NS': { name: 'Nova Scotia', country: 'CA', unit: 'Litres' },
  'NB': { name: 'New Brunswick', country: 'CA', unit: 'Litres' },
  'NL': { name: 'Newfoundland', country: 'CA', unit: 'Litres' },
  'PE': { name: 'Prince Edward Island', country: 'CA', unit: 'Litres' },
  // US States
  'NY': { name: 'New York', country: 'US', unit: 'Gallons' },
  'TX': { name: 'Texas', country: 'US', unit: 'Gallons' },
  'CA': { name: 'California', country: 'US', unit: 'Gallons' },
  'FL': { name: 'Florida', country: 'US', unit: 'Gallons' },
  'IL': { name: 'Illinois', country: 'US', unit: 'Gallons' },
  'PA': { name: 'Pennsylvania', country: 'US', unit: 'Gallons' },
  'OH': { name: 'Ohio', country: 'US', unit: 'Gallons' },
  'GA': { name: 'Georgia', country: 'US', unit: 'Gallons' },
  'NC': { name: 'North Carolina', country: 'US', unit: 'Gallons' },
  'MI': { name: 'Michigan', country: 'US', unit: 'Gallons' },
  'NJ': { name: 'New Jersey', country: 'US', unit: 'Gallons' },
  'VA': { name: 'Virginia', country: 'US', unit: 'Gallons' },
  'WA': { name: 'Washington', country: 'US', unit: 'Gallons' },
  'AZ': { name: 'Arizona', country: 'US', unit: 'Gallons' },
  'MA': { name: 'Massachusetts', country: 'US', unit: 'Gallons' },
  'TN': { name: 'Tennessee', country: 'US', unit: 'Gallons' },
  'IN': { name: 'Indiana', country: 'US', unit: 'Gallons' },
  'MO': { name: 'Missouri', country: 'US', unit: 'Gallons' },
  'MD': { name: 'Maryland', country: 'US', unit: 'Gallons' },
  'WI': { name: 'Wisconsin', country: 'US', unit: 'Gallons' },
  'CO': { name: 'Colorado', country: 'US', unit: 'Gallons' },
  'MN': { name: 'Minnesota', country: 'US', unit: 'Gallons' },
  'SC': { name: 'South Carolina', country: 'US', unit: 'Gallons' },
  'AL': { name: 'Alabama', country: 'US', unit: 'Gallons' },
  'LA': { name: 'Louisiana', country: 'US', unit: 'Gallons' },
  'KY': { name: 'Kentucky', country: 'US', unit: 'Gallons' },
  'OR': { name: 'Oregon', country: 'US', unit: 'Gallons' },
  'OK': { name: 'Oklahoma', country: 'US', unit: 'Gallons' },
  'CT': { name: 'Connecticut', country: 'US', unit: 'Gallons' },
  'UT': { name: 'Utah', country: 'US', unit: 'Gallons' },
  'NV': { name: 'Nevada', country: 'US', unit: 'Gallons' },
  'IA': { name: 'Iowa', country: 'US', unit: 'Gallons' },
  'AR': { name: 'Arkansas', country: 'US', unit: 'Gallons' },
  'MS': { name: 'Mississippi', country: 'US', unit: 'Gallons' },
  'KS': { name: 'Kansas', country: 'US', unit: 'Gallons' },
  'NM': { name: 'New Mexico', country: 'US', unit: 'Gallons' },
  'NE': { name: 'Nebraska', country: 'US', unit: 'Gallons' },
  'WV': { name: 'West Virginia', country: 'US', unit: 'Gallons' },
  'ID': { name: 'Idaho', country: 'US', unit: 'Gallons' },
  'HI': { name: 'Hawaii', country: 'US', unit: 'Gallons' },
  'NH': { name: 'New Hampshire', country: 'US', unit: 'Gallons' },
  'ME': { name: 'Maine', country: 'US', unit: 'Gallons' },
  'MT': { name: 'Montana', country: 'US', unit: 'Gallons' },
  'RI': { name: 'Rhode Island', country: 'US', unit: 'Gallons' },
  'DE': { name: 'Delaware', country: 'US', unit: 'Gallons' },
  'SD': { name: 'South Dakota', country: 'US', unit: 'Gallons' },
  'ND': { name: 'North Dakota', country: 'US', unit: 'Gallons' },
  'AK': { name: 'Alaska', country: 'US', unit: 'Gallons' },
  'VT': { name: 'Vermont', country: 'US', unit: 'Gallons' },
  'WY': { name: 'Wyoming', country: 'US', unit: 'Gallons' },
  'DC': { name: 'Washington D.C.', country: 'US', unit: 'Gallons' },
};

const PAYABLE_TYPES = [
  { name: 'Extra Pickup', type: 'Extra Pickup', rate: 75, unit: 'qty' },
  { name: 'Extra Delivery', type: 'Extra Delivery', rate: 75, unit: 'qty' },
  { name: 'Self Pickup', type: 'Self Pickup', rate: 75, unit: 'qty' },
  { name: 'Self Delivery', type: 'Self Delivery', rate: 75, unit: 'qty' },
  { name: 'Tarping', type: 'Tarping', rate: 75, unit: 'qty' },
  { name: 'Untarping', type: 'Untarping', rate: 25, unit: 'qty' },
  { name: 'Trailer Switch', type: 'Trailer Switch', rate: 30, unit: 'qty' },
  { name: 'Waiting Time', type: 'Waiting Time', rate: 30, unit: 'hour', increment: 0.25 },
  { name: 'City Work', type: 'City Work', rate: 39, unit: 'hour', increment: 0.25 },
  { name: 'Layover', type: 'Layover', rate: 100, unit: 'qty' },
];

const TIME_OPTIONS = [
  { value: 0, label: '0h' },
  { value: 0.25, label: '0h 15m' },
  { value: 0.5, label: '0h 30m' },
  { value: 0.75, label: '0h 45m' },
  { value: 1, label: '1h' },
  { value: 1.25, label: '1h 15m' },
  { value: 1.5, label: '1h 30m' },
  { value: 1.75, label: '1h 45m' },
  { value: 2, label: '2h' },
  { value: 2.25, label: '2h 15m' },
  { value: 2.5, label: '2h 30m' },
  { value: 2.75, label: '2h 45m' },
  { value: 3, label: '3h' },
  { value: 3.25, label: '3h 15m' },
  { value: 3.5, label: '3h 30m' },
  { value: 3.75, label: '3h 45m' },
  { value: 4, label: '4h' },
  { value: 4.25, label: '4h 15m' },
  { value: 4.5, label: '4h 30m' },
  { value: 4.75, label: '4h 45m' },
  { value: 5, label: '5h' },
  { value: 5.25, label: '5h 15m' },
  { value: 5.5, label: '5h 30m' },
  { value: 5.75, label: '5h 45m' },
  { value: 6, label: '6h' },
  { value: 6.25, label: '6h 15m' },
  { value: 6.5, label: '6h 30m' },
  { value: 6.75, label: '6h 45m' },
  { value: 7, label: '7h' },
  { value: 7.25, label: '7h 15m' },
  { value: 7.5, label: '7h 30m' },
  { value: 7.75, label: '7h 45m' },
  { value: 8, label: '8h' },
  { value: 8.25, label: '8h 15m' },
  { value: 8.5, label: '8h 30m' },
  { value: 8.75, label: '8h 45m' },
  { value: 9, label: '9h' },
  { value: 9.25, label: '9h 15m' },
  { value: 9.5, label: '9h 30m' },
  { value: 9.75, label: '9h 45m' },
  { value: 10, label: '10h' },
  { value: 10.25, label: '10h 15m' },
  { value: 10.5, label: '10h 30m' },
  { value: 10.75, label: '10h 45m' },
  { value: 11, label: '11h' },
  { value: 11.25, label: '11h 15m' },
  { value: 11.5, label: '11h 30m' },
  { value: 11.75, label: '11h 45m' },
  { value: 12, label: '12h' },
  { value: 12.25, label: '12h 15m' },
  { value: 12.5, label: '12h 30m' },
  { value: 12.75, label: '12h 45m' },
  { value: 13, label: '13h' },
  { value: 13.25, label: '13h 15m' },
  { value: 13.5, label: '13h 30m' },
  { value: 13.75, label: '13h 45m' },
  { value: 14, label: '14h' },
  { value: 14.25, label: '14h 15m' },
  { value: 14.5, label: '14h 30m' },
  { value: 14.75, label: '14h 45m' },
  { value: 15, label: '15h' },
  { value: 15.25, label: '15h 15m' },
  { value: 15.5, label: '15h 30m' },
  { value: 15.75, label: '15h 45m' },
  { value: 16, label: '16h' },
  { value: 16.25, label: '16h 15m' },
  { value: 16.5, label: '16h 30m' },
  { value: 16.75, label: '16h 45m' },
  { value: 17, label: '17h' },
  { value: 17.25, label: '17h 15m' },
  { value: 17.5, label: '17h 30m' },
  { value: 17.75, label: '17h 45m' },
  { value: 18, label: '18h' },
  { value: 18.25, label: '18h 15m' },
  { value: 18.5, label: '18h 30m' },
  { value: 18.75, label: '18h 45m' },
  { value: 19, label: '19h' },
  { value: 19.25, label: '19h 15m' },
  { value: 19.5, label: '19h 30m' },
  { value: 19.75, label: '19h 45m' },
  { value: 20, label: '20h' },
  { value: 20.25, label: '20h 15m' },
  { value: 20.5, label: '20h 30m' },
  { value: 20.75, label: '20h 45m' },
  { value: 21, label: '21h' },
  { value: 21.25, label: '21h 15m' },
  { value: 21.5, label: '21h 30m' },
  { value: 21.75, label: '21h 45m' },
  { value: 22, label: '22h' },
  { value: 22.25, label: '22h 15m' },
  { value: 22.5, label: '22h 30m' },
  { value: 22.75, label: '22h 45m' },
  { value: 23, label: '23h' },
  { value: 23.25, label: '23h 15m' },
  { value: 23.5, label: '23h 30m' },
  { value: 23.75, label: '23h 45m' },
  { value: 24, label: '24h' },
];

const HOUR_OPTIONS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.25, 8.5, 8.75, 9, 9.25, 9.5, 9.75, 10, 10.25, 10.5, 10.75, 11, 11.25, 11.5, 11.75, 12, 12.25, 12.5, 12.75, 13, 13.25, 13.5, 13.75, 14, 14.25, 14.5, 14.75, 15, 15.25, 15.5, 15.75, 16, 16.25, 16.5, 16.75, 17, 17.25, 17.5, 17.75, 18, 18.25, 18.5, 18.75, 19, 19.25, 19.5, 19.75, 20, 20.25, 20.5, 20.75, 21, 21.25, 21.5, 21.75, 22, 22.25, 22.5, 22.75, 23, 23.25, 23.5, 23.75, 24];

interface TollEntry {
  id: number;
  amount: number;
}

interface ExtraPayItem {
  type: string;
  quantity: number;
  amount?: number;
}

interface MobileQuickAddPanelProps {
  trips: any[];
  isOpen: boolean;
  onClose: () => void;
}

export default function MobileQuickAddPanel({ trips, isOpen, onClose }: MobileQuickAddPanelProps) {
  const [selectedTrip, setSelectedTrip] = useState<string>('');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [extraPayItems, setExtraPayItems] = useState<ExtraPayItem[]>([]);
  const [tollEntries, setTollEntries] = useState<TollEntry[]>([{ id: 1, amount: 0 }]);
  const [nextTollId, setNextTollId] = useState(2);

  // Form states
  const [fuelForm, setFuelForm] = useState({
    date: new Date().toISOString().split('T')[0],
    location: '',
    province: '',
    quantity: '',
    amount: '',
    odometer: '',
    unit: 'Gallons',
  });

  const [odometerForm, setOdometerForm] = useState({
    start: '',
    end: '',
  });

  useEffect(() => {
    if (trips.length > 0 && !selectedTrip) {
      setSelectedTrip(trips[0].trip_number);
    }
  }, [trips, selectedTrip]);
  
  // Reset states when modal is closed
  useEffect(() => {
    if (!isOpen) {
      setActiveModal(null);
      resetForms();
    }
  }, [isOpen]);

  const resetForms = () => {
    setFuelForm({ date: new Date().toISOString().split('T')[0], location: '', province: '', quantity: '', amount: '', odometer: '', unit: 'Gallons' });
    setOdometerForm({ start: '', end: '' });
    setExtraPayItems([]);
    setTollEntries([{ id: 1, amount: 0 }]);
    setNextTollId(2);
  };
  
  const handleModalClose = () => {
    setActiveModal(null);
    resetForms();
    onClose(); // This will set the parent's state to close the main panel
  };

  const handleSaveFuel = async () => {
    // City + Province are required
    if (!selectedTrip || !fuelForm.location || !fuelForm.province) return;
    setIsSaving(true);
    try {
      await fetch('/api/dispatch/fuel', {
        method: 'POST',
        body: JSON.stringify({
          trip_number: selectedTrip,
          date: fuelForm.date,
          location: fuelForm.location,
          province: fuelForm.province,
          quantity: fuelForm.quantity ? parseFloat(fuelForm.quantity) : undefined,
          unit: fuelForm.unit,
          amount_usd: fuelForm.amount ? parseFloat(fuelForm.amount) : undefined,
          odometer: fuelForm.odometer ? parseFloat(fuelForm.odometer) : undefined,
        }),
      });
      alert('Fuel added!');
      handleModalClose();
    } catch (err) {
      alert('Failed to add fuel');
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleSaveOdometer = async () => {
    if (!selectedTrip) return;
    // Allow saving with just one odometer value
    if (!odometerForm.start && !odometerForm.end) return;
    setIsSaving(true);
    try {
      const updateData: any = {};
      if (odometerForm.start) updateData.start_odometer = parseFloat(odometerForm.start);
      if (odometerForm.end) updateData.end_odometer = parseFloat(odometerForm.end);
      
      await fetch(`/api/dispatch/${selectedTrip}`, {
        method: 'PATCH',
        body: JSON.stringify(updateData),
      });
      alert('Odometer updated!');
      handleModalClose();
    } catch (err) {
      alert('Failed to update odometer');
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateExtraPay = (type: string, delta: number) => {
    setExtraPayItems(prev => {
      const existing = prev.find(item => item.type === type);
      const payable = PAYABLE_TYPES.find(p => p.type === type);
      const increment = payable?.unit === 'hour' ? (payable.increment || 0.25) : 1;
      
      if (existing) {
        const newQuantity = Math.max(0, existing.quantity + delta);
        if (newQuantity === 0) {
          return prev.filter(item => item.type !== type);
        }
        return prev.map(item => item.type === type ? { ...item, quantity: newQuantity } : item);
      } else if (delta > 0) {
        return [...prev, { type, quantity: increment }];
      }
      return prev;
    });
  };

  const handleSetExtraPayFromDropdown = (type: string, hours: number) => {
    setExtraPayItems(prev => {
      const existing = prev.find(item => item.type === type);
      if (hours === 0) {
        return prev.filter(item => item.type !== type);
      }
      if (existing) {
        return prev.map(item => item.type === type ? { ...item, quantity: hours } : item);
      }
      return [...prev, { type, quantity: hours }];
    });
  };

  const handleAddToll = () => {
    setTollEntries(prev => [...prev, { id: nextTollId, amount: 0 }]);
    setNextTollId(prev => prev + 1);
  };

  const handleUpdateToll = (id: number, amount: number) => {
    setTollEntries(prev => prev.map(t => t.id === id ? { ...t, amount } : t));
  };

  const handleRemoveToll = (id: number) => {
    if (tollEntries.length > 1) {
      setTollEntries(prev => prev.filter(t => t.id !== id));
    }
  };

  const handleSaveExtras = async () => {
    if (!selectedTrip) return;
    setIsSaving(true);
    try {
      // Handle tolls separately - each toll entry
      const validTolls = tollEntries.filter(t => t.amount > 0);
      for (const toll of validTolls) {
        await fetch('/api/dispatch/extra', {
          method: 'POST',
          body: JSON.stringify({
            trip_number: selectedTrip,
            type: 'Tolls',
            amount: toll.amount,
            quantity: 1,
          }),
        });
      }

      // Handle other extra pay items
      for (const item of extraPayItems) {
        const payable = PAYABLE_TYPES.find(p => p.type === item.type);
        if (payable) {
          await fetch('/api/dispatch/extra', {
            method: 'POST',
            body: JSON.stringify({
              trip_number: selectedTrip,
              type: item.type,
              amount: payable.unit === 'dollar' ? (item.amount || 0) : payable.rate,
              quantity: item.quantity,
            }),
          });
        }
      }
      alert('Extras added!');
      handleModalClose();
    } catch (err) {
      alert('Failed to add extras');
    } finally {
      setIsSaving(false);
    }
  };

  const activeTripLabel = useMemo(() => {
    const trip = trips.find(t => t.trip_number === selectedTrip);
    return trip ? `#${trip.trip_number}` : '';
  }, [selectedTrip, trips]);

  const activeTripStatus = useMemo(() => {
    const trip = trips.find(t => t.trip_number === selectedTrip);
    return trip?.status || 'Unknown';
  }, [selectedTrip, trips]);

  const hasValidExtras = useMemo(() => {
    const hasTolls = tollEntries.some(t => t.amount > 0);
    const hasOtherItems = extraPayItems.length > 0;
    return hasTolls || hasOtherItems;
  }, [tollEntries, extraPayItems]);

  // Check if fuel form is valid (city + province required)
  const isFuelValid = fuelForm.location && fuelForm.province && fuelForm.quantity;

  // Check odometer validity
  const isOdometerValid = odometerForm.start || odometerForm.end;

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[80] flex items-end justify-center animate-fade-in">
      <div className="bg-zinc-900 border-t border-zinc-800 rounded-t-3xl w-full max-h-[75vh] overflow-y-auto p-4 pb-28 animate-slide-up z-[105]">
        
        {/* Main Panel or Modal Selector */}
        {!activeModal ? (
          <>
            {/* Header and Close Button */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black uppercase text-zinc-300">⚡ Quick Add</h3>
              <button onClick={handleModalClose} className="bg-zinc-800 p-2 rounded-xl text-zinc-400 hover:text-white">✕</button>
            </div>

            {/* Trip Selector */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-3 mb-3 shadow-lg">
              <label className="text-[10px] font-black uppercase text-zinc-500 mb-2 block">
                For Trip
              </label>
              <select
                value={selectedTrip}
                onChange={(e) => setSelectedTrip(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl py-3 px-4 text-base font-black text-blue-500 focus:border-blue-600 outline-none"
              >
                {trips.map((trip: any) => (
                  <option key={trip.trip_number} value={trip.trip_number}>
                    #{trip.trip_number} - {trip.status || 'Unknown'}
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Add Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setActiveModal('extras')}
                className="bg-blue-600/20 hover:bg-blue-600/30 border border-blue-600/30 rounded-2xl py-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all h-24"
              >
                <span className="text-2xl">💰</span>
                <span className="text-[10px] font-black uppercase">Extra Pay</span>
              </button>
              
              <button
                onClick={() => setActiveModal('fuel')}
                className="bg-green-600/20 hover:bg-green-600/30 border border-green-600/30 rounded-2xl py-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all h-24"
              >
                <span className="text-2xl">⛽</span>
                <span className="text-[10px] font-black uppercase">Add Fuel</span>
              </button>
              
              <button
                onClick={() => setActiveModal('odometer')}
                className="bg-orange-600/20 hover:bg-orange-600/30 border border-orange-600/30 rounded-2xl py-4 flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-all h-24 col-span-2"
              >
                <span className="text-2xl">🔢</span>
                <span className="text-[10px] font-black uppercase">Update Odometer</span>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Modal Header */}
            <div className="flex justify-between items-center mb-4">
               <h3 className="text-lg font-black uppercase">
                 {activeModal === 'extras' && '💰 Add Extra Pay'}
                 {activeModal === 'fuel' && '⛽ Add Fuel'}
                 {activeModal === 'odometer' && '🔢 Odometer'}
               </h3>
               <button onClick={() => setActiveModal(null)} className="bg-zinc-800 p-2 rounded-xl text-zinc-400 hover:text-white">← Back</button>
            </div>
            
            {/* Trip indicator with Change button */}
            <div className="bg-blue-600/20 border border-blue-600/30 rounded-xl p-3 mb-4 flex items-center justify-between">
              <span className="text-xs font-black uppercase text-blue-400">
                Adding to trip: {activeTripLabel}
              </span>
              <button 
                onClick={() => setActiveModal(null)} 
                className="text-[10px] font-bold bg-blue-600/40 hover:bg-blue-600/60 text-blue-300 px-2 py-1 rounded-lg uppercase"
              >
                Change
              </button>
            </div>

            {/* Extra Pay Modal */}
            {activeModal === 'extras' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  {PAYABLE_TYPES.map((payable) => {
                    const item = extraPayItems.find(p => p.type === payable.type);
                    const qty = item?.quantity || 0;
                    
                    // Hour-based items (Waiting Time, City Work) - with dropdown
                    if (payable.unit === 'hour') {
                      const increment = payable.increment || 0.25;
                      return (
                        <div key={payable.name} className="flex items-center bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                          <div className="flex-1">
                            <span className="text-sm font-bold text-zinc-300 block">{payable.name}</span>
                            <span className="text-[10px] text-zinc-500">${payable.rate}/hr</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => handleUpdateExtraPay(payable.type, -increment)} className="w-8 h-8 bg-zinc-800 hover:bg-red-900 rounded-lg flex items-center justify-center text-lg transition-all font-black border border-zinc-700">-</button>
                            <select
                              value={qty}
                              onChange={(e) => handleSetExtraPayFromDropdown(payable.type, parseFloat(e.target.value))}
                              className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1 text-sm font-bold text-center"
                            >
                              {TIME_OPTIONS.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                            <button onClick={() => handleUpdateExtraPay(payable.type, increment)} className="w-8 h-8 bg-zinc-800 hover:bg-blue-600 rounded-lg flex items-center justify-center text-lg transition-all font-black border border-zinc-700">+</button>
                          </div>
                        </div>
                      )
                    }
                    // Quantity-based items
                    return (
                      <div key={payable.name} className="flex items-center bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="flex-1">
                          <span className="text-sm font-bold text-zinc-300 block">{payable.name}</span>
                          <span className="text-[10px] text-zinc-500">${payable.rate}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleUpdateExtraPay(payable.type, -1)} className="w-8 h-8 bg-zinc-800 hover:bg-red-900 rounded-lg flex items-center justify-center text-lg transition-all font-black border border-zinc-700">-</button>
                          <span className="text-lg font-mono font-black w-9 text-center">{qty}</span>
                          <button onClick={() => handleUpdateExtraPay(payable.type, 1)} className="w-8 h-8 bg-zinc-800 hover:bg-blue-600 rounded-lg flex items-center justify-center text-lg transition-all font-black border border-zinc-700">+</button>
                        </div>
                      </div>
                    )
                  })}
                  
                  {/* Tolls Section - Multiple entries */}
                  <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 mt-2">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-bold text-zinc-300">Tolls</span>
                      <button 
                        onClick={handleAddToll}
                        className="w-7 h-7 bg-green-600/30 hover:bg-green-600/50 rounded-lg flex items-center justify-center text-green-400 font-black text-lg border border-green-600/30"
                      >
                        +
                      </button>
                    </div>
                    {tollEntries.map((toll, index) => (
                      <div key={toll.id} className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-zinc-500 w-6">#{index + 1}</span>
                        <input 
                          type="number"
                          placeholder="$"
                          value={toll.amount || ''}
                          onChange={(e) => handleUpdateToll(toll.id, parseFloat(e.target.value) || 0)}
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-right font-mono text-green-400 text-sm"
                        />
                        {tollEntries.length > 1 && (
                          <button 
                            onClick={() => handleRemoveToll(toll.id)}
                            className="w-7 h-7 bg-red-900/30 hover:bg-red-900/50 rounded-lg flex items-center justify-center text-red-400 font-black border border-red-900/30"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleSaveExtras}
                  disabled={isSaving || !hasValidExtras}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-black uppercase py-4 rounded-2xl mt-4"
                >
                  {isSaving ? 'Saving...' : 'Save Extras'}
                </button>
              </div>
            )}

            {/* Fuel Modal */}
            {activeModal === 'fuel' && (
              <div className="space-y-3">
                <input
                  type="date"
                  value={fuelForm.date}
                  onChange={(e) => setFuelForm({ ...fuelForm, date: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-base font-bold outline-none focus:border-green-600 [color-scheme:dark]"
                />
                <input
                  type="text"
                  placeholder="City * (required)"
                  value={fuelForm.location}
                  onChange={(e) => setFuelForm({ ...fuelForm, location: e.target.value })}
                  className={`w-full bg-zinc-950 border rounded-xl p-4 text-base font-bold outline-none focus:border-green-600 ${
                    fuelForm.location ? 'border-zinc-800' : 'border-red-600/50'
                  }`}
                />
                {/* Smart Location Selector - Province REQUIRED */}
                <select
                  value={fuelForm.province}
                  onChange={(e) => {
                    const province = e.target.value;
                    const locationData = province ? LOCATIONS[province as keyof typeof LOCATIONS] : null;
                    setFuelForm({ 
                      ...fuelForm, 
                      province: province,
                      unit: locationData ? locationData.unit : 'Gallons'
                    });
                  }}
                  className={`w-full bg-zinc-950 border rounded-xl p-4 text-base font-bold outline-none focus:border-green-600 ${
                    fuelForm.province ? 'border-green-600/50 text-green-400' : 'border-red-600/50 text-red-400'
                  }`}
                >
                  <option value="">Province/State * (required)</option>
                  <optgroup label="🇨🇦 Canada">
                    {Object.entries(LOCATIONS).filter(([_, v]) => v.country === 'CA').map(([code, data]) => (
                      <option key={code} value={code}>{data.name}</option>
                    ))}
                  </optgroup>
                  <optgroup label="🇺🇸 United States">
                    {Object.entries(LOCATIONS).filter(([_, v]) => v.country === 'US').map(([code, data]) => (
                      <option key={code} value={code}>{data.name}</option>
                    ))}
                  </optgroup>
                </select>
                {/* Unit indicator (auto-set by province) */}
                <div className="text-xs text-zinc-500 text-center mb-1">
                  Unit: <span className={`font-bold ${fuelForm.unit === 'Litres' ? 'text-blue-400' : 'text-green-400'}`}>
                    {fuelForm.unit}
                  </span> {fuelForm.province && `(auto-set from ${LOCATIONS[fuelForm.province as keyof typeof LOCATIONS]?.name || 'province'})`}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Qty *"
                      value={fuelForm.quantity}
                      onChange={(e) => setFuelForm({ ...fuelForm, quantity: e.target.value })}
                      className={`bg-zinc-950 border rounded-xl p-3 text-base font-bold outline-none focus:border-green-600 w-full pr-10 ${
                        fuelForm.quantity ? 'border-zinc-800' : 'border-red-600/50'
                      }`}
                    />
                    <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs font-black px-2 py-1 rounded ${
                      fuelForm.unit === 'Litres' ? 'bg-blue-600/30 text-blue-400' : 'bg-green-600/30 text-green-400'
                    }`}>
                      {fuelForm.unit === 'Litres' ? 'L' : 'Gal'}
                    </span>
                  </div>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="$ (opt)"
                    value={fuelForm.amount}
                    onChange={(e) => setFuelForm({ ...fuelForm, amount: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-base font-bold outline-none focus:border-green-600"
                  />
                </div>
                <input
                  type="number"
                  placeholder="Odometer (optional)"
                  value={fuelForm.odometer}
                  onChange={(e) => setFuelForm({ ...fuelForm, odometer: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-base font-bold outline-none focus:border-green-600"
                />
                <button
                  onClick={handleSaveFuel}
                  disabled={isSaving || !isFuelValid}
                  className="w-full bg-green-600 hover:bg-green-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-black uppercase py-4 rounded-2xl mt-4"
                >
                  {isSaving ? 'Saving...' : 'Add Fuel'}
                </button>
              </div>
            )}

            {/* Odometer Modal - Side by side Start/End - Smaller boxes */}
            {activeModal === 'odometer' && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {/* Start Odometer */}
                  <div className={`relative border rounded-xl p-2 transition-colors ${
                    odometerForm.start 
                      ? 'border-green-600/50 bg-green-600/10' 
                      : 'border-red-600/50 bg-red-600/5'
                  }`}>
                    <label className="text-[9px] font-black uppercase text-zinc-500 block mb-1">
                      Start
                    </label>
                    <input
                      type="number"
                      placeholder="Start"
                      value={odometerForm.start}
                      onChange={(e) => setOdometerForm({ ...odometerForm, start: e.target.value })}
                      className={`w-full bg-transparent text-center font-mono font-black text-base outline-none placeholder:text-zinc-600 ${
                        odometerForm.start ? 'text-green-400' : 'text-red-400'
                      }`}
                    />
                  </div>
                  {/* End Odometer */}
                  <div className={`relative border rounded-xl p-2 transition-colors ${
                    odometerForm.end 
                      ? 'border-green-600/50 bg-green-600/10' 
                      : 'border-red-600/50 bg-red-600/5'
                  }`}>
                    <label className="text-[9px] font-black uppercase text-zinc-500 block mb-1">
                      End
                    </label>
                    <input
                      type="number"
                      placeholder="End"
                      value={odometerForm.end}
                      onChange={(e) => setOdometerForm({ ...odometerForm, end: e.target.value })}
                      className={`w-full bg-transparent text-center font-mono font-black text-base outline-none placeholder:text-zinc-600 ${
                        odometerForm.end ? 'text-green-400' : 'text-red-400'
                      }`}
                    />
                  </div>
                </div>
                <p className="text-xs text-zinc-500 text-center">
                  Fill at least one (Start or End)
                </p>
                <button
                  onClick={handleSaveOdometer}
                  disabled={isSaving || !isOdometerValid}
                  className="w-full bg-orange-600 hover:bg-orange-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white font-black uppercase py-4 rounded-2xl mt-4"
                >
                  {isSaving ? 'Saving...' : 'Save Odometer'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-slide-up {
          animation: slide-up 0.3s ease-out;
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
