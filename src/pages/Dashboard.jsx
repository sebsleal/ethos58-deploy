import { useRef, useState, useEffect, useMemo } from 'react';
import { ArrowRight, Activity, Droplet, FileText, Settings2, Zap, MonitorPlay, CheckCircle, AlertTriangle, Trash2, Heart, TrendingUp, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { getRecentLogs, clearRecentLogs, getActiveBlend, clearActiveBlend, getLogResult } from '../utils/storage';
import { hapticLight } from '../utils/haptics';

const STATUS_ICON = {
  Safe:    <CheckCircle size={14} className="text-green-400" />,
  Caution: <AlertTriangle size={14} className="text-yellow-400" />,
  Risk:    <AlertTriangle size={14} className="text-red-400" />,
};

const STATUS_COLOR = {
  Safe:    'text-green-400 bg-green-500/10 border-green-500/20',
  Caution: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  Risk:    'text-red-400 bg-red-500/10 border-red-500/20',
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatShortDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function scoreColor(score) {
  if (score === null || score === undefined) return '#71717a';
  if (score >= 80) return '#22c55e';
  if (score >= 55) return '#eab308';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score === null || score === undefined) return '—';
  if (score >= 80) return 'Good';
  if (score >= 55) return 'Caution';
  return 'Risk';
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function average(nums) {
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function toNumericValue(value) {
  if (value === null || value === undefined || value === '—' || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// SVG ring progress component
function HealthRing({ score, size = 80 }) {
  const r = (size - 10) / 2;
  const circ = 2 * Math.PI * r;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;
  const color = scoreColor(score);

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={8}
        className="text-gray-200 dark:text-zinc-800" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
    </svg>
  );
}

function HealthScorePanel({ log }) {
  const score = log?.healthScore ?? null;
  const color = scoreColor(score);

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <HealthRing score={score} size={80} />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold" style={{ color }}>{score ?? '—'}</span>
        </div>
      </div>
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">{scoreLabel(score)}</p>
        {log ? (
          <>
            <p className="text-xs text-gray-500 dark:text-zinc-400 truncate max-w-[140px]">{log.filename}</p>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{formatDate(log.date)}</p>
          </>
        ) : (
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">No logs analyzed yet</p>
        )}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-gray-500 dark:text-zinc-400 mb-1">{label}</p>
      <p className="font-semibold" style={{ color: scoreColor(d.healthScore) }}>
        Score {d.healthScore ?? '—'} — {scoreLabel(d.healthScore)}
      </p>
      {d.sampleSize > 1 && (
        <p className="text-gray-400 dark:text-zinc-500">{d.sampleSize} logs in group</p>
      )}
      {d.timingPull !== null && d.timingPull !== undefined && (
        <p className="text-gray-400 dark:text-zinc-500">Timing pull avg {d.timingPull}°</p>
      )}
    </div>
  );
};

const Dashboard = () => {
  const [recentLogs, setRecentLogs] = useState([]);
  const [activeBlend, setActiveBlend] = useState(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [trendFilter, setTrendFilter] = useState('date');
  const startTouchYRef = useRef(null);
  const pullDistanceRef = useRef(0); // mirrors pullDistance for use in non-reactive closures
  const refreshingRef = useRef(false);
  const refreshTimeoutRef = useRef(null);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  const loadDashboardData = () => {
    setRecentLogs(getRecentLogs());
    setActiveBlend(getActiveBlend());
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const getScrollContainer = () => {
    return rootRef.current?.closest('[data-scroll-container]') ?? null;
  };

  const finishRefresh = () => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshingRef.current = false;
      setPullDistance(0);
      setRefreshing(false);
      refreshTimeoutRef.current = null;
    }, 350);
  };

  const triggerRefresh = () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    void hapticLight();
    loadDashboardData();
    finishRefresh();
  };

  useEffect(() => {
    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []);

  // Non-passive touch listeners so preventDefault() works on iOS WebView
  // (React's onTouchMove is passive by default, which silently ignores preventDefault)
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onStart = (e) => {
      if (refreshingRef.current) {
        startTouchYRef.current = null;
        return;
      }
      const scrollEl = getScrollContainer();
      if (!scrollEl || scrollEl.scrollTop > 0) { startTouchYRef.current = null; return; }
      startTouchYRef.current = e.touches[0].clientY;
    };

    const onMove = (e) => {
      if (refreshingRef.current) return;
      if (startTouchYRef.current === null) return;
      const scrollEl = getScrollContainer();
      if (!scrollEl || scrollEl.scrollTop > 0) return;
      const delta = e.touches[0].clientY - startTouchYRef.current;
      if (delta <= 0) { pullDistanceRef.current = 0; setPullDistance(0); return; }
      e.preventDefault(); // stops native overscroll competing on iOS
      const clamped = Math.min(delta, 120);
      pullDistanceRef.current = clamped;
      setPullDistance(clamped);
    };

    const onEnd = () => {
      if (refreshingRef.current) {
        startTouchYRef.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      if (startTouchYRef.current === null) return;
      startTouchYRef.current = null;
      const dist = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (dist >= 70) triggerRefresh();
    };

    const onCancel = () => {
      startTouchYRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearLogs = () => {
    clearRecentLogs();
    setRecentLogs([]);
  };

  const handleClearBlend = () => {
    clearActiveBlend();
    setActiveBlend(null);
  };

  const mostRecentLog = recentLogs[0] || null;

  const filteredTrendLogs = useMemo(() => {
    return recentLogs.filter(log => log.healthScore !== null && log.healthScore !== undefined);
  }, [recentLogs]);

  const timelineData = useMemo(() => {
    const sorted = [...filteredTrendLogs].sort((a, b) => new Date(a.date) - new Date(b.date));

    if (trendFilter === 'date') {
      return sorted.map(l => ({
        label: formatShortDate(l.date),
        groupKey: l.date,
        healthScore: l.healthScore,
        baselineScore: null,
        timingPull: l.timingPull,
        sampleSize: 1,
      }));
    }

    const grouped = sorted.reduce((acc, log) => {
      let groupKey = null;
      let label = null;

      if (trendFilter === 'ethanol') {
        groupKey = String(log.ethanol ?? '—');
        label = `E${groupKey}`;
      } else if (trendFilter === 'tune') {
        groupKey = String(log.tune || 'Unknown');
        label = groupKey;
      } else if (trendFilter === 'ambient') {
        const ambient = toNumericValue(log.ambientTemp);
        if (ambient === null) return acc;
        const bucketStart = Math.floor(ambient / 10) * 10;
        const bucketEnd = bucketStart + 9;
        groupKey = `${bucketStart}`;
        label = `${bucketStart}–${bucketEnd}°F`;
      } else if (trendFilter === 'month') {
        const dt = new Date(log.date);
        const month = String(dt.getMonth() + 1).padStart(2, '0');
        groupKey = `${dt.getFullYear()}-${month}`;
        label = formatMonthLabel(groupKey);
      }

      if (!groupKey || !label) return acc;
      if (!acc[groupKey]) acc[groupKey] = { key: groupKey, label, values: [], timing: [] };
      acc[groupKey].values.push(log.healthScore);
      const pull = toNumericValue(log.timingPull);
      if (pull !== null) acc[groupKey].timing.push(pull);
      return acc;
    }, {});

    return Object.values(grouped)
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
      .map(group => ({
        label: group.label,
        groupKey: group.key,
        healthScore: Number(average(group.values).toFixed(1)),
        baselineScore: 75,
        timingPull: average(group.timing) !== null ? Number(average(group.timing).toFixed(1)) : null,
        sampleSize: group.values.length,
      }));
  }, [filteredTrendLogs, trendFilter]);

  return (
    <div
      ref={rootRef}
      className="space-y-8 animate-fade-in relative"
      style={{ transform: pullDistance > 0 ? `translateY(${Math.min(pullDistance, 80) / 3}px)` : 'translateY(0)', transition: refreshing ? 'transform 0.2s ease' : 'none' }}
    >
      {(pullDistance > 0 || refreshing) && (
        <div className="absolute left-1/2 -translate-x-1/2 -top-2 z-10">
          <div className="px-3 py-1 rounded-full bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 text-[11px] font-semibold text-gray-500 dark:text-zinc-300 shadow-sm">
            {refreshing ? 'Refreshing logs…' : pullDistance >= 70 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      )}
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">Overview of your analysis tools and recent logs.</p>
        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-2">Batch tip: drag a folder of CSVs into Log Analyzer to quickly build trend baselines.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* Left Column */}
        <div className="lg:col-span-8 flex flex-col gap-6">

          {/* Quick Start */}
          <SectionPanel title="Quick Start" icon={Zap}>
            <Link to="/viewer" className="flex flex-col items-center justify-center h-48 mt-4 rounded-xl border-2 border-dashed border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/20 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors text-gray-500 dark:text-zinc-400 cursor-pointer group">
              <FileText size={32} className="mb-3 opacity-50 group-hover:opacity-80 group-hover:text-brand-500 transition-colors" strokeWidth={1.5} />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Open Log Viewer</p>
              <p className="text-xs mt-1">Analyze a BM3 or MHD CSV</p>
            </Link>
          </SectionPanel>

          {/* Health Score Timeline */}
          {timelineData.length >= 2 && (
            <SectionPanel
              title="Tune Health Timeline"
              icon={TrendingUp}
              action={(
                <div className="flex items-center gap-2">
                  <Upload size={12} className="text-gray-400 dark:text-zinc-500" />
                  <select
                    value={trendFilter}
                    onChange={(event) => setTrendFilter(event.target.value)}
                    className="text-xs rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-gray-600 dark:text-zinc-300"
                  >
                    <option value="date">By date</option>
                    <option value="month">By month</option>
                    <option value="ethanol">By ethanol</option>
                    <option value="tune">By tune</option>
                    <option value="ambient">By ambient temp</option>
                  </select>
                </div>
              )}
            >
              <div className="mt-3 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timelineData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#71717a' }} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={80} stroke="#22c55e" strokeDasharray="3 3" strokeOpacity={0.4} />
                    <ReferenceLine y={55} stroke="#eab308" strokeDasharray="3 3" strokeOpacity={0.4} />
                    {trendFilter !== 'date' && (
                      <Line
                        type="monotone"
                        dataKey="baselineScore"
                        stroke="#a1a1aa"
                        strokeDasharray="4 4"
                        dot={false}
                        strokeWidth={1.5}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="healthScore"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props;
                        return (
                          <circle key={payload.groupKey || payload.label} cx={cx} cy={cy} r={3}
                            fill={scoreColor(payload.healthScore)} stroke="none" />
                        );
                      }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-zinc-600 mt-1 text-right">
                {trendFilter === 'date'
                  ? 'Per-log snapshots by date'
                  : 'Trend mode: grouped averages with baseline at 75'}
              </p>
            </SectionPanel>
          )}

          {/* Recently Analyzed Logs */}
          <SectionPanel
            title="Recently Analyzed Logs"
            icon={FileText}
            action={recentLogs.length > 0 && (
              <button onClick={handleClearLogs} className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors">
                <Trash2 size={12} /> Clear
              </button>
            )}
          >
            {recentLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-24 mt-4 rounded-lg border border-dashed border-gray-200 dark:border-zinc-800 bg-gray-50/50 dark:bg-zinc-900/20 text-gray-500 dark:text-zinc-500">
                <p className="text-xs font-medium">No logs analyzed yet.</p>
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-2">
                {recentLogs.map(log => (
                  <button
                    key={log.id}
                    onClick={() => {
                      const result = getLogResult(log.id);
                      navigate('/analyzer', result?.analysis ? { state: { analysis: result.analysis } } : {});
                    }}
                    className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-zinc-900/40 border border-gray-100 dark:border-zinc-800 hover:border-brand-500/30 transition-colors group text-left w-full"
                  >
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase shrink-0 ${STATUS_COLOR[log.status] || STATUS_COLOR.Safe}`}>
                      {STATUS_ICON[log.status]}
                      {log.status}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{log.filename}</p>
                      <p className="text-xs text-gray-400 dark:text-zinc-500">{log.engine} · E{log.ethanol} · {formatDate(log.date)}</p>
                    </div>
                    {log.healthScore !== null && log.healthScore !== undefined && (
                      <span className="text-xs font-bold shrink-0" style={{ color: scoreColor(log.healthScore) }}>
                        {log.healthScore}
                      </span>
                    )}
                    {log.afr && <p className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">AFR {log.afr}</p>}
                    <ArrowRight size={14} className="text-gray-300 dark:text-zinc-600 group-hover:text-brand-400 transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </SectionPanel>

        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Tune Health Score */}
          <SectionPanel title="Tune Health" icon={Heart}>
            <div className="mt-2 mb-2">
              <HealthScorePanel log={mostRecentLog} />
              {mostRecentLog?.timingPull !== null && mostRecentLog?.timingPull !== undefined && (
                <div className="mt-3 pt-3 border-t border-gray-100 dark:border-zinc-800 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-50 dark:bg-zinc-900/40 border border-gray-100 dark:border-zinc-800 rounded-lg p-2 text-center">
                    <p className="font-bold text-gray-900 dark:text-white">{mostRecentLog.timingPull}°</p>
                    <p className="text-gray-500 dark:text-zinc-500">Max Timing Pull</p>
                  </div>
                  {mostRecentLog.afr && (
                    <div className="bg-gray-50 dark:bg-zinc-900/40 border border-gray-100 dark:border-zinc-800 rounded-lg p-2 text-center">
                      <p className="font-bold text-gray-900 dark:text-white">{mostRecentLog.afr}</p>
                      <p className="text-gray-500 dark:text-zinc-500">Min AFR</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </SectionPanel>

          {/* Active Blend */}
          <SectionPanel
            title="Active Blend"
            icon={Droplet}
            action={activeBlend && (
              <button onClick={handleClearBlend} className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-red-400 transition-colors">
                <Trash2 size={12} /> Clear
              </button>
            )}
          >
            {activeBlend ? (
              <div className="mt-2 mb-4">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-500 font-bold text-sm">
                    E{activeBlend.resultingBlend}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-white">E{activeBlend.resultingBlend} Blend</p>
                    <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">{formatDate(activeBlend.date)}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-lg p-2 text-center">
                    <p className="text-brand-600 dark:text-brand-400 font-bold text-base">{activeBlend.e85Gallons} gal</p>
                    <p className="text-gray-500 dark:text-zinc-400">E85</p>
                  </div>
                  <div className="bg-gray-50 dark:bg-zinc-900/40 border border-gray-200 dark:border-zinc-800 rounded-lg p-2 text-center">
                    <p className="text-gray-800 dark:text-white font-bold text-base">{activeBlend.pumpGallons} gal</p>
                    <p className="text-gray-500 dark:text-zinc-400">{activeBlend.pumpOctane ?? 93} Oct</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4 mt-2 mb-6">
                <div className="w-12 h-12 rounded-lg bg-gray-100 dark:bg-zinc-800/80 border border-gray-200 dark:border-zinc-700 flex items-center justify-center text-gray-400 dark:text-zinc-500 font-medium text-lg">—</div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">None Active</p>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Calculate blend to view</p>
                </div>
              </div>
            )}
            <Link to="/calculator" className="flex items-center justify-center w-full py-2 bg-white dark:bg-[#121214] border border-gray-200 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/80 text-gray-900 dark:text-white rounded-lg shadow-sm text-sm font-medium transition-colors gap-2">
              <Settings2 size={16} strokeWidth={1.5} />
              {activeBlend ? 'Recalculate' : 'Configure Target'}
            </Link>
          </SectionPanel>

          {/* Quick Actions */}
          <div className="flex flex-col gap-3">
            <h2 className="text-xs font-semibold tracking-wide text-gray-500 dark:text-zinc-500 uppercase px-1 mt-2">Quick Actions</h2>
            <Link to="/calculator" className="flex items-center gap-3 w-full p-3 bg-white dark:bg-[#121214] border border-gray-200 dark:border-zinc-800/80 rounded-xl shadow-sm hover:border-brand-500/50 hover:bg-brand-50/50 dark:hover:bg-brand-500/5 transition-all group">
              <div className="bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 p-2 rounded-lg border border-brand-100 dark:border-brand-500/20">
                <Droplet size={16} strokeWidth={2} />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">Calculate Content</span>
              <ArrowRight size={16} className="ml-auto text-gray-400 dark:text-zinc-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 group-hover:translate-x-0.5 transition-all" strokeWidth={1.5} />
            </Link>
            <Link to="/viewer" className="flex items-center gap-3 w-full p-3 bg-white dark:bg-[#121214] border border-gray-200 dark:border-zinc-800/80 rounded-xl shadow-sm hover:border-gray-300 dark:hover:border-zinc-600 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-all group">
              <div className="bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 p-2 rounded-lg border border-gray-200 dark:border-zinc-700">
                <MonitorPlay size={16} strokeWidth={2} />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white transition-colors">View Data Log</span>
              <ArrowRight size={16} className="ml-auto text-gray-400 dark:text-zinc-500 group-hover:text-gray-900 dark:group-hover:text-white group-hover:translate-x-0.5 transition-all" strokeWidth={1.5} />
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
};

const SectionPanel = ({ title, icon: Icon, action, children }) => (
  <div className="bg-white dark:bg-[#121214] border border-gray-200 dark:border-zinc-800/80 rounded-xl p-5 shadow-sm">
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2 text-gray-900 dark:text-white">
        {Icon && <Icon size={16} className="text-gray-500 dark:text-zinc-400" strokeWidth={1.5} />}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {action && <div>{action}</div>}
    </div>
    {children}
  </div>
);

export default Dashboard;
