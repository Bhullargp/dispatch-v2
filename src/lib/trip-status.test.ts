import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveTripStatus, hasFinalYardDropOrRelease, normalizeTripStatus } from './trip-status';

test('deriveTripStatus marks future trips as not started', () => {
  assert.equal(deriveTripStatus({ startDate: '2026-04-30', endDate: '2026-05-01', today: '2026-04-24' }), 'Not Started');
});

test('deriveTripStatus marks trips spanning today as active', () => {
  assert.equal(deriveTripStatus({ startDate: '2026-04-24', endDate: '2026-04-25', today: '2026-04-24' }), 'Active');
  assert.equal(deriveTripStatus({ startDate: '2026-04-23', endDate: '2026-04-24', today: '2026-04-24' }), 'Active');
});

test('deriveTripStatus marks past trips with final Caledon drop/release as completed', () => {
  assert.equal(deriveTripStatus({
    startDate: '2026-04-20',
    endDate: '2026-04-21',
    today: '2026-04-24',
    stops: [
      { stop_type: 'PICKUP', location: 'Plano, IL' },
      { stop_type: 'RELEASE', location: 'Caledon, ON' },
    ],
  }), 'Completed');
});

test('deriveTripStatus marks past trips missing final yard stop as incomplete', () => {
  assert.equal(deriveTripStatus({
    startDate: '2026-04-20',
    endDate: '2026-04-21',
    today: '2026-04-24',
    stops: [{ stop_type: 'DELIVER', location: 'Plano, IL' }],
  }), 'Incomplete');
});

test('deriveTripStatus preserves explicit completed/cancelled statuses', () => {
  assert.equal(deriveTripStatus({ startDate: '2026-04-30', requestedStatus: 'Completed', today: '2026-04-24' }), 'Completed');
  assert.equal(deriveTripStatus({ startDate: '2026-04-30', requestedStatus: 'canceled', today: '2026-04-24' }), 'Cancelled');
});

test('deriveTripStatus moves vague defaults based on dates', () => {
  assert.equal(deriveTripStatus({ startDate: '2026-04-30', requestedStatus: 'Active', today: '2026-04-24' }), 'Not Started');
  assert.equal(deriveTripStatus({ startDate: '2026-04-24', endDate: '2026-04-25', requestedStatus: 'Not Started', today: '2026-04-24' }), 'Active');
});

test('hasFinalYardDropOrRelease accepts Boss spelling and stop aliases', () => {
  assert.equal(hasFinalYardDropOrRelease([{ type: 'DROP', location: 'Galauden, ON' }]), true);
  assert.equal(normalizeTripStatus('not started yet'), 'Not Started');
});

test('hasFinalYardDropOrRelease requires the final stop to be the yard', () => {
  assert.equal(hasFinalYardDropOrRelease([
    { type: 'RELEASE', location: 'Caledon, ON' },
    { type: 'DELIVER', location: 'Plano, IL' },
  ]), false);
});
