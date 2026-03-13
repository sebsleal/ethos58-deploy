const TELEMETRY_ENDPOINT = import.meta.env.VITE_TELEMETRY_ENDPOINT || '/api/telemetry';
const TELEMETRY_QUEUE_KEY = 'ethos:telemetry:queue';
const MAX_QUEUE_SIZE = 200;
const FLUSH_INTERVAL_MS = 10000;
const MAX_RETRY_BACKOFF_MS = 5 * 60 * 1000;

let flushTimer = null;
let telemetryInitialized = false;
const sessionId = typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `session_${Date.now()}`;

function hasWindow() {
  return typeof window !== 'undefined';
}

function now() {
  return Date.now();
}

function publish(eventName, payload) {
  if (!hasWindow()) return;
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
}

function sanitizePayload(data) {
  if (data === null || data === undefined) return data;
  if (typeof data === 'string') return data.slice(0, 4000);
  if (typeof data === 'number' || typeof data === 'boolean') return data;
  if (Array.isArray(data)) return data.slice(0, 40).map(sanitizePayload);
  if (typeof data === 'object') {
    return Object.entries(data).slice(0, 60).reduce((acc, [key, value]) => {
      acc[String(key).slice(0, 80)] = sanitizePayload(value);
      return acc;
    }, {});
  }
  return String(data).slice(0, 4000);
}

function readQueue() {
  if (!hasWindow()) return [];
  try {
    const raw = window.localStorage.getItem(TELEMETRY_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(TELEMETRY_QUEUE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
  } catch {
    // ignore storage pressure issues
  }
}

function enqueue(payload) {
  if (!hasWindow()) return;
  const queue = readQueue();
  queue.push(payload);
  writeQueue(queue);
}

function withEnvelope(type, name, data = {}, severity = 'info') {
  return {
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${now()}_${Math.random()}`,
    type,
    name,
    severity,
    ts: now(),
    session_id: sessionId,
    app_version: import.meta.env.VITE_APP_VERSION || 'unknown',
    url: hasWindow() ? window.location.href : null,
    user_agent: hasWindow() ? navigator.userAgent : null,
    data: sanitizePayload(data),
    attempts: 0,
    next_attempt_at: 0,
  };
}

async function uploadBatch(events) {
  if (!events.length || !hasWindow()) return true;

  const body = JSON.stringify({
    source: 'ethos58-web',
    sent_at: now(),
    events,
  });

  if (navigator.sendBeacon && document.visibilityState === 'hidden') {
    const success = navigator.sendBeacon(TELEMETRY_ENDPOINT, new Blob([body], { type: 'application/json' }));
    return success;
  }

  const response = await fetch(TELEMETRY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  });
  return response.ok;
}

async function flushTelemetry() {
  if (!hasWindow()) return;
  const queue = readQueue();
  if (!queue.length) return;

  const timestamp = now();
  const ready = queue.filter(item => (item.next_attempt_at || 0) <= timestamp).slice(0, 30);
  if (!ready.length) return;

  try {
    const success = await uploadBatch(ready.map(({ attempts, next_attempt_at, ...event }) => event));
    if (success) {
      const sentIds = new Set(ready.map(e => e.id));
      writeQueue(queue.filter(item => !sentIds.has(item.id)));
      return;
    }
  } catch {
    // retries happen below
  }

  const retryIds = new Set(ready.map(e => e.id));
  const updated = queue.map(item => {
    if (!retryIds.has(item.id)) return item;
    const attempts = (item.attempts || 0) + 1;
    const backoff = Math.min(2 ** attempts * 1000, MAX_RETRY_BACKOFF_MS);
    return {
      ...item,
      attempts,
      next_attempt_at: timestamp + backoff,
    };
  });
  writeQueue(updated);
}

function scheduleTelemetryFlush() {
  if (!hasWindow() || flushTimer) return;
  flushTimer = window.setInterval(() => {
    void flushTelemetry();
  }, FLUSH_INTERVAL_MS);
}

function installCrashHandlers() {
  if (!hasWindow()) return;

  window.addEventListener('error', (event) => {
    trackError('client_runtime_crash', event.error || event.message || 'Unknown runtime error', {
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    trackError('client_unhandled_rejection', event.reason || 'Unhandled promise rejection');
  });
}

export function initTelemetry() {
  if (!hasWindow() || telemetryInitialized) return;
  telemetryInitialized = true;
  installCrashHandlers();
  scheduleTelemetryFlush();

  window.addEventListener('online', () => { void flushTelemetry(); });
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushTelemetry();
    }
  });
  window.addEventListener('pagehide', () => { void flushTelemetry(); });

  void flushTelemetry();
}

export function trackEvent(name, props = {}) {
  const payload = withEnvelope('event', name, props, 'info');
  enqueue(payload);
  publish('ethos:track', payload);
  if (import.meta.env.DEV) {
    console.info('[telemetry:event]', payload);
  }
}

export function trackError(name, error, props = {}) {
  const message = error?.message || String(error || 'Unknown error');
  const stack = typeof error?.stack === 'string' ? error.stack.split('\n').slice(0, 8).join('\n') : undefined;
  const payload = withEnvelope('error', name, { message, stack, ...props }, 'error');
  enqueue(payload);
  publish('ethos:error', payload);
  console.error('[telemetry:error]', payload);
}

export function trackUploadFailure(error, props = {}) {
  trackError('upload_failure', error, { category: 'upload_failure', ...props });
}

export function trackParserMismatch(props = {}) {
  trackEvent('parser_mismatch_detected', { category: 'parser_mismatch', ...props });
}

export function trackPerformanceIssue(name, props = {}) {
  trackEvent(name || 'performance_issue_detected', { category: 'large_log_performance', ...props });
}

export function trackExportFailure(error, props = {}) {
  trackError('export_share_failure', error, { category: 'export_share_failure', ...props });
}

initTelemetry();
