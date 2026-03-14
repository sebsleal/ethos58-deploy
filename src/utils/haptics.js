/**
 * Thin wrapper around @capacitor/haptics.
 * Silently no-ops on web or when the plugin is unavailable.
 */

let _haptics = null;
let _hapticsPromise = null;

async function getHaptics() {
  if (_haptics) return _haptics;
  if (!_hapticsPromise) {
    _hapticsPromise = import('@capacitor/haptics')
      .then((mod) => { _haptics = mod.Haptics; return _haptics; })
      .catch(() => null);
  }
  return Promise.race([
    _hapticsPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
  ]);
}

const HAPTIC_TIMEOUT = 500;
const withTimeout = (promise) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(resolve, HAPTIC_TIMEOUT))]);

/** Light tap — success feedback */
export async function hapticLight() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.impact({ style: 'LIGHT' })); } catch {}
}

/** Medium tap — caution feedback */
export async function hapticMedium() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.impact({ style: 'MEDIUM' })); } catch {}
}

/** Heavy tap — risk / error feedback */
export async function hapticHeavy() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.impact({ style: 'HEAVY' })); } catch {}
}

/** Notification success */
export async function hapticSuccess() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.notification({ type: 'SUCCESS' })); } catch {}
}

/** Notification warning */
export async function hapticWarning() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.notification({ type: 'WARNING' })); } catch {}
}

/** Notification error */
export async function hapticError() {
  const H = await getHaptics();
  if (!H) return;
  try { await withTimeout(H.notification({ type: 'ERROR' })); } catch {}
}
