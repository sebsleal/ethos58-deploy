/**
 * CSV parser with bootmod3 / MHD column detection.
 * Browser-compatible — no Node.js dependencies.
 */

const COLUMN_MAP = {
  time:        ['time', 'timestamp', 'elapsed', 'log time'],
  rpm:         ['rpm', 'engine speed', 'engine_speed'],
  load:        ['load_%', 'load (%)', 'load(%)', 'load act. (rel.)', 'load target (rel.)', 'load', 'engine load', 'throttle position'],
  afr:         ['air fuel ratio', 'air_fuel_ratio', 'afr', 'lambda'],
  boost:       ['boost (pre-throttle)', 'boost pre throttle', 'boost pre-throttle', 'pre throttle boost', 'manifold pressure pre throttle',
                'hp boost pre throttle', 'boost pressure pre throttle',
                'boost act', 'boost mean', 'manifold absolute pressure', 'boost pressure', 'boost_pressure',
                'boost (psi)', 'boost_psi', 'boost', 'manifold pressure', 'map'],
  iat:         ['intake air temp', 'intake_air_temp', 'intake air temperature',
                'charge air temp', 'charge_air_temp', 'charge air temperature',
                '^iat'],
  hpfp:        ['hp fuel pressure actual', 'hpfp actual', 'hpfp_actual', 'high pressure fuel pump actual', 'hpfp act',
                 'hpfp (psi)', 'hpfp_psi', 'hpfp', 'high pressure fuel pump', 'fuel pressure actual', 'fuel_pressure_actual'],
  hpfp_target: ['hpfp (target)', 'hpfp target', 'hpfp_target', 'hp fuel pressure target', 'fuel pressure target', 'hpfp req',
                'hpfp setpoint', 'hpfp_setpoint', 'hp fuel pressure setpoint', 'fuel pressure setpoint',
                'hpfp desired', 'hp fuel pressure desired', 'fuel pressure desired',
                'hpfp sp', 'hpfp set', 'high pressure fuel pump target', 'high pressure fuel pump setpoint'],
  afr_target:  ['afr target', 'afr_target', 'air fuel ratio target'],
  pedal:       ['pedal', 'accel. pedal', 'accel pedal', 'accelerator pedal', 'accel_pedal', 'pedal position'],
  throttle:    ['throttle', 'throttle position', 'throttle_position', 'throttle angle', 'throttle_angle'],
  ltft:        ['long term fuel trim', 'ltft', 'long_term_fuel_trim', 'fuel trim long term', 'fuel trim lt'],
  stft:        ['short term fuel trim', 'stft', 'short_term_fuel_trim', 'fuel trim short term', 'fuel trim st'],
};

const TIMING_KEYWORDS  = ['timing cor', 'timing_cor', 'ign cor', 'ign_cor', 'ignition cor', 'knock'];
const CYLINDER_KEYWORDS = ['cyl', 'cylinder', 'cyl_'];

// Signature columns unique to each format
const BM3_SIGNATURES  = [
  'bootmod3',
  '(bm3)',
  'boost (pre-throttle)',
  'hpfp act.',
  'hpfp (target)',
  'ignition cyl',
];
const MHD_SIGNATURES  = ['mhd', 'boost act', 'hpfp act', 'ltft', 'stft', 'wgdc', 'boost mean'];

function parseRow(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsvText(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV file is empty or could not be parsed.');
  const headers = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseRow(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return { rows, headers };
}

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

function findTimingColumns(headers) {
  return headers.filter(h => {
    const lower = h.toLowerCase();
    const hasTimingWord = TIMING_KEYWORDS.some(kw => lower.includes(kw));
    const hasCylWord    = CYLINDER_KEYWORDS.some(kw => lower.includes(kw));
    return hasTimingWord && hasCylWord;
  });
}

function detectBoostUnit(columnName, sampleValues = []) {
  if (!columnName) return 'psi';
  const lower = columnName.toLowerCase();
  // Unit explicitly in column name — most reliable
  if (lower.includes('bar')) return 'bar';
  if (lower.includes('kpa')) return 'kpa';
  if (lower.includes('psi')) return 'psi';

  // No unit in column name — infer from value range
  // Bar gauge boost: 0.5–2.5, absolute: 1.0–3.0  → max < 5
  // kPa absolute: 100–310                          → max > 50
  // psi gauge: 0–35, absolute: 14–50              → max 5–50
  const valid = sampleValues.filter(v => !isNaN(v) && v > 0);
  if (valid.length > 0) {
    const maxVal = Math.max(...valid);
    if (maxVal > 50) return 'kpa';
    if (maxVal < 5)  return 'bar';
  }
  return 'psi';
}

/**
 * Detect log format from headers.
 * Returns 'BM3', 'MHD', or 'Unknown'.
 */
export function detectLogFormat(headers) {
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

export function parseCsv(csvText) {
  const normalizedCsv = typeof csvText === 'string' ? csvText : String(csvText ?? '');
  const { rows, headers } = parseCsvText(normalizedCsv);

  const columns = {};
  for (const [key, keywords] of Object.entries(COLUMN_MAP)) {
    // Explicitly exclude post-throttle columns for boost
    const exclude = key === 'boost' ? ['post throttle', 'post-throttle'] : [];
    columns[key] = findColumn(headers, keywords, exclude);
  }

  const timingColumns = findTimingColumns(headers);

  // Sample boost values for unit detection when column name has no unit label
  const boostSamples = columns.boost
    ? rows.slice(0, 50).map(r => parseFloat(r[columns.boost])).filter(v => !isNaN(v))
    : [];
  const boostUnit = detectBoostUnit(columns.boost, boostSamples);
  const logFormat = detectLogFormat(headers);

  return { rows, columns, timingColumns, boostUnit, logFormat };
}

export function num(row, col) {
  if (!col || row[col] === undefined || row[col] === '') return NaN;
  return parseFloat(row[col]);
}

export function lambdaToAfr(lambda) {
  return lambda * 14.7;
}
