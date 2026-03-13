/**
 * Persistent storage helpers for Ethos85.
 * All data lives in localStorage — works on web and Capacitor iOS.
 */

const KEYS = {
  RECENT_LOGS:      'ethos_recent_logs',
  LOG_RESULTS:      'ethos_log_results',
  ACTIVE_BLEND:     'ethos_active_blend',
  SETTINGS:         'ethos_settings',
  THEME:            'theme',
  UNITS:            'ethos_units',
  BLEND_PROFILES:   'ethos_blend_profiles',
  ANNOTATIONS:      'ethos_annotations',
  LAST_VERSION:     'ethos_last_version',
  ONBOARDING_DONE:  'ethos_onboarding_done',
  STATION_PRESETS:  'ethos_station_presets',
  FUEL_PLANNER:     'ethos_fuel_planner',
};

const MAX_RECENT_LOGS = 10;

// ─── Recent Logs ─────────────────────────────────────────────────────────────

export function getRecentLogs() {
  try {
    const logs = JSON.parse(localStorage.getItem(KEYS.RECENT_LOGS) || '[]');
    if (!Array.isArray(logs)) return [];

    let updatedAny = false;
    const updated = logs.map(log => {
      try {
        const full = JSON.parse(localStorage.getItem(`${KEYS.LOG_RESULTS}_${log.id}`) || 'null');
        const recalculated = computeHealthScore(full);
        if (recalculated !== null && log.healthScore !== recalculated) {
          updatedAny = true;
          return { ...log, healthScore: recalculated };
        }
      } catch {
        // ignore malformed per-log payload
      }
      return log;
    });

    if (updatedAny) {
      localStorage.setItem(KEYS.RECENT_LOGS, JSON.stringify(updated));
    }

    return updated;
  } catch {
    return [];
  }
}

export function saveRecentLog(analysis) {
  const id = Date.now();
  const logs = getRecentLogs();

  const timingPull = analysis.metrics?.timingCorrections?.max_correction ?? null;
  const healthScore = computeHealthScore(analysis);

  const entry = {
    id,
    filename:    analysis.filename,
    date:        new Date().toISOString(),
    status:      analysis.status,
    engine:      analysis.carDetails?.engine  || '—',
    ethanol:     analysis.carDetails?.ethanol ?? '—',
    tune:        analysis.carDetails?.tuneStage || '—',
    ambientTemp: analysis.metrics?.iat?.value ?? null,
    afr:         analysis.metrics?.afr?.actual ?? null,
    hpfp:        analysis.metrics?.hpfp?.actual ?? null,
    rowCount:    analysis.row_count ?? null,
    timingPull,
    healthScore,
  };

  // Trim old full results before saving new ones to stay within storage limits
  const oldLogs = logs.slice(MAX_RECENT_LOGS - 1);
  oldLogs.forEach(l => localStorage.removeItem(`${KEYS.LOG_RESULTS}_${l.id}`));

  const updated = [entry, ...logs].slice(0, MAX_RECENT_LOGS);
  localStorage.setItem(KEYS.RECENT_LOGS, JSON.stringify(updated));

  // Store full analysis result keyed by ID so it can be reopened
  try {
    localStorage.setItem(`${KEYS.LOG_RESULTS}_${id}`, JSON.stringify(analysis));
  } catch {
    // localStorage quota exceeded — skip full result storage
  }

  return updated;
}

export function getLogResult(id) {
  try {
    return JSON.parse(localStorage.getItem(`${KEYS.LOG_RESULTS}_${id}`) || 'null');
  } catch {
    return null;
  }
}

export function clearRecentLogs() {
  const logs = getRecentLogs();
  logs.forEach(l => localStorage.removeItem(`${KEYS.LOG_RESULTS}_${l.id}`));
  localStorage.removeItem(KEYS.RECENT_LOGS);
}

// ─── Active Blend ─────────────────────────────────────────────────────────────

export function getActiveBlend() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.ACTIVE_BLEND) || 'null');
  } catch {
    return null;
  }
}

export function saveActiveBlend(result) {
  const entry = { ...result, date: new Date().toISOString() };
  localStorage.setItem(KEYS.ACTIVE_BLEND, JSON.stringify(entry));
  return entry;
}

export function clearActiveBlend() {
  localStorage.removeItem(KEYS.ACTIVE_BLEND);
}

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_DEFAULTS = {
  theme:          'system',
  units:          'US',
  downsampling:   'Original (All Data)',
  lineThickness:  'Normal (1.5px)',
  blendResultUnit: 'auto',
};

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS.SETTINGS) || '{}');
    // Back-compat: pick up legacy keys written directly
    const theme = localStorage.getItem(KEYS.THEME) || stored.theme || SETTINGS_DEFAULTS.theme;
    const units = localStorage.getItem(KEYS.UNITS) || stored.units || SETTINGS_DEFAULTS.units;
    return { ...SETTINGS_DEFAULTS, ...stored, theme, units };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

export function saveSetting(key, value) {
  const current = getSettings();
  const updated = { ...current, [key]: value };
  localStorage.setItem(KEYS.SETTINGS, JSON.stringify(updated));
  // Keep legacy keys in sync for backward compat
  if (key === 'theme') localStorage.setItem(KEYS.THEME, value);
  if (key === 'units') localStorage.setItem(KEYS.UNITS, value);
}

// ─── Blend Profiles ───────────────────────────────────────────────────────────

export function getBlendProfiles() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.BLEND_PROFILES) || '{}');
  } catch {
    return {};
  }
}

export function saveBlendProfile(name, data) {
  const profiles = getBlendProfiles();
  profiles[name] = { ...data, savedAt: new Date().toISOString() };
  localStorage.setItem(KEYS.BLEND_PROFILES, JSON.stringify(profiles));
}

export function deleteBlendProfile(name) {
  const profiles = getBlendProfiles();
  delete profiles[name];
  localStorage.setItem(KEYS.BLEND_PROFILES, JSON.stringify(profiles));
}


export function getStationPresets() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.STATION_PRESETS) || '{}');
  } catch {
    return {};
  }
}

export function saveStationPreset(name, data) {
  const presets = getStationPresets();
  presets[name] = { ...data, savedAt: new Date().toISOString() };
  localStorage.setItem(KEYS.STATION_PRESETS, JSON.stringify(presets));
}

export function deleteStationPreset(name) {
  const presets = getStationPresets();
  delete presets[name];
  localStorage.setItem(KEYS.STATION_PRESETS, JSON.stringify(presets));
}

export function getFuelPlannerDefaults() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.FUEL_PLANNER) || '{}');
  } catch {
    return {};
  }
}

export function saveFuelPlannerDefaults(defaults) {
  const current = getFuelPlannerDefaults();
  localStorage.setItem(KEYS.FUEL_PLANNER, JSON.stringify({ ...current, ...defaults }));
}

// ─── Annotations ─────────────────────────────────────────────────────────────

export function getAnnotations(logId) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.ANNOTATIONS) || '{}');
    return all[logId] || [];
  } catch {
    return [];
  }
}

export function saveAnnotations(logId, annotations) {
  try {
    const all = JSON.parse(localStorage.getItem(KEYS.ANNOTATIONS) || '{}');
    all[logId] = annotations;
    localStorage.setItem(KEYS.ANNOTATIONS, JSON.stringify(all));
  } catch {
    // quota exceeded — ignore
  }
}

// ─── Onboarding ──────────────────────────────────────────────────────────────

export function isOnboardingDone() {
  return localStorage.getItem(KEYS.ONBOARDING_DONE) === 'true';
}

export function markOnboardingDone() {
  localStorage.setItem(KEYS.ONBOARDING_DONE, 'true');
}

// ─── Changelog / Version ─────────────────────────────────────────────────────

export function getLastSeenVersion() {
  return localStorage.getItem(KEYS.LAST_VERSION) || null;
}

export function setLastSeenVersion(version) {
  localStorage.setItem(KEYS.LAST_VERSION, version);
}

// ─── Health Score ─────────────────────────────────────────────────────────────
// 0–100 composite score from log metrics (100 = perfect, 0 = critical issues)

export function computeHealthScore(analysis) {
  if (!analysis?.metrics) return null;

  const { afr, hpfp, iat, timingCorrections } = analysis.metrics;
  let score = 100;

  // Timing pull: max 30 pts deducted
  const pull = timingCorrections?.max_correction ?? 0;
  if (pull < -4)      score -= 30;
  else if (pull < -2) score -= 15;
  else if (pull < -1) score -= 5;

  // AFR status: max 40 pts deducted
  if (afr?.status === 'Risk')        score -= 40;
  else if (afr?.status === 'Caution') score -= 15;

  // HPFP status + crash severity: max 60 pts deducted
  const hpfpDrop = hpfp?.max_drop_pct ?? 0;
  if (hpfpDrop >= 40) score -= 60;
  else if (hpfpDrop >= 30) score -= 45;
  else if (hpfp?.status === 'Risk') score -= 30;
  else if (hpfp?.status === 'Caution') score -= 12;

  // IAT status: max 10 pts deducted
  if (iat?.status === 'Risk')        score -= 10;
  else if (iat?.status === 'Caution') score -= 4;

  return Math.max(0, score);
}
