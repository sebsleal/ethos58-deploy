import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  ArrowUpCircle,
  ArrowUpDown,
  ArrowUpRight,
  CalendarDays,
  Calculator as CalculatorIcon,
  Car,
  ChevronDown,
  Circle,
  FileJson,
  FileSpreadsheet,
  FileUp,
  FolderArchive,
  LayoutDashboard,
  ListFilter,
  Menu,
  X,
  MonitorPlay,
  Pencil,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { analyzeLog } from '../utils/logAnalyzer';
import {
  calculateBlend,
  calculateResultingOctane,
  calibratePumpEthanol,
  estimateBlendFillCost,
  planEthanolOverTanks,
  reverseCalculateBlend,
} from '../utils/blendMath';
import { mergeCompareChartData } from '../utils/logCompare';
import {
  deleteBlendProfile,
  clearGarageLogs,
  clearRecentLogs,
  deleteGarageLog,
  deleteStationPreset,
  exportGarageBackup,
  exportGarageSummaryCsv,
  getActiveBlend,
  getBlendProfiles,
  getGarageLogs,
  getLogResult,
  getRecentLogs,
  getSettings,
  getStationPresets,
  importGarageBackup,
  saveActiveBlend,
  saveBlendProfile,
  saveGarageLog,
  saveRecentLog,
  saveSetting,
  saveStationPreset,
  updateGarageLogMeta,
  getCarProfiles,
  saveCarProfile,
  deleteCarProfile,
  getActiveCar,
  setActiveCar,
  setPendingBlend,
  getBlendHistory,
  saveBlendHistory,
  clearBlendHistory,
} from '../utils/storage';
import { parseViewerCsv } from '../utils/viewerCsv';
import { useToast } from '../components/ui';

const containerVariants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.3,
      ease: 'easeOut',
    },
  },
};

const VIEWER_COLORS = [
  '#9a958e',
  '#8f7d63',
  '#22a96e',
  '#c97f22',
  '#e0513a',
  '#7a746b',
  '#c6a75a',
  '#5c8577',
];

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

const TIME_KEYWORDS = ['time', 'timestamp', 'elapsed', 'log time'];
const AUTO_KEYWORDS = ['rpm', 'load', 'afr', 'lambda', 'boost', 'iat', 'hpfp', 'timing', 'knock'];
const LITERS_PER_GALLON = 3.78541;

const analyzerDefaults = {
  ethanol: '',
  engine: '',
  tuneStage: '',
};

const engineOptions = ['B58 Gen1', 'B58 Gen2', 'S58', 'N55', 'N54', 'Other'];
const tuneOptions = ['Stage 1', 'Stage 2', 'Stage 2+', 'Custom E-tune'];

// updateCarProfile helper (local wrapper for Dashboard use)
function updateCarProfile(id, updates) {
  saveCarProfile({ ...getCarProfiles().find((p) => p.id === id), ...updates });
}

function loadSnapshot() {
  return {
    recentLogs: getRecentLogs(),
    garageLogs: getGarageLogs(),
    activeBlend: getActiveBlend(),
    settings: getSettings(),
    profiles: getBlendProfiles(),
    stationPresets: getStationPresets(),
    carProfiles: getCarProfiles(),
    activeCarId: getActiveCar(),
  };
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}

function toDisplayVolume(gallons, units) {
  if (gallons === '' || gallons === null || gallons === undefined || Number.isNaN(Number(gallons))) return '';
  return units === 'Metric' ? roundTo(Number(gallons) * LITERS_PER_GALLON, 2) : roundTo(Number(gallons), 2);
}

function fromDisplayVolume(value, units) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return '';
  return units === 'Metric' ? parsed / LITERS_PER_GALLON : parsed;
}

function formatVolume(gallons, units) {
  const value = toDisplayVolume(gallons, units);
  return `${value} ${units === 'Metric' ? 'L' : 'gal'}`;
}

function formatDate(value) {
  if (!value) return 'No date';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return 'No timestamp';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatMetric(value, suffix = '', decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return `${Number(value).toFixed(decimals)}${suffix}`;
}

function statusTone(status) {
  if (status === 'Risk') return 'danger';
  if (status === 'Caution') return 'warn';
  return 'success';
}

function statusLabel(status) {
  return status || 'Safe';
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });
}

function paletteColor(index) {
  return VIEWER_COLORS[index % VIEWER_COLORS.length];
}

function detectTimeColumn(headers) {
  return headers.find((header) => TIME_KEYWORDS.some((keyword) => header.toLowerCase().includes(keyword))) ?? null;
}

function detectNumericChannels(headers, rows) {
  const sample = rows.slice(0, 40);
  return headers.filter((header) => {
    const values = sample.map((row) => parseFloat(row[header])).filter((value) => !Number.isNaN(value));
    return values.length >= 5;
  });
}

function computeViewerStats(channels, rows) {
  const raw = {};
  channels.forEach((channel) => {
    const values = rows.map((row) => parseFloat(row[channel])).filter((value) => !Number.isNaN(value));
    if (!values.length) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    raw[channel] = { min, max, avg };
  });

  const groups = {};
  channels.forEach((channel) => {
    if (!raw[channel]) return;
    const match = channel.match(/\[([^\]]+)\]$/);
    if (!match) {
      groups[`solo_${channel}`] = [channel];
      return;
    }
    const unit = match[1].toLowerCase();
    const absAvg = Math.abs(raw[channel].avg);
    const magnitude = absAvg > 0 ? Math.floor(Math.log10(absAvg)) : -999;
    const key = `${unit}_${magnitude}`;
    groups[key] = [...(groups[key] || []), channel];
  });

  const stats = {};
  Object.values(groups).forEach((group) => {
    const mins = group.map((channel) => raw[channel]?.min).filter((value) => value !== undefined);
    const maxs = group.map((channel) => raw[channel]?.max).filter((value) => value !== undefined);
    const avgs = group.map((channel) => raw[channel]?.avg).filter((value) => value !== undefined);
    if (!mins.length || !maxs.length || !avgs.length) return;

    const globalMin = Math.min(...mins);
    const globalMax = Math.max(...maxs);
    const globalAvg = avgs.reduce((sum, value) => sum + value, 0) / avgs.length;
    const range = globalMax - globalMin;
    const floor = Math.max(1, Math.abs(globalAvg) * 0.1);
    const effectiveRange = Math.max(range, floor);
    const center = (globalMax + globalMin) / 2;
    const normMin = center - effectiveRange / 2;
    const normMax = center + effectiveRange / 2;

    group.forEach((channel) => {
      stats[channel] = { ...raw[channel], normMin, normMax };
    });
  });

  return stats;
}

function downsampleRows(rows, maxPoints) {
  if (!Number.isFinite(maxPoints) || rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, index) => index % step === 0);
}

function buildViewerPayload(csvText, filename, settings) {
  const parsed = parseViewerCsv(csvText);
  if (!parsed) {
    throw new Error('The viewer could not parse that CSV file.');
  }

  const { headers, rows } = parsed;
  const numericChannels = detectNumericChannels(headers, rows);
  const timeCol = detectTimeColumn(headers);
  const maxPoints = DOWNSAMPLING_MAP[settings.downsampling] ?? 1600;
  const sampledRows = downsampleRows(rows, maxPoints);
  const stats = computeViewerStats(numericChannels, rows);
  const colors = {};
  numericChannels.forEach((channel, index) => {
    colors[channel] = paletteColor(index);
  });

  const autoSelected = numericChannels
    .filter((channel) => AUTO_KEYWORDS.some((keyword) => channel.toLowerCase().includes(keyword)))
    .slice(0, 6);

  return {
    csvText,
    filename,
    rows: sampledRows,
    numericChannels,
    timeCol,
    stats,
    colors,
    autoSelected: autoSelected.length ? autoSelected : numericChannels.slice(0, 4),
  };
}

function buildSessionBars(recentLogs) {
  const today = new Date();
  const dayEntries = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));
    return {
      key: date.toISOString().slice(0, 10),
      day: date.toLocaleDateString(undefined, { weekday: 'short' }),
      count: 0,
    };
  });

  recentLogs.forEach((log) => {
    const key = new Date(log.date || log.createdAt || Date.now()).toISOString().slice(0, 10);
    const target = dayEntries.find((entry) => entry.key === key);
    if (target) target.count += 1;
  });

  const maxCount = Math.max(...dayEntries.map((entry) => entry.count), 1);
  return dayEntries.map((entry) => ({
    day: entry.day,
    value: 12 + Math.round((entry.count / maxCount) * 31),
    rawCount: entry.count,
    active: entry.count === maxCount && maxCount > 0,
  }));
}

function useCountUp(target, duration = 900) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frameId = 0;
    let startTime = null;

    const tick = (time) => {
      if (startTime === null) startTime = time;
      const progress = Math.min((time - startTime) / duration, 1);
      setValue(Math.round(target * progress));
      if (progress < 1) frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frameId);
  }, [duration, target]);

  return value;
}

function EmptyState({ icon: Icon, title, body, actionLabel, onAction }) {
  return (
    <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-6 py-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-dark-muted)]">
        <Icon size={18} strokeWidth={1.8} />
      </div>
      <h3 className="mt-4 text-[14px] font-medium text-[var(--text-primary)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-[1.6] text-[var(--text-secondary)]">{body}</p>
      {actionLabel ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-page)]"
        >
          {actionLabel}
          <ArrowRight size={12} strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  );
}

function CardBadge({ label, tone }) {
  const toneClasses = {
    success: 'bg-[var(--success-bg)] text-[var(--success-text)]',
    warn: 'bg-[var(--warn-bg)] text-[var(--warn-text)]',
    danger: 'bg-[rgba(224,81,58,0.12)] text-[var(--danger-text)]',
  };

  return (
    <span className={`rounded-[4px] px-[7px] py-[2px] font-mono text-[10px] ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

function StatCard({ label, value, detail, warn }) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-[14px]">
      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <p className="text-[24px] font-light tracking-[-0.04em] text-[var(--text-primary)]">{value}</p>
        {warn ? <AlertCircle size={14} strokeWidth={1.8} className="shrink-0 text-[var(--danger-text)] opacity-60" /> : null}
      </div>
      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{detail}</p>
    </div>
  );
}

function SurfaceSection({ title, subtitle, action, children }) {
  return (
    <section className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-[14px]">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-[var(--text-primary)]">{title}</h2>
          {subtitle ? <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function FieldShell({ label, children, hint }) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{hint}</span> : null}
    </label>
  );
}

function StudioInput(props) {
  return (
    <input
      {...props}
      className={`mt-2 w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${props.className || ''}`}
    />
  );
}

function StudioTextarea(props) {
  return (
    <textarea
      {...props}
      className={`mt-2 w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-[12px] leading-[1.6] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] ${props.className || ''}`}
    />
  );
}

function StudioSelect({ children, className = '', ...props }) {
  return (
    <div className="relative mt-2">
      <select
        {...props}
        className={`w-full appearance-none rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 pr-9 text-[12px] text-[var(--text-primary)] outline-none ${className}`}
      >
        {children}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
    </div>
  );
}

function StatusBadge({ status }) {
  return <CardBadge label={statusLabel(status)} tone={statusTone(status)} />;
}

function StandardCard({ card }) {
  const content = (
    <>
      <h3 className="mb-[5px] truncate text-[12px] font-medium text-[var(--text-primary)]">{card.title}</h3>
      <p
        className="mb-3 overflow-hidden text-[11px] leading-[1.55] text-[var(--text-secondary)]"
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 1,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {card.body}
      </p>

      {card.badges?.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {card.badges.map((badge) => (
            <CardBadge key={`${card.title}_${badge.label}`} label={badge.label} tone={badge.tone} />
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={11} strokeWidth={1.8} />
          <span>{card.date}</span>
        </div>
        <div className="flex items-center gap-1">
          <ArrowUpRight size={11} strokeWidth={1.8} />
          <span>{card.counters.primary}</span>
        </div>
      </div>
    </>
  );

  return (
    <motion.article
      variants={itemVariants}
      whileHover={{ y: -2, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
      transition={{ duration: 0.15 }}
      className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-[14px]"
    >
      {card.onClick ? (
        <button type="button" onClick={card.onClick} className="block w-full text-left">
          {content}
        </button>
      ) : (
        content
      )}
    </motion.article>
  );
}

const CHANGE_TYPE = {
  new:      { label: 'New',      cls: 'bg-[var(--selection)] text-[var(--text-primary)]' },
  improved: { label: 'Improved', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
  fixed:    { label: 'Fixed',    cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
};
const PLATFORM_TYPE = {
  web:  { label: 'Web',     cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  ios:  { label: 'iOS',     cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  both: { label: 'Web+iOS', cls: 'bg-[var(--border)] text-[var(--text-muted)]' },
};

function UpdateLogWorkspace({ searchQuery }) {
  const [entries, setEntries] = useState([]);
  const [platformFilter, setPlatformFilter] = useState('all');
  const deferredSearch = useDeferredValue(searchQuery);

  useEffect(() => {
    fetch('/CHANGELOG.json')
      .then(r => r.json())
      .then(data => setEntries(data))
      .catch(() => {});
  }, []);

  const filtered = entries
    .map(entry => {
      const changes = (entry.changes || []).filter(c => {
        const platform = c.platform || 'both';
        const platformOk =
          platformFilter === 'all' ? true :
          platformFilter === 'web' ? platform === 'web' :
          platform === 'ios';
        const searchOk = !deferredSearch || c.text.toLowerCase().includes(deferredSearch.toLowerCase()) ||
          entry.title.toLowerCase().includes(deferredSearch.toLowerCase());
        return platformOk && searchOk;
      });
      return { ...entry, changes };
    })
    .filter(e => e.changes.length > 0);

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-[var(--text-primary)]">Update log</h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">Every release, what changed, and where.</p>
          </div>
          {entries[0] && (
            <span className="shrink-0 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 font-mono text-[11px] text-[var(--text-muted)]">
              v{entries[0].version}
            </span>
          )}
        </div>

        {/* Platform filter */}
        <div className="flex gap-2">
          {['all', 'web', 'ios'].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setPlatformFilter(f)}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] capitalize transition-colors ${
                platformFilter === f
                  ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-page)]'
                  : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--text-secondary)]'
              }`}
            >
              {f === 'all' ? 'All platforms' : f === 'ios' ? 'iOS' : 'Web'}
            </button>
          ))}
        </div>

        {/* Entries */}
        {filtered.length === 0 && (
          <div className="py-16 text-center text-[13px] text-[var(--text-muted)]">No entries match this filter.</div>
        )}
        {filtered.map((entry, idx) => (
          <div key={entry.version} className="rounded-[12px] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
              {idx === 0
                ? <Zap size={13} strokeWidth={1.8} className="shrink-0 text-[var(--text-primary)]" />
                : <ArrowUpCircle size={13} strokeWidth={1.8} className="shrink-0 text-[var(--text-muted)]" />}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-[var(--text-primary)] truncate">{entry.title}</p>
                <p className="font-mono text-[10px] text-[var(--text-muted)]">v{entry.version}</p>
              </div>
              <span className="shrink-0 font-mono text-[11px] text-[var(--text-muted)]">{entry.date}</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {entry.changes.map((c, i) => {
                const type = CHANGE_TYPE[c.type] || CHANGE_TYPE.new;
                const platform = PLATFORM_TYPE[c.platform || 'both'] || PLATFORM_TYPE.both;
                return (
                  <li key={i} className="flex items-start gap-3 px-5 py-3">
                    <span className={`mt-0.5 shrink-0 rounded px-[6px] py-[2px] font-mono text-[9px] font-semibold uppercase ${type.cls}`}>
                      {type.label}
                    </span>
                    <span className="flex-1 text-[12px] leading-[1.6] text-[var(--text-secondary)]">{c.text}</span>
                    <span className={`mt-0.5 shrink-0 rounded px-[6px] py-[2px] font-mono text-[9px] font-semibold uppercase ${platform.cls}`}>
                      {platform.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function FlaggedCard({ card }) {
  return (
    <motion.article
      variants={itemVariants}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-[14px]"
    >
      <button type="button" onClick={card.onClick} className="block w-full text-left">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[12px] font-medium text-[var(--text-primary)]">{card.title}</h3>
            <p className="mt-1 text-[11px] leading-[1.55] text-[var(--text-secondary)]">{card.body}</p>
          </div>
          <AlertCircle size={14} className="shrink-0 text-[var(--danger-text)]" strokeWidth={1.8} />
        </div>

        <div className="rounded-[7px] bg-[var(--bg-muted)] px-3 py-[10px] font-mono text-[11px] leading-[1.7]">
          {card.codeRows.map((row) => (
            <div key={row.label} className="flex justify-between">
              <span className="text-[var(--text-muted)]">{row.label}</span>
              <span className={row.valueClass}>{row.value}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-[var(--text-muted)]">
          <span>{card.date}</span>
          <span>{card.footer}</span>
        </div>
      </button>
    </motion.article>
  );
}

function NavContent({ navGroups, activeView, onSelect, setMobileOpen, initials, displayName, layoutPrefix, animated = true }) {
  return (
    <>
      <div className="space-y-5">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">{group.label}</p>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { onSelect(item.id); setMobileOpen(false); }}
                    className={`relative flex w-full items-center gap-3 overflow-hidden rounded-[8px] px-[10px] py-[7px] text-left transition-colors ${
                      isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-muted)]'
                    }`}
                  >
                    {isActive ? (
                      animated ? (
                        <motion.div
                          layoutId={`active-nav-pill-${layoutPrefix}`}
                          className="absolute inset-0 rounded-[8px] bg-[var(--bg-page)]"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                        />
                      ) : (
                        <div className="absolute inset-0 rounded-[8px] bg-[var(--bg-page)]" />
                      )
                    ) : null}
                    <div className="relative z-10 flex flex-1 items-center gap-3">
                      <Icon size={14} strokeWidth={1.8} />
                      <span className={`text-[13px] ${isActive ? 'font-medium' : 'font-normal'}`}>{item.name}</span>
                    </div>
                    {item.badge ? (
                      <span className="relative z-10 rounded-full bg-[var(--text-primary)] px-[6px] py-[1px] font-mono text-[10px] text-[var(--bg-page)]">
                        {item.badge}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto border-t border-[var(--border)] pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--border)] font-mono text-[10px] text-[var(--text-dark-muted)]">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-[var(--text-primary)]">{displayName}</p>
            <p className="truncate font-mono text-[10px] text-[var(--text-muted)]">studio operator</p>
          </div>
        </div>
      </div>
    </>
  );
}

function Sidebar({ activeView, onSelect, snapshot }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const riskCount = snapshot.recentLogs.filter((log) => log.status === 'Risk').length;
  const displayName = snapshot.settings.displayName || 'B58 Enthusiast';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'B5';
  const garageCount = snapshot.garageLogs.length;
  const navGroups = [
    {
      label: 'Studio',
      items: [
        { id: 'dashboard', name: 'Dashboard', icon: LayoutDashboard },
        { id: 'analyzer', name: 'Log analyzer', icon: Activity, badge: riskCount ? String(riskCount) : null },
        { id: 'viewer', name: 'Log viewer', icon: MonitorPlay },
      ],
    },
    {
      label: 'Signals',
      items: [
        { id: 'calculator', name: 'Blend lab', icon: CalculatorIcon },
        { id: 'compare', name: 'Compare logs', icon: ArrowUpDown },
        { id: 'garage', name: 'Garage', icon: Car },
        { id: 'archive', name: 'Archive', icon: FolderArchive, badge: garageCount ? String(garageCount) : null },
        { id: 'updates', name: 'Update log', icon: Sparkles },
        { id: 'settings', name: 'Settings', icon: Settings2 },
      ],
    },
  ];

  return (
    <aside className="relative flex w-full shrink-0 flex-col border-b border-[var(--border)] bg-[var(--bg-surface)] md:h-screen md:w-[200px] md:border-b-0 md:border-r">
      <div
        className="flex items-center justify-between border-b border-[var(--border)] px-[18px] pb-[22px]"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 22px)' }}
      >
        <button
          type="button"
          onClick={() => setMobileOpen((prev) => !prev)}
          className="flex items-center justify-center rounded-[6px] p-1 text-[var(--text-muted)] hover:bg-[var(--bg-muted)] md:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
        >
          <span style={{ display: 'grid', placeItems: 'center' }}>
            <Menu size={16} strokeWidth={1.8} style={{ gridArea: '1/1', transition: 'opacity 0.15s ease, transform 0.15s ease', opacity: mobileOpen ? 0 : 1, transform: mobileOpen ? 'rotate(45deg) scale(0.7)' : 'none' }} />
            <X    size={16} strokeWidth={1.8} style={{ gridArea: '1/1', transition: 'opacity 0.15s ease, transform 0.15s ease', opacity: mobileOpen ? 1 : 0, transform: mobileOpen ? 'none' : 'rotate(-45deg) scale(0.7)' }} />
          </span>
        </button>
        <div className="flex items-center text-[var(--text-primary)]">
          {/* E mark — viewBox cropped tight to glyph so it kerned like a real letter */}
          <svg height="14" viewBox="53 41 99 118" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style={{ display: 'block', position: 'relative', top: '-1px' }}>
            <g fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="square" strokeLinejoin="miter">
              <line x1="64" y1="52" x2="140" y2="52"/>
              <line x1="64" y1="148" x2="140" y2="148"/>
              <line x1="64" y1="52" x2="64" y2="148"/>
            </g>
            <path d="M64 100 L80 100 C86 100 88 84 100 84 C112 84 114 116 120 116 C126 116 128 100 134 100 L140 100"
              fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="butt" strokeLinejoin="round"/>
          </svg>
          <p className="text-[15px] font-medium tracking-[-0.02em]">thos</p>
        </div>
      </div>

      {/* Desktop nav — always visible */}
      <div className="hidden flex-1 flex-col px-[18px] py-4 md:flex">
        <NavContent navGroups={navGroups} activeView={activeView} onSelect={onSelect} setMobileOpen={setMobileOpen} initials={initials} displayName={displayName} layoutPrefix="desktop" />
      </div>

      {/* Mobile nav — absolute so it overlays content (no layout shift), scaleY+opacity GPU-composited */}
      <div
        className="md:hidden absolute left-0 right-0 z-50 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-surface)]"
        style={{
          top: '100%',
          transform: mobileOpen ? 'scaleY(1)' : 'scaleY(0)',
          transformOrigin: 'top',
          opacity: mobileOpen ? 1 : 0,
          pointerEvents: mobileOpen ? 'auto' : 'none',
          transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.18s ease',
          willChange: 'transform, opacity',
        }}
      >
        <div className="px-[18px] py-4">
          <NavContent navGroups={navGroups} activeView={activeView} onSelect={onSelect} setMobileOpen={setMobileOpen} initials={initials} displayName={displayName} layoutPrefix="mobile" animated={false} />
        </div>
      </div>
    </aside>
  );
}

function Topbar({ activeView, searchQuery, onSearchChange, filterActive, onToggleFilter, onUpload }) {
  const placeholders = {
    dashboard: 'Search logs, sessions, and saved fuel work',
    analyzer: 'Search diagnostics, notes, and metrics',
    viewer: 'Search telemetry channels',
    calculator: 'Search blend profiles and stations',
    garage: 'Search filenames, tags, and notes',
    settings: 'Search preferences and profile fields',
  };

  return (
    <motion.div
      variants={itemVariants}
      className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-3 md:h-[52px] md:flex-row md:items-center md:justify-between md:gap-4"
    >
      <label className="flex flex-1 items-center gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-[7px]">
        <Search size={13} className="text-[var(--text-muted)]" strokeWidth={1.8} />
        <input
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={placeholders[activeView]}
          className="w-full border-0 bg-transparent p-0 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleFilter}
          className={`inline-flex items-center gap-2 rounded-[8px] border px-3 py-[7px] text-[12px] transition-colors ${
            filterActive
              ? 'border-[var(--text-primary)] bg-[var(--bg-page)] text-[var(--text-primary)]'
              : 'border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-dark-muted)] hover:bg-[var(--bg-muted)]'
          }`}
        >
          <ListFilter size={12} strokeWidth={1.8} />
          Filter
        </button>

        <motion.button
          type="button"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={onUpload}
          className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-[14px] py-[7px] text-[12px] font-medium text-[var(--bg-page)] shadow-[0_10px_24px_var(--selection)]"
        >
          <Upload size={12} strokeWidth={1.8} />
          Upload Log
        </motion.button>
      </div>
    </motion.div>
  );
}

function PullSessionsChart({ bars }) {
  return (
    <div className="flex h-full flex-col">
      <p className="mb-3 text-[12px] font-medium text-[var(--text-primary)]">Pull sessions</p>
      <div className="flex h-11 items-end gap-[5px]">
        {bars.map((bar, index) => (
          <motion.div
            key={bar.day}
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            style={{
              transformOrigin: 'bottom',
              height: `${bar.value}px`,
              backgroundColor: bar.active ? 'var(--text-primary)' : 'var(--border)',
            }}
            transition={{ delay: index * 0.05, duration: 0.4, ease: 'easeOut' }}
            className="flex-1 rounded-t-[3px]"
          />
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-[5px]">
        {bars.map((bar) => (
          <span key={bar.day} className="text-center font-mono text-[10px] text-[var(--text-muted)]">
            {bar.day}
          </span>
        ))}
      </div>
    </div>
  );
}

function healthBarClass(score) {
  if (score === null || score === undefined) return 'health-bar-empty';
  if (score >= 75) return 'health-bar-safe';
  if (score >= 50) return 'health-bar-caution';
  return 'health-bar-risk';
}

function HealthTrendChart({ recentLogs }) {
  // Build up to 14 bars from recent logs (most recent on right)
  const bars = [...recentLogs].reverse().slice(0, 14).map((log) => ({
    score: Number.isFinite(Number(log.healthScore)) ? Number(log.healthScore) : null,
    filename: log.filename,
    date: log.date,
  }));

  // Pad to 14
  while (bars.length < 14) bars.unshift({ score: null, filename: null, date: null });

  const avgScore = bars.filter((b) => b.score !== null).reduce((s, b, _, a) => s + b.score / a.length, 0) || 0;
  const visibleBars = bars.filter((b) => b.score !== null);
  const trend = visibleBars.length >= 2
    ? visibleBars[visibleBars.length - 1].score - visibleBars[0].score
    : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[12px] font-medium text-[var(--text-primary)]">Health trend</p>
        <span className={`font-mono text-[10px] ${trend > 0 ? 'text-[var(--success-text)]' : trend < 0 ? 'text-[var(--danger-text)]' : 'text-[var(--text-muted)]'}`}>
          {trend > 0 ? `+${trend.toFixed(0)}` : trend < 0 ? trend.toFixed(0) : '—'} pts
        </span>
      </div>
      <div className="flex h-10 items-end gap-[3px] flex-1">
        {bars.map((bar, i) => (
          <div
            key={i}
            title={bar.score !== null ? `${bar.filename ?? ''}: ${bar.score}%` : ''}
            className={`flex-1 rounded-t-[2px] transition-none ${healthBarClass(bar.score)}`}
            style={{ height: bar.score !== null ? `${Math.max(10, bar.score)}%` : '12%', opacity: bar.score !== null ? 1 : 0.25 }}
          />
        ))}
      </div>
      <p className="mt-2 font-mono text-[10px] text-[var(--text-muted)]">avg {avgScore.toFixed(0)}% · last {visibleBars.length} logs</p>
    </div>
  );
}

function NumericStat({ label, target, detail }) {
  const value = useCountUp(target);
  return (
    <div className="flex h-full flex-col justify-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-[30px] font-light tracking-[-0.04em] text-[var(--text-primary)]">{value}</p>
      <div className="mt-2 flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
        <ArrowUpRight size={11} strokeWidth={1.8} />
        <span>{detail}</span>
      </div>
    </div>
  );
}

function StatsStrip({ snapshot }) {
  const flaggedCount = snapshot.recentLogs.filter((log) => log.status !== 'Safe').length;
  const garageCount = snapshot.garageLogs.length;
  const bars = buildSessionBars(snapshot.recentLogs);

  return (
    <motion.div
      variants={itemVariants}
      className="grid border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-5 md:h-[100px] md:grid-cols-4"
    >
      <div className="border-b border-[var(--border)] pb-5 md:border-b-0 md:border-r md:pb-0 md:pr-6">
        <PullSessionsChart bars={bars} />
      </div>
      <div className="border-b border-[var(--border)] py-5 md:border-b-0 md:border-r md:px-6 md:py-0">
        <HealthTrendChart recentLogs={snapshot.recentLogs} />
      </div>
      <div className="border-b border-[var(--border)] py-5 md:border-b-0 md:border-r md:px-6 md:py-0">
        <NumericStat label="Flagged pulls" target={flaggedCount} detail={`${snapshot.recentLogs.length} recent sessions tracked`} />
      </div>
      <div className="pt-5 md:pl-6 md:pt-0">
        <NumericStat label="Garage logs" target={garageCount} detail={`${Object.keys(snapshot.profiles).length} saved fuel profiles`} />
      </div>
    </motion.div>
  );
}

function KanbanColumn({ column, emptyState }) {
  return (
    <motion.section variants={itemVariants}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium text-[var(--text-primary)]">{column.title}</h2>
        <div className="inline-flex items-center gap-1 rounded-[6px] border border-[var(--border)] bg-[var(--bg-surface)] px-[8px] py-[3px] font-mono text-[10px] text-[var(--text-secondary)]">
          <ArrowUpDown size={10} strokeWidth={1.8} />
          {column.count}
        </div>
      </div>

      <motion.div variants={containerVariants} className="space-y-[10px]">
        {column.cards.length ? column.cards.map((card) => (
          card.kind === 'dark' ? <FlaggedCard key={card.title} card={card} /> : <StandardCard key={card.title} card={card} />
        )) : emptyState ? (
          <EmptyState icon={emptyState.icon} title={emptyState.title} body={emptyState.body} actionLabel={emptyState.actionLabel} onAction={emptyState.onAction} />
        ) : (
          <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center">
            <p className="text-[11px] text-[var(--text-secondary)]">Nothing to show yet.</p>
          </div>
        )}
      </motion.div>
    </motion.section>
  );
}

function CarProfileCard({ profile, isActive, onSetActive, onDelete }) {
  return (
    <motion.div
      variants={itemVariants}
      className={`rounded-[10px] border bg-[var(--bg-surface)] px-4 py-[14px] transition-all ${
        isActive ? 'border-[var(--text-primary)]' : 'border-[var(--border)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <Car size={12} strokeWidth={1.8} className="shrink-0 text-[var(--text-muted)]" />
          <h3 className="text-[12px] font-medium text-[var(--text-primary)] truncate max-w-[120px]">
            {profile.name || 'Unnamed car'}
          </h3>
        </div>
        {isActive && (
          <span className="shrink-0 rounded-[4px] px-[6px] py-[2px] font-mono text-[9px] bg-[var(--success-bg)] text-[var(--success-text)]">
            ACTIVE
          </span>
        )}
      </div>
      <div className="font-mono text-[10px] text-[var(--text-muted)] space-y-0.5 mb-3">
        {profile.engine && <p>{profile.engine}</p>}
        {profile.tuneStage && <p>{profile.tuneStage}</p>}
        {(profile.ethanol !== '' && profile.ethanol !== undefined) && <p>E{profile.ethanol} blend</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSetActive}
          className="text-[10px] font-medium text-[var(--text-dark-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {isActive ? 'Deactivate' : 'Set active'}
        </button>
        <span className="text-[var(--border)]">·</span>
        <button
          type="button"
          onClick={onDelete}
          className="text-[10px] font-medium text-[var(--danger-text)] opacity-60 hover:opacity-100 transition-opacity"
        >
          Delete
        </button>
      </div>
    </motion.div>
  );
}

function DashboardOverview({ snapshot, searchQuery, filterActive, onOpenAnalysis, onOpenGarage, onOpenCalculator, onSetActiveView, onCarProfilesChange }) {
  const { toast } = useToast();
  const filteredSearch = searchQuery.trim().toLowerCase();
  const flaggedLogs = snapshot.recentLogs.filter((log) => log.status !== 'Safe');
  const activeBlend = snapshot.activeBlend;
  const profileEntries = Object.entries(snapshot.profiles);

  const queueCards = snapshot.recentLogs
    .filter((log) => !filterActive || log.status !== 'Safe')
    .filter((log) => !filteredSearch || `${log.filename} ${log.engine} ${log.tune}`.toLowerCase().includes(filteredSearch))
    .slice(0, 3)
    .map((log) => ({
      title: log.filename,
      body: `${log.engine} · ${log.tune} · E${log.ethanol}. Last status ${log.status.toLowerCase()} with health score ${log.healthScore ?? '—'}.`,
      badges: [{ label: log.status.toLowerCase(), tone: statusTone(log.status) }],
      date: formatDate(log.date),
      counters: {
        primary: log.healthScore ?? '—',
        secondary: log.rowCount ?? '—',
      },
      onClick: () => onOpenAnalysis(log.id),
    }));

  const analysisCards = snapshot.garageLogs
    .filter((log) => !filteredSearch || `${log.filename} ${log.notes || ''}`.toLowerCase().includes(filteredSearch))
    .slice(0, 3)
    .map((log) => ({
      title: log.filename,
      body: `${log.engine} archive entry with ${log.tags?.length || 0} tags. ${log.notes || 'Ready to reopen in the analyzer or viewer.'}`,
      badges: [{ label: log.status.toLowerCase(), tone: statusTone(log.status) }],
      date: formatDate(log.createdAt),
      counters: {
        primary: log.healthScore ?? '—',
        secondary: log.tags?.length || 0,
      },
      onClick: () => onOpenGarage(log.id),
    }));

  const flaggedCards = flaggedLogs
    .filter((log) => !filteredSearch || `${log.filename} ${log.status}`.toLowerCase().includes(filteredSearch))
    .slice(0, 3)
    .map((log, index) => {
      const analysis = getLogResult(log.id)?.analysis;
      const metrics = analysis?.metrics || {};
      const summaryNote = analysis?.summary?.notes?.[0] || 'High-load review required before release.';
      return {
        kind: index === 0 ? 'dark' : 'standard',
        title: log.filename,
        body: summaryNote,
        codeRows: [
          {
            label: 'timing',
            value: formatMetric(metrics.timingCorrections?.max_correction, ' deg', 1),
            valueClass: 'text-[var(--danger-text)]',
          },
          {
            label: 'hpfp drop',
            value: formatMetric(metrics.hpfp?.max_drop_pct, '%', 1),
            valueClass: 'text-[var(--accent-yellow)]',
          },
          {
            label: 'iat peak',
            value: formatMetric(metrics.iat?.peak_f, ' F', 0),
            valueClass: 'text-[#5eca8a]',
          },
        ],
        date: formatDate(log.date),
        footer: 'open analysis',
        onClick: () => onOpenAnalysis(log.id),
        badges: [{ label: log.status.toLowerCase(), tone: statusTone(log.status) }],
        counters: { primary: log.healthScore ?? '—', secondary: log.rowCount ?? '—' },
      };
    })
    .map((card) => (card.kind === 'standard'
      ? {
          title: card.title,
          body: card.body,
          badges: card.badges,
          date: card.date,
          counters: card.counters,
          onClick: card.onClick,
        }
      : card));

  const fuelCards = [
    activeBlend
      ? {
          title: `Active blend · E${activeBlend.resultingBlend}`,
          body: `${formatVolume(activeBlend.e85Gallons, snapshot.settings.units)} E85 and ${formatVolume(activeBlend.pumpGallons, snapshot.settings.units)} pump saved from the latest calculation.`,
          badges: [{ label: `${activeBlend.resultingOctane || '—'} aki`, tone: 'success' }],
          date: formatDate(activeBlend.date),
          counters: {
            primary: activeBlend.pumpOctane ?? '—',
            secondary: activeBlend.pumpEthanol ?? '—',
          },
          onClick: onOpenCalculator,
        }
      : null,
    ...profileEntries.slice(0, 2).map(([name, profile]) => ({
      title: name,
      body: `Saved target E${profile.targetE} recipe with tank size ${profile.tankSize} gal and pump ethanol ${profile.pumpEthanol}%.`,
      badges: [{ label: 'profile', tone: 'warn' }],
      date: formatDate(profile.savedAt),
      counters: {
        primary: profile.targetE ?? '—',
        secondary: profile.currentFuel ?? '—',
      },
      onClick: onOpenCalculator,
    })),
  ]
    .filter(Boolean)
    .filter((card) => !filteredSearch || `${card.title} ${card.body}`.toLowerCase().includes(filteredSearch));

  const columns = [
    { title: 'Queued', count: String(queueCards.length).padStart(2, '0'), cards: queueCards },
    { title: 'Library', count: String(analysisCards.length).padStart(2, '0'), cards: analysisCards },
    { title: 'Flagged', count: String(flaggedCards.length).padStart(2, '0'), cards: flaggedCards },
    { title: 'Fuel', count: String(fuelCards.length).padStart(2, '0'), cards: fuelCards },
  ];

  const [mobileTab, setMobileTab] = useState(columns[0].title);
  const activeColumn = columns.find((c) => c.title === mobileTab) ?? columns[0];

  const carProfiles = snapshot.carProfiles ?? [];
  const activeCarId = snapshot.activeCarId;
  const filteredCars = carProfiles.filter((p) =>
    !filteredSearch || `${p.name ?? ''} ${p.engine ?? ''} ${p.tuneStage ?? ''}`.toLowerCase().includes(filteredSearch),
  );

  // Column-specific empty states
  const emptyStates = {
    Queued: { icon: Upload, title: 'No recent sessions', body: 'Upload a CSV log to start analyzing your pulls.', actionLabel: 'Upload CSV', onAction: () => onSetActiveView('analyzer') },
    Library: { icon: FolderArchive, title: 'Garage is empty', body: 'Analyzed logs are automatically archived here.', actionLabel: null },
    Flagged: { icon: AlertCircle, title: 'No flagged pulls', body: 'Logs with Caution or Risk status will appear here.', actionLabel: null },
    Fuel: { icon: CalculatorIcon, title: 'No fuel data', body: 'Calculate a blend to see your active blend and saved profiles.', actionLabel: 'Open blend lab', onAction: () => onOpenCalculator() },
  };

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)]">
      {/* Car profiles strip */}
      {(carProfiles.length > 0 || !filteredSearch) && (
        <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-medium text-[var(--text-primary)]">Garage</h2>
            <button
              type="button"
              onClick={() => onSetActiveView('settings')}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
            >
              Manage profiles →
            </button>
          </div>
          {filteredCars.length > 0 ? (
            <motion.div variants={containerVariants} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {filteredCars.slice(0, 6).map((profile) => (
                <CarProfileCard
                  key={profile.id}
                  profile={profile}
                  isActive={profile.id === activeCarId}
                  onSetActive={() => {
                    const newId = profile.id === activeCarId ? null : profile.id;
                    setActiveCar(newId);
                    onCarProfilesChange();
                    const name = profile.nickname || profile.name || 'Car';
                    if (newId) toast(`${name} set as active.`, { variant: 'success' });
                    else toast(`${name} deactivated.`, { variant: 'info' });
                  }}
                  onDelete={() => {
                    if (!window.confirm(`Delete "${profile.name || 'this profile'}"?`)) return;
                    deleteCarProfile(profile.id);
                    onCarProfilesChange();
                    toast(`${profile.nickname || profile.name || 'Car'} deleted.`, { variant: 'info' });
                  }}
                />
              ))}
            </motion.div>
          ) : (
            <p className="text-[11px] text-[var(--text-secondary)]">No car profiles saved yet. Add one in Settings.</p>
          )}
        </div>
      )}

      {/* Mobile: tab bar + single column */}
      <div className="md:hidden">
        <div className="flex gap-1 border-b border-[var(--border)] px-4 pt-4 pb-0">
          {columns.map((col) => (
            <button
              key={col.title}
              onClick={() => setMobileTab(col.title)}
              className={`flex items-center gap-1.5 rounded-t-[8px] px-3 py-2 text-[11px] font-semibold transition-colors ${
                mobileTab === col.title
                  ? 'bg-[var(--bg-surface)] border border-b-0 border-[var(--border)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {col.title}
              <span className="font-mono text-[9px] opacity-60">{col.count}</span>
            </button>
          ))}
        </div>
        <div className="px-4 py-4">
          <motion.div variants={containerVariants} className="space-y-[10px]">
            {activeColumn.cards.length ? activeColumn.cards.map((card) => (
              card.kind === 'dark' ? <FlaggedCard key={card.title} card={card} /> : <StandardCard key={card.title} card={card} />
            )) : (() => {
              const es = emptyStates[activeColumn.title];
              return es ? (
                <EmptyState icon={es.icon} title={es.title} body={es.body} actionLabel={es.actionLabel} onAction={es.onAction} />
              ) : (
                <div className="rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-4 py-8 text-center">
                  <p className="text-[11px] text-[var(--text-secondary)]">Nothing to show yet.</p>
                </div>
              );
            })()}
          </motion.div>
        </div>
      </div>

      {/* Desktop: 4-column kanban grid */}
      <motion.div variants={containerVariants} className="hidden md:grid min-w-[760px] grid-cols-4 gap-[14px] px-6 py-[22px]">
        {columns.map((column) => {
          const es = emptyStates[column.title];
          return <KanbanColumn key={column.title} column={column} emptyState={es} />;
        })}
      </motion.div>
    </motion.div>
  );
}

function AnalyzerSummary({ analysis }) {
  const metrics = analysis.metrics;
  return (
    <div className="grid gap-3 md:grid-cols-5">
      <StatCard label="Status" value={analysis.status} detail={analysis.filename} />
      <StatCard label="AFR" value={formatMetric(metrics.afr.actual, ':1', 2)} detail={metrics.afr.note || 'AFR stayed within target windows.'} />
      <StatCard label="HPFP drop" value={formatMetric(metrics.hpfp.max_drop_pct, '%', 1)} detail={metrics.hpfp.note || 'Rail pressure remained stable.'} warn={metrics.hpfp.status === 'Risk'} />
      <StatCard label="IAT peak" value={formatMetric(metrics.iat.peak_f, 'F', 0)} detail={metrics.iat.note || 'Charge temps look controlled.'} />
      <StatCard label="Timing" value={formatMetric(metrics.timingCorrections.max_correction, ' deg', 1)} detail={metrics.timingCorrections.note || 'No corrections were observed under load.'} />
    </div>
  );
}

function SkeletonAnalysis() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid gap-3 md:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-[14px]">
            <div className="skeleton h-2.5 w-16 mb-3" />
            <div className="skeleton h-7 w-20 mb-2" />
            <div className="skeleton h-2 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="skeleton h-3 w-32 mb-1" />
          <div className="skeleton h-2.5 w-48 mb-4" />
          <div className="skeleton rounded-[6px] h-[300px] w-full" />
        </div>
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="skeleton h-3 w-24 mb-1" />
          <div className="skeleton h-2.5 w-40 mb-4" />
          <div className="skeleton rounded-[6px] h-[300px] w-full" />
        </div>
      </div>
    </div>
  );
}

function buildAfrHistogram(chartData) {
  if (!chartData?.length) return [];
  const values = chartData.map((r) => r.afrActual).filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return [];
  const min = Math.floor(Math.min(...values) * 2) / 2;
  const max = Math.ceil(Math.max(...values) * 2) / 2;
  const bucketSize = 0.25;
  const buckets = {};
  for (let b = min; b <= max; b = Math.round((b + bucketSize) * 100) / 100) {
    buckets[b.toFixed(2)] = 0;
  }
  values.forEach((v) => {
    const key = (Math.floor(v / bucketSize) * bucketSize).toFixed(2);
    if (key in buckets) buckets[key]++;
  });
  return Object.entries(buckets).map(([afr, count]) => ({
    afr: Number(afr),
    count,
    label: afr,
  }));
}

function AfrHistogram({ chartData }) {
  const bins = useMemo(() => buildAfrHistogram(chartData), [chartData]);

  // Derive median logged target from per-row afrTarget values; fall back to distribution median
  const resolvedTarget = useMemo(() => {
    const targets = (chartData || [])
      .map((r) => r.afrTarget)
      .filter((v) => Number.isFinite(v) && v > 0);
    if (targets.length) {
      const sorted = [...targets].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    }
    // Fall back to the weighted center of the distribution
    if (!bins.length) return null;
    const totalCount = bins.reduce((s, b) => s + b.count, 0);
    if (!totalCount) return null;
    return bins.reduce((s, b) => s + b.afr * b.count, 0) / totalCount;
  }, [chartData, bins]);

  if (!bins.length) return null;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={bins} barCategoryGap="2%">
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} interval={3} />
        <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={30} />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const d = payload[0].payload;
            return (
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 shadow-[0_12px_24px_rgba(0,0,0,0.08)]">
                <p className="font-mono text-[10px] text-[var(--text-muted)]">AFR {d.afr.toFixed(2)}</p>
                <p className="font-mono text-[11px] text-[var(--text-primary)]">{d.count} samples</p>
                {resolvedTarget && (
                  <p className="font-mono text-[10px] text-[var(--text-muted)]">
                    {(d.afr - resolvedTarget) > 0 ? '+' : ''}{(d.afr - resolvedTarget).toFixed(2)} vs target
                  </p>
                )}
              </div>
            );
          }}
        />
        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
          {bins.map((b) => {
            const diff = resolvedTarget != null ? b.afr - resolvedTarget : 0;
            const color = resolvedTarget == null ? 'var(--text-secondary)'
              : Math.abs(diff) <= 0.25 ? 'var(--success-text)'
              : diff < -0.5 || diff > 0.75 ? 'var(--danger-text)'
              : 'var(--warn-text)';
            return <Cell key={b.label} fill={color} fillOpacity={0.8} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TelemetryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 shadow-[0_12px_24px_rgba(0,0,0,0.08)]">
      <p className="font-mono text-[10px] text-[var(--text-muted)]">time {label}s</p>
      <div className="mt-2 space-y-1">
        {payload.map((entry) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-[var(--text-secondary)]">{entry.name}</span>
            <span className="font-mono text-[var(--text-primary)]">{entry.value ?? '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnalyzerWorkspace({
  carDetails,
  onCarDetailsChange,
  analysisState,
  onUpload,
  onCompareUpload,
  onReset,
  onOpenViewer,
  onOpenCalculator,
  searchQuery,
  filterActive,
}) {
  const filteredSearch = searchQuery.trim().toLowerCase();
  const analysis = analysisState.analysis;
  const compareAnalysis = analysisState.compareAnalysis;
  const diagnostics = useMemo(() => {
    if (!analysis?.diagnostics) return [];
    return analysis.diagnostics.filter((item) => {
      if (filterActive && item.severity === 'Safe') return false;
      if (!filteredSearch) return true;
      return `${item.title} ${item.evidence} ${(item.likelyCauses || []).join(' ')} ${(item.recommendedChecks || []).join(' ')}`
        .toLowerCase()
        .includes(filteredSearch);
    });
  }, [analysis, filterActive, filteredSearch]);

  const keyPoints = useMemo(() => {
    if (!analysis?.keyPoints) return [];
    return analysis.keyPoints.filter((point) => (!filteredSearch ? true : point.toLowerCase().includes(filteredSearch)));
  }, [analysis, filteredSearch]);

  const compareData = useMemo(() => mergeCompareChartData(analysis, compareAnalysis), [analysis, compareAnalysis]);

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="space-y-4">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
          <SurfaceSection
            title="Analyzer workspace"
            subtitle="Upload a CSV, run the parser, and archive the result in one pass."
            action={analysis ? <StatusBadge status={analysis.status} /> : null}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Session actions</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={onUpload} className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[12px] font-medium text-[var(--bg-page)]">
                    Upload CSV
                  </button>
                  <button type="button" onClick={onCompareUpload} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                    Compare pull
                  </button>
                  <button type="button" onClick={onOpenViewer} disabled={!analysisState.csvText} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] disabled:opacity-40">
                    Open in viewer
                  </button>
                  <button type="button" onClick={onReset} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)]">
                    Reset
                  </button>
                  {analysis && analysis.carDetails?.ethanol !== undefined && analysis.carDetails?.ethanol !== '' && (
                    <button
                      type="button"
                      onClick={() => {
                        setPendingBlend({ currentE: Number(analysis.carDetails.ethanol) });
                        onOpenCalculator();
                      }}
                      className="rounded-[8px] border border-[var(--accent-yellow)] bg-[var(--warn-bg)] px-3 py-2 text-[12px] font-medium text-[var(--warn-text)] flex items-center gap-1.5"
                    >
                      <CalculatorIcon size={12} strokeWidth={1.8} />
                      Use E{analysis.carDetails.ethanol} in blend lab
                    </button>
                  )}
                </div>
                {analysisState.error ? <p className="mt-3 text-[11px] text-[var(--danger-text)]">{analysisState.error}</p> : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <FieldShell label="Fuel blend">
                  <StudioSelect value={carDetails.ethanol} onChange={(event) => onCarDetailsChange('ethanol', Number(event.target.value))}>
                    <option value="">Select</option>
                    {[0, 10, 20, 30, 40, 50, 60, 85].map((value) => (
                      <option key={value} value={value}>
                        E{value}
                      </option>
                    ))}
                  </StudioSelect>
                </FieldShell>
                <FieldShell label="Engine">
                  <StudioSelect value={carDetails.engine} onChange={(event) => onCarDetailsChange('engine', event.target.value)}>
                    <option value="">Select</option>
                    {engineOptions.map((option) => <option key={option}>{option}</option>)}
                  </StudioSelect>
                </FieldShell>
                <FieldShell label="Tune stage">
                  <StudioSelect value={carDetails.tuneStage} onChange={(event) => onCarDetailsChange('tuneStage', event.target.value)}>
                    <option value="">Select</option>
                    {tuneOptions.map((option) => <option key={option}>{option}</option>)}
                  </StudioSelect>
                </FieldShell>
              </div>
            </div>
          </SurfaceSection>

          <SurfaceSection title="Current file" subtitle="Latest parser context and comparison status.">
            <div className="space-y-3">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="text-[12px] font-medium text-[var(--text-primary)]">{analysis?.filename || 'No session loaded'}</p>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {analysis ? `${analysis.row_count} rows · ${analysis.logFormat} format` : 'Upload a BM3 or MHD CSV to generate diagnostics.'}
                </p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Compare pull</p>
                <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                  {compareAnalysis ? `${compareAnalysis.filename} is overlaid on the main session charts.` : 'Upload a second CSV to overlay AFR and boost trends.'}
                </p>
              </div>
            </div>
          </SurfaceSection>
        </div>

        {analysisState.loading ? (
          <SkeletonAnalysis />
        ) : !analysis ? (
          <EmptyState
            icon={Activity}
            title="Analyzer is ready"
            body="Upload a CSV to restore the original analysis workflow: health scoring, diagnostics, chart data, and garage archiving."
            actionLabel="Upload a log"
            onAction={onUpload}
          />
        ) : (
          <>
            <AnalyzerSummary analysis={analysis} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
              <SurfaceSection title="AFR and boost trace" subtitle="The main comparison overlay uses the same parser output saved to storage.">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={compareData}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                      <YAxis yAxisId="afr" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={38} />
                      <YAxis yAxisId="boost" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={38} />
                      <Tooltip content={<TelemetryTooltip />} />
                      <Line yAxisId="afr" type="monotone" dataKey="afrActual" name="AFR" stroke="var(--text-primary)" dot={false} strokeWidth={1.6} />
                      <Line yAxisId="afr" type="monotone" dataKey="afrActual_b" name="AFR compare" stroke="#9a958e" dot={false} strokeWidth={1.2} strokeDasharray="4 3" />
                      <Line yAxisId="boost" type="monotone" dataKey="boost" name="Boost" stroke="#c97f22" dot={false} strokeWidth={1.6} />
                      <Line yAxisId="boost" type="monotone" dataKey="boost_b" name="Boost compare" stroke="#e8c97a" dot={false} strokeWidth={1.2} strokeDasharray="4 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </SurfaceSection>

              <SurfaceSection title="HPFP trace" subtitle="Actual versus target pressure from the active session.">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analysis.chartData}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={42} />
                      <Tooltip content={<TelemetryTooltip />} />
                      <Area type="monotone" dataKey="hpfpTarget" name="Target" stroke="#c6a75a" fill="rgba(232,201,122,0.16)" strokeWidth={1.3} />
                      <Area type="monotone" dataKey="hpfpActual" name="Actual" stroke="var(--text-primary)" fill="var(--selection)" strokeWidth={1.5} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </SurfaceSection>
            </div>

            {analysis.chartData?.length > 0 && (
              <div className="grid gap-4 md:grid-cols-2">
                <SurfaceSection
                  title="AFR distribution"
                  subtitle="Sample count per AFR bucket. Green = near target, amber = drift, red = out of bounds."
                >
                  <div className="h-[200px]">
                    <AfrHistogram chartData={analysis.chartData} />
                  </div>
                </SurfaceSection>

                <SurfaceSection
                  title="Timing correction distribution"
                  subtitle="How often each correction magnitude was recorded under load."
                >
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={(() => {
                          const vals = (analysis.chartData || []).map((r) => r.timingCorrectionCyl1 ?? r.timingCorrection).filter(Number.isFinite);
                          if (!vals.length) return [];
                          const min = Math.floor(Math.min(...vals));
                          const max = Math.ceil(Math.max(...vals));
                          const buckets = {};
                          for (let b = min; b <= max; b++) buckets[b] = 0;
                          vals.forEach((v) => { const k = Math.round(v); if (k in buckets) buckets[k]++; });
                          return Object.entries(buckets).map(([deg, count]) => ({ deg: Number(deg), count, label: deg }));
                        })()}
                        barCategoryGap="4%"
                      >
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={30} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2">
                                <p className="font-mono text-[10px] text-[var(--text-muted)]">{d.deg >= 0 ? '+' : ''}{d.deg} deg</p>
                                <p className="font-mono text-[11px] text-[var(--text-primary)]">{d.count} samples</p>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                          {(() => {
                            const vals = (analysis.chartData || []).map((r) => r.timingCorrectionCyl1 ?? r.timingCorrection).filter(Number.isFinite);
                            if (!vals.length) return [];
                            const min = Math.floor(Math.min(...vals));
                            const max = Math.ceil(Math.max(...vals));
                            const result = [];
                            for (let b = min; b <= max; b++) {
                              const color = b >= 0 ? 'var(--success-text)' : b >= -2 ? 'var(--warn-text)' : 'var(--danger-text)';
                              result.push(<Cell key={b} fill={color} fillOpacity={0.75} />);
                            }
                            return result;
                          })()}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </SurfaceSection>
              </div>
            )}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <SurfaceSection title="Diagnostics" subtitle="Generated from the same analysis rules used by the original app.">
                <div className="space-y-3">
                  {diagnostics.length ? diagnostics.map((item) => (
                    <div key={item.id} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-[12px] font-medium text-[var(--text-primary)]">{item.title}</h3>
                        <StatusBadge status={item.severity} />
                      </div>
                      <p className="mt-2 text-[11px] leading-[1.6] text-[var(--text-secondary)]">{item.evidence}</p>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Likely causes</p>
                          <ul className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                            {item.likelyCauses.map((cause) => <li key={cause}>• {cause}</li>)}
                          </ul>
                        </div>
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Recommended checks</p>
                          <ul className="mt-2 space-y-1 text-[11px] text-[var(--text-secondary)]">
                            {item.recommendedChecks.map((check) => <li key={check}>• {check}</li>)}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <p className="text-[11px] text-[var(--text-secondary)]">No diagnostics match the current search or filter state.</p>
                  )}
                </div>
              </SurfaceSection>

              <div className="space-y-4">
                <SurfaceSection title="Key points" subtitle="Quick interpretation notes generated from the parser output.">
                  <div className="space-y-2">
                    {keyPoints.length ? keyPoints.map((point) => (
                      <div key={point} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3 text-[11px] leading-[1.6] text-[var(--text-secondary)]">
                        {point}
                      </div>
                    )) : (
                      <p className="text-[11px] text-[var(--text-secondary)]">No key points match the current search.</p>
                    )}
                  </div>
                </SurfaceSection>

                <SurfaceSection title="Knock scatter" subtitle="Correction points derived from timing columns.">
                  <div className="h-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis type="number" dataKey="rpm" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                        <YAxis type="number" dataKey="pull" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                        <Tooltip cursor={{ strokeDasharray: '4 4' }} />
                        <Scatter data={analysis.knockScatter} fill="var(--text-primary)" />
                      </ScatterChart>
                    </ResponsiveContainer>
                  </div>
                </SurfaceSection>
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function ViewerTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 shadow-[0_12px_24px_rgba(0,0,0,0.08)]">
      <div className="space-y-1">
        {payload.map((entry) => {
          const channel = entry.dataKey.replace(/_norm$/, '');
          const rawValue = entry.payload?.[`${channel}_raw`];
          return (
            <div key={channel} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-[var(--text-secondary)]">{channel}</span>
              <span className="font-mono text-[var(--text-primary)]">{rawValue ?? '—'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CHANNEL_PRESETS = [
  { label: 'HPFP',    keys: ['hpfp', 'hp fuel', 'fuel press', 'kraftstoff', 'fuelpress', 'hd_druck', 'high press'] },
  { label: 'Timing',  keys: ['timing', 'ignition', 'zündw', 'ign corr', 'knock', 'klopf', 'advance', 'retard'] },
  { label: 'Boost',   keys: ['boost', 'map', 'manifold', 'ladedruck', 'turbo', 'charge press', 'inlet press'] },
  { label: 'AFR',     keys: ['afr', 'lambda', 'o2', 'fuel trim', 'stft', 'ltft', 'sauerstoff', 'mixture'] },
  { label: 'Thermals',keys: ['temp', 'iat', 'ect', 'coolant', 'oil temp', 'ansaug', 'intake air', 'wasser', 'öltemp'] },
  { label: 'RPM',     keys: ['rpm', 'drehzahl', 'engine speed', 'rev'] },
];

function ViewerWorkspace({ viewerData, selectedChannels, onToggleChannel, onSetChannels, onUpload, searchQuery, filterActive, lineWidth }) {
  const deferredSearch = useDeferredValue(searchQuery);
  const filteredChannels = useMemo(() => {
    if (!viewerData) return [];
    return viewerData.numericChannels.filter((channel) => {
      if (filterActive && !selectedChannels.has(channel)) return false;
      if (!deferredSearch) return true;
      return channel.toLowerCase().includes(deferredSearch.toLowerCase());
    });
  }, [viewerData, selectedChannels, filterActive, deferredSearch]);

  const chartData = useMemo(() => {
    if (!viewerData) return [];
    return viewerData.rows.map((row, index) => {
      const point = {
        _t: viewerData.timeCol ? parseFloat(row[viewerData.timeCol]) || index : index,
      };
      selectedChannels.forEach((channel) => {
        const value = parseFloat(row[channel]);
        const stat = viewerData.stats[channel];
        if (Number.isNaN(value) || !stat) return;
        const span = stat.normMax - stat.normMin || 1;
        point[`${channel}_norm`] = ((value - stat.normMin) / span) * 100;
        point[`${channel}_raw`] = roundTo(value, 2);
      });
      return point;
    });
  }, [viewerData, selectedChannels]);

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      {!viewerData ? (
        <EmptyState
          icon={MonitorPlay}
          title="Viewer is ready"
          body="Upload any CSV to inspect channels, normalize series automatically, and reopen archived garage logs without leaving the new shell."
          actionLabel="Upload a CSV"
          onAction={onUpload}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
          <SurfaceSection
            title="Channels"
            subtitle={`${viewerData.filename.length > 32 ? '…' + viewerData.filename.slice(-29) : viewerData.filename} · ${viewerData.numericChannels.length} numeric channels`}
            action={
              <button type="button" onClick={onUpload} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-[11px] text-[var(--text-primary)]">
                Replace
              </button>
            }
          >
            {/* Presets */}
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CHANNEL_PRESETS.map((preset) => {
                const matches = viewerData.numericChannels.filter(ch =>
                  preset.keys.some(k => ch.toLowerCase().includes(k))
                );
                if (!matches.length) return null;
                const active = matches.every(ch => selectedChannels.has(ch));
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      if (active) {
                        const next = new Set(selectedChannels);
                        matches.forEach(ch => next.delete(ch));
                        onSetChannels(next);
                      } else {
                        const next = new Set(selectedChannels);
                        matches.forEach(ch => next.add(ch));
                        onSetChannels(next);
                      }
                    }}
                    className={`rounded-[6px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                      active
                        ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-surface)]'
                        : 'border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:border-[var(--text-primary)]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {selectedChannels.size > 0 && (
                <button
                  type="button"
                  onClick={() => onSetChannels(new Set())}
                  className="rounded-[6px] border border-[var(--border)] bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--danger-text)] transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="max-h-[620px] space-y-2 overflow-auto pr-1">
              {filteredChannels.map((channel) => {
                const checked = selectedChannels.has(channel);
                return (
                  <button
                    key={channel}
                    type="button"
                    onClick={() => onToggleChannel(channel)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors ${
                      checked
                        ? 'border-[var(--text-primary)] bg-[var(--bg-page)] text-[var(--text-primary)]'
                        : 'border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text-secondary)]'
                    }`}
                  >
                    <span className="truncate text-[11px]">{channel}</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: viewerData.colors[channel] }} />
                  </button>
                );
              })}
            </div>
          </SurfaceSection>

          <div className="space-y-4">
            <SurfaceSection title="Telemetry canvas" subtitle="Normalized chart with raw values preserved in the tooltip.">
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="_t" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={32} />
                    <Tooltip content={<ViewerTooltip />} />
                    {Array.from(selectedChannels).map((channel) => (
                      <Line
                        key={channel}
                        type="monotone"
                        dataKey={`${channel}_norm`}
                        stroke={viewerData.colors[channel]}
                        dot={false}
                        strokeWidth={lineWidth}
                      />
                    ))}
                    {chartData.length > 40 ? <Brush dataKey="_t" height={20} stroke="#9a958e" travellerWidth={8} /> : null}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </SurfaceSection>

            <div className="grid gap-3 md:grid-cols-3">
              <StatCard label="Rows shown" value={String(viewerData.rows.length)} detail="Downsampling is applied from settings." />
              <StatCard label="Selected" value={String(selectedChannels.size)} detail="Series are normalized onto one scale." />
              <StatCard label="Time axis" value={viewerData.timeCol || 'Index'} detail="Detected automatically from the CSV header." />
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function CalculatorWorkspace({ snapshot, onSnapshotRefresh, searchQuery }) {
  const { toast } = useToast();
  const [mode, setMode] = useState('blend');
  const [form, setForm] = useState({
    currentFuel: snapshot.activeBlend?.currentFuel ?? '',
    currentE: snapshot.activeBlend?.currentE ?? '',
    targetE: snapshot.activeBlend?.resultingBlend ?? '',
    tankSize: '',
    pumpEthanol: snapshot.activeBlend?.pumpEthanol ?? '',
    pumpOctane: snapshot.activeBlend?.pumpOctane ?? '',
    precisionMode: false,
    addFuel: '',
    calibrationReadings: '72, 74, 76',
    e85Price: 3.19,
    pumpPrice: 4.29,
    tankCount: 3,
    profileName: '',
    stationName: '',
  });
  const [blendResult, setBlendResult] = useState(snapshot.activeBlend);
  const [refuelResult, setRefuelResult] = useState(null);
  const [calibratedPumpE, setCalibratedPumpE] = useState(null);
  const [costResult, setCostResult] = useState(null);
  const [tankPlan, setTankPlan] = useState([]);
  const [error, setError] = useState(null);
  const [blendHistory, setBlendHistory] = useState(getBlendHistory);
  const [showHistory, setShowHistory] = useState(false);
  const [currentFuelUnit, setCurrentFuelUnit] = useState(() => (snapshot.settings.units === 'Metric' ? 'L' : 'gal'));
  const units = snapshot.settings.units;
  const filteredSearch = searchQuery.trim().toLowerCase();

  const filteredProfiles = useMemo(() => Object.entries(snapshot.profiles).filter(([name]) => (!filteredSearch ? true : name.toLowerCase().includes(filteredSearch))), [snapshot.profiles, filteredSearch]);
  const filteredStations = useMemo(() => Object.entries(snapshot.stationPresets).filter(([name]) => (!filteredSearch ? true : name.toLowerCase().includes(filteredSearch))), [snapshot.stationPresets, filteredSearch]);

  const setField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const handleBlend = () => {
    setError(null);
    try {
      const result = calculateBlend({
        current_gallons: form.currentFuel,
        current_ethanol_percent: form.currentE,
        target_ethanol_percent: form.targetE,
        tank_size: form.tankSize,
        pump_ethanol_percent: form.pumpEthanol,
        precision_mode: form.precisionMode,
      });
      const octane = calculateResultingOctane({
        e85Gallons: result.gallons_of_e85_to_add,
        pumpGallons: result.gallons_of_93_to_add,
        pumpOctane: form.pumpOctane,
      });
      const payload = {
        ...result,
        resultingBlend: result.resulting_percent,
        resultingOctane: octane,
        pumpEthanol: form.pumpEthanol,
        pumpOctane: form.pumpOctane,
        currentFuel: form.currentFuel,
        currentE: form.currentE,
        targetE: form.targetE,
        tankSize: form.tankSize,
        e85Gallons: result.gallons_of_e85_to_add,
        pumpGallons: result.gallons_of_93_to_add,
      };
      saveActiveBlend(payload);
      saveBlendHistory({ e85Gallons: payload.e85Gallons, pumpGallons: payload.pumpGallons, targetE: payload.targetE, resultingBlend: payload.resultingBlend });
      setBlendResult(payload);
      setBlendHistory(getBlendHistory());
      onSnapshotRefresh();
      toast(`E${payload.resultingBlend} blend calculated successfully.`, { variant: 'success' });
    } catch (caughtError) {
      setError(caughtError.message);
      toast(caughtError.message, { variant: 'error' });
    }
  };

  const handleRefuel = () => {
    setRefuelResult(reverseCalculateBlend({
      currentE: form.currentE,
      currentGallons: form.currentFuel,
      addGallons: form.addFuel,
      pumpEthanol: form.pumpEthanol,
    }));
  };

  const handleCalibration = () => {
    const readings = form.calibrationReadings.split(/[\s,]+/).filter(Boolean);
    setCalibratedPumpE(calibratePumpEthanol(readings));
  };

  const handleCostPlan = () => {
    try {
      setCostResult(estimateBlendFillCost({
        currentGallons: form.currentFuel,
        currentE: form.currentE,
        targetE: form.targetE,
        tankSize: form.tankSize,
        pumpEthanol: calibratedPumpE ?? form.pumpEthanol,
        e85Price: form.e85Price,
        pumpPrice: form.pumpPrice,
      }));
      setTankPlan(planEthanolOverTanks({
        tanks: form.tankCount,
        startGallons: form.currentFuel,
        startE: form.currentE,
        tankSize: form.tankSize,
        targetE: form.targetE,
        pumpEthanol: calibratedPumpE ?? form.pumpEthanol,
      }));
    } catch (caughtError) {
      setError(caughtError.message);
    }
  };

  const saveProfile = () => {
    if (!form.profileName.trim()) return;
    saveBlendProfile(form.profileName.trim(), {
      currentFuel: form.currentFuel,
      currentE: form.currentE,
      targetE: form.targetE,
      tankSize: form.tankSize,
      pumpEthanol: form.pumpEthanol,
      pumpOctane: form.pumpOctane,
    });
    setField('profileName', '');
    onSnapshotRefresh();
  };

  const saveStation = () => {
    if (!form.stationName.trim()) return;
    saveStationPreset(form.stationName.trim(), {
      e85Price: form.e85Price,
      pumpPrice: form.pumpPrice,
      pumpEthanol: calibratedPumpE ?? form.pumpEthanol,
    });
    setField('stationName', '');
    onSnapshotRefresh();
  };

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            ['blend', 'Blend'],
            ['refuel', 'Refuel'],
            ['planner', 'Planner'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded-[8px] border px-3 py-2 text-[12px] ${
                mode === id
                  ? 'border-[var(--text-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)]'
                  : 'border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text-secondary)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SurfaceSection title="Fuel math" subtitle="The original blend utilities are now routed through the redesigned shell.">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="block">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Current fuel ({currentFuelUnit === 'L' ? 'ltr' : 'gal'})</span>
                  <div className="flex gap-1">
                    {[['gal', 'gal'], ['L', 'ltr']].map(([u, label]) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setCurrentFuelUnit(u)}
                        className={`w-8 rounded-[6px] border py-0.5 text-center font-mono text-[9px] uppercase tracking-[0.05em] transition-colors ${currentFuelUnit === u ? 'border-[var(--text-primary)] bg-[var(--bg-surface)] text-[var(--text-primary)]' : 'border-[var(--border)] bg-transparent text-[var(--text-muted)]'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <StudioInput
                  type="number"
                  value={form.currentFuel === '' ? '' : currentFuelUnit === 'L' ? roundTo(Number(form.currentFuel) * LITERS_PER_GALLON, 2) : roundTo(Number(form.currentFuel), 2)}
                  onChange={(event) => {
                    const v = event.target.value;
                    if (v === '') { setField('currentFuel', ''); return; }
                    const parsed = Number(v);
                    setField('currentFuel', Number.isNaN(parsed) ? '' : currentFuelUnit === 'L' ? parsed / LITERS_PER_GALLON : parsed);
                  }}
                />
              </div>
              <FieldShell label="Current ethanol (%)">
                <StudioInput type="number" value={form.currentE} onChange={(event) => setField('currentE', event.target.value === '' ? '' : Number(event.target.value))} />
              </FieldShell>
              <FieldShell label="Target ethanol (%)">
                <StudioInput type="number" value={form.targetE} onChange={(event) => setField('targetE', event.target.value === '' ? '' : Number(event.target.value))} />
              </FieldShell>
              <FieldShell label={`Tank size (${units === 'Metric' ? 'L' : 'gal'})`}>
                <StudioInput
                  type="number"
                  value={form.tankSize === '' ? '' : toDisplayVolume(form.tankSize, units)}
                  onChange={(event) => setField('tankSize', event.target.value === '' ? '' : fromDisplayVolume(event.target.value, units))}
                />
              </FieldShell>
              <FieldShell label="Pump ethanol (%)">
                <StudioInput type="number" value={form.pumpEthanol} onChange={(event) => setField('pumpEthanol', event.target.value === '' ? '' : Number(event.target.value))} />
              </FieldShell>
              <FieldShell label="Pump octane">
                <StudioInput type="number" value={form.pumpOctane} onChange={(event) => setField('pumpOctane', event.target.value === '' ? '' : Number(event.target.value))} />
              </FieldShell>
            </div>

            {mode === 'blend' ? (
              <div className="mt-4 space-y-4">
                <label className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
                  <input type="checkbox" checked={form.precisionMode} onChange={(event) => setField('precisionMode', event.target.checked)} />
                  Precision mode with staged fill steps
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleBlend} className="rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-page)]">
                    Run blend
                  </button>
                  <button type="button" onClick={saveProfile} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-[12px] text-[var(--text-primary)]">
                    Save profile
                  </button>
                  <StudioInput
                    placeholder="Profile name"
                    value={form.profileName}
                    onChange={(event) => setField('profileName', event.target.value)}
                    className="mt-0 max-w-[180px]"
                  />
                  {blendHistory.length > 0 && (
                    <button type="button" onClick={() => setShowHistory((v) => !v)} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-[12px] text-[var(--text-primary)]">
                      History ({blendHistory.length})
                    </button>
                  )}
                </div>
                {showHistory && (
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Blend History</p>
                      <button type="button" onClick={() => { if (!window.confirm('Clear all blend history?')) return; clearBlendHistory(); setBlendHistory([]); setShowHistory(false); toast('Blend history cleared.', { variant: 'info' }); }} className="text-[11px] text-[var(--danger-text)]">Clear all</button>
                    </div>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {blendHistory.slice(0, 20).map((entry) => (
                        <div key={entry.id} className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                          <span>{formatVolume(entry.e85Gallons, units)} E85 + {formatVolume(entry.pumpGallons, units)} pump → E{entry.resultingBlend}</span>
                          <span className="text-[var(--text-muted)] shrink-0">{new Date(entry.date).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {mode === 'refuel' ? (
              <div className="mt-4 space-y-4">
                <FieldShell label={`Fuel to add (${units === 'Metric' ? 'L' : 'gal'})`}>
                  <StudioInput
                    type="number"
                    value={form.addFuel === '' ? '' : toDisplayVolume(form.addFuel, units)}
                    onChange={(event) => setField('addFuel', event.target.value === '' ? '' : fromDisplayVolume(event.target.value, units))}
                  />
                </FieldShell>
                <button type="button" onClick={handleRefuel} className="rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-page)]">
                  Calculate resulting blend
                </button>
              </div>
            ) : null}

            {mode === 'planner' ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <FieldShell label="Tester readings">
                    <StudioInput value={form.calibrationReadings} onChange={(event) => setField('calibrationReadings', event.target.value)} />
                  </FieldShell>
                  <FieldShell label="E85 price">
                    <StudioInput type="number" value={form.e85Price} onChange={(event) => setField('e85Price', Number(event.target.value))} />
                  </FieldShell>
                  <FieldShell label="Pump price">
                    <StudioInput type="number" value={form.pumpPrice} onChange={(event) => setField('pumpPrice', Number(event.target.value))} />
                  </FieldShell>
                </div>
                <div className="space-y-3">
                  <FieldShell label="Tank count">
                    <StudioInput type="number" value={form.tankCount} onChange={(event) => setField('tankCount', Number(event.target.value))} />
                  </FieldShell>
                  <FieldShell label="Station name">
                    <StudioInput value={form.stationName} onChange={(event) => setField('stationName', event.target.value)} />
                  </FieldShell>
                  <div className="flex flex-wrap gap-2 pt-5">
                    <button type="button" onClick={handleCalibration} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-[12px] text-[var(--text-primary)]">
                      Calibrate
                    </button>
                    <button type="button" onClick={handleCostPlan} className="rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-page)]">
                      Build plan
                    </button>
                    <button type="button" onClick={saveStation} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-[12px] text-[var(--text-primary)]">
                      Save station
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {error ? <p className="mt-4 text-[11px] text-[var(--danger-text)]">{error}</p> : null}
          </SurfaceSection>

          <div className="space-y-4">
            <SurfaceSection title="Results" subtitle="Live values saved back into local storage.">
              {mode === 'blend' && !blendResult ? (
                <p className="text-[11px] text-[var(--text-muted)]">
                  Fill in the blend fields and tap <span className="font-medium text-[var(--text-primary)]">Run blend</span> to see results here.
                </p>
              ) : null}

              {mode === 'blend' && blendResult ? (
                <div className="space-y-3 text-[12px] text-[var(--text-secondary)]">
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Primary fill</p>
                    <p className="mt-2 text-[14px] font-medium text-[var(--text-primary)]">
                      {formatVolume(blendResult.e85Gallons, units)} E85 / {formatVolume(blendResult.pumpGallons, units)} pump
                    </p>
                    <p className="mt-1">Resulting blend E{blendResult.resultingBlend} at {blendResult.resultingOctane || '—'} AKI.</p>
                  </div>
                  {blendResult.fill_steps?.length ? (
                    <div className="space-y-2">
                      {blendResult.fill_steps.map((step) => (
                        <div key={step.step} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Step {step.step}</p>
                          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{step.note}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {(() => {
                    const totalGal = (Number(blendResult.e85Gallons) || 0) + (Number(blendResult.pumpGallons) || 0);
                    if (totalGal <= 0) return null;
                    const e85Pct = ((Number(blendResult.e85Gallons) || 0) / totalGal) * 100;
                    const pumpPct = 100 - e85Pct;
                    return (
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)] mb-2">Blend composition</p>
                        <div className="flex rounded-[6px] overflow-hidden h-7" title={`E85: ${e85Pct.toFixed(1)}% | Pump: ${pumpPct.toFixed(1)}%`}>
                          <div className="flex items-center justify-center text-[10px] font-medium text-white transition-all duration-500" style={{ width: `${e85Pct}%`, backgroundColor: '#e8a63a', minWidth: e85Pct > 5 ? undefined : 0 }}>
                            {e85Pct > 12 ? `E85 ${e85Pct.toFixed(0)}%` : ''}
                          </div>
                          <div className="flex items-center justify-center text-[10px] font-medium text-white transition-all duration-500" style={{ width: `${pumpPct}%`, backgroundColor: '#6b7280' }}>
                            {pumpPct > 12 ? `Pump ${pumpPct.toFixed(0)}%` : ''}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              {mode === 'refuel' ? (
                <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3 text-[12px] text-[var(--text-secondary)]">
                  <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Projected blend</p>
                  <p className="mt-2 text-[20px] font-light text-[var(--text-primary)]">{refuelResult === null ? '—' : `E${refuelResult}`}</p>
                </div>
              ) : null}

              {mode === 'planner' ? (
                <div className="space-y-3 text-[12px] text-[var(--text-secondary)]">
                  <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Calibrated pump ethanol</p>
                    <p className="mt-2 text-[20px] font-light text-[var(--text-primary)]">{calibratedPumpE === null ? '—' : `${calibratedPumpE}%`}</p>
                  </div>
                  {costResult ? (
                    <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                      <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Estimated fill cost</p>
                      <p className="mt-2 text-[20px] font-light text-[var(--text-primary)]">${costResult.totalCost}</p>
                      <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                        E85 ${costResult.e85Cost} / Pump ${costResult.pumpCost}
                      </p>
                    </div>
                  ) : null}
                  {tankPlan.length ? (
                    <div className="space-y-2">
                      {tankPlan.map((item) => (
                        <div key={item.tank} className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Tank {item.tank}</p>
                          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                            {formatVolume(item.e85Gallons, units)} E85 and {formatVolume(item.pumpGallons, units)} pump to land at E{item.resultingE}.
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </SurfaceSection>

            <SurfaceSection title="Saved items" subtitle="Blend profiles and station presets stored from this workspace.">
              <div className="space-y-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Profiles</p>
                  <div className="mt-2 space-y-2">
                    {filteredProfiles.length ? filteredProfiles.map(([name, profile]) => (
                      <div key={name} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2">
                        <button type="button" onClick={() => setForm((current) => ({ ...current, ...profile }))} className="text-left">
                          <p className="text-[12px] font-medium text-[var(--text-primary)]">{name}</p>
                          <p className="text-[10px] text-[var(--text-secondary)]">Target E{profile.targetE}</p>
                        </button>
                        <button type="button" onClick={() => { deleteBlendProfile(name); onSnapshotRefresh(); }} className="text-[var(--danger-text)]">
                          <Trash2 size={12} strokeWidth={1.8} />
                        </button>
                      </div>
                    )) : <p className="text-[11px] text-[var(--text-secondary)]">No saved profiles match the current search.</p>}
                  </div>
                </div>

                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Stations</p>
                  <div className="mt-2 space-y-2">
                    {filteredStations.length ? filteredStations.map(([name, preset]) => (
                      <div key={name} className="flex items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setForm((current) => ({
                            ...current,
                            e85Price: preset.e85Price ?? current.e85Price,
                            pumpPrice: preset.pumpPrice ?? current.pumpPrice,
                            pumpEthanol: preset.pumpEthanol ?? current.pumpEthanol,
                          }))}
                          className="text-left"
                        >
                          <p className="text-[12px] font-medium text-[var(--text-primary)]">{name}</p>
                          <p className="text-[10px] text-[var(--text-secondary)]">
                            E85 ${preset.e85Price} / Pump ${preset.pumpPrice}
                          </p>
                        </button>
                        <button type="button" onClick={() => { deleteStationPreset(name); onSnapshotRefresh(); }} className="text-[var(--danger-text)]">
                          <Trash2 size={12} strokeWidth={1.8} />
                        </button>
                      </div>
                    )) : <p className="text-[11px] text-[var(--text-secondary)]">No station presets saved yet.</p>}
                  </div>
                </div>
              </div>
            </SurfaceSection>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

const CAR_ENGINE_OPTIONS = ['B58 Gen1', 'B58 Gen2', 'S58', 'S55', 'N55', 'N54', 'N20/N26', 'B48', 'N63/S63', 'Other'];
const CAR_TUNE_OPTIONS = ['Stock', 'Stage 1', 'Stage 2', 'Stage 2+', 'Custom E-tune', 'Full build'];
const CAR_ETHANOL_OPTIONS = [0, 10, 20, 30, 40, 50, 85, 100];

const EMPTY_CAR_FORM = { nickname: '', year: '', model: '', engine: '', tuneStage: '', ethanol: '', tuner: '', notes: '' };

function GarageWorkspace({ snapshot, onSnapshotRefresh, onAnalyzeWithCar }) {
  const { toast } = useToast();
  const [profiles, setProfiles] = useState(() => getCarProfiles());
  const [activeCarId, setActiveCarId] = useState(() => getActiveCar());
  const [editing, setEditing] = useState(null); // null | 'new' | id string
  const [form, setForm] = useState(EMPTY_CAR_FORM);

  const handleSetActive = (id) => {
    const newId = activeCarId === id ? null : id;
    setActiveCar(newId);
    setActiveCarId(newId);
    const profile = profiles.find((p) => p.id === id);
    const name = profile?.nickname || 'Car';
    if (newId) toast(`${name} set as active.`, { variant: 'success' });
    else toast(`${name} deactivated.`, { variant: 'info' });
  };

  const refresh = () => setProfiles(getCarProfiles());

  const openNew = () => { setForm(EMPTY_CAR_FORM); setEditing('new'); };
  const openEdit = (p) => { setForm({ nickname: p.nickname||'', year: p.year||'', model: p.model||'', engine: p.engine||'', tuneStage: p.tuneStage||'', ethanol: p.ethanol??'', tuner: p.tuner||'', notes: p.notes||'' }); setEditing(p.id); };
  const cancel = () => { setEditing(null); setForm(EMPTY_CAR_FORM); };

  const save = () => {
    if (!form.nickname.trim()) return;
    if (editing === 'new') saveCarProfile(form);
    else updateCarProfile(editing, form);
    refresh();
    toast(`${form.nickname.trim()} saved.`, { variant: 'success' });
    cancel();
  };

  const remove = (id) => {
    const profile = profiles.find((p) => p.id === id);
    deleteCarProfile(id);
    refresh();
    toast(`${profile?.nickname || 'Car'} deleted.`, { variant: 'info' });
  };

  const field = (key) => ({ value: form[key], onChange: (e) => setForm((f) => ({ ...f, [key]: e.target.value })) });

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="space-y-4">
        <SurfaceSection
          title="My cars"
          action={
            <button type="button" onClick={openNew}
              className="flex shrink-0 items-center gap-1 rounded-[7px] border border-[var(--border)] bg-[var(--bg-muted)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:bg-[var(--bg-page)] transition-colors">
              <Plus size={11} strokeWidth={2} /><span>Add car</span>
            </button>
          }
        >
          {/* Add / Edit form */}
          {editing !== null && (
            <div className="mb-4 rounded-[10px] border border-[var(--border)] bg-[var(--bg-page)] p-4 space-y-3">
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">{editing === 'new' ? 'New car' : 'Edit car'}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Nickname *</label>
                  <input {...field('nickname')} placeholder="e.g. Daily M2" className="app-input w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Year</label>
                  <input {...field('year')} placeholder="e.g. 2019" className="app-input w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Model</label>
                  <input {...field('model')} placeholder="e.g. M2 Competition" className="app-input w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Engine</label>
                  <select {...field('engine')} className="app-input w-full px-3 py-2 text-sm">
                    <option value="">Select</option>
                    {CAR_ENGINE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tune stage</label>
                  <select {...field('tuneStage')} className="app-input w-full px-3 py-2 text-sm">
                    <option value="">Select</option>
                    {CAR_TUNE_OPTIONS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Fuel blend</label>
                  <select {...field('ethanol')} className="app-input w-full px-3 py-2 text-sm">
                    <option value="">Select</option>
                    {CAR_ETHANOL_OPTIONS.map((v) => <option key={v} value={v}>E{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Tuner</label>
                  <input {...field('tuner')} placeholder="e.g. BM3, MHD, JB4" className="app-input w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Notes</label>
                  <input {...field('notes')} placeholder="Mods, dyno numbers, etc." className="app-input w-full px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={save}
                  className="rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-surface)]">
                  Save
                </button>
                <button type="button" onClick={cancel}
                  className="rounded-[8px] border border-[var(--border)] px-4 py-2 text-[12px] text-[var(--text-secondary)]">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Car cards */}
          {profiles.length === 0 && editing === null ? (
            <p className="text-[12px] text-[var(--text-secondary)]">No cars added yet. Hit "Add car" to get started.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {profiles.map((p) => {
                const isActive = activeCarId === p.id;
                const matchingLogs = (snapshot.garageLogs || []).filter((log) =>
                  (!p.engine || log.engine === p.engine) &&
                  (p.ethanol === '' || p.ethanol == null || String(log.ethanol) === String(p.ethanol)) &&
                  (!p.tuneStage || log.tune === p.tuneStage)
                );
                const logCount = matchingLogs.length;
                const lastHealth = matchingLogs.length > 0
                  ? [...matchingLogs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0].healthScore
                  : null;
                return (
                  <div key={p.id} className={`rounded-[10px] border bg-[var(--bg-surface)] p-4 space-y-2 transition-all ${isActive ? 'border-[var(--text-primary)] ring-1 ring-[var(--text-primary)]' : 'border-[var(--border)]'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-semibold text-[var(--text-primary)] leading-tight">{p.nickname}</p>
                          {isActive && <span className="rounded-[4px] bg-[var(--text-primary)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--bg-surface)]">Active</span>}
                        </div>
                        {(p.year || p.model) && <p className="text-[11px] text-[var(--text-secondary)]">{[p.year, p.model].filter(Boolean).join(' ')}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button type="button" onClick={() => openEdit(p)} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><Pencil size={12} /></button>
                        <button type="button" onClick={() => remove(p.id)} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--danger-text)]"><Trash2 size={12} /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {p.engine && <span className="rounded-[5px] bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">{p.engine}</span>}
                      {p.tuneStage && <span className="rounded-[5px] bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">{p.tuneStage}</span>}
                      {p.ethanol !== '' && p.ethanol !== undefined && <span className="rounded-[5px] bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">E{p.ethanol}</span>}
                      {p.tuner && <span className="rounded-[5px] bg-[var(--bg-muted)] px-2 py-0.5 text-[10px] font-mono text-[var(--text-secondary)]">{p.tuner}</span>}
                    </div>
                    {p.notes && <p className="text-[11px] text-[var(--text-muted)] leading-snug">{p.notes}</p>}
                    {/* Stats row */}
                    <div className="flex items-center gap-3 pt-0.5">
                      <span className="text-[10px] text-[var(--text-muted)]">
                        <span className="font-semibold text-[var(--text-secondary)]">{logCount}</span> {logCount === 1 ? 'log' : 'logs'}
                      </span>
                      {lastHealth != null && (
                        <span className="text-[10px] text-[var(--text-muted)]">
                          Last health <span className="font-semibold text-[var(--text-secondary)]">{lastHealth}%</span>
                        </span>
                      )}
                    </div>
                    {/* Action buttons */}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSetActive(p.id)}
                        className={`rounded-[7px] border px-3 py-1.5 text-[11px] font-medium transition-colors ${isActive ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-surface)]' : 'border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                      >
                        {isActive ? 'Active' : 'Set active'}
                      </button>
                      {onAnalyzeWithCar && (
                        <button
                          type="button"
                          onClick={() => onAnalyzeWithCar(p)}
                          className="rounded-[7px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        >
                          Analyze Log
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceSection>
      </div>
    </motion.div>
  );
}

function ArchiveWorkspace({ snapshot, onSnapshotRefresh, searchQuery, filterActive, onOpenAnalysis, onOpenViewer, carProfiles = [] }) {
  const { toast } = useToast();
  const importRef = useRef(null);
  const [tagFilter, setTagFilter] = useState('all');
  const [carFilter, setCarFilter] = useState(null);
  const [importError, setImportError] = useState(null);
  const deferredSearch = useDeferredValue(searchQuery);

  const allTags = useMemo(() => {
    const tags = new Set();
    snapshot.garageLogs.forEach((log) => (log.tags || []).forEach((tag) => tags.add(tag)));
    return [...tags].sort();
  }, [snapshot.garageLogs]);

  const filteredLogs = useMemo(() => snapshot.garageLogs.filter((log) => {
    if (filterActive && log.status === 'Safe') return false;
    const matchTag = tagFilter === 'all' || (log.tags || []).includes(tagFilter);
    const matchSearch = !deferredSearch || `${log.filename} ${log.notes || ''} ${(log.tags || []).join(' ')}`.toLowerCase().includes(deferredSearch.toLowerCase());
    if (!matchTag || !matchSearch) return false;
    if (carFilter) {
      const car = carProfiles.find((p) => p.id === carFilter);
      if (car) {
        const engineMatch = !car.engine || log.engine === car.engine;
        const ethanolMatch = car.ethanol === '' || car.ethanol == null || String(log.ethanol) === String(car.ethanol);
        const tuneMatch = !car.tuneStage || log.tune === car.tuneStage;
        if (!engineMatch || !ethanolMatch || !tuneMatch) return false;
      }
    }
    return true;
  }), [snapshot.garageLogs, tagFilter, filterActive, deferredSearch, carFilter, carProfiles]);

  const handleImport = async (file) => {
    try {
      setImportError(null);
      const text = await file.text();
      importGarageBackup(JSON.parse(text), 'merge');
      onSnapshotRefresh();
      toast('Garage backup imported successfully.', { variant: 'success' });
    } catch (caughtError) {
      const msg = caughtError instanceof Error ? caughtError.message : 'Could not import that backup file.';
      setImportError(msg);
      toast(msg, { variant: 'error' });
    }
  };

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="space-y-4">
        <SurfaceSection
          title="Log archive"
          subtitle="Long-term archive with reopen, tag, note, backup, and import flows restored."
          action={(
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => { downloadBlob(`ethos58-garage-summary-${Date.now()}.csv`, exportGarageSummaryCsv(), 'text/csv;charset=utf-8'); toast('Summary CSV downloaded.', { variant: 'success' }); }}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-[11px] text-[var(--text-primary)]"
              >
                <FileSpreadsheet size={12} className="mr-1 inline-block" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => { downloadBlob(`ethos58-garage-${Date.now()}.json`, JSON.stringify(exportGarageBackup(), null, 2), 'application/json'); toast('Backup JSON downloaded.', { variant: 'success' }); }}
                className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 text-[11px] text-[var(--text-primary)]"
              >
                <FileJson size={12} className="mr-1 inline-block" />
                Backup JSON
              </button>
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                className="rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[11px] font-medium text-[var(--bg-page)]"
              >
                <FileUp size={12} className="mr-1 inline-block" />
                Import JSON
              </button>
              <input
                ref={importRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  if (event.target.files?.[0]) handleImport(event.target.files[0]);
                  event.target.value = '';
                }}
              />
            </div>
          )}
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <div className="space-y-2">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3 text-[11px] text-[var(--text-secondary)]">
                Search is driven from the top bar. Use the filter button to limit the archive to non-safe logs.
              </div>
              {carProfiles.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {carProfiles.map((car) => (
                    <button
                      key={car.id}
                      type="button"
                      onClick={() => setCarFilter(carFilter === car.id ? null : car.id)}
                      className={`rounded-[6px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${carFilter === car.id ? 'border-[var(--text-primary)] bg-[var(--text-primary)] text-[var(--bg-surface)]' : 'border-[var(--border)] bg-[var(--bg-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    >
                      {car.nickname}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <FieldShell label="Tag filter">
              <StudioSelect value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="mt-0">
                <option value="all">All tags</option>
                {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </StudioSelect>
            </FieldShell>
          </div>
          {importError ? <p className="mt-3 text-[11px] text-[var(--danger-text)]">{importError}</p> : null}
        </SurfaceSection>

        <div className="space-y-3">
          {filteredLogs.length ? filteredLogs.map((log) => (
            <SurfaceSection
              key={log.id}
              title={log.filename}
              subtitle={`${formatDateTime(log.createdAt)} · ${log.engine} · E${log.ethanol} · ${log.tune}`}
              action={<StatusBadge status={log.status} />}
            >
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-4">
                    <StatCard label="Health" value={String(log.healthScore ?? '—')} detail="Composite score from the analyzer." />
                    <StatCard label="Rows" value={String(log.rowCount ?? '—')} detail="Original parsed row count." />
                    <StatCard label="Timing" value={formatMetric(log.timingPull, ' deg', 1)} detail="Worst correction seen under load." />
                    <StatCard label="AFR" value={formatMetric(log.afr, '', 2)} detail="Demand AFR or worst lean event." />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <FieldShell label="Tags">
                      <StudioInput
                        defaultValue={(log.tags || []).join(', ')}
                        onBlur={(event) => {
                          const tags = event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean);
                          updateGarageLogMeta(log.id, { tags });
                          onSnapshotRefresh();
                        }}
                      />
                    </FieldShell>
                    <FieldShell label="Notes">
                      <StudioTextarea
                        rows={3}
                        defaultValue={log.notes || ''}
                        onBlur={(event) => {
                          updateGarageLogMeta(log.id, { notes: event.target.value });
                          onSnapshotRefresh();
                        }}
                      />
                    </FieldShell>
                  </div>
                </div>

                <div className="space-y-2">
                  <button type="button" onClick={() => onOpenAnalysis(log.id)} className="w-full rounded-[8px] bg-[var(--text-primary)] px-3 py-2 text-[12px] font-medium text-[var(--bg-page)]">
                    Open analysis
                  </button>
                  <button type="button" onClick={() => onOpenViewer(log.id)} disabled={!log.hasCsv} className="w-full rounded-[8px] border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[12px] text-[var(--text-primary)] disabled:opacity-40">
                    Re-open CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(`Delete ${log.filename} from the garage?`)) return;
                      deleteGarageLog(log.id);
                      onSnapshotRefresh();
                      toast(`${log.filename} deleted.`, { variant: 'info' });
                    }}
                    className="w-full rounded-[8px] border border-[rgba(224,81,58,0.3)] bg-[rgba(224,81,58,0.06)] px-3 py-2 text-[12px] text-[var(--danger-text)]"
                  >
                    Delete log
                  </button>
                </div>
              </div>
            </SurfaceSection>
          )) : (
            <EmptyState icon={FolderArchive} title="No garage logs match" body="Upload and analyze a log, or clear the current search and filter state to reveal archived entries." />
          )}
        </div>
      </div>
    </motion.div>
  );
}

function SettingsWorkspace({ snapshot, onSettingChange, onSnapshotRefresh, searchQuery }) {
  const deferredSearch = useDeferredValue(searchQuery);
  const matches = (text) => !deferredSearch || text.toLowerCase().includes(deferredSearch.toLowerCase());

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.8fr)]">
        <div className="space-y-4">
          {(matches('profile account name email') || !deferredSearch) ? (
            <SurfaceSection title="Profile" subtitle="Basic account preferences stored locally.">
              <div className="grid gap-3 md:grid-cols-2">
                <FieldShell label="Display name">
                  <StudioInput
                    defaultValue={snapshot.settings.displayName || 'B58 Enthusiast'}
                    onBlur={(event) => onSettingChange('displayName', event.target.value)}
                  />
                </FieldShell>
                <FieldShell label="Email">
                  <StudioInput
                    type="email"
                    defaultValue={snapshot.settings.email || 'user@example.com'}
                    onBlur={(event) => onSettingChange('email', event.target.value)}
                  />
                </FieldShell>
              </div>
            </SurfaceSection>
          ) : null}

          {(matches('theme units preferences formatting') || !deferredSearch) ? (
            <SurfaceSection title="Preferences" subtitle="Display and chart rendering preferences.">
              <div className="grid gap-3 md:grid-cols-2">
                <FieldShell label="Theme">
                  <StudioSelect value={snapshot.settings.theme} onChange={(event) => onSettingChange('theme', event.target.value)}>
                    <option value="system">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </StudioSelect>
                </FieldShell>
                <FieldShell label="Units">
                  <StudioSelect value={snapshot.settings.units} onChange={(event) => onSettingChange('units', event.target.value)}>
                    <option value="US">US</option>
                    <option value="Metric">Metric</option>
                  </StudioSelect>
                </FieldShell>
              </div>
            </SurfaceSection>
          ) : null}

          {(matches('viewer downsampling line thickness') || !deferredSearch) ? (
            <SurfaceSection title="Viewer tuning" subtitle="Chart rendering preferences.">
              <div className="grid gap-3 md:grid-cols-2">
                <FieldShell label="Downsampling">
                  <StudioSelect value={snapshot.settings.downsampling} onChange={(event) => onSettingChange('downsampling', event.target.value)}>
                    {Object.keys(DOWNSAMPLING_MAP).map((option) => <option key={option}>{option}</option>)}
                  </StudioSelect>
                </FieldShell>
                <FieldShell label="Line thickness">
                  <StudioSelect value={snapshot.settings.lineThickness} onChange={(event) => onSettingChange('lineThickness', event.target.value)}>
                    {Object.keys(LINE_WIDTH_MAP).map((option) => <option key={option}>{option}</option>)}
                  </StudioSelect>
                </FieldShell>
              </div>
            </SurfaceSection>
          ) : null}
        </div>

        <div className="space-y-4">
          <SurfaceSection title="Local storage" subtitle="Everything Ethos stores is kept on this device only.">
            <div className="space-y-3">
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Recent logs</p>
                <p className="mt-2 text-[22px] font-light text-[var(--text-primary)]">{snapshot.recentLogs.length}</p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Garage logs</p>
                <p className="mt-2 text-[22px] font-light text-[var(--text-primary)]">{snapshot.garageLogs.length}</p>
              </div>
              <div className="rounded-[8px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Fuel profiles</p>
                <p className="mt-2 text-[22px] font-light text-[var(--text-primary)]">{Object.keys(snapshot.profiles).length}</p>
              </div>
            </div>
          </SurfaceSection>

          <SurfaceSection title="Data management" subtitle="Clear stored data from this device. This cannot be undone.">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Clear all recent logs? This cannot be undone.')) return;
                  clearRecentLogs();
                  onSnapshotRefresh();
                }}
                className="rounded-[8px] border border-[rgba(224,81,58,0.3)] bg-[rgba(224,81,58,0.06)] px-3 py-2 text-[12px] text-[var(--danger-text)] transition-colors hover:bg-[rgba(224,81,58,0.1)]"
              >
                Clear recent logs
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('Clear all archive logs? This cannot be undone.')) return;
                  clearGarageLogs();
                  onSnapshotRefresh();
                }}
                className="rounded-[8px] border border-[rgba(224,81,58,0.3)] bg-[rgba(224,81,58,0.06)] px-3 py-2 text-[12px] text-[var(--danger-text)] transition-colors hover:bg-[rgba(224,81,58,0.1)]"
              >
                Clear archive
              </button>
            </div>
          </SurfaceSection>
        </div>
      </div>
    </motion.div>
  );
}

function CompareWorkspace({ garageLogs }) {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');

  const leftResult = useMemo(() => (leftId ? getLogResult(leftId)?.analysis : null), [leftId]);
  const rightResult = useMemo(() => (rightId ? getLogResult(rightId)?.analysis : null), [rightId]);
  const merged = useMemo(() => mergeCompareChartData(leftResult, rightResult), [leftResult, rightResult]);

  const formatMetricLocal = (v, suffix = '', d = 1) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)}${suffix}` : '—');

  const metricDiff = (a, b, lowerIsBetter = false) => {
    if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return null;
    const diff = Number(b) - Number(a);
    const good = lowerIsBetter ? diff < 0 : diff > 0;
    return { diff, good, label: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}` };
  };

  const metrics = leftResult && rightResult ? [
    { label: 'Status', left: leftResult.status, right: rightResult.status },
    { label: 'AFR', left: formatMetricLocal(leftResult.metrics?.afr?.actual, ':1', 2), right: formatMetricLocal(rightResult.metrics?.afr?.actual, ':1', 2) },
    { label: 'HPFP drop', left: formatMetricLocal(leftResult.metrics?.hpfp?.max_drop_pct, '%'), right: formatMetricLocal(rightResult.metrics?.hpfp?.max_drop_pct, '%'), diff: metricDiff(leftResult.metrics?.hpfp?.max_drop_pct, rightResult.metrics?.hpfp?.max_drop_pct, true) },
    { label: 'IAT peak', left: formatMetricLocal(leftResult.metrics?.iat?.peak_f, 'F', 0), right: formatMetricLocal(rightResult.metrics?.iat?.peak_f, 'F', 0), diff: metricDiff(leftResult.metrics?.iat?.peak_f, rightResult.metrics?.iat?.peak_f, true) },
    { label: 'Timing pull', left: formatMetricLocal(leftResult.metrics?.timingCorrections?.max_correction, ' deg'), right: formatMetricLocal(rightResult.metrics?.timingCorrections?.max_correction, ' deg'), diff: metricDiff(leftResult.metrics?.timingCorrections?.max_correction, rightResult.metrics?.timingCorrections?.max_correction, false) },
    { label: 'Health score', left: formatMetricLocal(leftResult.healthScore, '%', 0), right: formatMetricLocal(rightResult.healthScore, '%', 0), diff: metricDiff(leftResult.healthScore, rightResult.healthScore, false) },
  ] : [];

  return (
    <motion.div variants={itemVariants} className="flex-1 overflow-auto bg-[var(--bg-page)] px-6 py-[22px]">
      <div className="space-y-6 max-w-[1200px]">
        <div className="grid grid-cols-2 gap-4">
          <SurfaceSection title="Log A (baseline)" subtitle="Select a garage log to use as the reference.">
            <StudioSelect value={leftId} onChange={(e) => setLeftId(e.target.value)}>
              <option value="">Select log…</option>
              {garageLogs.map((log) => (
                <option key={log.id} value={log.id}>{log.filename} — {log.engine} {log.tune}</option>
              ))}
            </StudioSelect>
          </SurfaceSection>
          <SurfaceSection title="Log B (compare)" subtitle="Select a garage log to compare against the baseline.">
            <StudioSelect value={rightId} onChange={(e) => setRightId(e.target.value)}>
              <option value="">Select log…</option>
              {garageLogs.map((log) => (
                <option key={log.id} value={log.id}>{log.filename} — {log.engine} {log.tune}</option>
              ))}
            </StudioSelect>
          </SurfaceSection>
        </div>

        {!leftResult && !rightResult ? (
          <EmptyState
            icon={ArrowUpDown}
            title="Select two logs to compare"
            body="Pick a baseline log and a comparison log above. Ethos will overlay their charts and surface metric deltas side-by-side."
            actionLabel={null}
          />
        ) : null}

        {leftResult && rightResult ? (
          <>
            {/* Metric comparison table */}
            <SurfaceSection title="Metric delta" subtitle="Side-by-side comparison of key performance indicators.">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="py-2 pr-4 text-left font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Metric</th>
                      <th className="py-2 px-4 text-right font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        A — {leftResult.filename?.replace(/\.csv$/i, '') || 'Log A'}
                      </th>
                      <th className="py-2 px-4 text-right font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">
                        B — {rightResult.filename?.replace(/\.csv$/i, '') || 'Log B'}
                      </th>
                      <th className="py-2 pl-4 text-right font-mono text-[10px] uppercase tracking-[0.07em] text-[var(--text-muted)]">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {metrics.map((m) => (
                      <tr key={m.label}>
                        <td className="py-2.5 pr-4 text-[var(--text-secondary)]">{m.label}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--text-primary)]">{m.left}</td>
                        <td className="py-2.5 px-4 text-right font-mono text-[var(--text-primary)]">{m.right}</td>
                        <td className="py-2.5 pl-4 text-right font-mono">
                          {m.diff ? (
                            <span className={m.diff.good ? 'text-[var(--success-text)]' : 'text-[var(--danger-text)]'}>
                              {m.diff.label}
                            </span>
                          ) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SurfaceSection>

            {/* Overlay chart */}
            {merged.length > 0 && (
              <SurfaceSection title="AFR and boost overlay" subtitle="Solid = Log A, dashed = Log B.">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={merged}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="time" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                      <YAxis yAxisId="afr" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={38} />
                      <YAxis yAxisId="boost" orientation="right" tick={{ fontSize: 10, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={38} />
                      <Tooltip content={<TelemetryTooltip />} />
                      <Line yAxisId="afr" type="monotone" dataKey="afrActual" name="AFR (A)" stroke="var(--text-primary)" dot={false} strokeWidth={1.6} />
                      <Line yAxisId="afr" type="monotone" dataKey="afrActual_b" name="AFR (B)" stroke="#9a958e" dot={false} strokeWidth={1.2} strokeDasharray="4 3" />
                      <Line yAxisId="boost" type="monotone" dataKey="boost" name="Boost (A)" stroke="#c97f22" dot={false} strokeWidth={1.6} />
                      <Line yAxisId="boost" type="monotone" dataKey="boost_b" name="Boost (B)" stroke="#e8c97a" dot={false} strokeWidth={1.2} strokeDasharray="4 3" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </SurfaceSection>
            )}

            {/* HPFP comparison */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[{ result: leftResult, label: 'A' }, { result: rightResult, label: 'B' }].map(({ result: r, label }) => (
                <SurfaceSection key={label} title={`HPFP trace — Log ${label}`} subtitle={r.filename || ''}>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={r.chartData}>
                        <CartesianGrid stroke="var(--border)" vertical={false} />
                        <XAxis dataKey="time" tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} />
                        <YAxis tick={{ fontSize: 9, fill: 'var(--text-muted)', fontFamily: 'DM Mono' }} width={38} />
                        <Tooltip content={<TelemetryTooltip />} />
                        <Area type="monotone" dataKey="hpfpTarget" name="Target" stroke="#c6a75a" fill="rgba(232,201,122,0.12)" strokeWidth={1.2} />
                        <Area type="monotone" dataKey="hpfpActual" name="Actual" stroke="var(--text-primary)" fill="var(--selection)" strokeWidth={1.4} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </SurfaceSection>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </motion.div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [activeView, setActiveView] = useState('dashboard');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterActive, setFilterActive] = useState(false);
  const [snapshot, setSnapshot] = useState(loadSnapshot);

  const analyzerUploadRef = useRef(null);
  const analyzerCompareRef = useRef(null);
  const viewerUploadRef = useRef(null);

  const [carDetails, setCarDetails] = useState(() => {
    const activeId = getActiveCar();
    if (activeId) {
      const car = getCarProfiles().find((p) => p.id === activeId);
      if (car) return { ethanol: car.ethanol ?? '', engine: car.engine || '', tuneStage: car.tuneStage || '' };
    }
    return analyzerDefaults;
  });
  const [analysisState, setAnalysisState] = useState({
    analysis: null,
    csvText: '',
    compareAnalysis: null,
    loading: false,
    error: null,
  });
  const [viewerSource, setViewerSource] = useState({ csvText: '', filename: '' });
  const [viewerData, setViewerData] = useState(null);
  const [selectedChannels, setSelectedChannels] = useState(new Set());

  const refreshSnapshot = useCallback(() => {
    setSnapshot(loadSnapshot());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const { theme } = snapshot.settings;

    function applyTheme() {
      if (theme === 'dark') {
        root.classList.add('dark');
      } else if (theme === 'light') {
        root.classList.remove('dark');
      } else {
        root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
      }
    }

    applyTheme();

    if (theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      mql.addEventListener('change', applyTheme);
      return () => mql.removeEventListener('change', applyTheme);
    }
  }, [snapshot.settings]);

  useEffect(() => {
    if (!viewerSource.csvText) return;
    try {
      const payload = buildViewerPayload(viewerSource.csvText, viewerSource.filename, snapshot.settings);
      setViewerData(payload);
      setSelectedChannels((current) => {
        if (current.size === 0) return new Set(payload.autoSelected);
        const next = new Set([...current].filter((channel) => payload.numericChannels.includes(channel)));
        return next.size ? next : new Set(payload.autoSelected);
      });
    } catch (caughtError) {
      setViewerData(null);
      setSelectedChannels(new Set());
    }
  }, [viewerSource, snapshot.settings]);

  const openAnalyzerUpload = () => {
    startTransition(() => {
      setActiveView('analyzer');
      setSearchQuery('');
      setFilterActive(false);
    });
    analyzerUploadRef.current?.click();
  };

  const handleAnalyzeFile = async (file, options = {}) => {
    if (!file) return;
    const { compare = false } = options;
    setAnalysisState((current) => ({ ...current, loading: true, error: null }));
    startTransition(() => setActiveView('analyzer'));
    try {
      const csvText = await readFileAsText(file);
      const analysis = analyzeLog(csvText, file.name, carDetails);
      if (compare) {
        setAnalysisState((current) => ({ ...current, compareAnalysis: analysis, loading: false }));
        toast(`Compare log loaded: ${file.name}`, { variant: 'info' });
      } else {
        saveRecentLog(analysis);
        saveGarageLog(analysis, csvText);
        setAnalysisState({
          analysis,
          csvText,
          compareAnalysis: null,
          loading: false,
          error: null,
        });
        refreshSnapshot();
        const statusVariant = analysis.status === 'Risk' ? 'error' : analysis.status === 'Caution' ? 'warn' : 'success';
        toast(`${file.name} analyzed — ${analysis.status}`, { variant: statusVariant });
      }
    } catch (caughtError) {
      const msg = caughtError instanceof Error ? caughtError.message : 'Could not analyze that log.';
      setAnalysisState((current) => ({
        ...current,
        loading: false,
        error: msg,
      }));
      toast(msg, { variant: 'error' });
    }
  };

  const handleViewerFile = async (file) => {
    if (!file) return;
    try {
      const csvText = await readFileAsText(file);
      setViewerSource({ csvText, filename: file.name });
      startTransition(() => {
        setActiveView('viewer');
        setSearchQuery('');
        setFilterActive(false);
      });
      toast(`${file.name} opened in viewer.`, { variant: 'info' });
    } catch {
      setViewerData(null);
      setSelectedChannels(new Set());
      toast('Could not open that CSV file.', { variant: 'error' });
    }
  };

  const openAnalysisFromId = (id) => {
    const payload = getLogResult(id);
    if (!payload?.analysis) return;
    setAnalysisState({
      analysis: payload.analysis,
      csvText: payload.csvText || '',
      compareAnalysis: null,
      loading: false,
      error: null,
    });
    startTransition(() => setActiveView('analyzer'));
  };

  const openViewerFromId = (id) => {
    const payload = getLogResult(id);
    if (!payload?.csvText) return;
    setViewerSource({
      csvText: payload.csvText,
      filename: payload.analysis?.filename || 'garage-log.csv',
    });
    startTransition(() => setActiveView('viewer'));
  };

  const handleSettingChange = (key, value) => {
    saveSetting(key, value);
    refreshSnapshot();
  };

  const activeLineWidth = LINE_WIDTH_MAP[snapshot.settings.lineThickness] ?? 1.5;

  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={containerVariants}
      className="flex min-h-screen flex-col overflow-hidden bg-[var(--bg-page)] md:h-screen md:flex-row"
    >
      <input
        ref={analyzerUploadRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.[0]) handleAnalyzeFile(event.target.files[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={analyzerCompareRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.[0]) handleAnalyzeFile(event.target.files[0], { compare: true });
          event.target.value = '';
        }}
      />
      <input
        ref={viewerUploadRef}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(event) => {
          if (event.target.files?.[0]) handleViewerFile(event.target.files[0]);
          event.target.value = '';
        }}
      />

      <Sidebar activeView={activeView} onSelect={(view) => { setActiveView(view); setSearchQuery(''); setFilterActive(false); }} snapshot={snapshot} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar
          activeView={activeView}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterActive={filterActive}
          onToggleFilter={() => setFilterActive((current) => !current)}
          onUpload={activeView === 'viewer' ? () => viewerUploadRef.current?.click() : openAnalyzerUpload}
        />
        {activeView === 'dashboard' ? <StatsStrip snapshot={snapshot} /> : null}

        {activeView === 'dashboard' ? (
          <DashboardOverview
            snapshot={snapshot}
            searchQuery={searchQuery}
            filterActive={filterActive}
            onOpenAnalysis={openAnalysisFromId}
            onOpenGarage={openAnalysisFromId}
            onOpenCalculator={() => setActiveView('calculator')}
            onSetActiveView={setActiveView}
            onCarProfilesChange={refreshSnapshot}
          />
        ) : null}

        {activeView === 'analyzer' ? (
          <AnalyzerWorkspace
            carDetails={carDetails}
            onCarDetailsChange={(key, value) => setCarDetails((current) => ({ ...current, [key]: value }))}
            analysisState={analysisState}
            onUpload={openAnalyzerUpload}
            onCompareUpload={() => analyzerCompareRef.current?.click()}
            onReset={() => setAnalysisState({ analysis: null, csvText: '', compareAnalysis: null, loading: false, error: null })}
            onOpenViewer={() => {
              if (!analysisState.csvText) return;
              setViewerSource({ csvText: analysisState.csvText, filename: analysisState.analysis?.filename || 'analyzed-log.csv' });
              startTransition(() => setActiveView('viewer'));
            }}
            onOpenCalculator={() => startTransition(() => setActiveView('calculator'))}
            searchQuery={searchQuery}
            filterActive={filterActive}
          />
        ) : null}

        {activeView === 'viewer' ? (
          <ViewerWorkspace
            viewerData={viewerData}
            selectedChannels={selectedChannels}
            onToggleChannel={(channel) => setSelectedChannels((current) => {
              const next = new Set(current);
              if (next.has(channel)) next.delete(channel);
              else next.add(channel);
              return next;
            })}
            onUpload={() => viewerUploadRef.current?.click()}
            onSetChannels={(channels) => setSelectedChannels(channels)}
            searchQuery={searchQuery}
            filterActive={filterActive}
            lineWidth={activeLineWidth}
          />
        ) : null}

        {activeView === 'calculator' ? (
          <CalculatorWorkspace snapshot={snapshot} onSnapshotRefresh={refreshSnapshot} searchQuery={searchQuery} />
        ) : null}

        {activeView === 'garage' ? (
          <GarageWorkspace
            snapshot={snapshot}
            onSnapshotRefresh={refreshSnapshot}
            onAnalyzeWithCar={(car) => {
              setCarDetails({ ethanol: car.ethanol ?? '', engine: car.engine || '', tuneStage: car.tuneStage || '' });
              setActiveView('analyzer');
            }}
          />
        ) : null}

        {activeView === 'archive' ? (
          <ArchiveWorkspace
            snapshot={snapshot}
            onSnapshotRefresh={refreshSnapshot}
            searchQuery={searchQuery}
            filterActive={filterActive}
            onOpenAnalysis={openAnalysisFromId}
            onOpenViewer={openViewerFromId}
            carProfiles={getCarProfiles()}
          />
        ) : null}

        {activeView === 'compare' ? (
          <CompareWorkspace garageLogs={snapshot.garageLogs} />
        ) : null}

        {activeView === 'updates' ? (
          <UpdateLogWorkspace searchQuery={searchQuery} />
        ) : null}

        {activeView === 'settings' ? (
          <SettingsWorkspace snapshot={snapshot} onSettingChange={handleSettingChange} onSnapshotRefresh={refreshSnapshot} searchQuery={searchQuery} />
        ) : null}
      </div>
    </motion.div>
  );
}
