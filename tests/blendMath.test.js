import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBlend } from '../src/utils/blendMath.js';

test('calculateBlend returns expected shape and sane values', () => {
  const result = calculateBlend({
    current_gallons: 5,
    current_ethanol_percent: 10,
    target_ethanol_percent: 40,
    tank_size: 13.7,
    pump_ethanol_percent: 0,
    precision_mode: false,
  });

  assert.equal(typeof result.gallons_of_e85_to_add, 'number');
  assert.equal(typeof result.gallons_of_93_to_add, 'number');
  assert.equal(result.precision_mode, false);
  assert.ok(result.gallons_of_e85_to_add > 0);
  assert.ok(result.gallons_of_93_to_add >= 0);
  assert.ok(result.resulting_percent >= 39.5 && result.resulting_percent <= 40.5);
});

test('calculateBlend throws on invalid range', () => {
  assert.throws(() => {
    calculateBlend({
      current_gallons: 15,
      current_ethanol_percent: 10,
      target_ethanol_percent: 40,
      tank_size: 13.7,
    });
  }, /current_gallons/);
});
