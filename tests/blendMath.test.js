import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateBlend, calibratePumpEthanol, estimateBlendFillCost, planEthanolOverTanks } from '../src/utils/blendMath.js';

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

test('calibratePumpEthanol averages valid readings', () => {
  const result = calibratePumpEthanol(['72', 74, 'bad', 80]);
  assert.equal(result, 75.3);
});

test('estimateBlendFillCost returns costs', () => {
  const result = estimateBlendFillCost({
    currentGallons: 5,
    currentE: 10,
    targetE: 40,
    tankSize: 13.7,
    pumpEthanol: 10,
    e85Price: 3.19,
    pumpPrice: 4.29,
  });

  assert.equal(typeof result.totalCost, 'number');
  assert.ok(result.totalCost > 0);
});

test('planEthanolOverTanks builds an N-tank plan', () => {
  const plan = planEthanolOverTanks({
    tanks: 3,
    startGallons: 5,
    startE: 20,
    tankSize: 13.7,
    targetE: 40,
    pumpEthanol: 10,
  });

  assert.equal(plan.length, 3);
  assert.equal(plan[0].tank, 1);
  assert.ok(plan[0].e85Gallons >= 0);
});
