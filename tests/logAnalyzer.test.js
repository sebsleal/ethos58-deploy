import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLog, analyzeParsedLog } from '../src/utils/logAnalyzer.js';
import { parseCsv as parseBrowserCsv } from '../src/utils/csvParser.js';
import { parseCsv as parseServerCsv } from '../server/utils/csvParser.js';
import { computeHealthScore } from '../src/utils/storage.js';

const csv = `time,load (%),boost (psi),air fuel ratio,hpfp actual,hpfp target,intake air temp [°F],timing cor cyl1\n0,20,0,14.7,2500,2500,90,0\n1,80,12,14.2,2000,2500,145,-4.5\n`;

test('analyzeLog flags risk conditions from browser parser path', () => {
  const result = analyzeLog(csv, 'risk-log.csv', { ethanol: 10, engine: 'B58 Gen1', tuneStage: 'Stage 2' });

  assert.equal(result.status, 'Risk');
  assert.equal(result.metrics.afr.status, 'Risk');
  assert.equal(result.metrics.hpfp.status, 'Risk');
  assert.equal(result.metrics.iat.status, 'Risk');
  assert.equal(result.metrics.timingCorrections.status, 'Risk');
  assert.ok(result.chartData.length > 0);
});

test('analyzeParsedLog works with server csv parser output', () => {
  const parsed = parseServerCsv(Buffer.from(csv));
  const result = analyzeParsedLog(parsed, 'risk-log.csv', { ethanol: 10 });

  assert.equal(result.row_count, 2);
  assert.equal(result.status, 'Risk');
  assert.equal(result.detectedColumns.boostUnit, 'psi');
});

test('detects BM3 format when bootmod3 markers exist even with LTFT/STFT columns', () => {
  const bm3Like = `Time,Accel. Pedal[%],Boost (Pre-Throttle)[psig],HPFP (Target)[psig],HPFP Act.[psig],LTFT[-],STFT[-],bootmod3_3.12.000_unknown\n0,100,20,3000,1539,0,0,1\n`;
  const parsed = parseBrowserCsv(bm3Like);
  assert.equal(parsed.logFormat, 'BM3');
});

test('HPFP crash at high pedal is flagged as risk with strong health score penalty', () => {
  const crashCsv = `Time,Accel. Pedal[%],Boost (Pre-Throttle)[psig],Load Act. (Rel.)[%],HPFP (Target)[psig],HPFP Act.[psig],Lambda Act.[AFR],IAT[F],(RAM) Ignition Timing Corr. Cyl. (Dzw_kr) [0x51802430] 1[-],bootmod3_3.12.000_unknown\n0.1,100,20,92,3000,1539,12.0,120,0,1\n0.2,95,18,88,2900,1700,12.1,122,0,1\n`;
  const result = analyzeLog(crashCsv, 'bm3-crash.csv', { ethanol: 30 });
  const health = computeHealthScore(result);

  assert.equal(result.logFormat, 'BM3');
  assert.equal(result.metrics.hpfp.status, 'Risk');
  assert.equal(result.metrics.hpfp.worst_actual, 1539);
  assert.equal(result.metrics.hpfp.worst_target, 3000);
  assert.ok(result.metrics.hpfp.max_drop_pct >= 45);
  assert.ok(health <= 55);
});
