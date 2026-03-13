/**
 * Thin wrapper around @capacitor/haptics.
 * Silently no-ops on web or when the plugin is unavailable.
 */

let _haptics = null;

async function getHaptics() {
  if (_haptics) return _haptics;
  try {
    const mod = await import('@capacitor/haptics');
    _haptics = mod.Haptics;
    return _haptics;
  } catch {
    return null;
  }
}

/** Light tap — success feedback */
export async function hapticLight() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.impact({ style: 'LIGHT' }); } catch {}
}

/** Medium tap — caution feedback */
export async function hapticMedium() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.impact({ style: 'MEDIUM' }); } catch {}
}

/** Heavy tap — risk / error feedback */
export async function hapticHeavy() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.impact({ style: 'HEAVY' }); } catch {}
}

/** Notification success */
export async function hapticSuccess() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.notification({ type: 'SUCCESS' }); } catch {}
}

/** Notification warning */
export async function hapticWarning() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.notification({ type: 'WARNING' }); } catch {}
}

/** Notification error */
export async function hapticError() {
  const H = await getHaptics();
  if (!H) return;
  try { await H.notification({ type: 'ERROR' }); } catch {}
}
