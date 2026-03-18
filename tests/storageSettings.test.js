import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAllData, getSettings, saveSetting } from '../src/utils/storage.js';

function createLocalStorageMock(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

test('getSettings merges defaults with stored settings and legacy theme/units keys', () => {
  global.localStorage = createLocalStorageMock({
    ethos_settings: JSON.stringify({
      compactView: true,
      downsampling: 'Fast (800 pts)',
      lineThickness: 'Thick (2px)',
      theme: 'system',
      units: 'US',
    }),
    theme: 'dark',
    ethos_units: 'Metric',
  });

  const settings = getSettings();

  assert.equal(settings.theme, 'dark');
  assert.equal(settings.units, 'Metric');
  assert.equal(settings.compactView, true);
  assert.equal(settings.downsampling, 'Fast (800 pts)');
  assert.equal(settings.timeFormat, 'Elapsed (Seconds)');
  assert.equal(settings.blendResultUnit, 'auto');
});

test('getSettings falls back to defaults when stored JSON is malformed (migration-safe)', () => {
  global.localStorage = createLocalStorageMock({
    ethos_settings: '{not-valid-json',
    theme: 'dark',
  });

  const settings = getSettings();

  assert.equal(settings.theme, 'system');
  assert.equal(settings.units, 'US');
  assert.equal(settings.defaultPreset, 'None (Clear)');
  assert.equal(settings.lineThickness, 'Normal (1.5px)');
});

test('saveSetting persists setting payload and keeps legacy keys synchronized', () => {
  const storage = createLocalStorageMock();
  global.localStorage = storage;

  saveSetting('theme', 'light');
  saveSetting('units', 'Metric');
  saveSetting('timeFormat', 'Elapsed (Seconds)');

  const settingsRaw = storage.dump().ethos_settings;
  const settings = JSON.parse(settingsRaw);

  assert.equal(settings.theme, 'light');
  assert.equal(settings.units, 'Metric');
  assert.equal(settings.timeFormat, 'Elapsed (Seconds)');
  assert.equal(storage.dump().theme, 'light');
  assert.equal(storage.dump().ethos_units, 'Metric');
});

test('clearAllData removes all ethos keys and legacy theme key', () => {
  const storage = createLocalStorageMock({
    ethos_settings: JSON.stringify({ theme: 'dark' }),
    ethos_recent_logs: JSON.stringify([{ id: 1 }]),
    ethos_log_results_1: JSON.stringify({ analysis: { status: 'Safe' } }),
    theme: 'dark',
    unrelated_key: 'keep-me',
  });
  global.localStorage = storage;

  clearAllData();

  const dumped = storage.dump();
  assert.equal(dumped.ethos_settings, undefined);
  assert.equal(dumped.ethos_recent_logs, undefined);
  assert.equal(dumped.ethos_log_results_1, undefined);
  assert.equal(dumped.theme, undefined);
  assert.equal(dumped.unrelated_key, 'keep-me');
});
