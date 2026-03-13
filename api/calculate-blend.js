import express from 'express';
import cors from 'cors';
import { calculateBlendHandler, globalErrorHandler, methodGuard } from '../server/routeHandlers.js';

const app = express();
app.use(cors());
app.use(express.json());

app.all('/api/calculate-blend', (req, res) => {
  if (!methodGuard(req, res)) return;
  return calculateBlendHandler(req, res);
});

app.use(globalErrorHandler);

export default app;
