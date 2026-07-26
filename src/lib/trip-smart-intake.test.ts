import test from 'node:test';
import assert from 'node:assert/strict';

import { llmResultToParsedTrip, parseDriverItinerary } from './pdf-processing';
import { shouldShowTripSmartIntakePanel } from './trip-details-ui';

const SAMPLE_ITINERARY = `Driver Trip Itinerary T053209                                                                          Start Date: Sun Apr 19, 2026

Lead Driver          GURNEETPAL SINGH BHULLAR                               Dispatched By        Name: Vikramjeet Singh Gill
Team Driver                                                                                      EMail:   flatbedteam@dmtransport.ca
                                                                                                 Issued On:     Apr 17, 2026 at 11:26AM

ROUTING INSTRUCTIONS                                                                          TOTAL ROUTED MILES: 562

ACQUIRE (CALEDON, ON)
DM TRANSPORT - YARD                                                                              Truck: 598
121 HEALEY ROAD
CALEDON, ON

HOOK (CALEDON, ON)
DM TRANSPORT - YARD                                                                              Trailer: 1020R
121 HEALEY ROAD
CALEDON, ON

DELIVER (PLANO, IL)                                                                              APPOINTMENT - MON, APR 20 AT 8:00 AM
562 miles from last stop (562.00 miles traveled, 0.00 miles remaining)
`;

const T053452_HEADER = `Driver Trip Itinerary T053452                                                                        Start Date: Sun Apr 26, 2026

Lead Driver          GURNEETPAL SINGH BHULLAR                                Dispatched By     Name: Vikramjeet Singh Gill
Team Driver                                                                                    EMail:   flatbedteam@dmtransport.ca
                                                                                               Issued On:     Apr 24, 2026 at 02:14PM

ROUTING INSTRUCTIONS                                                                        TOTAL ROUTED MILES: 2,088

ACQUIRE (CALEDON, ON)
DM TRANSPORT - YARD                                                                            Truck: 598
121 HEALEY ROAD
CALEDON, ON

HOOK (CALEDON, ON)
DM TRANSPORT - YARD                                                                            Trailer: 1038R
121 HEALEY ROAD
CALEDON, ON

DELIVER (WELLFORD, SC)                                                                         APPOINTMENT - MON, APR 27 AT 6:00 AM
838 miles from last stop (838.00 miles traveled, 1,250.00 miles remaining)

PICKUP (CHURCH HILL, TN)                                                                       APPOINTMENT - MON, APR 27 AT 1:00 PM
163 miles from last stop (1,001.00 miles traveled, 1,087.00 miles remaining)

DELIVER (LAURIER-STATION, QC)                                                                  APPOINTMENT REQUIRED - THU, APR 30
1,087 miles from last stop (2,088.00 miles traveled, 0.00 miles remaining)
`;

test('trip details page hides smart intake panel now that documents tab owns it', () => {
  assert.equal(shouldShowTripSmartIntakePanel(), false);
});

test('parseDriverItinerary extracts lead driver and equipment from DM itinerary text', () => {
  const parsed = parseDriverItinerary(SAMPLE_ITINERARY);

  assert.equal(parsed.tripNumber, 'T053209');
  assert.equal(parsed.driverName, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.leadDriver, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.coDriver, null);
  assert.equal(parsed.truckNumber, '598');
  assert.equal(parsed.trailerNumber, '1020R');
  assert.equal(parsed.totalMiles, 562);
  assert.equal(parsed.stops.at(-1)?.stop_type, 'DELIVER');
});

test('parseDriverItinerary does not mistake dispatcher name for the driver', () => {
  const parsed = parseDriverItinerary(SAMPLE_ITINERARY);
  assert.notEqual(parsed.driverName, 'Vikramjeet Singh Gill');
  assert.notEqual(parsed.leadDriver, 'Vikramjeet Singh Gill');
});

test('parseDriverItinerary handles T053452-style header with dispatcher Name separately', () => {
  const parsed = parseDriverItinerary(T053452_HEADER);

  assert.equal(parsed.tripNumber, 'T053452');
  assert.equal(parsed.driverName, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.leadDriver, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.dispatcherName, 'Vikramjeet Singh Gill');
  assert.equal(parsed.truckNumber, '598');
  assert.equal(parsed.trailerNumber, '1038R');
  assert.equal(parsed.totalMiles, 2088);
  assert.equal(parsed.startDate, '2026-04-26');
  assert.equal(parsed.endDate, '2026-04-30');
});

test('llmResultToParsedTrip rejects dispatcher when model puts it in driver fields', () => {
  const parsed = llmResultToParsedTrip({
    trip_number: 'T053452',
    start_date: '2026-04-26',
    driver_name: 'Vikramjeet Singh Gill',
    lead_driver: 'GURNEETPAL SINGH BHULLAR',
    co_driver: 'flatbedteam@dmtransport.ca',
    truck_number: '598',
    trailer_number: '1038R',
    total_miles: 2088,
    stops: [],
    customs_broker: null,
    dispatcher_name: 'Vikramjeet Singh Gill',
  }, T053452_HEADER);

  assert.equal(parsed.driverName, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.leadDriver, 'GURNEETPAL SINGH BHULLAR');
  assert.equal(parsed.coDriver, null);
  assert.equal(parsed.dispatcherName, 'Vikramjeet Singh Gill');
});
