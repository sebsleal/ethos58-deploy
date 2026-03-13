import multer from 'multer';
import { appendFile } from 'node:fs/promises';
import { calculateBlend } from '../src/utils/blendMath.js';
import { analyzeParsedLog } from '../src/utils/logAnalyzer.js';
import { parseCsv as parseServerCsv } from './utils/csvParser.js';

function safeErrorMessage(err, fallback = 'Unexpected server error.') {
  if (!err) return fallback;
  const msg = typeof err.message === 'string' ? err.message : String(err);
  return msg || fallback;
}

function sendError(res, status, code, message, details = undefined) {
  return res.status(status).json({
    success: false,
    code,
    error: message,
    ...(details ? { details } : {}),
  });
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return defaultValue;
}

function parseCarDetails(raw) {
  if (!raw) return {};

  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('car_details must be valid JSON.');
    }
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('car_details must be a JSON object.');
  }

  const out = {};

  if (data.ethanol !== undefined) {
    const ethanol = Number(data.ethanol);
    if (!Number.isFinite(ethanol) || ethanol < 0 || ethanol > 85) {
      throw new Error('car_details.ethanol must be a number between 0 and 85.');
    }
    out.ethanol = ethanol;
  }

  if (data.engine !== undefined) {
    if (typeof data.engine !== 'string' || data.engine.trim().length === 0) {
      throw new Error('car_details.engine must be a non-empty string.');
    }
    out.engine = data.engine.trim();
  }

  if (data.tuneStage !== undefined) {
    if (typeof data.tuneStage !== 'string' || data.tuneStage.trim().length === 0) {
      throw new Error('car_details.tuneStage must be a non-empty string.');
    }
    out.tuneStage = data.tuneStage.trim();
  }

  return out;
}



const MAX_TELEMETRY_EVENTS_PER_REQUEST = 100;
const MAX_TELEMETRY_EVENT_BYTES = 24 * 1024;

function trimTelemetryEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const normalized = {
    id: typeof event.id === 'string' ? event.id.slice(0, 100) : undefined,
    type: typeof event.type === 'string' ? event.type.slice(0, 40) : 'event',
    name: typeof event.name === 'string' ? event.name.slice(0, 160) : 'unknown',
    severity: typeof event.severity === 'string' ? event.severity.slice(0, 20) : 'info',
    ts: Number.isFinite(Number(event.ts)) ? Number(event.ts) : Date.now(),
    session_id: typeof event.session_id === 'string' ? event.session_id.slice(0, 120) : undefined,
    app_version: typeof event.app_version === 'string' ? event.app_version.slice(0, 60) : undefined,
    url: typeof event.url === 'string' ? event.url.slice(0, 500) : undefined,
    user_agent: typeof event.user_agent === 'string' ? event.user_agent.slice(0, 500) : undefined,
    data: event.data && typeof event.data === 'object' ? event.data : {},
  };

  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_TELEMETRY_EVENT_BYTES) {
    normalized.data = { note: 'payload_truncated', original_bytes: serialized.length };
  }

  return normalized;
}

export async function telemetryIngestHandler(req, res) {
  try {
    const input = Array.isArray(req.body?.events) ? req.body.events : [];
    if (input.length === 0) {
      return sendError(res, 400, 'INVALID_TELEMETRY_PAYLOAD', 'Request body must include a non-empty events array.');
    }

    const trimmed = input
      .slice(0, MAX_TELEMETRY_EVENTS_PER_REQUEST)
      .map(trimTelemetryEvent)
      .filter(Boolean);

    if (!trimmed.length) {
      return sendError(res, 400, 'INVALID_TELEMETRY_PAYLOAD', 'No valid telemetry events were provided.');
    }

    const lines = trimmed
      .map(event => JSON.stringify({
        ...event,
        received_at: Date.now(),
        source: req.body?.source || 'unknown',
        remote_ip: req.ip,
      }))
      .join('\n') + '\n';

    await appendFile('server/telemetry.ndjson', lines, 'utf8');

    return res.json({ success: true, accepted: trimmed.length });
  } catch (err) {
    return sendError(res, 500, 'TELEMETRY_INGEST_FAILED', safeErrorMessage(err, 'Failed to ingest telemetry events.'));
  }
}

export const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.originalname.toLowerCase().endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv files are accepted.'));
    }
  },
});

export function calculateBlendHandler(req, res) {
  try {
    const {
      current_gallons, currentFuel,
      current_ethanol_percent, currentE,
      target_ethanol_percent, targetE,
      tank_size, tankSize,
      pump_ethanol_percent, pumpEthanol,
    } = req.body || {};

    const result = calculateBlend({
      current_gallons: current_gallons ?? currentFuel,
      current_ethanol_percent: current_ethanol_percent ?? currentE,
      target_ethanol_percent: target_ethanol_percent ?? targetE,
      tank_size: tank_size ?? tankSize,
      pump_ethanol_percent: pump_ethanol_percent ?? pumpEthanol ?? 0,
      precision_mode: parseBoolean(req.body?.precision_mode ?? req.body?.precisionMode, false),
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, 400, 'INVALID_BLEND_INPUT', safeErrorMessage(err, 'Invalid blend calculation input.'));
  }
}

export function analyzeLogHandler(req, res) {
  try {
    if (!req.file) {
      return sendError(
        res,
        400,
        'MISSING_FILE',
        'No file uploaded. Send the CSV as multipart/form-data with field name "file".'
      );
    }

    const carDetails = parseCarDetails(req.body?.car_details);
    const parsed = parseServerCsv(req.file.buffer);
    const result = analyzeParsedLog(parsed, req.file.originalname, carDetails);

    return res.json({ success: true, data: result });
  } catch (err) {
    return sendError(res, 422, 'ANALYZE_FAILED', safeErrorMessage(err, 'Failed to analyze CSV log.'));
  }
}

export function methodGuard(req, res) {
  if (req.method === 'POST') return true;
  sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  return false;
}

// eslint-disable-next-line no-unused-vars
export function globalErrorHandler(err, _req, res, _next) {
  console.error('[API Error]', err?.message || err);
  sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error.');
}
