import React, { useState, useCallback, useMemo } from 'react';
import { MonitorPlay, UploadCloud, Search, Eye, EyeOff, FileText, RotateCcw, BarChart2, XCircle, Droplet } from 'lucide-react';
import { getSettings } from '../utils/storage';
import { parseViewerCsv } from '../utils/viewerCsv';
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
    <div className="bg-white dark:bg-surface-200 border border-gray-300 dark:border-white/10 rounded-lg p-3 shadow-xl text-xs min-w-[200px] backdrop-blur-md">
      {payload.map(entry => {
        const ch = entry.dataKey.replace(/_norm$/, '');
        const raw = entry.payload[`${ch}_raw`];
        if (raw === undefined) return null;
        return (
          <div key={ch} className="flex items-center gap-2 py-1">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.stroke, boxShadow: `0 0 6px ${entry.stroke}80` }} />
            <span className="text-gray-400 dark:text-gray-400 font-medium truncate flex-1 pr-4">{ch}</span>
            <span className="font-bold text-gray-900 dark:text-gray-100 shrink-0">{fmt(raw)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
const LogViewer = () => {
  const [fileData, setFileData] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [dragActive, setDragActive] = useState(false);
  const [search, setSearch] = useState('');
  const settings = getSettings();
  const maxPoints = DOWNSAMPLING_MAP[settings.downsampling] ?? 800;
  const lineWidth = LINE_WIDTH_MAP[settings.lineThickness] ?? 1.5;

  const processFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseViewerCsv(e.target.result);
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

      setFileData({ filename: file.name, rows: sampled, numericChannels, timeCol, stats, colors });
      setSelected(autoSel);
      setSearch('');
    };
    reader.readAsText(file);
  }, [maxPoints]);

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

  const filteredChannels = fileData
    ? fileData.numericChannels.filter(ch => ch.toLowerCase().includes(search.toLowerCase()))
    : [];

  // ── Upload view ──────────────────────────────────────────────────────────────
  if (!fileData) {
    return (
      <div className="space-y-6 animate-fade-in p-8 md:p-12 max-w-6xl mx-auto h-full">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <MonitorPlay className="text-brand-400" size={32} />
            Log Viewer
          </h1>
          <p className="text-gray-400 dark:text-gray-400 mt-2">
            Visualize any BM3 or MHD CSV datalog — every channel, fully interactive.
          </p>
        </header>

        <div
          className={`border-2 border-dashed rounded-xl h-[400px] flex flex-col items-center justify-center transition-all relative overflow-hidden group
            ${dragActive ? 'border-brand-500 bg-brand-500/5' : 'border-gray-300 dark:border-white/10 bg-white dark:bg-surface-200 hover:bg-surface-200/80 hover:border-gray-400 dark:hover:border-white/20'}`}
          onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

          <div className="w-20 h-20 rounded-full bg-gray-50 dark:bg-surface-300 border border-gray-200 dark:border-white/5 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
            <MonitorPlay size={40} className={dragActive ? 'text-brand-400' : 'text-gray-400 dark:text-gray-400'} />
          </div>
          <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">Drop a Datalog CSV</h3>
          <p className="text-gray-400 dark:text-gray-500 mt-2 text-center max-w-sm text-sm">
            All numeric channels are detected automatically. Toggle any combination to visualize them side-by-side.
          </p>

          <div className="mt-8 flex items-center gap-4 w-full max-w-xs px-8">
            <div className="h-px bg-gray-200 dark:bg-white/10 flex-1" />
            <span className="text-gray-400 dark:text-gray-500 text-xs font-semibold uppercase tracking-wider">or</span>
            <div className="h-px bg-gray-200 dark:bg-white/10 flex-1" />
          </div>

          <label className="mt-8 cursor-pointer bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-300 dark:border-white/10 hover:border-gray-400 dark:hover:border-white/20 text-gray-800 dark:text-gray-200 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all relative z-10 shadow-sm dark:shadow-none">
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
    <div className="flex flex-col h-full bg-white dark:bg-surface-200 overflow-hidden animate-fade-in">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-white/5 bg-gray-50/80 dark:bg-surface-300/50 shrink-0 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
            <MonitorPlay size={16} />
          </div>
          <div>
            <h1 className="text-gray-900 dark:text-gray-100 font-semibold text-sm leading-tight">Interactive Log Viewer</h1>
            <p className="text-gray-400 dark:text-gray-500 text-[11px] flex items-center gap-1.5 font-medium mt-0.5">
              <FileText size={10} />
              {filename} <span className="text-white/10 px-1">•</span> {rows.length} samples <span className="text-white/10 px-1">•</span> {numericChannels.length} channels
            </p>
          </div>
        </div>
        <button
          onClick={() => setFileData(null)}
          className="flex items-center gap-2 text-xs font-medium text-gray-400 dark:text-gray-400 hover:text-gray-100 bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/5 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-gray-300 dark:hover:border-white/10 px-3 py-1.5 rounded-md transition-all"
        >
          <RotateCcw size={12} />
          Close Log
        </button>
      </div>

      {/* Body: channel list + chart */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden">
        {/* ── Left: channel panel ── */}
        <div className="w-full md:w-64 h-1/3 md:h-auto shrink-0 flex flex-col bg-gray-50/50 dark:bg-surface-300/30 border-b md:border-b-0 md:border-r border-gray-200 dark:border-white/5 overflow-hidden">
          {/* Search */}
          <div className="p-3 border-b border-gray-200 dark:border-white/5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Search channels…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 focus:border-brand-500 rounded-md pl-8 pr-3 py-2 text-gray-800 dark:text-gray-200 text-xs font-medium outline-none transition-colors placeholder-gray-600 shadow-inner"
              />
            </div>
          </div>

          {/* Select all / none & Presets */}
          <div className="flex flex-col gap-2 px-3 py-2 border-b border-gray-200 dark:border-white/5 bg-gray-50/80 dark:bg-surface-300/50">
            <div className="flex gap-2">
              <button
                onClick={() => setSelected(new Set(numericChannels))}
                className="flex-1 text-[11px] font-semibold py-1.5 rounded border border-gray-300 dark:border-white/10 text-gray-400 dark:text-gray-400 hover:border-brand-500/50 hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
              >Select All</button>
              <button
                onClick={() => setSelected(new Set())}
                className="flex-1 text-[11px] font-semibold py-1.5 rounded border border-gray-300 dark:border-white/10 text-gray-400 dark:text-gray-400 hover:border-red-500/50 hover:text-red-400 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
              >Clear</button>
              <span className="text-[10px] font-bold text-gray-600 self-center shrink-0 w-10 text-right">{selected.size}/{numericChannels.length}</span>
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
                className="flex-1 text-[11px] font-semibold py-1.5 rounded border border-brand-500/30 text-brand-500 bg-brand-500/5 hover:bg-brand-500/10 hover:border-brand-500/60 transition-all flex items-center justify-center gap-1.5"
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
                className="flex-1 text-[11px] font-semibold py-1.5 rounded border border-blue-500/30 text-blue-500 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/60 transition-all flex items-center justify-center gap-1.5"
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
                      ? 'bg-gray-50 dark:bg-surface-300 border-gray-300 dark:border-white/10 shadow-sm dark:shadow-none'
                      : 'border-transparent hover:bg-gray-100 dark:hover:bg-white/5'
                    }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 transition-all ${active ? 'shadow-[0_0_6px_currentColor]' : 'opacity-40 group-hover:opacity-60'}`}
                      style={{ backgroundColor: colors[ch], color: colors[ch] }}
                    />
                    <span className={`text-[11px] truncate flex-1 font-semibold leading-tight ${active ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-300'}`}>{ch}</span>
                    {active
                      ? <Eye size={12} className="text-gray-400 dark:text-gray-400 shrink-0" />
                      : <EyeOff size={12} className="text-gray-600 shrink-0 opacity-0 group-hover:opacity-100" />
                    }
                  </div>
                  {s && active && (
                    <div className="mt-1.5 pl-4 flex gap-3">
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">min: <span className="text-gray-700 dark:text-gray-300">{fmt(s.min)}</span></span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 font-medium">max: <span className="text-gray-700 dark:text-gray-300">{fmt(s.max)}</span></span>
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
            <div className="flex-1 flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 relative z-10">
              <BarChart2 size={48} className="opacity-20 mb-4" />
              <p className="text-sm font-medium">Select channels from the left panel to plot them here.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 relative z-10">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />

                  <XAxis
                    dataKey="_t"
                    stroke="#52525B"
                    tick={{ fontSize: 10, fill: '#71717A' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => typeof v === 'number' ? v.toFixed(1) : v}
                    label={{
                      value: timeCol || 'Sample Index',
                      position: 'insideBottomRight',
                      offset: -10,
                      fill: '#52525B',
                      fontSize: 10,
                      fontWeight: 600,
                      textAnchor: 'end'
                    }}
                  />

                  <YAxis
                    stroke="#52525B"
                    tick={{ fontSize: 10, fill: '#71717A' }}
                    domain={[0, 100]}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={v => `${v}%`}
                    width={35}
                  />

                  <Tooltip
                    content={<CustomTooltip />}
                    cursor={{ stroke: '#52525B', strokeWidth: 1, strokeDasharray: '4 4' }}
                    isAnimationActive={false}
                  />

                  <Brush
                    dataKey="_t"
                    height={20}
                    stroke="#3F3F46"
                    fill="#18181B"
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
            <div className="shrink-0 pt-3 mt-2 border-t border-gray-200 dark:border-white/5 flex flex-wrap gap-x-2 gap-y-2 max-h-20 overflow-y-auto custom-scrollbar relative z-10">
              {[...selected].map(ch => (
                <button
                  key={ch}
                  onClick={() => toggleChannel(ch)}
                  title={`Remove ${ch}`}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:text-white bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-200 dark:border-white/5 hover:border-gray-300 dark:hover:border-white/10 px-2 py-1 rounded transition-colors group"
                >
                  <span className="inline-block w-2 h-2 rounded-full shrink-0 shadow-sm dark:shadow-none" style={{ backgroundColor: colors[ch] }} />
                  <span className="truncate max-w-[150px]">{ch}</span>
                  <XCircle size={10} className="text-gray-400 dark:text-gray-500 opacity-0 group-hover:opacity-100 ml-1 transition-opacity" />
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
