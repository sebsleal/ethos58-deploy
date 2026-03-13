/**
 * CSV parser with bootmod3 / MHD column detection.
 *
 * Both loggers export CSVs with different column naming conventions.
 * We use keyword-based fuzzy matching against a priority list of patterns
 * so we can handle both without requiring a fixed schema.
 *
 * Timing-correction columns are detected dynamically — any header containing
 * timing/ignition/knock keywords AND a cylinder keyword is treated as a
 * per-cylinder correction channel.
 */

import { parse } from 'csv-parse/sync';

// Ordered keyword lists: first match wins.
const COLUMN_MAP = {
  time: ['time', 'timestamp', 'elapsed', 'log time'],
  rpm: ['rpm', 'engine speed', 'engine_speed'],
  load: ['load_%', 'load (%)', 'load(%)', 'load act. (rel.)', 'load target (rel.)', 'load', 'engine load', 'throttle position'],
  afr: ['air fuel ratio', 'air_fuel_ratio', 'afr', 'lambda'],
  boost: ['boost (pre-throttle)', 'boost pre throttle', 'boost pre-throttle', 'pre throttle boost', 'manifold pressure pre throttle',
    'hp boost pre throttle', 'boost pressure pre throttle',
    'boost act', 'boost mean', 'manifold absolute pressure', 'boost pressure', 'boost_pressure',
    'boost (psi)', 'boost_psi', 'boost', 'manifold pressure', 'map'],
  iat: ['intake air temp', 'intake_air_temp', 'intake air temperature',
        'charge air temp', 'charge_air_temp', 'charge air temperature',
        '^iat',   // matches IAT[F], IAT[°C], IAT (F), IAT, etc.
                  // ^ prefix = startsWith, so it won't match "deviation" mid-word
       ],
  hpfp: ['hp fuel pressure actual', 'hpfp actual', 'hpfp_actual', 'high pressure fuel pump actual', 'hpfp act',
    'hpfp (psi)', 'hpfp_psi', 'hpfp', 'high pressure fuel pump', 'fuel pressure actual', 'fuel_pressure_actual'],
  hpfp_target: ['hpfp (target)', 'hpfp target', 'hpfp_target', 'hp fuel pressure target', 'fuel pressure target', 'hpfp req'],
  afr_target: ['afr target', 'afr_target', 'air fuel ratio target'],
  pedal: ['pedal', 'accel. pedal', 'accel pedal', 'accelerator pedal', 'accel_pedal', 'pedal position'],
  throttle: ['throttle', 'throttle position', 'throttle_position', 'throttle angle', 'throttle_angle'],
  ltft: ['long term fuel trim', 'ltft', 'long_term_fuel_trim', 'fuel trim long term', 'fuel trim lt'],
  stft: ['short term fuel trim', 'stft', 'short_term_fuel_trim', 'fuel trim short term', 'fuel trim st'],
};

const TIMING_KEYWORDS = ['timing cor', 'timing_cor', 'ign cor', 'ign_cor', 'ignition cor', 'knock'];
const CYLINDER_KEYWORDS = ['cyl', 'cylinder', 'cyl_'];
const BM3_SIGNATURES = [
  'bootmod3',
  '(bm3)',
  'boost (pre-throttle)',
  'hpfp act.',
  'hpfp (target)',
  'ignition cyl',
];
const MHD_SIGNATURES = ['mhd', 'boost act', 'hpfp act', 'ltft', 'stft', 'wgdc', 'boost mean'];

/**
 * Find the first CSV header matching any of the given keywords (case-insensitive).
 *
 * Keyword syntax:
 *   'foo'   — header contains 'foo' anywhere (original behaviour)
 *   '^foo'  — header STARTS WITH 'foo' (avoids false matches like
 *             'iat' matching 'Boost Pressure (Deviation)[psia]' via "deviation")
 */
function findColumn(headers, keywords, exclude = []) {
  for (const keyword of keywords) {
    const isStart = keyword.startsWith('^');
    const kw = isStart ? keyword.slice(1).toLowerCase() : keyword.toLowerCase();
    const match = headers.find(h => {
      const hl = h.toLowerCase();
      if (exclude.some(ex => hl.includes(ex))) return false;
      return isStart ? hl.startsWith(kw) : hl.includes(kw);
    });
    if (match) return match;
  }
  return null;
}

/**
 * Find all per-cylinder timing correction columns.
 */
function findTimingColumns(headers) {
  return headers.filter(h => {
    const lower = h.toLowerCase();
    const hasTimingWord = TIMING_KEYWORDS.some(kw => lower.includes(kw));
    const hasCylWord = CYLINDER_KEYWORDS.some(kw => lower.includes(kw));
    return hasTimingWord && hasCylWord;
  });
}

/**
 * Detect the unit of the boost column from its header name.
 * Returns 'bar', 'kpa', or 'psi' (default).
 */
function detectBoostUnit(columnName, sampleValues = []) {
  if (!columnName) return 'psi';
  const lower = columnName.toLowerCase();
  if (lower.includes('bar')) return 'bar';
  if (lower.includes('kpa')) return 'kpa';
  if (lower.includes('psi')) return 'psi';

  const valid = sampleValues.filter(v => !isNaN(v) && v > 0);
  if (valid.length > 0) {
    const maxVal = Math.max(...valid);
    if (maxVal > 50) return 'kpa';
    if (maxVal < 5) return 'bar';
  }
  return 'psi';
}

function detectLogFormat(headers) {
  const lowers = headers.map(h => h.toLowerCase());
  if (lowers.some(h => h.includes('bootmod3') || h.includes('(bm3)'))) return 'BM3';
  if (lowers.some(h => h.includes('mhd'))) return 'MHD';
  const bm3Matches = BM3_SIGNATURES.filter(sig => lowers.some(h => h.includes(sig))).length;
  const mhdMatches = MHD_SIGNATURES.filter(sig => lowers.some(h => h.includes(sig))).length;
  if (bm3Matches > mhdMatches) return 'BM3';
  if (mhdMatches > bm3Matches) return 'MHD';
  if (bm3Matches > 0) return 'BM3';
  if (mhdMatches > 0) return 'MHD';
  return 'Unknown';
}

/**
 * Parse a raw CSV buffer into structured rows plus resolved column mapping.
 * @param {Buffer|string} csvBuffer
 * @returns {{ rows: object[], columns: object, timingColumns: string[], boostUnit: string }}
 */
export function parseCsv(csvBuffer) {
  const raw = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });

  if (!raw || raw.length === 0) {
    throw new Error('CSV file is empty or could not be parsed.');
  }

  const headers = Object.keys(raw[0]);

  const columns = {};
  for (const [key, keywords] of Object.entries(COLUMN_MAP)) {
    const exclude = key === 'boost' ? ['post throttle', 'post-throttle'] : [];
    columns[key] = findColumn(headers, keywords, exclude);
  }

  const timingColumns = findTimingColumns(headers);
  const boostSamples = columns.boost
    ? raw.slice(0, 50).map(r => parseFloat(r[columns.boost])).filter(v => !isNaN(v))
    : [];
  const boostUnit = detectBoostUnit(columns.boost, boostSamples);
  const logFormat = detectLogFormat(headers);

  return { rows: raw, columns, timingColumns, boostUnit, logFormat };
}

/**
 * Extract a numeric value from a row by column name. Returns NaN if missing or non-numeric.
 */
export function num(row, col) {
  if (!col || row[col] === undefined || row[col] === '') return NaN;
  return parseFloat(row[col]);
}

/**
 * Convert lambda (relative air-fuel ratio) to AFR using stoichiometric ratio for gasoline.
 */
export function lambdaToAfr(lambda) {
  return lambda * 14.7;
}
