export type DispatchTripStatus = 'Active' | 'Completed' | 'Started' | 'Not Started' | 'Incomplete' | 'Cancelled' | 'Unknown';

type StopLike = {
  stop_type?: string | null;
  type?: string | null;
  location?: string | null;
};

export function todayDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeTripStatus(value?: string | null): DispatchTripStatus | null {
  const v = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  if (!v) return null;
  if (v === 'active') return 'Active';
  if (v === 'completed' || v === 'complete') return 'Completed';
  if (v === 'started' || v === 'start') return 'Started';
  if (v === 'not started' || v === 'not started yet' || v === 'future') return 'Not Started';
  if (v === 'incomplete' || v === 'missing final stop') return 'Incomplete';
  if (v === 'cancelled' || v === 'canceled') return 'Cancelled';
  if (v === 'unknown') return 'Unknown';
  return null;
}

export function hasFinalYardDropOrRelease(stops: StopLike[] = []): boolean {
  const finalStop = [...stops].reverse().find((stop) => String(stop.location || '').trim());
  if (!finalStop) return false;

  const type = String(finalStop.stop_type || finalStop.type || '').trim().toUpperCase();
  const location = String(finalStop.location || '').trim();
  const isYard = /\b(?:caledon|galauden)\b/i.test(location);
  const isFinalEvent = type === 'RELEASE' || type === 'DROP' || type === 'DELIVER' || type === 'DELIVERY';
  return isYard && isFinalEvent;
}

export function deriveTripStatus(params: {
  startDate?: string | null;
  endDate?: string | null;
  stops?: StopLike[];
  requestedStatus?: string | null;
  today?: string;
}): DispatchTripStatus {
  const explicit = normalizeTripStatus(params.requestedStatus);
  // Preserve deliberate manual terminal statuses. Let date/stop evidence move
  // vague defaults like Active/Started/Not Started as time passes.
  if (explicit === 'Completed' || explicit === 'Cancelled') return explicit;

  const today = params.today || todayDateString();
  const start = params.startDate || null;
  const end = params.endDate || start;

  if (start && start > today) return 'Not Started';
  if (start && start <= today && (!end || end >= today)) return 'Active';
  if (end && end < today) return hasFinalYardDropOrRelease(params.stops || []) ? 'Completed' : 'Incomplete';
  return explicit || 'Unknown';
}

export function statusDotClass(status?: string | null): string {
  switch (normalizeTripStatus(status)) {
    case 'Active': return 'bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.9)]';
    case 'Completed': return 'bg-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.7)]';
    case 'Started': return 'bg-lime-400 shadow-[0_0_10px_rgba(163,230,53,0.7)]';
    case 'Not Started': return 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.7)]';
    case 'Incomplete': return 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.7)]';
    case 'Cancelled': return 'bg-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.7)]';
    default: return 'bg-zinc-500';
  }
}

export function statusPillClass(status?: string | null): string {
  switch (normalizeTripStatus(status)) {
    case 'Active': return 'bg-emerald-500/15 text-emerald-300 border-emerald-400/60 shadow-[0_0_18px_rgba(52,211,153,0.18)]';
    case 'Completed': return 'bg-sky-500/15 text-sky-300 border-sky-400/60 shadow-[0_0_18px_rgba(14,165,233,0.18)]';
    case 'Started': return 'bg-lime-500/15 text-lime-300 border-lime-400/60 shadow-[0_0_18px_rgba(163,230,53,0.18)]';
    case 'Not Started': return 'bg-yellow-500/15 text-yellow-200 border-yellow-400/60 shadow-[0_0_18px_rgba(250,204,21,0.16)]';
    case 'Incomplete': return 'bg-red-500/15 text-red-300 border-red-400/60 shadow-[0_0_18px_rgba(239,68,68,0.18)]';
    case 'Cancelled': return 'bg-orange-500/15 text-orange-300 border-orange-400/60 shadow-[0_0_18px_rgba(249,115,22,0.18)]';
    default: return 'bg-zinc-800/50 text-zinc-400 border-zinc-600/50';
  }
}

export function statusTextClass(status?: string | null): string {
  switch (normalizeTripStatus(status)) {
    case 'Active': return 'text-emerald-300';
    case 'Completed': return 'text-sky-300';
    case 'Started': return 'text-lime-300';
    case 'Not Started': return 'text-yellow-200';
    case 'Incomplete': return 'text-red-300';
    case 'Cancelled': return 'text-orange-300';
    default: return 'text-zinc-400';
  }
}
