# Ethos85

Ethos85 is a React + Vite app (web + Capacitor iOS) with an Express API for ethanol blend calculations and BMW datalog analysis.

## Run locally

```bash
npm install
npm run dev:all
```

- Web UI: `http://localhost:5173`
- API: `http://localhost:3001`

## Architecture

### Shared business logic

- Blend math lives in `src/utils/blendMath.js`.
- Log analysis logic lives in `src/utils/logAnalyzer.js`.

### CSV parser runtime split (intentional)

- Browser parser: `src/utils/csvParser.js`
  - No Node dependencies.
  - Used by the web app and worker.
- Server parser: `server/utils/csvParser.js`
  - Uses `csv-parse/sync` for robust server-side parsing.
  - Used by API handlers before calling `analyzeParsedLog`.

Do not cross-import these parser modules across runtimes.

### API handlers

- Shared request handlers and validation are in `server/routeHandlers.js`.
- Reused by:
  - `server/index.js` (local API server)
  - `api/*.js` (Vercel/serverless entrypoints)

## Tests

```bash
npm test
```

Coverage currently focuses on core correctness for:
- `calculateBlend`
- `analyzeLog` / `analyzeParsedLog`
