import test from 'node:test';
import assert from 'node:assert/strict';

import { formatFuelOdometerInput } from './fuel-format';

test('formatFuelOdometerInput renders scientific notation as plain digits', () => {
  assert.equal(formatFuelOdometerInput('1.604991e+06'), '1604991');
});

test('formatFuelOdometerInput returns empty string for missing values', () => {
  assert.equal(formatFuelOdometerInput(null), '');
  assert.equal(formatFuelOdometerInput(undefined), '');
  assert.equal(formatFuelOdometerInput(''), '');
});
