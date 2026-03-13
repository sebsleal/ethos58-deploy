function hasWindow() {
  return typeof window !== 'undefined';
}

function publish(eventName, payload) {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
}

export function trackEvent(name, props = {}) {
  const payload = { name, props, ts: Date.now() };
  publish('ethos:track', payload);
  if (import.meta.env.DEV) {
    console.info('[telemetry:event]', payload);
  }
}

export function trackError(name, error, props = {}) {
  const payload = {
    name,
    message: error?.message || String(error || 'Unknown error'),
    props,
    ts: Date.now(),
  };
  publish('ethos:error', payload);
  console.error('[telemetry:error]', payload);
}
