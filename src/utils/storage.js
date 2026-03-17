/**
 * Persistent storage helpers for Ethos85.
 * All data lives in localStorage — works on web and Capacitor iOS.
 */

const KEYS = {
  RECENT_LOGS:      'ethos_recent_logs',
  LOG_RESULTS:      'ethos_log_results',
  LOG_GARAGE:       'ethos_log_garage',
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
  BLEND_HISTORY:    'ethos_blend_history',
  PENDING_BLEND:    'ethos_pending_blend',
  CAR_PROFILES:     'ethos_car_profiles',
  ACTIVE_CAR:       'ethos_active_car',
};

const MAX_RECENT_LOGS = 10;

function isQuotaError(error) {
  if (!error) return false;
  return error?.name === 'QuotaExceededError' || error?.code === 22;
}

function safeSetItem(key, value, onQuotaExceeded) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    if (isQuotaError(error) && typeof onQuotaExceeded === 'function') {
      onQuotaExceeded();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ─── Recent Logs ─────────────────────────────────────────────────────────────

export function getRecentLogs() {
  try {
    const logs = JSON.parse(localStorage.getItem(KEYS.RECENT_LOGS) || '[]');
    return Array.isArray(logs) ? logs : [];
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
  safeSetItem(KEYS.RECENT_LOGS, JSON.stringify(updated));

  // Store full analysis result keyed by ID so it can be reopened
  safeSetItem(`${KEYS.LOG_RESULTS}_${id}`, JSON.stringify({ analysis, csvText: null }));

  return updated;
}

function getGarageIndex() {
  try {
    const rows = JSON.parse(localStorage.getItem(KEYS.LOG_GARAGE) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveGarageIndex(entries) {
  safeSetItem(KEYS.LOG_GARAGE, JSON.stringify(entries));
}

export function getGarageLogs() {
  return getGarageIndex().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function saveGarageLog(analysis, csvText = null) {
  const id = Date.now();
  const timingPull = analysis.metrics?.timingCorrections?.max_correction ?? null;
  const healthScore = computeHealthScore(analysis);

  const entry = {
    id,
    filename: analysis.filename,
    createdAt: new Date().toISOString(),
    status: analysis.status,
    engine: analysis.carDetails?.engine || '—',
    ethanol: analysis.carDetails?.ethanol ?? '—',
    tune: analysis.carDetails?.tuneStage || '—',
    afr: analysis.metrics?.afr?.actual ?? null,
    hpfp: analysis.metrics?.hpfp?.actual ?? null,
    rowCount: analysis.row_count ?? null,
    timingPull,
    healthScore,
    tags: [],
    notes: '',
    hasCsv: Boolean(csvText),
  };

  const current = getGarageIndex();
  saveGarageIndex([entry, ...current]);

  safeSetItem(
    `${KEYS.LOG_RESULTS}_${id}`,
    JSON.stringify({ analysis, csvText }),
    () => {
      const oldGarage = getGarageIndex().slice(25);
      oldGarage.forEach((item) => localStorage.removeItem(`${KEYS.LOG_RESULTS}_${item.id}`));
    },
  );

  return entry;
}

export function updateGarageLogMeta(id, updates) {
  const current = getGarageIndex();
  const next = current.map((item) => item.id === id ? { ...item, ...updates } : item);
  saveGarageIndex(next);
  return next.find((item) => item.id === id) ?? null;
}

export function deleteGarageLog(id) {
  const current = getGarageIndex();
  const next = current.filter((item) => item.id !== id);
  saveGarageIndex(next);
  localStorage.removeItem(`${KEYS.LOG_RESULTS}_${id}`);
}

export function exportGarageBackup() {
  const logs = getGarageLogs();
  const payload = logs.map((entry) => ({
    ...entry,
    full: getLogResult(entry.id),
  }));
  return {
    schema: 'ethos58-garage-v1',
    exportedAt: new Date().toISOString(),
    logs: payload,
  };
}

export function importGarageBackup(data, mode = 'merge') {
  if (!data || !Array.isArray(data.logs)) {
    throw new Error('Invalid backup format.');
  }

  const existing = mode === 'replace' ? [] : getGarageIndex();
  const existingIds = new Set(existing.map((item) => item.id));
  const importedEntries = [];

  for (const log of data.logs) {
    const nextId = existingIds.has(log.id) ? (Date.now() + Math.floor(Math.random() * 100000)) : log.id;
    existingIds.add(nextId);
    const entry = {
      id: nextId,
      filename: log.filename || 'Imported Log',
      createdAt: log.createdAt || new Date().toISOString(),
      status: log.status || 'Unknown',
      engine: log.engine || '—',
      ethanol: log.ethanol ?? '—',
      tune: log.tune || '—',
      afr: log.afr ?? null,
      hpfp: log.hpfp ?? null,
      rowCount: log.rowCount ?? null,
      timingPull: log.timingPull ?? null,
      healthScore: log.healthScore ?? null,
      tags: Array.isArray(log.tags) ? log.tags : [],
      notes: typeof log.notes === 'string' ? log.notes : '',
      hasCsv: Boolean(log?.full?.csvText),
    };
    importedEntries.push(entry);

    if (log.full) {
      safeSetItem(`${KEYS.LOG_RESULTS}_${nextId}`, JSON.stringify(log.full));
    }
  }

  saveGarageIndex([...importedEntries, ...existing]);
  return importedEntries.length;
}

export function exportGarageSummaryCsv() {
  const logs = getGarageLogs();
  const headers = ['id', 'filename', 'createdAt', 'status', 'engine', 'ethanol', 'tune', 'rowCount', 'timingPull', 'healthScore', 'tags', 'notes'];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = logs.map((log) => [
    log.id,
    log.filename,
    log.createdAt,
    log.status,
    log.engine,
    log.ethanol,
    log.tune,
    log.rowCount,
    log.timingPull,
    log.healthScore,
    (log.tags || []).join('|'),
    log.notes || '',
  ].map(escape).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export function getLogResult(id) {
  try {
    const stored = JSON.parse(localStorage.getItem(`${KEYS.LOG_RESULTS}_${id}`) || 'null');
    if (stored && typeof stored === 'object' && (stored.analysis || stored.csvText !== undefined)) {
      return stored;
    }
    // Backward compatibility with older saves containing only analysis
    return stored ? { analysis: stored, csvText: null } : null;
  } catch {
    return null;
  }
}

export function clearRecentLogs() {
  const logs = getRecentLogs();
  logs.forEach(l => localStorage.removeItem(`${KEYS.LOG_RESULTS}_${l.id}`));
  localStorage.removeItem(KEYS.RECENT_LOGS);
}

export function clearGarageLogs() {
  const logs = getGarageIndex();
  logs.forEach((l) => localStorage.removeItem(`${KEYS.LOG_RESULTS}_${l.id}`));
  localStorage.removeItem(KEYS.LOG_GARAGE);
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
  safeSetItem(KEYS.ACTIVE_BLEND, JSON.stringify(entry));
  // Also track in blend history
  saveBlendHistory({
    e85Gallons: result.e85Gallons,
    pumpGallons: result.pumpGallons,
    resultingBlend: result.resultingBlend,
    resultingOctane: result.resultingOctane,
    pumpOctane: result.pumpOctane,
    pumpEthanol: result.pumpEthanol,
  });
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
  timeFormat:     'Elapsed (Seconds)',
  defaultPreset:  'None (Clear)',
  compactView:    false,
  blendResultUnit: 'auto',
};

export function getSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEYS.SETTINGS) || '{}');
    // Back-compat: pick up legacy keys written directly
    const theme = localStorage.getItem(KEYS.THEME) || stored.theme || SETTINGS_DEFAULTS.theme;
    const units = localStorage.getItem(KEYS.UNITS) || stored.units || SETTINGS_DEFAULTS.units;
    const settings = { ...SETTINGS_DEFAULTS, ...stored, theme, units };

    // Migration v2: users who had the old 'High Quality (1600 pts)' default get reset
    // to the new 'Original (All Data)' default. Only runs once (_settingsV is absent).
    if (!stored._settingsV) {
      if (settings.downsampling === 'High Quality (1600 pts)') {
        settings.downsampling = 'Original (All Data)';
      }
      localStorage.setItem(KEYS.SETTINGS, JSON.stringify({ ...settings, _settingsV: 2 }));
    }

    return settings;
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

// ─── Blend History ───────────────────────────────────────────────────────────

const MAX_BLEND_HISTORY = 50;

export function getBlendHistory() {
  try {
    const entries = JSON.parse(localStorage.getItem(KEYS.BLEND_HISTORY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

export function saveBlendHistory(entry) {
  const history = getBlendHistory();
  const next = [{ ...entry, date: new Date().toISOString(), id: Date.now() }, ...history].slice(0, MAX_BLEND_HISTORY);
  localStorage.setItem(KEYS.BLEND_HISTORY, JSON.stringify(next));
  return next;
}

export function clearBlendHistory() {
  localStorage.removeItem(KEYS.BLEND_HISTORY);
}

// ─── Pending Blend (log-to-blend bridge) ─────────────────────────────────────

export function getPendingBlend() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.PENDING_BLEND) || 'null');
  } catch {
    return null;
  }
}

export function setPendingBlend(data) {
  localStorage.setItem(KEYS.PENDING_BLEND, JSON.stringify(data));
}

export function clearPendingBlend() {
  localStorage.removeItem(KEYS.PENDING_BLEND);
}

// ─── Car Profiles ─────────────────────────────────────────────────────────────

export function getCarProfiles() {
  try {
    const profiles = JSON.parse(localStorage.getItem(KEYS.CAR_PROFILES) || '[]');
    return Array.isArray(profiles) ? profiles : [];
  } catch {
    return [];
  }
}

export function saveCarProfile(profile) {
  const list = getCarProfiles();
  const entry = { ...profile, id: profile.id || Date.now().toString(), createdAt: profile.createdAt || new Date().toISOString() };
  // Avoid duplicates — update if same id
  const idx = list.findIndex((p) => p.id === entry.id);
  const next = idx >= 0 ? list.map((p) => (p.id === entry.id ? entry : p)) : [entry, ...list];
  localStorage.setItem(KEYS.CAR_PROFILES, JSON.stringify(next));
  return entry;
}

export function deleteCarProfile(id) {
  const list = getCarProfiles().filter((p) => p.id !== id);
  localStorage.setItem(KEYS.CAR_PROFILES, JSON.stringify(list));
  if (getActiveCar() === id) setActiveCar(null);
}

export function getActiveCar() {
  return localStorage.getItem(KEYS.ACTIVE_CAR) || null;
}

export function setActiveCar(id) {
  if (id) localStorage.setItem(KEYS.ACTIVE_CAR, id);
  else localStorage.removeItem(KEYS.ACTIVE_CAR);
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
