# Dispatch app processing rules

These rules belong to this app and should travel with deployments.

## Purpose
This app should not rely on external chat memory to understand how DM Transport trips, fuel receipts, and envelope PDFs work. The app should carry its own operating rules.

## Itinerary rules
- Re-uploads are never treated as duplicates.
- Existing trips must still receive updated stops and status.
- Hook/drop/acquire/release/pickup/delivery/border crossing are all distinct stored events.
- Trailer swaps matter and should be preserved from stop order.
- Stored trip dates should be used exactly as saved.

## Fuel receipt rules
- Match receipts to trips by date range.
- Save receipt files with the fuel entry.
- Preserve litres, gallons, and odometer exactly.
- App-specific naming can be standardized to receipt date when needed.
- Receipt matching must be per fuel entry, not just per trip.
- Do not assume date alone is enough, because the same day can have multiple fuel-ups.
- Preferred matching order: explicit linked fuel entry, then date + location, then odometer, then litres/gallons, then weaker fallback.
- Target behavior is 1 fuel entry ↔ 1 receipt document.

## Envelope PDF rules
- Exclude border crossings unless explicitly requested.
- Trailer timeline follows actual hook/drop progression.
- Event column shows real event words.
- Billable extras belong in their own column, separate from raw events.
- Use clean city + province/state formatting when requested.

## Future deployment note
If this app is deployed for another company, these rules should be replaced or extended through app-owned configuration rather than hard-coded assumptions spread across chats.
