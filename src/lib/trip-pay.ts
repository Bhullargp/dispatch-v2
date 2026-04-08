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
 * Detect if a trip is Canada-based.
 * Rule: ANY US stop → US rate. ALL Canadian stops → Canada rate.
 * A cross-border trip with even one US stop pays at the US rate.
 */
export function detectCanada(trip: TripPayInput): boolean {
  const route = (trip.route || '').toUpperCase().trim();

  // Explicit manual overrides
  if (route === 'USA' || route === 'US') return false;
  if (route === 'CANADA' || route === 'CA') return true;

  // If we have all stops, check every single one
  if (trip.stops_json) {
    try {
      const stops: Array<{ location?: string; stop_type?: string }> =
        Array.isArray(trip.stops_json) ? trip.stops_json : JSON.parse(trip.stops_json as string);
      const locations = stops.map(s => s.location || '').filter(Boolean);
      if (locations.length > 0) {
        // Any US stop → US rate immediately
        if (locations.some(locationIsUSA)) return false;
        // All Canada → Canada rate
        if (locations.every(locationIsCanada)) return true;
      }
    } catch {}
  }

  // Fallback: first & last stop
  // Any US stop in first/last → US rate
  if (locationIsUSA(trip.first_stop) || locationIsUSA(trip.last_stop)) return false;
  // Both Canada → Canada rate
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
