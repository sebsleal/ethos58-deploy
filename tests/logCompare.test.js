import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCompareChartData } from '../src/utils/logCompare.js';

test('mergeCompareChartData returns base chart when compare dataset is absent', () => {
  const analysis = { chartData: [{ time: 0, afrActual: 12.2, boost: 10 }] };

  const merged = mergeCompareChartData(analysis, null);

  assert.deepEqual(merged, analysis.chartData);
});

test('mergeCompareChartData overlays compare AFR/boost and keeps time-sorted union', () => {
  const analysis = {
    chartData: [
      { time: 2, afrActual: 12.0, boost: 14 },
      { time: 1, afrActual: 12.5, boost: 11 },
    ],
  };
  const compareAnalysis = {
    chartData: [
      { time: 1, afrActual: 11.8, boost: 10 },
      { time: 3, afrActual: 11.6, boost: 12 },
    ],
  };

  const merged = mergeCompareChartData(analysis, compareAnalysis);

  assert.deepEqual(merged.map(row => row.time), [1, 2, 3]);
  assert.equal(merged[0].afrActual, 12.5);
  assert.equal(merged[0].afrActual_b, 11.8);
  assert.equal(merged[0].boost_b, 10);
  assert.equal(merged[2].afrActual_b, 11.6);
  assert.equal(merged[2].boost_b, 12);
});
