import { Capacitor } from '@capacitor/core';

async function invokeNative(method, payload = {}) {
  if (!Capacitor.isNativePlatform()) return null;
  const plugin = Capacitor.Plugins?.EthosNative;
  if (!plugin || typeof plugin[method] !== 'function') return null;
  try {
    return await plugin[method](payload);
  } catch {
    return null;
  }
}

export async function updateWidgetSnapshot(activeBlend) {
  return invokeNative('updateWidgetSnapshot', { activeBlend });
}

export async function donateBlendShortcut(activeBlend) {
  return invokeNative('donateBlendShortcut', { activeBlend });
}

export async function indexGarageLogsInSpotlight(logs) {
  return invokeNative('indexGarageLogsInSpotlight', {
    logs: (logs || []).slice(0, 250).map((log) => ({
      id: String(log.id),
      title: log.filename,
      engine: log.engine,
      date: log.createdAt,
      tags: log.tags || [],
      tune: log.tune,
      ethanol: log.ethanol,
    })),
  });
}

export async function startBlendLiveActivity(activity) {
  return invokeNative('startBlendLiveActivity', { activity });
}
