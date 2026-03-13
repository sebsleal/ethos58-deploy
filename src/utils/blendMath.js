/**
 * Ethanol blend math for Ethos85.
 *
 * Solves a two-fuel mixing problem:
 *   We have `current_gallons` of fuel at `current_ethanol_percent` (e.g. E10).
 *   We want to reach `target_ethanol_percent` in a `tank_size` tank.
 *   We add E85 (85% ethanol) and/or 93-octane pump gas (0% ethanol).
 *
 * Core equation (filling the tank to capacity):
 *   (current_gallons * ce + e85 * 0.85) / tank_size = target_ethanol_percent / 100
 *
 * Solving for e85:
 *   e85 = (tank_size * te/100 - current_gallons * ce/100) / 0.85
 *
 * Precision mode: returns 3-decimal accuracy and staged fill steps to help
 * avoid pump overshoot (a real-world problem when filling in small increments).
 */

/**
 * @param {object} params
 * @param {number}  params.current_gallons
 * @param {number}  params.current_ethanol_percent
 * @param {number}  params.target_ethanol_percent
 * @param {number}  params.tank_size
 * @param {number}  [params.pump_ethanol_percent=0]  Ethanol % in pump gas (e.g. 10 for E10 93-octane)
 * @param {boolean} [params.precision_mode=false]
 */
export function calculateBlend({
  current_gallons,
  current_ethanol_percent,
  target_ethanol_percent,
  tank_size,
  pump_ethanol_percent = 0,
  precision_mode = false,
}) {
  const warnings = [];

  const g  = parseFloat(current_gallons);
  const ce = parseFloat(current_ethanol_percent);
  const te = parseFloat(target_ethanol_percent);
  const ts = parseFloat(tank_size);
  const pe = parseFloat(pump_ethanol_percent) / 100;

  if ([g, ce, te, ts].some(isNaN)) {
    throw new Error('All inputs must be valid numbers.');
  }
  if (g < 0 || g > ts)     throw new Error('current_gallons must be between 0 and tank_size.');
  if (ce < 0 || ce > 100)  throw new Error('current_ethanol_percent must be 0–100.');
  if (te < 0 || te > 85)   throw new Error('target_ethanol_percent must be 0–85 (E85 ceiling).');
  if (ts <= 0)              throw new Error('tank_size must be greater than 0.');

  const availableSpace        = ts - g;
  const currentEthanolGallons = g * (ce / 100);
  const targetEthanolGallons  = ts * (te / 100);

  // Solve for E85 accounting for pump gas ethanol content (pe):
  //   currentEthanol + e85*0.85 + gas*pe = targetEthanol
  //   gas = availableSpace - e85
  //   => e85*(0.85 - pe) = targetEthanol - currentEthanol - availableSpace*pe
  const denominator = 0.85 - pe;
  let e85Raw = denominator !== 0
    ? (targetEthanolGallons - currentEthanolGallons - availableSpace * pe) / denominator
    : 0;

  let e85 = Math.max(0, Math.min(e85Raw, availableSpace));
  let gas = Math.max(0, availableSpace - e85);

  if (e85Raw < 0) {
    warnings.push(`Target ethanol is below what ${Math.round(pe * 100)}-octane dilution alone can achieve. Drain some fuel first.`);
    e85 = 0;
    gas = availableSpace;
  }

  if (e85Raw > availableSpace) {
    warnings.push('Target ethanol % cannot be reached without draining the tank — E85 capped at available space.');
    e85 = availableSpace;
    gas = 0;
  }

  const totalFuel        = g + e85 + gas;
  const totalEthanol     = currentEthanolGallons + e85 * 0.85 + gas * pe;
  const resultingPercent = totalFuel > 0 ? (totalEthanol / totalFuel) * 100 : 0;

  // Standard output: 2 decimal places on gallons, 1 on percent
  const galDec     = precision_mode ? 3 : 2;
  const pctDec     = precision_mode ? 2 : 1;

  const result = {
    gallons_of_e85_to_add: round(e85, galDec),
    gallons_of_93_to_add:  round(gas, galDec),
    resulting_percent:     round(resultingPercent, pctDec),
    precision_mode:        precision_mode,
    warnings,
  };

  // Precision mode: add staged fill steps to prevent pump overshoot
  if (precision_mode && e85 > 0) {
    // Fill E85 in two stages: 80% first, pause and check, then the final 20%
    const stage1 = round(e85 * 0.8, 3);
    const stage2 = round(e85 - stage1, 3);

    // What is the blend after stage 1 only (no gas yet)?
    const ethanolAfterStage1 = currentEthanolGallons + stage1 * 0.85;
    const gallonsAfterStage1 = g + stage1;
    const percentAfterStage1 = round((ethanolAfterStage1 / gallonsAfterStage1) * 100, 2);

    result.fill_steps = [
      {
        step: 1,
        action: 'E85',
        gallons: stage1,
        note: `Add ${stage1} gal E85. Blend will be ~E${percentAfterStage1} at this point.`,
      },
      {
        step: 2,
        action: 'E85',
        gallons: stage2,
        note: `Add final ${stage2} gal E85 slowly to avoid overshoot.`,
      },
      ...(gas > 0 ? [{
        step: 3,
        action: '93-octane',
        gallons: round(gas, 3),
        note: `Fill ${round(gas, 3)} gal 93-octane to top off.`,
      }] : []),
    ];

    result.precision_note = 'Fill E85 in two stages to avoid pump overshoot. Final blend is sensitive to the last 20% of E85 added.';
  }

  return result;
}

function round(value, decimals) {
  return parseFloat(value.toFixed(decimals));
}

/**
 * Compute the resulting octane after blending E85 + pump gas.
 * E85 is typically rated ~105 AKI. Pump gas is the user-selected octane.
 */
export function calculateResultingOctane({ e85Gallons, pumpGallons, pumpOctane, e85Octane = 105 }) {
  const total = (e85Gallons || 0) + (pumpGallons || 0);
  if (total === 0) return null;
  return round((e85Gallons * e85Octane + pumpGallons * pumpOctane) / total, 1);
}

/**
 * Reverse blend calculation: given how many gallons the user is about to add
 * at a known pump ethanol %, what will the resulting blend be?
 */
export function reverseCalculateBlend({ currentE, currentGallons, addGallons, pumpEthanol }) {
  const g  = parseFloat(currentGallons) || 0;
  const ag = parseFloat(addGallons)     || 0;
  const ce = parseFloat(currentE)       || 0;
  const pe = parseFloat(pumpEthanol)    || 0;

  const total = g + ag;
  if (total === 0) return null;

  const currentEthanolGal = g * (ce / 100);
  const addedEthanolGal   = ag * (pe / 100);

  return round(((currentEthanolGal + addedEthanolGal) / total) * 100, 1);
}

/**
 * Average pump ethanol readings from a tester (simple calibration helper).
 */
export function calibratePumpEthanol(readings = []) {
  const valid = readings
    .map(value => parseFloat(value))
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 100);

  if (valid.length === 0) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 1);
}

/**
 * Estimate blend cost for a full-tank target using station prices.
 */
export function estimateBlendFillCost({
  currentGallons,
  currentE,
  targetE,
  tankSize,
  pumpEthanol,
  e85Price,
  pumpPrice,
}) {
  const blend = calculateBlend({
    current_gallons: currentGallons,
    current_ethanol_percent: currentE,
    target_ethanol_percent: targetE,
    tank_size: tankSize,
    pump_ethanol_percent: pumpEthanol,
  });

  const e85Cost = (blend.gallons_of_e85_to_add || 0) * (parseFloat(e85Price) || 0);
  const pumpCost = (blend.gallons_of_93_to_add || 0) * (parseFloat(pumpPrice) || 0);

  return {
    ...blend,
    e85Cost: round(e85Cost, 2),
    pumpCost: round(pumpCost, 2),
    totalCost: round(e85Cost + pumpCost, 2),
  };
}

/**
 * Plan E85 additions for upcoming tanks.
 */
export function planEthanolOverTanks({
  tanks,
  startGallons,
  startE,
  tankSize,
  targetE,
  pumpEthanol,
}) {
  const totalTanks = Math.max(1, parseInt(tanks, 10) || 1);
  const plan = [];

  let currentGallons = parseFloat(startGallons) || 0;
  let currentE = parseFloat(startE) || 0;

  for (let i = 0; i < totalTanks; i += 1) {
    const blend = calculateBlend({
      current_gallons: currentGallons,
      current_ethanol_percent: currentE,
      target_ethanol_percent: targetE,
      tank_size: tankSize,
      pump_ethanol_percent: pumpEthanol,
    });

    plan.push({
      tank: i + 1,
      e85Gallons: blend.gallons_of_e85_to_add,
      pumpGallons: blend.gallons_of_93_to_add,
      resultingE: blend.resulting_percent,
    });

    // After this tank cycle, user returns near their starting fill level.
    currentGallons = parseFloat(startGallons) || 0;
    currentE = blend.resulting_percent;
  }

  return plan;
}
