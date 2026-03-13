function parseRow(line) {
  const out = [];
  let cur = '';
  let inQ = false;

  for (const c of line) {
    if (c === '"') {
      inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += c;
    }
  }

  out.push(cur.trim());
  return out;
}

export function parseViewerCsv(text) {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(l => l.trim());

  if (lines.length < 2) return null;

  const headers = parseRow(lines[0]);
  if (headers.length < 2) return null;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseRow(lines[i]);
    if (vals.length === 0) continue;

    const row = {};
    headers.forEach((h, j) => {
      row[h] = vals[j] ?? '';
    });

    rows.push(row);
  }

  return { headers, rows };
}
