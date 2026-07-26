/**
 * Shared trip pay calculation utility.
 * ALL pages must import from here to ensure consistency.
 */

export interface PayableItem {
  name: string;
  rate: number;
  unit: string;
  increments?: number;
  max?: number;
  freeLimit?: number;
}

export interface MileRates {
  us: number;
  canadaUnder1000: number;
  canadaOver1000: number;
}

export interface TripPayInput {
  total_miles: number | null;
  manual_rate: number | null;
  manual_hours?: number | null;
  rate_type?: string | null;
  extra_pay_json: string | null | any[];
  route: string | null;
  first_stop: string | null;
  last_stop: string | null;
  stops_json?: string | null; // optional - for stop-based detection
}

export interface TripPayResult {
  total: number;
  milePay: number;
  basePay: number;
  extras: number;
  extraBreakdown: Record<string, number>;
  isCanada: boolean;
  ratePerMile: number;
  rateLabel: string;
  rateUnit: 'mile' | 'hour';
  baseQuantity: number;
}

export const PAYABLE_DEFAULTS: PayableItem[] = [
  { name: 'Bonus Pay Mileage', rate: 0.05, unit: 'segment_mile' },
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
  { name: 'Layover', rate: 100, unit: 'qty' },
];

const CA_PROVINCES = new Set(['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU']);
const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
const CA_PROVINCE_NAMES = ['Ontario','Quebec','British Columbia','Alberta','Manitoba','Saskatchewan','Nova Scotia','New Brunswick','Newfoundland','Prince Edward Island','Northwest Territories','Yukon','Nunavut'];
const US_STATE_NAMES = ['Alabama','Alaska','Arizona','Arkansas','Colorado','Connecticut','Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas','Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota','Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey','New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon','Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas','Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];

function locationIsCanada(loc: string | null): boolean {
  if (!loc) return false;
  // Check for 2-letter province code preceded by comma/space (e.g. "Toronto, ON")
  const codes = loc.match(/\b([A-Z]{2})\b/g) || [];
  for (const c of codes) {
    if (CA_PROVINCES.has(c)) return true;
  }
  return CA_PROVINCE_NAMES.some(k => loc.includes(k));
}

function locationIsUSA(loc: string | null): boolean {
  if (!loc) return false;
  const codes = loc.match(/\b([A-Z]{2})\b/g) || [];
  for (const c of codes) {
    if (US_STATES.has(c)) return true;
  }
  return US_STATE_NAMES.some(k => loc.includes(k));
}

// Keep old name as alias for backward compatibility
function isCanadaLocation(loc: string | null): boolean {
  return locationIsCanada(loc);
}

function toNumber(value: any): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function extraQuantity(entry: any, item: PayableItem): number {
  if (item.unit === 'hour') {
    const duration = toNumber(entry.duration_hours);
    if (duration > 0) return duration;

    const quantity = toNumber(entry.quantity);
    if (quantity > 0) return quantity;

    const rate = toNumber(entry.rate) || item.rate;
    const amount = toNumber(entry.amount);
    if (rate > 0 && amount > 0) return amount / rate;

    return 1;
  }

  const quantity = toNumber(entry.quantity);
  return quantity > 0 ? quantity : 1;
}

function dollarAmount(entry: any): number {
  const amount = toNumber(entry.amount);
  if (amount > 0) return amount;
  return toNumber(entry.quantity);
}

function segmentMileageAmount(entry: any, item: PayableItem): number {
  const amount = toNumber(entry.amount);
  if (amount > 0) return amount;

  const miles = toNumber(entry.segment_miles) || toNumber(entry.quantity);
  const rate = toNumber(entry.rate) || item.rate;
  return miles * rate;
}

/**
 * Calculate extras from extra_pay_json matched against payable items.
 * Returns the total extras amount and a breakdown by type.
 */
export function calcExtras(extraPayJson: string | null | any[], extraItems: PayableItem[]): { total: number; breakdown: Record<string, number> } {
  let total = 0;
  const breakdown: Record<string, number> = {};

  try {
    // extraPayJson may be a string (from client) or already-parsed array (from PostgreSQL json_agg)
    const arr = Array.isArray(extraPayJson) ? extraPayJson : JSON.parse(extraPayJson || '[]');
    const grouped = new Map<string, any[]>();

    for (const e of arr) {
      if (!e?.type) continue;
      const list = grouped.get(e.type) || [];
      list.push(e);
      grouped.set(e.type, list);
    }

    for (const [type, entries] of grouped.entries()) {
      const item = extraItems.find(p => p.name === type);
      if (item) {
        let val = 0;
        if (item.unit === 'segment_mile') {
          val = entries.reduce((sum, e) => sum + segmentMileageAmount(e, item), 0);
        } else if (item.unit === 'dollar') {
          val = entries.reduce((sum, e) => sum + dollarAmount(e), 0);
        } else if (item.unit === 'hour') {
          const quantities = entries.map(e => extraQuantity(e, item)).filter(q => q > 0);
          const hasAggregateCityWork = type === 'City Work' && quantities.some(q => q > 1);
          const qty = hasAggregateCityWork
            ? Math.max(...quantities)
            : quantities.reduce((sum, q) => sum + q, 0);
          val = item.rate * qty;
        } else {
          const qty = entries.reduce((sum, e) => sum + extraQuantity(e, item), 0);
          val = item.rate * qty;
        }
        total += val;
        breakdown[type] = (breakdown[type] || 0) + val;
      }
    }
  } catch {}

  return { total, breakdown };
}

/**
 * Detect if a trip is Canada-based.
 * Rule: ANY US stop → US rate. ALL Canadian stops → Canada rate.
 * A cross-border trip with even one US stop pays at the US rate.
 */
export function detectCanada(trip: TripPayInput): boolean {
  // PRIMARY: check only DELIVERY and PICKUP stops — ignore acquire/release/hook/drop
  if (trip.stops_json) {
    try {
      const stops = Array.isArray(trip.stops_json) ? trip.stops_json : JSON.parse(trip.stops_json as string);
      const delStops = stops.filter((s: any) => {
        const t = (s.stop_type || '').toUpperCase();
        return t === 'DELIVERY' || t === 'DELIVER' || t === 'PICKUP' || t === 'PICK UP';
      });
      if (delStops.length > 0) {
        const locs = delStops.map((s: any) => s.location || '').filter(Boolean);
        if (locs.some(locationIsUSA)) return false;
        if (locs.every(locationIsCanada)) return true;
      }
    } catch {}
  }
  // Fallback: first & last stop (any type)
  if (locationIsUSA(trip.first_stop) || locationIsUSA(trip.last_stop)) return false;
  return locationIsCanada(trip.first_stop) && locationIsCanada(trip.last_stop);
}

/**
 * Core trip pay calculation. Use this everywhere.
 */
export function calcTripPay(
  trip: TripPayInput,
  mileRates: MileRates,
  extraItems: PayableItem[]
): TripPayResult {
  const miles = trip.total_miles || 0;
  const manualRate = toNumber(trip.manual_rate);
  const manualHours = toNumber(trip.manual_hours);
  const rateType = String(trip.rate_type || '').toLowerCase();

  const extrasInput = rateType === 'hourly'
    ? (() => {
        try {
          const arr = Array.isArray(trip.extra_pay_json) ? trip.extra_pay_json : JSON.parse(trip.extra_pay_json || '[]');
          return arr.filter((e: any) => e?.type !== 'City Work');
        } catch {
          return trip.extra_pay_json;
        }
      })()
    : trip.extra_pay_json;

  // Calculate extras. When the trip itself is hourly, City Work is the base pay
  // source, not an additional extra on top of hourly trip pay.
  const { total: extrasTotal, breakdown: extraBreakdown } = calcExtras(extrasInput, extraItems);

  if (rateType === 'hourly' && manualRate > 0) {
    const milePay = manualRate * manualHours;
    return {
      total: milePay + extrasTotal,
      milePay,
      basePay: milePay,
      extras: extrasTotal,
      extraBreakdown,
      isCanada: false,
      ratePerMile: manualRate,
      rateLabel: `HOURLY ($${manualRate}/hr${manualHours > 0 ? ` x ${manualHours} hr` : ''})`,
      rateUnit: 'hour',
      baseQuantity: manualHours,
    };
  }

  // Manual rate override
  if (manualRate > 0) {
    const milePay = miles * manualRate;
    return {
      total: milePay + extrasTotal,
      milePay,
      basePay: milePay,
      extras: extrasTotal,
      extraBreakdown,
      isCanada: false,
      ratePerMile: manualRate,
      rateLabel: `MANUAL ($${manualRate}/mi)`,
      rateUnit: 'mile',
      baseQuantity: miles,
    };
  }

  // Auto-detect rate
  const isCanada = detectCanada(trip);
  const mileRate = isCanada
    ? (miles < 1000 ? mileRates.canadaUnder1000 : mileRates.canadaOver1000)
    : mileRates.us;

  const milePay = miles * mileRate;
  const rateLabel = isCanada
    ? (miles < 1000 ? 'CAD (<1000mi)' : 'CAD (>1000mi)')
    : 'USA';

  return {
    total: milePay + extrasTotal,
    milePay,
    basePay: milePay,
    extras: extrasTotal,
    extraBreakdown,
    isCanada,
    ratePerMile: mileRate,
    rateLabel,
    rateUnit: 'mile',
    baseQuantity: miles,
  };
}
