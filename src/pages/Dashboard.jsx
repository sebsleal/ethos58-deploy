import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  Activity,
  ArrowRight,
  CalendarClock,
  Droplet,
  FileText,
  Flame,
  Heart,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Upload,
  Zap,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { clearActiveBlend, clearRecentLogs, getActiveBlend, getLogResult, getRecentLogs } from '../utils/storage';
import { hapticLight } from '../utils/haptics';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { ActionTile, ChartCard, InsetCard, MetricPill, PageHeader, SectionTitle, StatusPill, SurfaceCard } from '../components/ui';

function formatDate(iso) {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatShortDate(iso) {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatTimeAgo(iso) {
  const deltaMs = new Date(iso).getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(deltaMs / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}

function scoreColor(score) {
  if (score === null || score === undefined) return '#94a3b8';
  if (score >= 80) return '#14b8a6';
  if (score >= 55) return '#f59e0b';
  return '#ef4444';
}

function scoreLabel(score) {
  if (score === null || score === undefined) return 'No Data';
  if (score >= 80) return 'Healthy';
  if (score >= 55) return 'Watch';
  return 'Risk';
}

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maxFinite(values) {
  let best = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (best === null || value > best) best = value;
  }
  return best;
}

function minFinite(values) {
  let best = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (best === null || value < best) best = value;
  }
  return best;
}

function buildBoostSeries(analysis) {
  const chartData = Array.isArray(analysis?.chartData) ? analysis.chartData : [];
  const rows = chartData
    .map((point, index) => {
      const boost = Number(point?.boost);
      if (!Number.isFinite(boost)) return null;
      const rpm = Number(point?.rpm);
      const time = Number(point?.time);
      return {
        key: index,
        axisValue: Number.isFinite(rpm) ? rpm : Number.isFinite(time) ? time : index + 1,
        boost,
      };
    })
    .filter(Boolean);

  return {
    data: rows,
    label: rows.some((point) => point.axisValue > 1000) ? 'RPM' : 'Time',
  };
}

function buildTimingSeries(analysis) {
  const scatter = Array.isArray(analysis?.knockScatter) ? analysis.knockScatter : [];
  if (!scatter.length) return [];

  const groups = new Map();
  scatter.forEach((point) => {
    const rpm = Number(point?.rpm);
    const pull = Number(point?.pull);
    if (!Number.isFinite(rpm) || !Number.isFinite(pull)) return;
    const bucket = Math.round(rpm / 250) * 250;
    const current = groups.get(bucket);
    if (!current || pull < current.pull) {
      groups.set(bucket, { rpm: bucket, pull });
    }
  });

  return [...groups.values()].sort((a, b) => a.rpm - b.rpm);
}

function HealthRing({ score, size = 132 }) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circumference;

  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="rgba(148,163,184,0.18)"
        strokeWidth={9}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={scoreColor(score)}
        strokeWidth={9}
        strokeDasharray={`${dash} ${circumference}`}
        strokeLinecap="round"
        style={{ transition: 'stroke-dasharray 0.55s ease' }}
      />
    </svg>
  );
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="app-chart-tooltip min-w-[180px] p-3 text-xs shadow-lg">
      <p className="mb-1 app-muted">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="mt-1 font-medium app-heading">
          <span className="app-muted">{entry.name}:</span> {entry.value ?? '—'}
        </p>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [recentLogs, setRecentLogs] = useState([]);
  const [activeBlend, setActiveBlend] = useState(null);
  const rootRef = useRef(null);
  const navigate = useNavigate();

  const loadDashboardData = useCallback(() => {
    setRecentLogs(getRecentLogs());
    setActiveBlend(getActiveBlend());
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleRefresh = useCallback(async () => {
    await hapticLight();
    loadDashboardData();
  }, [loadDashboardData]);

  const { pullDistance, refreshing } = usePullToRefresh(rootRef, {
    getScrollContainer: () => rootRef.current?.closest('[data-scroll-container]') ?? null,
    onRefresh: handleRefresh,
  });

  const mostRecentLog = recentLogs[0] || null;
  const scoredLogs = useMemo(
    () => recentLogs.filter((log) => log.healthScore !== null && log.healthScore !== undefined),
    [recentLogs],
  );

  const averageHealthScore = useMemo(() => {
    const value = average(scoredLogs.map((log) => log.healthScore));
    return value === null ? null : Number(value.toFixed(1));
  }, [scoredLogs]);

  const mostRecentAnalysis = useMemo(
    () => (mostRecentLog ? getLogResult(mostRecentLog.id)?.analysis ?? null : null),
    [mostRecentLog],
  );

  const boostSeries = useMemo(() => buildBoostSeries(mostRecentAnalysis), [mostRecentAnalysis]);
  const timingSeries = useMemo(() => buildTimingSeries(mostRecentAnalysis), [mostRecentAnalysis]);

  const recentLogCards = useMemo(
    () => recentLogs.slice(0, 3).map((log) => {
      const analysis = getLogResult(log.id)?.analysis ?? null;
      const peakBoost = maxFinite((analysis?.chartData || []).map((point) => Number(point?.boost)));
      const peakTiming = analysis?.metrics?.timingCorrections?.max_correction ?? log.timingPull ?? null;
      return {
        ...log,
        peakBoost: peakBoost !== null ? Number(peakBoost.toFixed(1)) : null,
        peakTiming: Number.isFinite(Number(peakTiming)) ? Number(peakTiming) : null,
      };
    }),
    [recentLogs],
  );

  const healthBreakdown = mostRecentLog ? [
    { label: 'Status', value: mostRecentLog.status },
    { label: 'Timing Pull', value: mostRecentLog.timingPull !== null && mostRecentLog.timingPull !== undefined ? `${mostRecentLog.timingPull}°` : '—' },
    { label: 'AFR Floor', value: mostRecentLog.afr ? String(mostRecentLog.afr) : '—' },
    { label: 'Recent Logs', value: `${recentLogs.length}` },
  ] : [];

  const peakBoost = useMemo(
    () => maxFinite((mostRecentAnalysis?.chartData || []).map((point) => Number(point?.boost))),
    [mostRecentAnalysis],
  );

  const worstTiming = useMemo(
    () => minFinite(timingSeries.map((point) => Number(point.pull))),
    [timingSeries],
  );

  return (
    <div
      ref={rootRef}
      className="relative space-y-6 xl:space-y-7"
      style={{
        transform: pullDistance > 0 ? `translateY(${Math.min(pullDistance, 84) / 3}px)` : 'translateY(0)',
        transition: refreshing ? 'transform 0.22s ease' : 'none',
      }}
    >
      {(pullDistance > 0 || refreshing) && (
        <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
          <div className="app-pill px-3 py-1.5 text-[11px] font-semibold">
            {refreshing ? 'Refreshing dashboard…' : pullDistance >= 70 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        </div>
      )}

      <PageHeader
        eyebrow="Control Center"
        title="B58 Gen1 Overview"
        description="Blend planning, log review, and tune health in one place."
        meta={
          <>
            <MetricPill icon={CalendarClock} label="Last Log" value={mostRecentLog ? formatTimeAgo(mostRecentLog.date) : 'No data'} />
            <MetricPill icon={ShieldCheck} label="Health Score" value={averageHealthScore ?? '—'} />
            <MetricPill icon={Droplet} label="Target Blend" value={activeBlend ? `E${activeBlend.resultingBlend}` : 'Unset'} />
            <MetricPill icon={FileText} label="Recent Logs" value={recentLogs.length} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <SurfaceCard strong className="h-full">
            <SectionTitle
              icon={Zap}
              title="Quick Start"
              subtitle="Drop in a CSV, run instant health analysis, or jump straight into fuel planning."
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <ActionTile
                to="/analyzer"
                icon={Upload}
                title="Upload Logs"
                description="Drop in a BM3 or MHD CSV, run instant health analysis, and save the result to your garage."
                meta="Analyzer workflow"
                emphasized
              />
              <ActionTile
                to="/calculator"
                icon={Droplet}
                title="Calculate Blend"
                description="Set your current tank state and get precise E85 and pump instructions."
                meta="Fuel workflow"
              />
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-3">
          <SurfaceCard strong className="h-full">
            <SectionTitle
              icon={Heart}
              title="Tune Health Score"
              subtitle="Latest confidence snapshot from your most recent analyzed pull."
            />
            <div className="mt-4">
              {/* Ring + label row */}
              <div className="flex items-center gap-4">
                <div className="relative h-[96px] w-[96px] shrink-0">
                  <HealthRing score={mostRecentLog?.healthScore ?? null} size={96} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[2rem] font-semibold leading-none tracking-tight" style={{ color: scoreColor(mostRecentLog?.healthScore ?? null) }}>
                      {mostRecentLog?.healthScore ?? '—'}
                    </span>
                    <span className="mt-0.5 text-[10px] app-muted">/ 100</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold app-heading">{scoreLabel(mostRecentLog?.healthScore ?? null)}</p>
                  <p className="mt-0.5 text-[12px] leading-snug app-muted">
                    {mostRecentLog ? formatDate(mostRecentLog.date) : 'Upload a log to compute health.'}
                  </p>
                </div>
              </div>

              {/* Metrics 2-col grid */}
              {healthBreakdown.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {healthBreakdown.map((item) => (
                    <div key={item.label} className="rounded border border-[var(--app-border)] bg-[var(--app-card-inset)] px-3 py-2.5">
                      <p className="text-[10.5px] font-medium app-muted">{item.label}</p>
                      <p className="mt-0.5 text-sm font-semibold app-heading">{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SurfaceCard>
        </div>

        <div className="xl:col-span-4">
          <SurfaceCard strong className="h-full">
            <SectionTitle
              icon={Droplet}
              title="Active Blend"
              subtitle={activeBlend ? 'Pinned blend target and recent fill instruction set.' : 'No active blend is currently pinned.'}
              action={activeBlend ? (
                <button
                  onClick={() => {
                    if (!window.confirm('Clear the active blend from the dashboard?')) return;
                    clearActiveBlend();
                    setActiveBlend(null);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium app-muted transition-colors hover:text-red-500"
                >
                  <Trash2 size={13} />
                  Clear
                </button>
              ) : null}
            />

            {activeBlend ? (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                  <div>
                    <p className="text-[2.6rem] font-semibold leading-none tracking-tight app-heading">E{activeBlend.resultingBlend}</p>
                    <p className="mt-3 text-sm app-muted">Estimated octane {activeBlend.resultingOctane ?? '—'} · {formatDate(activeBlend.date)}</p>
                  </div>
                  <StatusPill status={activeBlend.warnings?.length ? 'Caution' : 'Safe'} />
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <InsetCard>
                    <p className="text-xs font-semibold uppercase tracking-wide app-muted">Target Blend</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight app-heading">E{activeBlend.resultingBlend}</p>
                  </InsetCard>
                  <InsetCard>
                    <p className="text-xs font-semibold uppercase tracking-wide app-muted">Peak Boost</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight app-heading">{peakBoost !== null ? `${peakBoost.toFixed(1)} psi` : '—'}</p>
                  </InsetCard>
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  <InsetCard>
                    <p className="text-xs font-semibold uppercase tracking-wide app-muted">E85 Mix</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight app-heading">{activeBlend.e85Gallons} gal</p>
                  </InsetCard>
                  <InsetCard>
                    <p className="text-xs font-semibold uppercase tracking-wide app-muted">Pump Mix</p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight app-heading">{activeBlend.pumpGallons} gal</p>
                  </InsetCard>
                </div>
              </div>
            ) : (
              <InsetCard className="mt-5 flex min-h-[160px] items-center justify-center text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium app-heading">No active blend</p>
                  <p className="text-sm app-muted">Use the calculator to pin an ethanol target and recent fill instructions.</p>
                </div>
              </InsetCard>
            )}

            <Link
              to="/calculator"
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded border border-[var(--app-border)] bg-[var(--app-card-inset)] px-4 py-2.5 text-sm font-medium app-heading transition-all hover:border-[var(--app-border-strong)] hover:text-brand-500"
            >
              <Droplet size={15} />
              {activeBlend ? 'Recalculate Blend' : 'Calculate Target'}
            </Link>
          </SurfaceCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <SurfaceCard className="xl:col-span-5">
          <SectionTitle
            icon={FileText}
            title="Recent Data Logs"
            subtitle="Latest pulls from your garage-ready analysis history."
            action={recentLogs.length > 0 ? (
              <button
                onClick={() => {
                  if (!window.confirm('Clear all recent data logs from the dashboard history?')) return;
                  clearRecentLogs();
                  setRecentLogs([]);
                }}
                className="inline-flex items-center gap-1 text-xs font-medium app-muted transition-colors hover:text-red-500"
              >
                <Trash2 size={13} />
                Clear
              </button>
            ) : null}
          />

          <div className="mt-4 space-y-3">
            {recentLogCards.map((log, index) => (
              <InsetCard key={log.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <StatusPill status={log.status} />
                      <span className="text-xs app-muted">{formatTimeAgo(log.date)}</span>
                    </div>
                    <div>
                      <p className="text-[1.1rem] font-semibold tracking-[-0.03em] app-heading">Pull #{recentLogs.length - index}</p>
                      <p className="mt-1 text-sm app-muted">{log.filename}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[1.35rem] font-semibold tracking-tight" style={{ color: scoreColor(log.healthScore) }}>
                      {log.healthScore ?? '—'}
                    </p>
                    <p className="text-xs app-muted">Health</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-[var(--app-border)] px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide app-muted">Peak Boost</p>
                    <p className="mt-1 text-base font-semibold app-heading">{log.peakBoost !== null ? `${log.peakBoost} psi` : '—'}</p>
                  </div>
                  <div className="rounded border border-[var(--app-border)] px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide app-muted">Peak Timing</p>
                    <p className="mt-1 text-base font-semibold app-heading">{log.peakTiming !== null ? `${Math.abs(log.peakTiming).toFixed(1)}°` : '—'}</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    onClick={() => {
                      const result = getLogResult(log.id);
                      navigate('/analyzer', result?.analysis ? { state: { analysis: result.analysis } } : {});
                    }}
                    className="inline-flex items-center gap-2 text-sm font-medium app-heading transition-colors hover:text-brand-500"
                  >
                    View data log
                    <ArrowRight size={14} />
                  </button>
                  <span className="text-xs font-medium app-muted">{formatShortDate(log.date)}</span>
                </div>
              </InsetCard>
            ))}

            {recentLogs.length === 0 && (
              <InsetCard className="flex min-h-[220px] items-center justify-center border-dashed text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium app-heading">No recent data logs yet</p>
                  <p className="text-sm app-muted">Analyze your first CSV to populate the control center.</p>
                </div>
              </InsetCard>
            )}
          </div>
        </SurfaceCard>

        <div className="grid gap-4 xl:col-span-7 xl:grid-cols-2">
          <ChartCard
            icon={TrendingUp}
            title={boostSeries.label === 'RPM' ? 'Boost vs RPM' : 'Boost Trace'}
            subtitle="Latest session telemetry, tuned for quick scanability."
          >
            {boostSeries.data.length >= 2 ? (
              <>
                <div className="surface-inset h-[240px] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={boostSeries.data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="boostFill" x1="0" x2="0" y1="0" y2="1">
                          <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.34} />
                          <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--app-chart-grid)" vertical={false} />
                      <XAxis dataKey="axisValue" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<TrendTooltip />} />
                      <Area type="monotone" dataKey="boost" name="Boost" stroke="#2dd4bf" strokeWidth={2.4} fill="url(#boostFill)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-3 text-xs app-muted">
                  {boostSeries.label === 'RPM' ? 'Boost plotted directly against RPM from the latest analyzed pull.' : 'Boost trace from the latest analyzed pull.'}
                </p>
              </>
            ) : (
              <InsetCard className="flex min-h-[240px] items-center justify-center text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium app-heading">No boost curve available yet</p>
                  <p className="text-sm app-muted">Analyze a pull with boost telemetry to populate this card.</p>
                </div>
              </InsetCard>
            )}
          </ChartCard>

          <ChartCard
            icon={Activity}
            title="Timing vs RPM"
            subtitle="Worst timing pull by RPM band from the latest log."
          >
            {timingSeries.length >= 2 ? (
              <>
                <div className="surface-inset h-[240px] p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={timingSeries} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="var(--app-chart-grid)" vertical={false} />
                      <XAxis dataKey="rpm" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} />
                      <Tooltip content={<TrendTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="pull"
                        name="Timing Pull"
                        stroke="#a855f7"
                        strokeWidth={2.4}
                        dot={{ r: 2.5, fill: '#a855f7' }}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs app-muted">
                  <span>Worst pull {worstTiming !== null ? `${worstTiming.toFixed(1)}°` : '—'}</span>
                  <span>{timingSeries.length} sampled buckets</span>
                </div>
              </>
            ) : (
              <InsetCard className="flex min-h-[240px] items-center justify-center text-center">
                <div className="space-y-2">
                  <p className="text-sm font-medium app-heading">Timing map will appear after analysis</p>
                  <p className="text-sm app-muted">Logs with timing correction columns surface an RPM-based pull curve here.</p>
                </div>
              </InsetCard>
            )}
          </ChartCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SurfaceCard>
          <SectionTitle icon={ShieldCheck} title="Health Score" subtitle="Confidence snapshot across your latest sessions." />
          <div className="mt-5">
            <p className="text-[2.2rem] font-semibold tracking-[-0.04em] app-heading">{averageHealthScore ?? '—'}</p>
            <p className="mt-2 text-sm app-muted">Average of your recent analyzed pulls.</p>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SectionTitle icon={Flame} title="AFR Floor" subtitle="Leanest meaningful AFR from the current snapshot." />
          <div className="mt-5">
            <p className="text-[2.2rem] font-semibold tracking-[-0.04em] app-heading">{mostRecentLog?.afr ?? '—'}</p>
            <p className="mt-2 text-sm app-muted">Based on the most recent saved analysis.</p>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <SectionTitle icon={FileText} title="Recent Logs" subtitle="How much fresh data is feeding the control center." />
          <div className="mt-5">
            <p className="text-[2.2rem] font-semibold tracking-[-0.04em] app-heading">{recentLogs.length}</p>
            <p className="mt-2 text-sm app-muted">Saved pulls ready to reopen in the analyzer.</p>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
