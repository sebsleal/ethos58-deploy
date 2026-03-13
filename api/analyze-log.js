import express from 'express';
import cors from 'cors';
import {
  uploadCsv,
  analyzeLogHandler,
  globalErrorHandler,
  methodGuard,
} from '../server/routeHandlers.js';

const app = express();
app.use(cors());

app.all('/api/analyze-log', uploadCsv.single('file'), (req, res) => {
  if (!methodGuard(req, res)) return;
  return analyzeLogHandler(req, res);
});

app.use(globalErrorHandler);

export default app;
