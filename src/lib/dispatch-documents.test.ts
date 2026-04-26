import test from 'node:test';
import assert from 'node:assert/strict';

import { isFuelReceiptDocument, pickFuelReceiptDocument, type TripDocument } from './dispatch-documents';

function makeDoc(overrides: Partial<TripDocument> = {}): TripDocument {
  return {
    id: 1,
    file_key: 'documents/1/test.jpg',
    original_filename: 'test.jpg',
    file_type: 'image/jpeg',
    file_size: 123,
    description: null,
    trip_number: 'T100',
    source_path: null,
    linked_record_type: null,
    linked_record_id: null,
    linked_record_key: null,
    uploaded_at: '2026-04-22T00:00:00Z',
    url: '/api/dispatch/documents/download/documents%2F1%2Ftest.jpg?redirect=true',
    sourceUrl: null,
    ...overrides,
  };
}

test('isFuelReceiptDocument excludes toll receipts even though they say receipt', () => {
  const tollDoc = makeDoc({
    original_filename: 'toll-2026-03-24.jpeg',
    description: 'toll receipt • expense #8',
  });

  assert.equal(isFuelReceiptDocument(tollDoc), false);
});

test('pickFuelReceiptDocument prefers exact linked fuel document over generic same-trip docs', () => {
  const entry = { id: 15, trip_number: 'T053034', date: '2026-04-14', location: 'Sweetwater, TX', odometer: 1595828 };
  const genericTripDoc = makeDoc({
    id: 11,
    original_filename: '2026-04-14-love-475-sweetwater-tx.jpg',
    description: "Fuel receipt - Love's 475 Sweetwater TX - 2026-04-14",
  });
  const exactLinkedDoc = makeDoc({
    id: 21,
    original_filename: '2026-04-14-love-475-sweetwater-tx.jpg',
    description: 'fuel receipt • fuel #15 • 2026-04-14',
    linked_record_type: 'fuel',
    linked_record_id: 15,
    linked_record_key: '15',
  });

  const picked = pickFuelReceiptDocument(entry, [genericTripDoc, exactLinkedDoc]);
  assert.equal(picked?.id, 21);
});

test('pickFuelReceiptDocument uses date and location when multiple fuel receipts exist on a trip', () => {
  const entry = { id: 14, trip_number: 'T053034', date: '2026-04-13', location: 'Rolla, MO', odometer: 1594366 };
  const wrongSameTripDoc = makeDoc({
    id: 21,
    original_filename: '2026-04-14-love-475-sweetwater-tx.jpg',
    description: 'Fuel receipt - Love\'s 475 Sweetwater TX - 2026-04-14',
  });
  const correctDoc = makeDoc({
    id: 10,
    original_filename: '2026-04-13-love-341-rolla-mo.jpg',
    description: 'Fuel receipt - Love\'s 341 Rolla MO - 2026-04-13',
  });

  const picked = pickFuelReceiptDocument(entry, [wrongSameTripDoc, correctDoc]);
  assert.equal(picked?.id, 10);
});
