import { analyzeLog } from '../utils/logAnalyzer.js';

self.onmessage = (event) => {
  const { id, csvText, filename, carDetails } = event.data || {};

  try {
    const result = analyzeLog(csvText, filename, carDetails || {});
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || 'Failed to analyze log in worker.',
    });
  }
};
