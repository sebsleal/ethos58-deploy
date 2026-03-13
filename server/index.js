/**
 * Ethos85 API Server
 *
 * POST /api/calculate-blend  – ethanol blend math
 * POST /api/analyze-log      – bootmod3 / MHD CSV datalog analysis
 * POST /api/telemetry       – batched client telemetry ingest
 */

import express from 'express';
import cors from 'cors';
import {
  uploadCsv,
  calculateBlendHandler,
  analyzeLogHandler,
  telemetryIngestHandler,
  globalErrorHandler,
} from './routeHandlers.js';

const app  = express();
const PORT = process.env.API_PORT || 3001;

// ─── Middleware ──────────────────────────────────────────────────────────────

// Open CORS for all origins — this is a local dev tool, not a public API.
// Restricting to localhost:5173 breaks access from phones/tablets on the same LAN.
app.use(cors());
app.use(express.json());

// ─── POST /api/calculate-blend ───────────────────────────────────────────────

app.post('/api/calculate-blend', calculateBlendHandler);

// ─── POST /api/analyze-log ───────────────────────────────────────────────────

app.post('/api/analyze-log', uploadCsv.single('file'), analyzeLogHandler);
app.post('/api/telemetry', telemetryIngestHandler);

// ─── Global error handler ────────────────────────────────────────────────────

app.use(globalErrorHandler);

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ethos85 API server running on http://0.0.0.0:${PORT}`);
});
