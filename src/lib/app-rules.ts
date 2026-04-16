export const DISPATCH_APP_RULES = `
Dispatch app rules are app-specific. Treat them as local business logic, not generic trucking defaults.

Itinerary processing:
- Re-uploads always overwrite with new info, they are never duplicates.
- Insert/update all stops for both new and existing trips.
- Read every stop in order.
- Keep acquire, hook, drop, pickup, delivery, border crossing, and release as distinct stop events in stored data.
- Capture trailer swaps from the itinerary, especially hook/drop transitions.
- Use stored trip dates exactly as saved. Do not timezone-shift YYYY-MM-DD values.

Fuel processing:
- Link fuel receipts by trip date range, not by guessed active trip.
- Save the receipt document alongside the fuel entry.
- Preserve litres/gallons and odometer exactly as provided.
- Receipt matching must be per fuel entry, not just per trip.
- Date alone is not sufficient when multiple fuel-ups happen on the same day.
- Prefer exact linkage; otherwise match by multiple signals in this order: explicit link, date + location, odometer, litres/gallons, then weaker fallbacks.
- The app should aim for 1 fuel entry ↔ 1 receipt document.

Envelope PDF rules:
- Border crossing stops are excluded from the envelope unless explicitly requested.
- Trailer column follows the trailer attached after each stop event.
- First acquire can be blank if no trailer is attached yet.
- First hook starts the trailer timeline.
- Event column shows the real event in plain words.
- Billable extras stay separate from plain stop events.
- Use city + province/state formatting for location display when a clean envelope is needed.
`;

export const ITINERARY_LLM_RULES = `
Extra app rules for itinerary parsing:
- Extract stop events faithfully so later envelope rendering can distinguish ACQUIRE, HOOK, DELIVERY, PICKUP, DROP, BORDER CROSSING, and RELEASE.
- Preserve hook/drop order because trailer timeline depends on it.
- Prefer city + province/state in structured stop output.
- Keep trailer number exact when present in itinerary text.
`;
