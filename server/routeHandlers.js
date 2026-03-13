import multer from 'multer';
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
