import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { MonitorPlay, UploadCloud, Search, Eye, EyeOff, FileText, RotateCcw, BarChart2, XCircle, Droplet } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { getSettings } from '../utils/storage';
import { parseViewerCsv } from '../utils/viewerCsv';
import { PageHeader } from '../components/ui';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush,
} from 'recharts';

// ── Color palette (distinct, high-contrast, tuned for dark mode) ──────────────
const PALETTE = [
  '#14b8a6', '#f43f5e', '#3b82f6', '#f59e0b', '#8b5cf6',
  '#ec4899', '#10b981', '#f97316', '#06b6d4', '#6366f1',
  '#84cc16', '#d946ef', '#ef4444', '#eab308', '#22c55e',
];

function paletteColor(i) { return PALETTE[i % PALETTE.length]; }

// ── Helpers ───────────────────────────────────────────────────────────────────
const TIME_KEYWORDS = ['time', 'timestamp', 'elapsed', 'log time'];

function detectTimeColumn(headers) {
  return headers.find(h => TIME_KEYWORDS.some(kw => h.toLowerCase().includes(kw))) ?? null;
}

function detectNumericChannels(headers, rows) {
  const sample = rows.slice(0, 40);
  return headers.filter(h => {
    const nums = sample.map(r => parseFloat(r[h])).filter(v => !isNaN(v));
    return nums.length >= 5;
  });
}

function computeStats(channels, rows) {
  const raw = {};
  for (const ch of channels) {
    const vals = rows.map(r => parseFloat(r[ch])).filter(v => !isNaN(v));
    if (!vals.length) continue;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    raw[ch] = { min, max, avg };
  }

  const groups = {};
  for (const ch of channels) {
    if (!raw[ch]) continue;
    const m = ch.match(/\[([^\]]+)\]$/);
    if (!m) { groups[`__solo_${ch}`] = [ch]; continue; }
    const unit = m[1].toLowerCase();
    const absAvg = Math.abs(raw[ch].avg);
    const magKey = absAvg > 0 ? Math.floor(Math.log10(absAvg)) : -999;
    const key = `${unit}__${magKey}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(ch);
  }

  const stats = {};
  for (const chs of Object.values(groups)) {
    const gMins = chs.map(ch => raw[ch]?.min).filter(v => v != null);
    const gMaxs = chs.map(ch => raw[ch]?.max).filter(v => v != null);
    const gAvgs = chs.map(ch => raw[ch]?.avg).filter(v => v != null);
    if (!gMins.length) continue;

    const gMin = Math.min(...gMins);
    const gMax = Math.max(...gMaxs);
    const gAvg = gAvgs.reduce((a, b) => a + b, 0) / gAvgs.length;

    const range = gMax - gMin;
    const floor = Math.max(1, Math.abs(gAvg) * 0.10);
    const effRange = Math.max(range, floor);
    const center = (gMax + gMin) / 2;
    const normMin = center - effRange / 2;
    const normMax = center + effRange / 2;

    for (const ch of chs) {
      if (raw[ch]) stats[ch] = { ...raw[ch], normMin, normMax };
    }
  }
  return stats;
}

function downsample(rows, maxPts) {
  if (rows.length <= maxPts) return rows;
  const step = Math.ceil(rows.length / maxPts);
  return rows.filter((_, i) => i % step === 0);
}

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

const AUTO_KEYWORDS = ['rpm', 'load', 'afr', 'lambda', 'boost', 'iat', 'hpfp', 'timing correction', 'knock'];
const DOWNSAMPLING_MAP = {
  'Fast (800 pts)': 800,
  'High Quality (1600 pts)': 1600,
  'Original (All Data)': Number.POSITIVE_INFINITY,
};
const LINE_WIDTH_MAP = {
  'Thin (1px)': 1,
  'Normal (1.5px)': 1.5,
  'Thick (2px)': 2,
};

// ── Custom tooltip ────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="app-chart-tooltip min-w-[200px] p-3 text-xs">
      {payload.map(entry => {
        const ch = entry.dataKey.replace(/_norm$/, '');
        const raw = entry.payload[`${ch}_raw`];
        if (raw === undefined) return null;
        return (
          <div key={ch} className="flex items-center gap-2 py-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.stroke, boxShadow: `0 0 6px ${entry.stroke}80` }} />
            <span className="app-muted font-medium truncate flex-1 pr-4">{ch}</span>
            <span className="app-heading font-bold shrink-0">{fmt(raw)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const LogViewer = () => {
  const location = useLocation();
  const [fileData, setFileData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState('');
  const [settings] = useState(getSettings);
  const maxPoints = DOWNSAMPLING_MAP[settings.downsampling] ?? 800;
  const lineWidth = LINE_WIDTH_MAP[settings.lineThickness] ?? 1.5;

  const processCsvText = useCallback((csvText, filename = 'Imported Log.csv') => {
    const parsed = parseViewerCsv(csvText);
    if (!parsed) return;
    const { headers, rows } = parsed;
    const numericChannels = detectNumericChannels(headers, rows);
    const timeCol = detectTimeColumn(headers);
    const stats = computeStats(numericChannels, rows);
    const sampled = Number.isFinite(maxPoints) ? downsample(rows, maxPoints) : rows;

    const colors = {};
    numericChannels.forEach((ch, i) => { colors[ch] = paletteColor(i); });

    const autoSel = new Set(
      numericChannels
        .filter(ch => AUTO_KEYWORDS.some(kw => ch.toLowerCase().includes(kw)))
        .slice(0, 6)
    );
    if (autoSel.size === 0) numericChannels.slice(0, 4).forEach(ch => autoSel.add(ch));

    setFileData({ filename, rows: sampled, numericChannels, timeCol, stats, colors });
    setSelected(autoSel);
    setSearch('');
  }, [maxPoints]);

  const processFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      processCsvText(e.target.result, file.name);
    };
    reader.readAsText(file);
  }, [processCsvText]);

  useEffect(() => {
    if (location.state?.csvText) {
      processCsvText(location.state.csvText, location.state.filename || 'Garage Log.csv');
    }
  }, [location.state, processCsvText]);

  const handleDrag = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) processFile(e.dataTransfer.files[0]);
  };
  const handleFileChange = (e) => {
    if (e.target.files?.[0]) processFile(e.target.files[0]);
  };

  const toggleChannel = (ch) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(ch) ? next.delete(ch) : next.add(ch);
      return next;
    });
  };

  const chartData = useMemo(() => {
    if (!fileData) return [];
    const { rows, timeCol, stats } = fileData;
    return rows.map((row, i) => {
      const pt = { _t: timeCol ? (parseFloat(row[timeCol]) || i) : i };
      for (const ch of selected) {
        const v = parseFloat(row[ch]);
        if (!isNaN(v) && stats[ch]) {
          const { normMin, normMax } = stats[ch];
          pt[`${ch}_norm`] = ((v - normMin) / (normMax - normMin)) * 100;
          pt[`${ch}_raw`] = v;
        }
      }
      return pt;
    });
  }, [fileData, selected]);

  const filteredChannels = useMemo(() => (
    fileData
      ? fileData.numericChannels.filter(ch => ch.toLowerCase().includes(search.toLowerCase()))
      : []
  ), [fileData, search]);

  // ── Upload view ──────────────────────────────────────────────────────────────
  if (!fileData) {
    return (
      <div className="space-y-6 animate-fade-in p-8 md:p-12 max-w-6xl mx-auto h-full">
        <PageHeader
          eyebrow="Analysis"
          title="Log Viewer"
          description="Visualize any BM3 or MHD CSV datalog with a cleaner layered canvas, preserved theme support, and tighter chart framing."
        />

        <div
          className={`surface-card-strong border-2 border-dashed h-[400px] flex flex-col items-center justify-center transition-all relative overflow-hidden group
            ${dragActive ? 'border-brand-500 bg-brand-500/5' : 'border-gray-300 dark:border-white/10 hover:border-gray-400 dark:hover:border-white/20'}`}
          onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

          <div className="surface-inset mb-6 flex h-20 w-20 items-center justify-center rounded-full group-hover:scale-110 transition-transform duration-300">
            <MonitorPlay size={40} className={dragActive ? 'text-brand-400' : 'app-muted'} />
          </div>
          <h3 className="text-xl font-bold app-heading">Drop a Datalog CSV</h3>
          <p className="mt-2 max-w-sm text-center text-sm app-muted">
            All numeric channels are detected automatically. Toggle any combination to visualize them side-by-side.
          </p>

          <div className="mt-8 flex items-center gap-4 w-full max-w-xs px-8">
            <div className="app-divider h-px flex-1 border-t" />
            <span className="text-xs font-semibold uppercase tracking-wider app-muted">or</span>
            <div className="app-divider h-px flex-1 border-t" />
          </div>

          <label className="app-button-secondary relative z-10 mt-8 cursor-pointer px-6 py-2.5 text-sm font-semibold">
            Browse Files
            <input type="file" className="hidden" accept=".csv,text/csv,text/plain" onChange={handleFileChange} />
          </label>
        </div>
      </div>
    );
  }

  // ── Viewer view ──────────────────────────────────────────────────────────────
  const { numericChannels, stats, colors, filename, timeCol, rows } = fileData;

  return (
    <div className="surface-card-strong flex flex-col h-full overflow-hidden animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b app-divider bg-[var(--app-card-inset)]/80 shrink-0 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
            <MonitorPlay size={16} />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight app-heading">Interactive Log Viewer</h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium app-muted">
              <FileText size={10} />
              {filename} <span className="text-white/10 px-1">•</span> {rows.length} samples <span className="text-white/10 px-1">•</span> {numericChannels.length} channels
            </p>
          </div>
        </div>
        <button
          onClick={() => setFileData(null)}
          className="app-button-secondary flex items-center gap-2 px-3 py-1.5 text-xs font-medium"
        >
          <RotateCcw size={12} />
          Close Log
        </button>
      </div>

      {/* Body: channel list + chart */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        {/* ── Left: channel panel ── */}
        <div className="app-soft-panel h-1/3 w-full shrink-0 overflow-hidden rounded-none border-b md:h-auto md:w-64 md:border-b-0 md:border-r">
          {/* Search */}
          <div className="app-divider border-b p-3">
            <div className="relative">
              <Search size={14} className="app-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search channels…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="app-input w-full pl-8 pr-3 py-2 text-xs font-medium"
              />
            </div>
          </div>

          {/* Select all / none & Presets */}
          <div className="app-divider flex flex-col gap-2 border-b px-3 py-2">
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(numericChannels))}
                className="app-button-secondary flex-1 py-1.5 text-[11px] font-semibold"
              >Select All</button>
              <button
                onClick={() => setSelected(new Set())}
                className="app-button-danger flex-1 py-1.5 text-[11px] font-semibold"
              >Clear</button>
              <span className="app-muted self-center shrink-0 w-10 text-right text-[10px] font-bold">{selected.size}/{numericChannels.length}</span>
            </div>

            {/* Presets */}
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => {
                  const tunerKeywords = ['boost', 'hpfp', 'lambda act', 'afr', 'pedal'];
                  const exclusions = ['ram', 'deviation', 'lambda req'];
                  const tunerSel = new Set(
                    numericChannels.filter(ch => {
                      const lower = ch.toLowerCase();
                      const isGenericLambda = lower.startsWith('lambda[') || lower === 'lambda';
                      return tunerKeywords.some(kw => lower.includes(kw)) &&
                        !exclusions.some(ex => lower.includes(ex)) &&
                        !isGenericLambda;
                    })
                  );
                  setSelected(tunerSel);
                }}
                className="app-button-secondary flex flex-1 items-center justify-center gap-1.5 border-brand-500/30 bg-brand-500/5 py-1.5 text-[11px] font-semibold text-brand-500"
              >
                <BarChart2 size={12} />
                Tuner Preset
              </button>
              <button
                onClick={() => {
                  const fuelKeywords = ['hpfp', 'lpfp', 'injector', 'afr', 'lambda', 'pedal'];
                  const fuelSel = new Set(
                    numericChannels.filter(ch => fuelKeywords.some(kw => ch.toLowerCase().includes(kw)))
                  );
                  setSelected(fuelSel);
                }}
                className="app-button-secondary flex flex-1 items-center justify-center gap-1.5 border-blue-500/30 bg-blue-500/5 py-1.5 text-[11px] font-semibold text-blue-500"
              >
                <Droplet size={12} />
                Fueling
              </button>
            </div>
          </div>

          {/* Channel list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
            {filteredChannels.map(ch => {
              const active = selected.has(ch);
              const s = stats[ch];
              return (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  className={`w-full text-left px-2.5 py-2 rounded-md border transition-all group
                    ${active
                      ? 'app-soft-panel shadow-sm'
                      : 'border-transparent hover:bg-[var(--app-card-inset)]/70'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 transition-all ${active ? 'shadow-[0_0_6px_currentColor]' : 'opacity-40 group-hover:opacity-60'}`}
                      style={{ backgroundColor: colors[ch], color: colors[ch] }}
                    />
                    <span className={`text-[11px] truncate flex-1 font-semibold leading-tight ${active ? 'app-heading' : 'app-muted group-hover:text-[var(--app-heading)]'}`}>{ch}</span>
                    {active
                      ? <Eye size={12} className="app-muted shrink-0" />
                      : <EyeOff size={12} className="shrink-0 opacity-0 app-muted group-hover:opacity-100" />
                    }
                  </div>
                  {s && active && (
                    <div className="mt-1.5 pl-4 flex gap-3">
                      <span className="app-muted text-[10px] font-medium">min: <span className="app-heading">{fmt(s.min)}</span></span>
                      <span className="app-muted text-[10px] font-medium">max: <span className="app-heading">{fmt(s.max)}</span></span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: chart ── */}
        <div className="flex-1 flex flex-col min-w-0 p-4 overflow-hidden relative">
          <div className="absolute inset-0 bg-surface-300/10 pointer-events-none" />

          {selected.size === 0 ? (
            <div className="app-muted relative z-10 flex flex-1 flex-col items-center justify-center">
              <BarChart2 size={48} className="opacity-20 mb-4" />
              <p className="text-sm font-medium">Select channels from the left panel to plot them here.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" vertical={false} />

                  <XAxis
                    dataKey="_t"
                    stroke="var(--app-chart-axis)"
                    tick={{ fontSize: 10, fill: 'var(--app-chart-axis-muted)' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => typeof v === 'number' ? v.toFixed(1) : v}
                    label={{
                      value: timeCol || 'Sample Index',
                      position: 'insideBottomRight',
                      offset: -10,
                      fill: 'var(--app-chart-axis)',
                      fontSize: 10,
                      fontWeight: 600,
                      textAnchor: 'end'
                    }}
                  />

                  <YAxis
                    stroke="var(--app-chart-axis)"
                    tick={{ fontSize: 10, fill: 'var(--app-chart-axis-muted)' }}
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v}%`}
                    width={35}
                  />

                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ stroke: 'var(--app-chart-axis)', strokeWidth: 1, strokeDasharray: '4 4' }}
                    isAnimationActive={false}
                  />

                  <Brush
                    dataKey="_t"
                    height={20}
                    stroke="var(--app-chart-brush-stroke)"
                    fill="var(--app-chart-brush-fill)"
                    travellerWidth={6}
                    tickFormatter={v => typeof v === 'number' ? v.toFixed(1) : ''}
                    className="opacity-70 hover:opacity-100 transition-opacity"
                  />

                  {[...selected].map(ch => (
                    <Line
                      key={ch}
                      type="monotone"
                      dataKey={`${ch}_norm`}
                      stroke={colors[ch]}
                      strokeWidth={lineWidth}
                      dot={false}
                      isAnimationActive={false}
                      connectNulls={false}
                      name={ch}
                      activeDot={{ r: 4, strokeWidth: 0 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Bottom legend / Active Channels */}
          {selected.size > 0 && (
            <div className="app-divider relative z-10 mt-2 flex max-h-20 shrink-0 flex-wrap gap-x-2 gap-y-2 overflow-y-auto border-t pt-3 custom-scrollbar">
              {[...selected].map(ch => (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  title={`Remove ${ch}`}
                  className="app-button-secondary group flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium"
                >
                  <span className="inline-block w-2 h-2 rounded-full shrink-0 shadow-sm dark:shadow-none" style={{ backgroundColor: colors[ch] }} />
                  <span className="truncate max-w-[150px]">{ch}</span>
                  <XCircle size={10} className="app-muted ml-1 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LogViewer;
