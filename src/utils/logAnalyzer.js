/**
 * Log analysis engine for Ethos85.
 *
 * Context-aware analysis — each metric only inspects rows where the car
 * is actually under demand. Coasting and idle produce naturally extreme
 * AFR/HPFP readings that are not safety concerns:
 *
 *   - During decel/coast, ECU cuts fuel → O2 sensor reads 18–22+ (not a real lean event)
 *   - At idle, HPFP runs at 300–800 psi intentionally — not a pressure drop
 *   - Light-throttle timing corrections are routine closed-loop adjustments
 *
 * Row classifications (derived from load + boost columns):
 *   COAST/IDLE: load < 50% and boost ≤ 2 psi  ← excluded from all metric analysis
 *   DEMAND:     load ≥ 50% OR boost > 2 psi   ← AFR sample collection, HPFP checked here
 *   WOT:        load ≥ 70% OR boost > 8 psi   ← AFR lean/rich events flagged here
 *
 * AFR thresholds are adjusted for ethanol content — E40 stoich is ~12.4:1,
 * so lean/rich limits scale proportionally from E0 baseline values.
 *
 * Boost unit detection: if the CSV column header contains "bar" or "kpa",
 * values are automatically converted to psi for all threshold comparisons.
 */

import { parseCsv, num, lambdaToAfr } from './csvParser.js'; // browser-compatible

// ─── Fuel Trim Analysis ───────────────────────────────────────────────────────

function analyzeFuelTrims(rows, columns) {
  const ltftCol = columns.ltft;
  const stftCol = columns.stft;
  const rpmCol  = columns.rpm;

  if (!ltftCol && !stftCol) return null;

  // Bucket rows by RPM: idle (<1500), cruise (1500–3500), high-load (>3500)
  const buckets = { idle: [], cruise: [], highLoad: [] };

  for (const row of rows) {
    const ltft = ltftCol ? num(row, ltftCol) : NaN;
    const stft = stftCol ? num(row, stftCol) : NaN;
    const rpm  = rpmCol  ? num(row, rpmCol)  : NaN;

    const combined = !isNaN(ltft) && !isNaN(stft) ? ltft + stft
      : !isNaN(ltft) ? ltft
      : !isNaN(stft) ? stft
      : NaN;

    if (isNaN(combined)) continue;

    const bucket = isNaN(rpm) ? 'cruise'
      : rpm < 1500  ? 'idle'
      : rpm <= 3500 ? 'cruise'
      : 'highLoad';

    buckets[bucket].push(combined);
  }

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const result = {
    idle:     avg(buckets.idle)     !== null ? roundN(avg(buckets.idle),     1) : null,
    cruise:   avg(buckets.cruise)   !== null ? roundN(avg(buckets.cruise),   1) : null,
    highLoad: avg(buckets.highLoad) !== null ? roundN(avg(buckets.highLoad), 1) : null,
    hasData:  true,
  };

  // Flag any bucket with avg trim deviation > ±5%
  result.idleStatus     = result.idle     !== null ? (Math.abs(result.idle)     > 5 ? 'Caution' : 'Safe') : null;
  result.cruiseStatus   = result.cruise   !== null ? (Math.abs(result.cruise)   > 5 ? 'Caution' : 'Safe') : null;
  result.highLoadStatus = result.highLoad !== null ? (Math.abs(result.highLoad) > 5 ? 'Caution' : 'Safe') : null;

  return result;
}

// ─── Knock Scatter Data ───────────────────────────────────────────────────────

function buildKnockScatterData(rows, columns, timingColumns, boostUnit) {
  if (timingColumns.length === 0) return [];

  const rpmCol  = columns.rpm;
  const loadCol = columns.load;

  const points = [];

  for (const row of rows) {
    const rpm  = rpmCol  ? num(row, rpmCol)  : NaN;
    const load = loadCol ? num(row, loadCol) : NaN;

    if (isNaN(rpm) || isNaN(load)) continue;

    let worstPull = 0;
    for (const col of timingColumns) {
      const val = num(row, col);
      if (!isNaN(val) && val < worstPull) worstPull = val;
    }

    if (worstPull < -0.5) {
      points.push({
        rpm:      Math.round(rpm),
        load:     roundN(load, 1),
        pull:     roundN(worstPull, 2),
        severity: worstPull <= -4 ? 'Risk' : worstPull <= -2 ? 'Caution' : 'Minor',
      });
    }
  }

  return points;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOAD_DEMAND = 50;   // % — minimum load for HPFP / AFR sampling
const LOAD_WOT = 70;   // % — WOT threshold for lean/rich flagging
const BOOST_DEMAND = 2;    // psi — demand threshold regardless of load
const BOOST_WOT = 8;    // psi — WOT threshold regardless of load
const LOAD_TIMING = 40;   // % — minimum load for meaningful timing corrections

// AFR lean thresholds are now per-blend via getAfrThresholds (lookup table from PDF).
// Rich limits remain E0-baseline, scaled by stoich ratio.
const AFR_RICH_RISK = 10.0;
const AFR_RICH_CAUTION = 10.8;

// HPFP thresholds are engine-specific — see getHpfpDropThresholds(engine).
// These are used as fallback for unknown engines.
const HPFP_DROP_RISK_PCT = 20;
const HPFP_DROP_CAUTION_PCT = 10;

const IAT_RISK_F = 140;
const IAT_CAUTION_F = 120;

// Per PDF Quick Rule Reference:
//   >−5° single cylinder sustained       → KNOCK RISK
//   >−4° on 3+ cylinders simultaneously  → FUEL QUALITY (handled in analyzeTimingCorrections)
//   >−3° single cyl                       → CAUTION
const TIMING_RISK_DEG = -5.0;
const TIMING_CAUTION_DEG = -3.0;
const TIMING_MULTICYL_RISK_DEG = -4.0; // threshold for simultaneous multi-cyl fuel quality flag
const TIMING_MULTICYL_MIN_CYLS = 3;    // how many cylinders must pull simultaneously

function maxFinite(values) {
  let peak = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (peak === null || value > peak) peak = value;
  }
  return peak;
}

// O2 sensors read 18–22+ during decel fuel cut regardless of blend.
// Chart AFR values above this threshold are excluded to clean up the display.
const FUEL_CUT_AFR = 16.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_RANK = { Safe: 0, Caution: 1, Risk: 2 };

function worstStatus(...statuses) {
  return statuses
    .filter(Boolean)
    .reduce((worst, s) => (STATUS_RANK[s] ?? 0) > (STATUS_RANK[worst] ?? 0) ? s : worst, 'Safe');
}

function roundN(v, n) { return parseFloat(v.toFixed(n)); }

/**
 * Normalize a boost value to psi from whatever unit the CSV uses.
 */
function normalizeBoostToPsi(v, unit) {
  if (isNaN(v)) return NaN;
  if (unit === 'bar') return v * 14.5038;
  if (unit === 'kpa') return v * 0.14504;
  return v;
}

/**
 * Compute ethanol-adjusted AFR safety thresholds.
 *
 * Stoich and lean alarm values come from the BMW Datalog Diagnostic Reference PDF
 * (sourced from HP Academy, ARM Motorsports, and community validation).
 * BMW DMEs always report AFR relative to gasoline stoich (14.7) — true lambda is
 * reported_AFR ÷ 14.7. A single-sample spike to 234.95 AFR post-lift is a DME
 * fuel-cut sentinel value and is filtered upstream via FUEL_CUT_AFR.
 *
 * Stoich lookup (exact PDF values):
 *   E0: 14.7   E10: 14.1   E30: 12.1   E40: 11.4   E85: 9.8   E100: 9.0
 *
 * Lean alarm thresholds (reported AFR from PDF):
 *   E0/E10: >13.0   E30: >11.5   E40: >10.8   E85: >9.5
 */
function getAfrThresholds(ethanolPercent = 10) {
  const e = Math.min(100, Math.max(0, Number(ethanolPercent) || 10));

  // Piecewise linear interpolation between known PDF data points
  const STOICH_POINTS = [
    [0, 14.7], [10, 14.1], [30, 12.1], [40, 11.4], [85, 9.8], [100, 9.0],
  ];
  const LEAN_RISK_POINTS = [
    [0, 13.5], [10, 13.5], [30, 12.0], [40, 11.3], [85, 10.0], [100, 9.3],
  ];
  const LEAN_CAUTION_POINTS = [
    [0, 13.0], [10, 13.0], [30, 11.5], [40, 10.8], [85, 9.5], [100, 8.8],
  ];

  function interp(points, x) {
    if (x <= points[0][0]) return points[0][1];
    if (x >= points[points.length - 1][0]) return points[points.length - 1][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      if (x >= x0 && x <= x1) {
        return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
      }
    }
    return points[points.length - 1][1];
  }

  const stoich = parseFloat(interp(STOICH_POINTS, e).toFixed(2));
  const lean_risk = parseFloat(interp(LEAN_RISK_POINTS, e).toFixed(2));
  const lean_caution = parseFloat(interp(LEAN_CAUTION_POINTS, e).toFixed(2));
  const r = stoich / 14.7;

  return {
    stoich,
    lean_risk,
    lean_caution,
    rich_risk: parseFloat((AFR_RICH_RISK * r).toFixed(2)),
    rich_caution: parseFloat((AFR_RICH_CAUTION * r).toFixed(2)),
  };
}

/**
 * Engine-specific HPFP drop thresholds (from PDF Quick Rule Reference).
 *   B58 Gen1:        >20% = Risk,  >10% = Caution
 *   B58TU / S55 / S58: >18% = Risk,   >8% = Caution
 *   N54 / N55:       >20% = Risk,  >10% = Caution  (absolute PSI thresholds also apply)
 *   Others:          >20% = Risk,  >10% = Caution
 */
function getHpfpDropThresholds(engine) {
  const e = (engine || '').toUpperCase();
  if (e.includes('B58TU') || e.includes('B58 GEN2') || e.includes('S55') || e.includes('S58')) {
    return { risk: 18, caution: 8 };
  }
  return { risk: HPFP_DROP_RISK_PCT, caution: HPFP_DROP_CAUTION_PCT };
}

function isDemand(load, boost, pedal, throttle) {
  const l = isNaN(load) ? 0 : load;
  const b = isNaN(boost) ? 0 : boost;
  const p = isNaN(pedal) ? NaN : pedal;
  const t = isNaN(throttle) ? NaN : throttle;

  // If we have pedal/throttle data, reject if both are explicitly lifted (coasting/shifting)
  if (!isNaN(p) && p < 1 && (!isNaN(t) ? t < 5 : true)) return false;

  return l >= LOAD_DEMAND || b > BOOST_DEMAND;
}

function isWot(load, boost, pedal, throttle) {
  const l = isNaN(load) ? 0 : load;
  const b = isNaN(boost) ? 0 : boost;
  const p = isNaN(pedal) ? NaN : pedal;
  const t = isNaN(throttle) ? NaN : throttle;

  // Require actual driver intent for WOT to avoid fuel-cut coasting spikes
  if (!isNaN(p) && p < 50) return false;
  if (!isNaN(t) && t < 30) return false;

  return l >= LOAD_WOT || b > BOOST_WOT;
}

function isHpfpCrashWindow(load, boost, pedal, throttle) {
  const p = isNaN(pedal) ? NaN : pedal;
  const t = isNaN(throttle) ? NaN : throttle;

  if (!isDemand(load, boost, pedal, throttle)) return false;
  if (!isNaN(p) && p >= 95) return true;
  if (!isNaN(t) && t >= 85) return true;
  return isWot(load, boost, pedal, throttle);
}

// ─── AFR Analysis ────────────────────────────────────────────────────────────

function analyzeAfr(rows, columns, isLambdaAfr, thresholds, boostUnit) {
  const afrCol = columns.afr;
  const loadCol = columns.load;
  const boostCol = columns.boost;
  const targetCol = columns.afr_target;
  const pedalCol = columns.pedal;
  const throttleCol = columns.throttle;

  if (!afrCol) {
    return { actual: null, target: null, lean_events: 0, rich_events: 0, status: 'Safe', note: 'AFR column not found in log.' };
  }

  const toAfr = v => isLambdaAfr ? lambdaToAfr(v) : v;
  const { lean_risk, lean_caution, rich_risk, rich_caution } = thresholds;

  let status = 'Safe';
  let worstLean = null;
  let leanEvents = 0;
  let richEvents = 0;
  const demandAfrSamples = [];
  const targetSamples = [];

  for (const row of rows) {
    const rawAfr = num(row, afrCol);
    if (isNaN(rawAfr)) continue;

    const afr = toAfr(rawAfr);
    if (afr >= FUEL_CUT_AFR) continue;

    const load = num(row, loadCol);
    const boost = normalizeBoostToPsi(num(row, boostCol), boostUnit);
    const pedal = num(row, pedalCol);
    const throttle = num(row, throttleCol);

    // Collect demand AFR samples and target readings only at meaningful load
    if (isDemand(load, boost, pedal, throttle)) {
      demandAfrSamples.push(afr);
      if (targetCol) {
        const rawTarget = num(row, targetCol);
        if (!isNaN(rawTarget)) targetSamples.push(toAfr(rawTarget));
      }
    }

    // Only flag lean/rich at WOT — coasting 18:1+ AFR is intentional fuel cut
    if (isWot(load, boost, pedal, throttle)) {
      if (afr > lean_risk) {
        leanEvents++;
        status = 'Risk';
        if (worstLean === null || afr > worstLean) worstLean = afr;
      } else if (afr > lean_caution && status !== 'Risk') {
        leanEvents++;
        status = 'Caution';
        if (worstLean === null || afr > worstLean) worstLean = afr;
      } else if (afr < rich_risk) {
        richEvents++;
        status = 'Risk';
      } else if (afr < rich_caution && status !== 'Risk') {
        richEvents++;
        status = 'Caution';
      }
    }
  }

  const avgDemandAfr = demandAfrSamples.length
    ? demandAfrSamples.reduce((a, b) => a + b, 0) / demandAfrSamples.length
    : null;

  const avgTarget = targetSamples.length
    ? targetSamples.reduce((a, b) => a + b, 0) / targetSamples.length
    : null;

  // Show worst lean event if one occurred, otherwise avg AFR under demand
  const displayAfr = worstLean ?? avgDemandAfr;

  let note = null;
  if (leanEvents > 0) note = `${leanEvents} lean event(s) at WOT — peak ${roundN(worstLean ?? 0, 2)}:1.`;
  else if (richEvents > 0) note = `${richEvents} rich event(s) at WOT.`;

  return {
    actual: displayAfr !== null ? roundN(displayAfr, 2) : null,
    target: avgTarget !== null ? roundN(avgTarget, 2) : null,
    lean_events: leanEvents,
    rich_events: richEvents,
    status,
    note,
  };
}

// ─── HPFP Analysis ───────────────────────────────────────────────────────────

function analyzeHpfp(rows, columns, boostUnit, engine) {
  const { risk: HPFP_RISK, caution: HPFP_CAUTION } = getHpfpDropThresholds(engine);
  const actualCol = columns.hpfp;
  const targetCol = columns.hpfp_target;
  const loadCol = columns.load;
  const boostCol = columns.boost;
  const pedalCol = columns.pedal;
  const throttleCol = columns.throttle;

  if (!actualCol) {
    return { actual: null, target: null, max_drop_pct: null, status: 'Safe', note: 'HPFP column not found in log.' };
  }

  const demandRows = rows.filter(r => {
    const load = num(r, loadCol);
    const boost = normalizeBoostToPsi(num(r, boostCol), boostUnit);
    const pedal = num(r, pedalCol);
    const throttle = num(r, throttleCol);
    return isDemand(load, boost, pedal, throttle);
  });

  const sourceRows = demandRows.length >= 5 ? demandRows : rows;

  const actuals = sourceRows.map(r => num(r, actualCol)).filter(v => !isNaN(v) && v > 0);
  if (actuals.length === 0) {
    return { actual: null, target: null, max_drop_pct: null, status: 'Safe', note: 'No valid HPFP readings during engine demand.' };
  }

  const avgActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  const peakActual = maxFinite(actuals);

  let avgTarget = null;
  if (targetCol) {
    const targets = sourceRows.map(r => num(r, targetCol)).filter(v => !isNaN(v) && v > 0);
    if (targets.length) avgTarget = targets.reduce((a, b) => a + b, 0) / targets.length;
  }

  let maxDropPct = 0;
  let worstCrash = null;

  if (targetCol) {
    const crashRows = rows.filter(r => {
      const load = num(r, loadCol);
      const boost = normalizeBoostToPsi(num(r, boostCol), boostUnit);
      const pedal = num(r, pedalCol);
      const throttle = num(r, throttleCol);
      const target = num(r, targetCol);
      const actual = num(r, actualCol);
      return isHpfpCrashWindow(load, boost, pedal, throttle) &&
        !isNaN(target) && target > 1200 &&
        !isNaN(actual) && actual > 0;
    });

    const sourceCrashRows = crashRows.length > 0 ? crashRows : rows;
    for (const row of sourceCrashRows) {
      const a = num(row, actualCol);
      const t = num(row, targetCol);
      if (isNaN(a) || isNaN(t) || t <= 1200 || a <= 0) continue;

      const dropPct = ((t - a) / t) * 100;
      if (dropPct > maxDropPct) {
        maxDropPct = dropPct;
        worstCrash = {
          actual: a,
          target: t,
          pedal: num(row, pedalCol),
          throttle: num(row, throttleCol),
        };
      }
    }
  } else {
    for (const a of actuals) {
      const dropPct = ((peakActual - a) / peakActual) * 100;
      if (dropPct > maxDropPct) maxDropPct = dropPct;
    }
  }

  let status = 'Safe';
  let note = null;
  const displayActual = worstCrash?.actual ?? avgActual;
  const displayTarget = worstCrash?.target ?? avgTarget ?? peakActual;

  // Absolute PSI floor checks (PDF Quick Rule Reference — universal for all engines):
  //   actual < 1,400 PSI sustained WOT = CRITICAL
  //   actual < 1,800 PSI sustained WOT = WARNING
  const minActual = actuals.length ? Math.min(...actuals.filter(v => v > 0)) : null;
  const absoluteCritical = minActual !== null && minActual < 1400;
  const absoluteWarning  = minActual !== null && minActual < 1800 && !absoluteCritical;

  if (maxDropPct >= HPFP_RISK || absoluteCritical) {
    status = 'Risk';
    const pedalText = !isNaN(worstCrash?.pedal) ? ` at ${roundN(worstCrash.pedal, 0)}% pedal` : '';
    note = worstCrash
      ? `HPFP crash${pedalText}: target ${roundN(worstCrash.target, 0)} psi, actual ${roundN(worstCrash.actual, 0)} psi (${roundN(maxDropPct, 1)}% drop).`
      : absoluteCritical
        ? `HPFP fell to ${roundN(minActual, 0)} psi — below 1,400 psi absolute critical threshold.`
        : `HPFP dropped ${roundN(maxDropPct, 1)}% below ${avgTarget ? 'target' : 'session peak'} during engine demand.`;
  } else if (maxDropPct >= HPFP_CAUTION || absoluteWarning) {
    status = 'Caution';
    const pedalText = !isNaN(worstCrash?.pedal) ? ` at ${roundN(worstCrash.pedal, 0)}% pedal` : '';
    note = worstCrash
      ? `HPFP dipped${pedalText}: target ${roundN(worstCrash.target, 0)} psi, actual ${roundN(worstCrash.actual, 0)} psi (${roundN(maxDropPct, 1)}% drop).`
      : absoluteWarning
        ? `HPFP dipped to ${roundN(minActual, 0)} psi — below 1,800 psi warning threshold. Monitor closely.`
        : `HPFP dipped ${roundN(maxDropPct, 1)}% under load — monitor closely.`;
  }

  return {
    actual: roundN(displayActual, 0),
    target: roundN(displayTarget, 0),
    max_drop_pct: roundN(maxDropPct, 1),
    worst_actual: worstCrash ? roundN(worstCrash.actual, 0) : null,
    worst_target: worstCrash ? roundN(worstCrash.target, 0) : null,
    worst_pedal: worstCrash && !isNaN(worstCrash.pedal) ? roundN(worstCrash.pedal, 0) : null,
    status,
    note,
  };
}

// ─── IAT unit detection ───────────────────────────────────────────────────────

/**
 * Read the IAT unit directly from the column header.
 * BM3/MHD export headers like "Intake Air Temp [°F]" or "IAT [°C]".
 * Returns 'F', 'C', or null when ambiguous (no unit marker in the name).
 */
function detectIatUnit(colName) {
  if (!colName) return null;
  const lower = colName.toLowerCase();
  if (lower.includes('°f') || lower.includes('[f]') || lower.includes('(f)') ||
      lower.includes('_f]') || lower.includes(' f]') || lower.includes('_fahrenheit')) return 'F';
  if (lower.includes('°c') || lower.includes('[c]') || lower.includes('(c)') ||
      lower.includes('_c]') || lower.includes(' c]') || lower.includes('_celsius')) return 'C';
  return null;
}

// ─── IAT Analysis ────────────────────────────────────────────────────────────

function analyzeIat(rows, columns, boostUnit) {
  const iatCol    = columns.iat;
  const loadCol   = columns.load;
  const boostCol  = columns.boost;
  const pedalCol  = columns.pedal;
  const throttleCol = columns.throttle;

  if (!iatCol) {
    return { value: null, unit: 'F', peak_f: null, status: 'Safe', note: 'IAT column not found in log.' };
  }

  const allValues = rows.map(r => num(r, iatCol)).filter(v => !isNaN(v));
  if (allValues.length === 0) {
    return { value: null, unit: 'F', peak_f: null, status: 'Safe', note: 'No valid IAT readings.' };
  }

  // Unit detection — column name is checked first (most reliable).
  // BM3/MHD embed the unit in the header, e.g. "Intake Air Temp [°F]".
  // Pure value-based guessing is used only when the name gives no clue:
  //   - any value > 100 → must be Fahrenheit (100°C = boiling water, impossible for IAT)
  //   - otherwise default Celsius (BMW ECU / MHD export metric by default)
  const colUnit = detectIatUnit(iatCol);
  let likelyCelsius;
  if (colUnit !== null) {
    likelyCelsius = (colUnit === 'C');
  } else {
    likelyCelsius = allValues.every(v => v <= 100);
  }
  const unit = likelyCelsius ? 'C' : 'F';
  const toF  = v => likelyCelsius ? v * 9 / 5 + 32 : v;

  // Filter to demand rows only — same pattern as HPFP.
  // Idle / heat-soak-at-rest readings are excluded so we report what the
  // engine actually sees during a pull, not a traffic-jam soak spike.
  const demandRows = rows.filter(r => {
    const load    = num(r, loadCol);
    const boost   = normalizeBoostToPsi(num(r, boostCol), boostUnit);
    const pedal   = num(r, pedalCol);
    const throttle = num(r, throttleCol);
    return isDemand(load, boost, pedal, throttle);
  });

  // Fall back to all rows if there are too few demand samples
  const sourceValues = demandRows.length >= 5
    ? demandRows.map(r => num(r, iatCol)).filter(v => !isNaN(v))
    : allValues;

  if (sourceValues.length === 0) {
    return { value: null, unit, peak_f: null, status: 'Safe', note: 'No valid IAT readings during engine demand.' };
  }

  const maxRaw = maxFinite(sourceValues);
  const peakF  = roundN(toF(maxRaw), 1);
  const context = demandRows.length >= 5 ? 'under load' : 'session peak';

  let status = 'Safe';
  let note   = null;

  if (peakF >= IAT_RISK_F) {
    status = 'Risk';
    note   = `Peak IAT of ${Math.round(peakF)}°F ${context} exceeds safe operating threshold.`;
  } else if (peakF >= IAT_CAUTION_F) {
    status = 'Caution';
    note   = `Peak IAT of ${Math.round(peakF)}°F ${context} is elevated — consider heat soak risk.`;
  }

  return {
    value:  roundN(maxRaw, 1),
    unit,
    peak_f: peakF,
    status,
    note,
  };
}

// ─── Timing Correction Analysis ──────────────────────────────────────────────

function analyzeTimingCorrections(rows, timingColumns, columns, boostUnit) {
  if (timingColumns.length === 0) {
    return {
      max_correction: null,
      cylinders: 'No timing correction columns found.',
      pull_events: 0,
      status: 'Safe',
      note: null,
    };
  }

  const loadCol = columns.load;
  const boostCol = columns.boost;
  const pedalCol = columns.pedal;
  const throttleCol = columns.throttle;

  let worstDeg = 0;
  let worstCyl = null;
  let pullEvents = 0;
  let multiCylEvents = 0; // rows where 3+ cylinders simultaneously exceed TIMING_MULTICYL_RISK_DEG

  for (const row of rows) {
    const load = num(row, loadCol);
    const boost = normalizeBoostToPsi(num(row, boostCol), boostUnit);
    const pedal = num(row, pedalCol);
    const throttle = num(row, throttleCol);

    const l = isNaN(load) ? 0 : load;
    const b = isNaN(boost) ? 0 : boost;
    const p = isNaN(pedal) ? NaN : pedal;
    const t = isNaN(throttle) ? NaN : throttle;

    if (!isNaN(p) && p < 1 && (!isNaN(t) ? t < 5 : true)) continue;
    if (l < LOAD_TIMING && b <= BOOST_DEMAND) continue;

    let rowMultiCylCount = 0;
    for (const col of timingColumns) {
      const val = num(row, col);
      if (isNaN(val)) continue;
      if (val < worstDeg) {
        worstDeg = val;
        worstCyl = col;
      }
      if (val <= TIMING_CAUTION_DEG) pullEvents++;
      if (val <= TIMING_MULTICYL_RISK_DEG) rowMultiCylCount++;
    }
    if (rowMultiCylCount >= TIMING_MULTICYL_MIN_CYLS) multiCylEvents++;
  }

  // Multi-cylinder simultaneous pull overrides single-cyl status (fuel quality issue)
  let status = 'Safe';
  if (worstDeg <= TIMING_RISK_DEG || multiCylEvents > 2) status = 'Risk';
  else if (worstDeg <= TIMING_CAUTION_DEG || multiCylEvents > 0) status = 'Caution';

  const cylLabel = worstCyl
    ? `${roundN(worstDeg, 1)}° on ${worstCyl}`
    : 'No corrections observed under load';

  const multiCylNote = multiCylEvents > 2
    ? `${multiCylEvents} rows with 3+ cylinders simultaneously pulling ≥${Math.abs(TIMING_MULTICYL_RISK_DEG)}° — fuel quality or octane issue suspected.`
    : null;

  return {
    max_correction: roundN(worstDeg, 2),
    cylinders: cylLabel,
    pull_events: pullEvents,
    multi_cyl_events: multiCylEvents,
    status,
    note: status !== 'Safe'
      ? (multiCylNote ?? `Worst timing pull under load: ${cylLabel}.`)
      : null,
  };
}

// ─── Chart Data ──────────────────────────────────────────────────────────────

function buildChartData(rows, columns, isLambdaAfr, boostUnit, maxPoints = 150, thresholds, timingColumns = []) {
  const {
    time: timeCol,
    rpm: rpmCol,
    afr: afrCol,
    afr_target: targetCol,
    boost: boostCol,
    load: loadCol,
    pedal: pedalCol,
    throttle: throttleCol,
    hpfp: hpfpCol,
    hpfp_target: hpfpTargetCol,
  } = columns;
  const toAfr = v => isLambdaAfr ? lambdaToAfr(v) : v;
  const { lean_caution } = thresholds;

  // Pre-compute HPFP session peak for fallback when no target column exists
  let hpfpPeak = null;
  if (hpfpCol && !hpfpTargetCol) {
    const actuals = rows.map(r => num(r, hpfpCol)).filter(v => !isNaN(v) && v > 0);
    if (actuals.length) hpfpPeak = maxFinite(actuals);
  }

  // Find the single worst HPFP drop row — only that one point gets flagged on the chart
  let worstHpfpRowIdx = -1;
  if (hpfpCol) {
    let worstDrop = 0;
    for (let j = 0; j < rows.length; j++) {
      const a = num(rows[j], hpfpCol);
      if (isNaN(a) || a <= 0) continue;
      let dropPct = 0;
      if (hpfpTargetCol) {
        const load = num(rows[j], loadCol);
        const pedal = num(rows[j], pedalCol);
        const throttle = num(rows[j], throttleCol);
        const bPsi = normalizeBoostToPsi(num(rows[j], boostCol), boostUnit);
        const t = num(rows[j], hpfpTargetCol);
        if (!isNaN(t) && t > 1200 && isHpfpCrashWindow(load, bPsi, pedal, throttle)) dropPct = ((t - a) / t) * 100;
      } else if (hpfpPeak !== null) {
        dropPct = ((hpfpPeak - a) / hpfpPeak) * 100;
      }
      if (dropPct > worstDrop) { worstDrop = dropPct; worstHpfpRowIdx = j; }
    }
    // Only mark if it actually crossed the risk threshold (use generic 18% as chart cutoff)
    if (worstDrop < 18) worstHpfpRowIdx = -1;
  }

  const step = Math.max(1, Math.floor(rows.length / maxPoints));
  const chartData = [];

  for (let i = 0; i < rows.length; i += step) {
    const row = rows[i];
    const rawAfr = num(row, afrCol);
    const rawTarget = num(row, targetCol);
    const rawBoost = num(row, boostCol);
    const rawTime = num(row, timeCol);
    const rawRpm = num(row, rpmCol);

    const boostPsi = normalizeBoostToPsi(rawBoost, boostUnit);

    const afrParsed = !isNaN(rawAfr) ? toAfr(rawAfr) : NaN;
    const afrDisplay = (!isNaN(afrParsed) && afrParsed < FUEL_CUT_AFR)
      ? roundN(afrParsed, 2)
      : undefined;

    let isLeanWarning = false;
    // Only the downsampled chunk that contains the single worst HPFP row gets flagged
    const isHpfpWarning = worstHpfpRowIdx >= i && worstHpfpRowIdx < i + step;
    let isTimingWarning = false;

    // Scan all rows in this downsample chunk so we don't skip critical warnings
    for (let j = i; j < i + step && j < rows.length; j++) {
      const r = rows[j];
      const l = num(r, loadCol);
      const p = num(r, pedalCol);
      const th = num(r, throttleCol);
      const bPsi = normalizeBoostToPsi(num(r, boostCol), boostUnit);

      if (!isLeanWarning) {
        const a = toAfr(num(r, afrCol));
        if (isWot(l, bPsi, p, th) && a > lean_caution) isLeanWarning = true;
      }

      // HPFP: handled outside the inner loop — only the worst row's chunk is flagged

      if (!isTimingWarning && timingColumns.length > 0) {
        const pl = isNaN(p) ? NaN : p;
        const pth = isNaN(th) ? NaN : th;
        if ((isNaN(pl) || pl >= 1 || (isNaN(pth) || pth >= 5)) && (l >= LOAD_TIMING || bPsi > BOOST_DEMAND)) {
          for (const col of timingColumns) {
            const pull = num(r, col);
            if (!isNaN(pull) && pull <= -3) isTimingWarning = true;
          }
        }
      }
    }

    const rawHpfpActual = num(row, hpfpCol);
    const rawHpfpTarget = num(row, hpfpTargetCol);

    chartData.push({
      time: !isNaN(rawTime) ? roundN(rawTime, 2) : String(i),
      rpm: !isNaN(rawRpm) ? Math.round(rawRpm) : undefined,
      afrActual: afrDisplay,
      afrTarget: !isNaN(rawTarget) ? roundN(toAfr(rawTarget), 2) : undefined,
      boost: !isNaN(boostPsi) ? roundN(boostPsi, 1) : undefined,
      hpfpActual: (!isNaN(rawHpfpActual) && rawHpfpActual > 0) ? roundN(rawHpfpActual, 0) : undefined,
      hpfpTarget: (!isNaN(rawHpfpTarget) && rawHpfpTarget > 0) ? roundN(rawHpfpTarget, 0) : undefined,
      isLeanWarning,
      isHpfpWarning,
      isTimingWarning
    });
  }

  return chartData;
}

// ─── Key Points ──────────────────────────────────────────────────────────────

function buildKeyPoints(afr, hpfp, iat, timing, carDetails) {
  const points = [];
  const ethanol = Number(carDetails.ethanol) || 10;
  const engine = carDetails.engine || 'B58';
  const thresholds = getAfrThresholds(ethanol);

  // AFR context
  if (afr.actual !== null) {
    const verdictText =
      afr.status === 'Safe' ? 'well within safe range.'
        : afr.status === 'Caution' ? 'slightly lean — monitor for lean events and consider a tune revision.'
          : 'dangerously lean — stop high-load driving and review the tune immediately.';
    points.push(
      `For E${ethanol} fuel, stoichiometric AFR is ~${thresholds.stoich}:1. ` +
      `WOT average in this log: ${afr.actual}:1 — ${verdictText}`
    );
  } else if (afr.note?.includes('not found')) {
    points.push('No AFR column detected — verify your export includes lambda or AFR data.');
  }

  // HPFP context
  if (hpfp.actual !== null) {
    const isHighEthanol = ethanol >= 30;
    const isB58 = engine.includes('B58');
    const isN20 = engine.includes('N20') || engine.includes('N26');
    const isB48 = engine.includes('B48');
    if (hpfp.status !== 'Safe') {
      let fuelNote;
      if (isN20) {
        fuelNote = `On the N20/N26 this is a critical warning — HPFP pressure drops are a primary symptom of cam follower failure. Do not continue high-load driving. Inspect the HPFP cam follower immediately; failure to address this leads to catastrophic engine damage.`;
      } else if (isB58 && isHighEthanol) {
        fuelNote = `On a Gen 1 B58 running E${ethanol}, this is a classic HPFP crash signature. The stock 3-lobe pump cannot sustain the higher fuel flow ethanol demands — upgrade to the B58TU 4-lobe HPFP assembly. Also verify LPFP voltage stays above 13V under load.`;
      } else if (isB48) {
        fuelNote = `Check charge pipe integrity and LPFP health. B48 fuel system is generally robust — also verify the in-tank filter is clean and LPFP voltage holds above 13V under load.`;
      } else if (isHighEthanol) {
        fuelNote = `High-ethanol blends demand significantly higher fuel flow — ensure your LPFP (low-side pump) is upgraded for E${ethanol} and the in-tank filter is clean.`;
      } else {
        fuelNote = `Check LPFP health, fuel filter condition, and HPFP cam lobe wear.`;
      }
      const crashContext = hpfp.worst_actual !== null && hpfp.worst_target !== null
        ? `Worst event: ${hpfp.worst_actual} psi actual vs ${hpfp.worst_target} psi target. `
        : '';
      points.push(
        `${crashContext}HPFP dropped ${hpfp.max_drop_pct}% vs target under load. ${fuelNote}`
      );
    } else if (isN20) {
      points.push(
        `HPFP holding at ${hpfp.actual} psi — acceptable for now. ` +
        `N20/N26 cam follower wear can appear suddenly; inspect the follower if mileage exceeds 50k or any pressure instability appears in future logs.`
      );
    } else if (isHighEthanol && isB58) {
      points.push(
        `HPFP holding at ${hpfp.actual} psi under load on E${ethanol}. ` +
        `Gen 1 B58 margin narrows quickly above E30 — if increasing blend further, upgrade to the B58TU HPFP and confirm LPFP flow capacity.`
      );
    } else if (isHighEthanol) {
      points.push(
        `HPFP at ${hpfp.actual} psi under load — acceptable for E${ethanol}. ` +
        `If you increase ethanol further, confirm your LPFP can support the higher flow demand.`
      );
    }
  }

  // Timing context
  if (timing.max_correction !== null && timing.max_correction < TIMING_CAUTION_DEG) {
    const isHighEthanol = ethanol >= 30;
    const isB58 = engine.includes('B58');
    const isS55 = engine.includes('S55');
    const isN20 = engine.includes('N20') || engine.includes('N26');
    let pullNote;
    if (isN20) {
      pullNote = `On the N20/N26, timing pull under load is often caused by a deteriorating cam follower reducing HPFP supply, leading to a lean condition and detonation. Check HPFP data in this log and inspect the follower immediately if any pressure drop is present.`;
    } else if (isS55) {
      pullNote = `The S55 has good knock resistance on quality fuel — timing retard here may indicate a heat soak issue (check IAT), a misfire on a worn coil pack, or insufficient octane margin on pump gas. On ethanol, rule out HPFP supply first.`;
    } else if (isHighEthanol && isB58) {
      pullNote = `On E${ethanol} the B58 should have excellent knock resistance — timing retard here often means the HPFP is crashing and the mixture is going lean under load. Check HPFP health first. Also verify ignition plugs are one heat range colder (e.g. NGK 97506 / BKR7EIX) as ethanol tunes increase cylinder temps.`;
    } else if (isHighEthanol) {
      pullNote = `On E${ethanol}, knock retard is unexpected — check for HPFP supply issues, heat soak, misfires, or a faulty knock sensor.`;
    } else {
      pullNote = `On E${ethanol}, consider raising ethanol content or adding water-methanol injection to reduce knock sensitivity.`;
    }
    points.push(`Timing correction of ${timing.max_correction}° under load. ${pullNote}`);
  }

  // IAT context
  if (iat.value !== null && iat.status !== 'Safe') {
    const intercoolerNote =
      engine.includes('S58') ? 'The S58 uses a water-to-air charge cooler in the intake manifold — verify the charge-cooler pump is running and the coolant reservoir is full. An upgraded heat exchanger will also help.' :
      engine.includes('S55') ? 'The S55 runs hot under sustained load — verify water pump operation (a common S55 failure) and consider an upgraded charge-cooler heat exchanger.' :
      engine.includes('N63') || engine.includes('S63') ? 'The N63/S63 has an in-valley intercooler — verify the charge-cooler pump is working. IAT spikes on this engine often indicate charge-cooler pump failure rather than ambient heat soak.' :
      engine.includes('N55') || engine.includes('N54') ? 'N-series engines benefit from a front-mount intercooler (FMIC) at sustained high IAT — a top-mount replacement is a worthwhile first upgrade.' :
      engine.includes('B58') || engine.includes('B48') ? 'The B58/B48 top-mount intercooler heat-soaks quickly — an upgraded TMIC or FMIC will significantly reduce charge temps on back-to-back pulls.' :
      engine.includes('N20') || engine.includes('N26') ? 'The N20/N26 benefits from an FMIC on aggressive maps — stock top-mount saturates quickly on repeated pulls.' :
      'A front-mount intercooler (FMIC) or upgraded top-mount will significantly reduce charge temps.';
    points.push(`Peak IAT of ${iat.peak_f}°F indicates heat soak. ${intercoolerNote}`);
  }

  return points;
}

// ─── Diagnostic Workflow Cards ───────────────────────────────────────────────

function formatTimeLabel(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  return `${roundN(v, 1)}s`;
}

/**
 * Spark plug recommendation based on engine + ethanol content.
 * Data sourced from BMW Datalog Diagnostic Reference PDF.
 */
function getSparkPlugNote(engine, ethanol) {
  const e = (engine || '').toUpperCase();
  const eth = Number(ethanol) || 10;
  // N54 has different heat ranges than N55 — important not to cross-apply
  if (e.includes('N54')) {
    if (eth >= 30) return 'Spark plugs: NGK 97506 at 0.020" gap for E30+ (N54 — do NOT use N55 plug specs for this engine).';
    return 'Spark plugs: NGK 97506 at 0.022" gap for Stage 2+ pump gas (N54 — one range colder than OEM).';
  }
  if (e.includes('N55')) {
    if (eth >= 60) return 'Spark plugs: NGK 97506 (or one step colder) at 0.018" gap for E60+ (N55 — ships with colder stock plugs than N54).';
    if (eth >= 30) return 'Spark plugs: NGK 97506 at 0.020" gap for E30–E50 on N55.';
    return 'Spark plugs: NGK 97506 at 0.022–0.024" gap for Stage 1–2 pump gas (N55).';
  }
  if (e.includes('N20') || e.includes('N26')) {
    if (eth >= 30) return 'Spark plugs: NGK 97506 at 0.020" gap for E30–E50 on N20/N26.';
    return 'Spark plugs: NGK 97506 at 0.024" gap for Stage 1 pump gas (N20/N26).';
  }
  if (e.includes('S55')) {
    return 'Spark plugs: NGK 97506 at 0.018–0.020" gap for all fuel blends on S55 (ARM Motorsports E85 validated).';
  }
  if (e.includes('S58')) {
    if (eth >= 60) return 'Spark plugs: NGK 97506 or one step colder at 0.018" gap for E60–E85 on S58.';
    if (eth >= 30) return 'Spark plugs: NGK 97506 at 0.020" gap for E30–E50 on S58.';
    return 'Spark plugs: NGK 97506 at 0.020–0.022" gap for pump gas on S58.';
  }
  if (e.includes('B48')) {
    if (eth >= 60) return 'Spark plugs: one step colder than NGK 97506 at 0.018" gap for E60+ on B48.';
    if (eth >= 30) return 'Spark plugs: NGK 97506 at 0.020" gap for E30+ on B48.';
    return 'Spark plugs: OEM or NGK 97506 at 0.024" gap for pump gas on B48.';
  }
  // B58 Gen1 / B58TU
  if (eth >= 60) return 'Spark plugs: NGK 96206 (2-step colder) at 0.018–0.020" gap for E60–E85 / >500 WHP on B58.';
  if (eth >= 30) return 'Spark plugs: NGK 97506 (1-step colder) at 0.020–0.022" gap for E30–E50 on B58 — required for ethanol tunes.';
  return 'Spark plugs: NGK 94201 (OEM Gen1) or NGK 97506 at 0.024–0.026" gap for Stage 1–2 on 93 octane.';
}

function getEngineSpecificChecks(engine, ethanol) {
  const e = (engine || '').toUpperCase();
  const plugNote = getSparkPlugNote(engine, ethanol);
  if (e.includes('S58')) return [
    'Run repeated 3rd–4th gear pulls to confirm charge-cooling consistency — S58 charge cooler electric pump is the primary IAT failure mode.',
    'Verify charge-cooler pump function: successive pull start IAT rising >15°F cumulatively = pump failure.',
    'Check ignition coil health — S58 coils are a known wear item under sustained high load.',
    plugNote,
  ];
  if (e.includes('S55')) return [
    'Check rod bearing condition — S55 rod bearings are a known wear item. Log oil pressure if possible: should be ≥65 PSI at high RPM under load. Risk zone: 60k–100k miles with infrequent oil changes or track use.',
    'Verify water pump function — S55 water pump failures cause rapid IAT spikes and coolant loss; a very common S55 failure.',
    'S55 stock HPFP is adequate to ~E50 at 500 WHP. E85 at 550+ WHP begins showing pressure variance — LPFP upgrade minimum. Injector IDC limit: ~500–550 WHP pump gas, ~400 WHP E85 on stock injectors.',
    'S55 runs higher oil pressure targets than N55 (BMW acknowledged this in DME calibration). Same variable-rate pump solenoid risk applies — consider solenoid modification at high mileage.',
    plugNote,
  ];
  if (e.includes('N54')) return [
    'Check for QCV/solenoid failure: look for ±100–200 PSI oscillation in rail pressure at idle (normal = flat ~750 PSI). Erratic WOT drops with partial recovery = QCV. DTCs: 2FBF, 2FBE, 29DC, 29F3.',
    'Check injector index codes — mismatched injector codes cause rail pressure instability on N54. Verify DME adaptation values match installed injectors.',
    'Inspect for wastegate rattle: boost overshoot >2 PSI at tip-in with erratic WGDC on decel. Does not show in fuel pressure data.',
    'Pressure-test charge pipes and vacuum lines for boost leaks.',
    'HPFP: most failure-prone N-series engine — original Bosch pump (part ending 881) at 60k–140k miles is danger zone. Continental replacement (ending 943) is more reliable. N54 stock injector IDC limit: ~500–540 WHP pump gas, ~380–400 WHP E85.',
    plugNote + ' NOTE: N54 stock plugs are one heat range HOTTER than N55 — do not cross-apply plug advice between these engines.',
  ];
  if (e.includes('N55')) return [
    'N55 rod bearing risk — variable-rate oil pump solenoid can briefly starve bearings at WOT tip-in. Log oil pressure if available: <50 PSI at >4,500 RPM = WARN, <40 PSI = CRITICAL. Risk zone: 70k–120k miles with extended oil change intervals.',
    'Preventive action: unplugging or blocking the oil pressure control solenoid forces maximum oil pressure continuously — a common N55 rod bearing protection mod.',
    'Ethanol threshold: E30 is practical ceiling on stock HPFP with modified turbo. E40+ without pump upgrade causes rail drops <1,400 PSI. Tip-in pressure spikes up to 300 PSI swing are normal; >500 PSI swing = LPFP marginal.',
    'Pressure-test charge pipes and vacuum lines for boost leaks.',
    plugNote + ' NOTE: N55 ships with COLDER stock plugs than N54 — do not cross-apply plug advice between these engines.',
  ];
  if (e.includes('N20') || e.includes('N26')) return [
    'URGENT — inspect the HPFP cam follower immediately. N20/N26 followers wear catastrophically between 30k–60k miles (some as early as 20k). Any HPFP pressure drop may indicate active failure.',
    'Do not continue high-load driving until the cam follower has been physically inspected — failure leads to catastrophic engine damage.',
    'If follower wear is confirmed, replace follower and inspect the HPFP cam lobe — BMW updated the part number to address this failure mode. B58TU HPFP retrofit is a proven fix (plug-and-play, no tune needed).',
    'Check N20 timing chain stretch — a secondary known failure on higher-mileage units.',
    plugNote,
  ];
  if (e.includes('B48')) return [
    'Pressure-test charge pipes — OEM plastic B48 charge pipe is a primary failure point, typically at 60k–90k miles under tune or on first hard pull after a flash. Upgrade to aluminium/silicone unit.',
    'B48 charge pipe failure signature: boost drops 3–8 PSI below target suddenly mid-pull, WGDC spikes to max, boost deficit persists on next pull.',
    'Check LPFP voltage under full load — should hold above 13V. E40+ on stock B48 HPFP starts showing rail drops.',
    'Check wastegate actuator function — B48 wastegate rattle is a known issue that can cause boost irregularity.',
    plugNote,
  ];
  if (e.includes('B58')) return [
    'Confirm you have the B58TU (Technical Update / HDP6) HPFP assembly — Gen 1 B58 HDP5 Evo capacity limit is ~350 WHP on E30+ (smooth linear pressure decline, not erratic spike). B58TU HDP6 is rated to 5,000+ PSI and supports E50 to ~420 WHP on stock tune.',
    'Note: B58TU normal tip-in pressure is 3,200 PSI tapering to 2,900 PSI — this is intentional DME behavior, not a fault.',
    'LPFP check: duty cycle >95–100% with pressure <60 PSI WOT = LPFP saturation — upgrade required for E40+. E60+ triggers LPFP upgrade even on B58TU.',
    'Inspect and replace the in-tank fuel filter if not recently serviced — restriction directly reduces HPFP supply.',
    'Injector duty cycle (MSV Duration): if maxed AND rail pressure is still dropping, both LPFP and injectors are saturated — stock HDEV 5.2 injectors hit IDC limit at ~380–400 WHP E85.',
    plugNote,
  ];
  if (e.includes('N63') || e.includes('S63')) return [
    'Check oil consumption — N63/S63 engines are known for elevated oil use; low oil level affects rod bearing and turbo lubrication.',
    'Inspect valve stem seals — oil burning at cold startup is a warning sign; N63 Customer Care Package covers some of these failures.',
    'Verify timing chain guide condition if mileage is above 80k — N63 timing chain guides are a known wear item.',
    'Confirm charge-cooler (in-valley intercooler) pump is functioning — N63/S63 IAT spikes are often charge-cooler pump failures, not ambient heat soak.',
  ];
  return ['Re-run a clean WOT pull in one gear and compare timing/HPFP trend repeatability.'];
}

function getTuneChecks(tuneStage, ethanol) {
  const stage = (tuneStage || '').toLowerCase();
  const e = Number(ethanol) || 10;
  const checks = [];

  if (stage.includes('custom')) checks.push('Ask your tuner to review this exact time window and smooth load-to-torque transition.');
  if (stage.includes('stage 2')) checks.push('Confirm hardware assumptions for Stage 2 (downpipe/intercooling/fueling) match the map.');
  if (e >= 40) {
    checks.push(`Validate low-side fuel delivery on E${e} at high duty (LPFP voltage, bucket fill, and filter condition).`);
    checks.push(`Confirm flex-fuel sensor reading matches actual blend — sensor drift on high ethanol is common.`);
  } else if (e >= 30) {
    checks.push(`E${e} is near the Gen 1 B58 HPFP limit — monitor drop percentage closely and consider B58TU pump upgrade before increasing blend.`);
  } else {
    checks.push(`If knock persists on E${e}, test one step higher ethanol blend and recheck timing response.`);
  }

  return checks;
}

function buildDiagnosticCards(rows, columns, timingColumns, boostUnit, metrics, carDetails) {
  const cards = [];
  const timeCol = columns.time;
  const loadCol = columns.load;
  const boostCol = columns.boost;
  const pedalCol = columns.pedal;
  const throttleCol = columns.throttle;
  const hpfpCol = columns.hpfp;
  const hpfpTargetCol = columns.hpfp_target;
  const iatCol = columns.iat;

  const engineChecks = getEngineSpecificChecks(carDetails.engine, carDetails.ethanol);
  const tuneChecks = getTuneChecks(carDetails.tuneStage, carDetails.ethanol);

  // HPFP drop start detection
  if (hpfpCol && hpfpTargetCol && metrics?.hpfp?.max_drop_pct >= HPFP_DROP_CAUTION_PCT) {
    let startRow = null;
    for (const row of rows) {
      const load = num(row, loadCol);
      const boost = normalizeBoostToPsi(num(row, boostCol), boostUnit);
      const pedal = num(row, pedalCol);
      const throttle = num(row, throttleCol);
      if (!isHpfpCrashWindow(load, boost, pedal, throttle)) continue;

      const target = num(row, hpfpTargetCol);
      const actual = num(row, hpfpCol);
      if (isNaN(target) || target <= 1200 || isNaN(actual) || actual <= 0) continue;

      const dropPct = ((target - actual) / target) * 100;
      if (dropPct >= HPFP_DROP_CAUTION_PCT) {
        startRow = { row, dropPct, target, actual };
        break;
      }
    }

    if (startRow) {
      const t = formatTimeLabel(num(startRow.row, timeCol));
      const eng = (carDetails.engine || '').toUpperCase();
      const isN20 = eng.includes('N20') || eng.includes('N26');
      const isB58Gen1 = eng.includes('B58') && eng.includes('GEN1');
      const isN54orN55 = eng.includes('N54') || eng.includes('N55');
      const hpfpCauses = isN20 ? [
        'HPFP cam follower failure — this is the primary N20/N26 failure mode. The follower that drives the HPFP wears through, starving the pump. Immediate inspection required.',
        'Do not confuse with tune or fuel blend issues — on N20/N26 this is a mechanical problem first.',
        'Ethanol content exceeding tune calibration (secondary consideration after follower is ruled out).',
      ] : isB58Gen1 ? [
        'Gen 1 B58 HPFP (3-lobe cam) is undersized for E30+ blends — upgrade to B58TU HPFP assembly strongly recommended.',
        'Low-side fuel supply (LPFP) saturated — stock in-tank pump commonly maxes out on E30+ without an upgraded unit.',
        'In-tank fuel filter restriction reducing HPFP supply pressure.',
        'HPFP cam lobe wear — Gen 1 B58 3-lobe design wears faster under sustained high ethanol duty.',
        'Ethanol content exceeding tune calibration (flex-fuel sensor drift or higher blend than map expects).',
      ] : isN54orN55 ? [
        'HPFP cam follower wear — N54/N55 followers are a documented failure point; inspect before replacing the pump.',
        'Low-side fuel supply (LPFP) saturated under high load.',
        'In-tank fuel filter restriction reducing HPFP supply pressure.',
        'HPFP solenoid valve wear — common on high-mileage N54 units.',
      ] : [
        'Low-side fuel supply (LPFP) saturated — pump may be undersized for current power level or ethanol blend.',
        'In-tank fuel filter restriction reducing HPFP supply pressure.',
        'HPFP mechanical wear or cam lobe condition.',
        'Ethanol content exceeding tune calibration (flex-fuel sensor drift or higher blend than map expects).',
      ];
      cards.push({
        id: 'hpfp-drop-start',
        severity: metrics.hpfp.status,
        title: `HPFP drop starts${t ? ` at ${t}` : ''}`,
        evidence: `Rail pressure fell to ${roundN(startRow.actual, 0)} psi vs ${roundN(startRow.target, 0)} psi target (${roundN(startRow.dropPct, 1)}% drop) in a high-load window.`,
        likelyCauses: hpfpCauses,
        recommendedChecks: [...engineChecks, ...tuneChecks],
      });
    }
  }

  // N20/N26 cam follower — detect high HPFP variance during WOT (RPM-synchronous oscillation proxy)
  if (hpfpCol && hpfpTargetCol) {
    const eng = (carDetails.engine || '').toUpperCase();
    if (eng.includes('N20') || eng.includes('N26')) {
      const wotActuals = [];
      for (const row of rows) {
        const load = num(row, loadCol);
        const boost = normalizeBoostToPsi(num(row, boostCol), boostUnit);
        const pedal = num(row, pedalCol);
        const throttle = num(row, throttleCol);
        if (!isHpfpCrashWindow(load, boost, pedal, throttle)) continue;
        const a = num(row, hpfpCol);
        if (!isNaN(a) && a > 0) wotActuals.push(a);
      }
      if (wotActuals.length >= 10) {
        const mean = wotActuals.reduce((s, v) => s + v, 0) / wotActuals.length;
        const stddev = Math.sqrt(wotActuals.reduce((s, v) => s + (v - mean) ** 2, 0) / wotActuals.length);
        if (stddev > 180) {
          cards.push({
            id: 'n20-cam-follower',
            severity: stddev > 280 ? 'Risk' : 'Caution',
            title: 'N20/N26 HPFP oscillation — possible cam follower wear',
            evidence: `Rail pressure standard deviation of ${Math.round(stddev)} PSI during WOT exceeds normal variance (>180 PSI). N20/N26 cam follower wear produces RPM-synchronous pressure oscillation as each cam lobe pass delivers progressively less volume.`,
            likelyCauses: [
              'HPFP cam follower wear — the primary N20/N26 failure mode. The follower wears through between 30k–60k miles (some as early as 20k).',
              'Early wear: minor RPM-correlated oscillation. Progressive wear: gap widens with RPM. Advanced: pressure tracks LPFP levels (pump effectively bypassed).',
              'Risk factors: frequent cold starts, infrequent oil changes, extended idle periods.',
            ],
            recommendedChecks: [
              'URGENT: physically inspect the HPFP cam follower before any further high-load driving.',
              'If follower wear is confirmed, replace follower and inspect the HPFP cam lobe — BMW updated part numbers to address this failure mode.',
              'B58TU HPFP retrofit is a validated plug-and-play fix (no tune change needed) that extends capacity to ~440 WHP.',
              ...tuneChecks,
            ],
          });
        }
      }
    }
  }

  // Multi-cylinder simultaneous timing pull — fuel quality / octane issue
  if (metrics?.timingCorrections?.multi_cyl_events > 2) {
    cards.push({
      id: 'timing-multi-cyl',
      severity: 'Risk',
      title: 'Multi-cylinder simultaneous timing pull',
      evidence: `${metrics.timingCorrections.multi_cyl_events} rows detected with 3+ cylinders simultaneously pulling ≥${Math.abs(TIMING_MULTICYL_RISK_DEG)}°. Uniform corrections across multiple cylinders indicate a broad fuel quality or octane issue rather than a single-cylinder fault.`,
      likelyCauses: [
        'Fuel quality issue — octane rating lower than tune expects (e.g. 91 oct fuel on a 93 oct or ethanol tune).',
        'Ethanol blend lower than configured — flex-fuel sensor drift or diluted blend (especially E85 winter blends can drop to E60).',
        'Heat soak causing broad knock across all cylinders — check IAT data.',
        'Faulty knock sensor sending uniform retard (less common — single-cylinder corrections would be expected first).',
      ],
      recommendedChecks: [
        'Verify fuel octane — check your receipt or re-fill at a fresh station before the next pull.',
        'If on ethanol, verify actual blend at the sensor and compare to your tune\'s configured E%.',
        'Check IAT data in this log — >120°F IAT at WOT can reduce effective octane margin by several points.',
        ...engineChecks,
      ],
    });
  }

  // Timing pull after IAT spike detection
  if (iatCol && timingColumns.length > 0 && metrics?.timingCorrections?.status !== 'Safe') {
    let firstIatSpikeTime = null;
    let firstPullTime = null;
    let worstPull = 0;

    for (const row of rows) {
      const load = num(row, loadCol);
      const boost = normalizeBoostToPsi(num(row, boostCol), boostUnit);
      const pedal = num(row, pedalCol);
      const throttle = num(row, throttleCol);
      const t = num(row, timeCol);

      if (!isDemand(load, boost, pedal, throttle)) continue;

      const iatRaw = num(row, iatCol);
      const iatF = iatRaw > 100 ? iatRaw : (iatRaw * 9 / 5 + 32);
      if (firstIatSpikeTime === null && !isNaN(iatF) && iatF >= IAT_CAUTION_F) firstIatSpikeTime = t;

      let rowWorst = 0;
      for (const col of timingColumns) {
        const v = num(row, col);
        if (!isNaN(v) && v < rowWorst) rowWorst = v;
      }
      if (rowWorst <= TIMING_CAUTION_DEG) {
        if (firstPullTime === null) firstPullTime = t;
        if (rowWorst < worstPull) worstPull = rowWorst;
      }
    }

    if (firstIatSpikeTime !== null && firstPullTime !== null && firstPullTime >= firstIatSpikeTime) {
      cards.push({
        id: 'timing-after-iat',
        severity: metrics.timingCorrections.status,
        title: 'Timing pull appears after IAT spike',
        evidence: `IAT crossed ${IAT_CAUTION_F}°F around ${formatTimeLabel(firstIatSpikeTime)} and timing pull reached ${roundN(worstPull, 1)}° by ${formatTimeLabel(firstPullTime)}.`,
        likelyCauses: ['Charge-air heat soak reducing knock resistance.', 'Knock sensitivity from octane margin or ignition system weakness under heat.'],
        recommendedChecks: [
          'Log back-to-back pulls after full cooldown to isolate heat-related timing behavior.',
          ...getEngineSpecificChecks(carDetails.engine, carDetails.ethanol),
          ...getTuneChecks(carDetails.tuneStage, carDetails.ethanol),
        ],
      });
    }
  }

  return cards;
}

// ─── Main Entry ──────────────────────────────────────────────────────────────

/**
 * @param {string} csvText     — file contents as a plain string (from FileReader)
 * @param {string} filename
 * @param {object} carDetails  — { ethanol, engine, tuneStage } from the UI form
 * @returns {object} Structured analysis result
 */
export function analyzeLog(csvText, filename, carDetails = {}) {
  const { rows, columns, timingColumns, boostUnit, logFormat } = parseCsv(csvText);
  return analyzeParsedLog({ rows, columns, timingColumns, boostUnit, logFormat }, filename, carDetails);
}

export function analyzeParsedLog(parsed, filename, carDetails = {}) {
  const { rows, columns, timingColumns, boostUnit, logFormat } = parsed;

  const sampleAfrs = rows
    .slice(0, 30)
    .map(r => num(r, columns.afr))
    .filter(v => !isNaN(v));
  const isLambdaAfr = sampleAfrs.length > 0 && sampleAfrs.every(v => v < 3.0);

  const thresholds = getAfrThresholds(carDetails.ethanol);

  const afr = analyzeAfr(rows, columns, isLambdaAfr, thresholds, boostUnit);
  const hpfp = analyzeHpfp(rows, columns, boostUnit, carDetails.engine);
  const iat = analyzeIat(rows, columns, boostUnit);
  const timing = analyzeTimingCorrections(rows, timingColumns, columns, boostUnit);
  const fuelTrims = analyzeFuelTrims(rows, columns);
  const knockScatter = buildKnockScatterData(rows, columns, timingColumns, boostUnit);
  const overall = worstStatus(afr.status, hpfp.status, iat.status, timing.status);

  const keyPoints = buildKeyPoints(afr, hpfp, iat, timing, carDetails);
  const diagnostics = buildDiagnosticCards(rows, columns, timingColumns, boostUnit, { afr, hpfp, iat, timingCorrections: timing }, carDetails);

  return {
    filename,
    row_count: rows.length,
    status: overall,
    carDetails,
    logFormat: logFormat || 'Unknown',
    detectedColumns: { ...columns, boostUnit, timingColumns },
    metrics: {
      afr,
      hpfp,
      iat,
      timingCorrections: timing,
      fuelTrims,
    },
    chartData: buildChartData(rows, columns, isLambdaAfr, boostUnit, 150, thresholds, timingColumns),
    knockScatter,
    keyPoints,
    diagnostics,
    summary: {
      afr_status: afr.status,
      hpfp_status: hpfp.status,
      iat_status: iat.status,
      timing_status: timing.status,
      overall_safety_score: overall,
      notes: [afr.note, hpfp.note, iat.note, timing.note].filter(Boolean),
    },
  };
}
