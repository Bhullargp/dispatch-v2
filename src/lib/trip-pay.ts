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
  extra_pay_json: string | null | any[];
  route: string | null;
  first_stop: string | null;
  last_stop: string | null;
  stops_json?: string | null; // optional - for stop-based detection
}

export interface TripPayResult {
  total: number;
  milePay: number;
  extras: number;
  extraBreakdown: Record<string, number>;
  isCanada: boolean;
  ratePerMile: number;
  rateLabel: string;
}

export const PAYABLE_DEFAULTS: PayableItem[] = [
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

const CA_PROVINCES = ['ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'NL', 'PE', 'NT', 'YT', 'NU'];

function isCanadaLocation(loc: string | null): boolean {
  if (!loc) return false;
  const m = loc.match(/\b([A-Z]{2})\b/);
  if (m && CA_PROVINCES.includes(m[1])) return true;
  const kw = ['Ontario', 'Quebec', 'British Columbia', 'Alberta', 'Manitoba', 'Saskatchewan', 'Nova Scotia', 'New Brunswick', 'Newfoundland', 'Prince Edward'];
  return kw.some(k => loc.includes(k));
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
    for (const e of arr) {
      const item = extraItems.find(p => p.name === e.type);
      if (item) {
        const qty = e.quantity || 1;
        const val = item.rate * qty;
        total += val;
        breakdown[e.type] = (breakdown[e.type] || 0) + val;
      }
    }
  } catch {}

  return { total, breakdown };
}

/**
 * Detect if a trip is Canada-based using route field, then first/last stop.
 */
export function detectCanada(trip: TripPayInput): boolean {
  const route = (trip.route || '').toUpperCase();

  if (route === 'USA' || route === 'US') return false;
  if (route === 'CANADA' || route === 'CA') return true;

  // Check route field for province codes
  if (route.includes('CANADA') || CA_PROVINCES.some(p => route.includes(p))) return true;

  // Fall back to first/last stop
  const canadaFirst = isCanadaLocation(trip.first_stop);
  const canadaLast = isCanadaLocation(trip.last_stop);
  return canadaFirst && canadaLast;
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

  // Calculate extras first (same regardless of rate)
  const { total: extrasTotal, breakdown: extraBreakdown } = calcExtras(trip.extra_pay_json, extraItems);

  // Manual rate override
  if (trip.manual_rate) {
    const milePay = miles * trip.manual_rate;
    return {
      total: milePay + extrasTotal,
      milePay,
      extras: extrasTotal,
      extraBreakdown,
      isCanada: false,
      ratePerMile: trip.manual_rate,
      rateLabel: `MANUAL ($${trip.manual_rate}/mi)`,
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
    extras: extrasTotal,
    extraBreakdown,
    isCanada,
    ratePerMile: mileRate,
    rateLabel,
  };
}
