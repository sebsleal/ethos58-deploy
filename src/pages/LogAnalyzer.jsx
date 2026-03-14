import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  UploadCloud, Activity, AlertTriangle, CheckCircle, BarChart2, XCircle,
  Lightbulb, Info, Download, GitCompare, MessageSquarePlus, Tag, Cpu, TrendingDown,
} from 'lucide-react';
import { analyzeLog } from '../utils/logAnalyzer';
import { saveRecentLog, saveGarageLog, getAnnotations, saveAnnotations } from '../utils/storage';
import { trackEvent, trackError, trackUploadFailure, trackParserMismatch, trackPerformanceIssue, trackExportFailure } from '../utils/telemetry';
import { hapticSuccess, hapticWarning, hapticError } from '../utils/haptics';
import { mergeCompareChartData } from '../utils/logCompare';
import { PageHeader } from '../components/ui';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, ReferenceLine, ReferenceDot, ScatterChart, Scatter, ZAxis,
} from 'recharts';

const ETHANOL_OPTIONS = [0, 10, 30, 40, 50, 85];
const ENGINE_OPTIONS = ['B58 Gen1', 'B58 Gen2', 'S58', 'N55', 'N54', 'Other'];
const TUNE_OPTIONS = ['Stage 1', 'Stage 2', 'Stage 2+', 'Custom E-tune'];
const FORMAT_COLOR = {
  BM3: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  MHD: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  Unknown: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
};

const COMPARE_CHANNELS = [
  { key: 'afrActual', label: 'AFR Actual', yAxisId: 'left', color: '#f59e0b' },
  { key: 'afrTarget', label: 'AFR Target', yAxisId: 'left', color: '#fbbf24', dashed: true },
  { key: 'boost', label: 'Boost (psi)', yAxisId: 'boost', color: '#60a5fa' },
  { key: 'hpfpActual', label: 'HPFP Actual', yAxisId: 'hpfp', color: '#c084fc' },
  { key: 'hpfpTarget', label: 'HPFP Target', yAxisId: 'hpfp', color: '#e9d5ff', dashed: true },
];

function AfrWarningDot(props) {
  const { cx = 0, cy = 0, payload } = props;
  if (!payload?.isLeanWarning) return <circle r={0} fill="none" />;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="#f43f5e" opacity={0.35} className="animate-ping" style={{ transformOrigin: `${cx}px ${cy}px` }} />
      <circle cx={cx} cy={cy} r={3.5} fill="#f43f5e" stroke="#111113" strokeWidth={1.5} />
    </g>
  );
}

function BoostWarningDot(props) {
  const { cx = 0, cy = 0, payload } = props;
  if (payload?.isHpfpWarning) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill="#f97316" opacity={0.35} className="animate-ping" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={3.5} fill="#f97316" stroke="#111113" strokeWidth={1.5} />
      </g>
    );
  }
  if (payload?.isTimingWarning) return <circle cx={cx} cy={cy} r={3.5} fill="#eab308" stroke="#111113" strokeWidth={1.5} />;
  return <circle r={0} fill="none" />;
}

const LogAnalyzer = () => {
  const location = useLocation();
  const [carDetails, setCarDetails] = useState({ ethanol: 10, engine: 'B58 Gen1', tuneStage: 'Stage 1' });
  const [dragActive, setDragActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('telemetry');
  const workerRef = useRef(null);
  const nextRequestIdRef = useRef(1);
  const unitPref = localStorage.getItem('ethos_units') || 'US';
  const chartRef = useRef(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const [compareAnalysis, setCompareAnalysis] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [compareChannels, setCompareChannels] = useState(() => ({ afrActual: true, boost: true }));
  const [hoverTime, setHoverTime] = useState(null);

  const [annotations, setAnnotations] = useState([]);
  const [annotationInput, setAnnotationInput] = useState('');
  const [pendingAnnotationTime, setPendingAnnotationTime] = useState(null);
  const [showAnnotationInput, setShowAnnotationInput] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (location.state?.analysis) {
      const a = location.state.analysis;
      setAnalysis(a);
      setAnnotations(getAnnotations(a.filename + '_' + a.row_count));
    }
  }, [location.state]);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('../workers/logAnalyzerWorker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    return () => { worker.terminate(); workerRef.current = null; };
  }, []);

  const analyzeViaWorker = (csvText, filename, details) => {
    const worker = workerRef.current;
    if (!worker) return Promise.resolve(analyzeLog(csvText, filename, details));
    const requestId = nextRequestIdRef.current++;
    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId = null;

      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      };

      const onMessage = (event) => {
        if (event.data?.id !== requestId) return;
        if (settled) return;
        settled = true;
        cleanup();
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error || 'Failed to analyze log.'));
      };

      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('The analysis worker stopped before it could finish parsing the log.'));
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Log analysis timed out. Try a smaller file or re-run the upload.'));
      }, 15000);
      worker.postMessage({ id: requestId, csvText, filename, carDetails: details });
    });
  };

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

  const handleFileChange = (e) => { if (e.target.files?.[0]) processFile(e.target.files[0]); };

  const readFileAsText = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsText(file);
  });

  const processBatchFiles = async (files) => {
    const csvFiles = Array.from(files || []).filter((file) => /\.csv$/i.test(file.name));
    if (!csvFiles.length) {
      setError('No CSV files found in selected folder.');
      return;
    }

    setLoading(true);
    setError(null);

    let lastResult = null;
    let importedCount = 0;

    for (const file of csvFiles) {
      try {
        const csvText = await readFileAsText(file);
        const result = await analyzeViaWorker(csvText, file.name, carDetails);
        if (!mountedRef.current) return;
        saveRecentLog(result);
        lastResult = result;
        importedCount += 1;
      } catch (err) {
        trackError('log_analyzer_batch_upload_failed', err, { filename: file.name });
      }
    }

    if (lastResult) {
      if (!mountedRef.current) return;
      setAnalysis(lastResult);
      setAnnotations(getAnnotations(lastResult.filename + '_' + lastResult.row_count));
      trackEvent('log_analyzer_batch_upload_succeeded', { imported_count: importedCount, total_count: csvFiles.length });
      hapticSuccess();
    } else {
      setError('Could not analyze any CSV files from this batch.');
    }

    setLoading(false);
  };

  const handleFolderChange = (e) => {
    if (e.target.files?.length) processBatchFiles(e.target.files);
    e.target.value = '';
  };


  const processFile = (file, isCompare = false) => {
    const startedAt = performance.now();
    if (!isCompare) trackEvent('log_analyzer_upload_started', { filename: file.name, size_bytes: file.size });
    const setter = isCompare ? setCompareLoading : setLoading;
    setter(true);
    if (!isCompare) { setError(null); setAnalysis(null); setCompareAnalysis(null); }
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const result = await analyzeViaWorker(e.target.result, file.name, carDetails);
        if (!mountedRef.current) return;
        if (isCompare) {
          setCompareAnalysis(result);
        } else {
          saveRecentLog(result);
          saveGarageLog(result, e.target.result);
          setAnalysis(result);
          setAnnotations(getAnnotations(result.filename + '_' + result.row_count));
          // Haptic feedback based on overall log health
          if (result?.status === 'Risk') hapticError();
          else if (result?.status === 'Caution') hapticWarning();
          else hapticSuccess();
          const elapsedMs = Math.round(performance.now() - startedAt);
          trackEvent('log_analyzer_upload_succeeded', {
            filename: file.name, row_count: result?.row_count ?? 0,
            elapsed_ms: elapsedMs, status: result?.status ?? 'Unknown',
          });

          if (result?.logFormat === 'Unknown') {
            trackParserMismatch({
              filename: file.name,
              detected_columns: result?.detectedColumns,
              row_count: result?.row_count ?? 0,
            });
          }

          if ((result?.row_count ?? 0) >= 4000 || elapsedMs >= 2500) {
            trackPerformanceIssue('log_analyzer_large_log_performance', {
              filename: file.name,
              row_count: result?.row_count ?? 0,
              elapsed_ms: elapsedMs,
              used_worker: Boolean(workerRef.current),
            });
          }
        }
      } catch (err) {
        if (!mountedRef.current) return;
        if (!isCompare) {
          setError(err.message);
          trackUploadFailure(err, { source: 'log_analyzer', filename: file.name, elapsed_ms: Math.round(performance.now() - startedAt), is_compare: isCompare });
        }
      } finally {
        if (!mountedRef.current) return;
        setter(false);
      }
    };
    reader.onerror = () => {
      const readError = reader.error || new Error('Failed to read file.');
      trackUploadFailure(readError, { source: 'file_reader', filename: file.name, is_compare: isCompare });
      if (!mountedRef.current) return;
      if (isCompare) {
        setCompareLoading(false);
        return;
      }
      setError('Failed to read file.');
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const reset = () => { setAnalysis(null); setError(null); setCompareAnalysis(null); setAnnotations([]); };

  const exportPng = async () => {
    if (!chartRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(chartRef.current, { backgroundColor: '#09090B', scale: 2 });
      const fileName = `ethos85-${analysis?.filename?.replace('.csv', '') || 'chart'}.png`;
      const dataUrl = canvas.toDataURL('image/png');

      if (Capacitor.isNativePlatform()) {
        const [{ Filesystem, Directory }, { Share }] = await Promise.all([
          import('@capacitor/filesystem'),
          import('@capacitor/share'),
        ]);
        const base64 = dataUrl.split(',')[1];
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: base64,
          directory: Directory.Cache,
          recursive: true,
        });
        await Share.share({
          title: 'Ethos85 Chart Export',
          text: 'Exported from Ethos85',
          url: saved.uri,
          dialogTitle: 'Share chart',
        });
        trackEvent('chart_exported_png_shared', { filename: analysis?.filename });
        return;
      }

      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      link.click();
      trackEvent('chart_exported_png_downloaded', { filename: analysis?.filename });
    } catch (err) {
      trackExportFailure(err, {
        filename: analysis?.filename,
        native_platform: Capacitor.isNativePlatform(),
      });
      console.error('Export failed:', err);
    }
  };

  const handleChartClick = (data) => {
    if (!showAnnotationInput) return;
    if (data?.activeLabel === null || data?.activeLabel === undefined) return;
    setPendingAnnotationTime(data.activeLabel);
  };

  const saveAnnotation = () => {
    if (!annotationInput.trim() || pendingAnnotationTime === null) return;
    const newAnnotation = { time: pendingAnnotationTime, label: annotationInput.trim(), id: Date.now() };
    const updated = [...annotations, newAnnotation];
    setAnnotations(updated);
    if (analysis) saveAnnotations(analysis.filename + '_' + analysis.row_count, updated);
    setAnnotationInput('');
    setPendingAnnotationTime(null);
    setShowAnnotationInput(false);
  };

  const removeAnnotation = (id) => {
    const updated = annotations.filter(a => a.id !== id);
    setAnnotations(updated);
    if (analysis) saveAnnotations(analysis.filename + '_' + analysis.row_count, updated);
  };

  const getStatusColor = (status) => {
    if (status === 'Safe')    return 'text-green-400 bg-green-500/10 border-green-500/20';
    if (status === 'Caution') return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
    if (status === 'Risk')    return 'text-red-400 bg-red-500/10 border-red-500/20';
    return 'text-gray-400 bg-gray-100 dark:bg-white/5 border-gray-300 dark:border-white/10';
  };

  const getStatusIcon = (status) => {
    if (status === 'Safe')    return <CheckCircle size={18} className="text-green-400" />;
    if (status === 'Caution') return <AlertTriangle size={18} className="text-yellow-400" />;
    if (status === 'Risk')    return <AlertTriangle size={18} className="text-red-400" />;
    return null;
  };

  const mergedChartData = React.useMemo(() => {
    if (!analysis || !compareAnalysis) return analysis?.chartData || [];
    const baseMap = {};
    (analysis.chartData || []).forEach(pt => { baseMap[pt.time] = { ...pt }; });
    (compareAnalysis.chartData || []).forEach(pt => {
      if (!baseMap[pt.time]) baseMap[pt.time] = { time: pt.time };
      COMPARE_CHANNELS.forEach(({ key }) => {
        baseMap[pt.time][`${key}_b`] = pt[key];
      });
    });
    return Object.values(baseMap).sort((a, b) => Number(a.time) - Number(b.time));
  }, [analysis, compareAnalysis]);

  const compareSummary = React.useMemo(() => {
    if (!analysis || !compareAnalysis) return [];
    const base = analysis.carDetails || {};
    const next = compareAnalysis.carDetails || {};
    const sameEngine = base.engine === next.engine;
    const sameTune = base.tuneStage === next.tuneStage;
    const sameFuel = Number(base.ethanol) === Number(next.ethanol);
    const context = sameEngine && sameTune && sameFuel
      ? 'same pull setup'
      : sameEngine && sameTune
        ? 'same tune, different fuel'
        : sameEngine
          ? 'before vs after tune'
          : 'cross-platform comparison';

    return [
      { title: 'Comparison Context', value: context, detail: `${base.engine || 'Unknown'} → ${next.engine || 'Unknown'}` },
      { title: 'Tune Match', value: sameTune ? 'Same tune' : 'Tune changed', detail: `${base.tuneStage || 'N/A'} → ${next.tuneStage || 'N/A'}` },
      { title: 'Fuel Blend', value: sameFuel ? `Same E${base.ethanol ?? '—'}` : `E${base.ethanol ?? '—'} → E${next.ethanol ?? '—'}`, detail: sameFuel ? 'Ideal for same-pull validation' : 'Before/after blend comparison' },
    ];
  }, [analysis, compareAnalysis]);

  const deltaCards = React.useMemo(() => {
    if (!analysis || !compareAnalysis) return [];
    const fields = [
      { title: 'AFR', path: ['metrics', 'afr', 'actual'], unit: '', precision: 2 },
      { title: 'HPFP', path: ['metrics', 'hpfp', 'actual'], unit: ' psi', precision: 0 },
      { title: 'Timing', path: ['metrics', 'timingCorrections', 'max_correction'], unit: '°', precision: 2 },
      { title: 'IAT', path: ['metrics', 'iat', 'peak_f'], unit: '°F', precision: 0 },
    ];
    const getValue = (obj, path) => path.reduce((acc, key) => acc?.[key], obj);
    const peakBoost = (obj) => {
      const vals = (obj?.chartData || []).map((pt) => Number(pt.boost)).filter((v) => Number.isFinite(v));
      if (!vals.length) return null;
      let peak = vals[0];
      for (let i = 1; i < vals.length; i += 1) {
        if (vals[i] > peak) peak = vals[i];
      }
      return peak;
    };
    return [
      ...fields.map((f) => {
      const a = Number(getValue(analysis, f.path));
      const b = Number(getValue(compareAnalysis, f.path));
      const hasData = Number.isFinite(a) && Number.isFinite(b);
      const delta = hasData ? Number((b - a).toFixed(f.precision)) : null;
      return {
        ...f,
        base: hasData ? a : null,
        compare: hasData ? b : null,
        delta,
      };
    }),
      (() => {
        const base = peakBoost(analysis);
        const compare = peakBoost(compareAnalysis);
        const hasData = Number.isFinite(base) && Number.isFinite(compare);
        return {
          title: 'Boost Peak',
          unit: ' psi',
          base: hasData ? Number(base.toFixed(1)) : null,
          compare: hasData ? Number(compare.toFixed(1)) : null,
          delta: hasData ? Number((compare - base).toFixed(1)) : null,
        };
      })(),
    ];
  }, [analysis, compareAnalysis]);

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Analysis"
        title="Log Analyzer"
        description="Upload BM3 or MHD CSV datalogs for instant health analysis, compare overlays, and guided diagnostics."
        action={analysis ? (
          <div className="flex items-center gap-3 animate-fade-in flex-wrap">
            {analysis.logFormat && analysis.logFormat !== 'Unknown' && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${FORMAT_COLOR[analysis.logFormat] || FORMAT_COLOR.Unknown}`}>
                {analysis.logFormat}
              </span>
            )}
            <span className="app-pill px-3 py-1.5 text-xs font-medium">
              {analysis.carDetails?.engine || 'B58'} · E{analysis.carDetails?.ethanol ?? 10} · {analysis.carDetails?.tuneStage || 'Stage 1'}
            </span>
            <div className={`px-4 py-1.5 rounded-md border flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${getStatusColor(analysis.status)}`}>
              {getStatusIcon(analysis.status)}{analysis.status}
            </div>
          </div>
        ) : null}
      />
      <div className="flex items-center gap-2 rounded-[1rem] border border-orange-200/70 bg-orange-50/85 px-3 py-2 text-sm text-orange-600 dark:border-orange-500/15 dark:bg-orange-500/6 dark:text-orange-400">
        <AlertTriangle size={16} className="shrink-0" />
        <p><strong>Heads up:</strong> Analysis models are currently being trained. Information provided may be inaccurate.</p>
      </div>

      {!analysis && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="surface-card h-fit p-5 md:p-6">
            <h3 className="mb-5 text-xs font-bold uppercase tracking-wider app-muted">Vehicle Profile</h3>
            <div className="space-y-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide app-muted">Engine</label>
                <select value={carDetails.engine} onChange={e => setCarDetails(prev => ({ ...prev, engine: e.target.value }))}
                  className="app-input w-full px-3 py-2 text-sm">
                  {ENGINE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide app-muted">Tune Stage</label>
                <select value={carDetails.tuneStage} onChange={e => setCarDetails(prev => ({ ...prev, tuneStage: e.target.value }))}
                  className="app-input w-full px-3 py-2 text-sm">
                  {TUNE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide app-muted">Fuel Mix</label>
                <div className="flex gap-2 flex-wrap">
                  {ETHANOL_OPTIONS.map(e => (
                    <button key={e} onClick={() => setCarDetails(prev => ({ ...prev, ethanol: e }))}
                      className={`px-3 py-1.5 rounded-[0.85rem] text-xs font-bold transition-all ${carDetails.ethanol === e ? 'bg-slate-900 text-white dark:bg-brand-500' : 'app-button-secondary app-muted hover:border-brand-500/40'}`}
                    >E{e}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 h-full">
            {error && (
              <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <XCircle size={20} className="text-red-400" />
                  <div>
                    <p className="text-sm font-semibold text-red-400">Analysis Failed</p>
                    <p className="text-xs text-red-400/80 mt-0.5">{error}</p>
                  </div>
                </div>
                <button onClick={reset} className="text-xs font-medium text-red-400 border border-red-400/30 px-3 py-1.5 rounded-md">Dismiss</button>
              </div>
            )}
            <div
              className={`surface-card-strong border-2 border-dashed h-full min-h-[300px] flex flex-col items-center justify-center transition-colors relative overflow-hidden group ${dragActive ? 'border-brand-500 bg-brand-500/5' : 'border-gray-300 dark:border-white/10 hover:border-gray-400 dark:hover:border-white/20'}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="surface-inset mb-4 flex h-16 w-16 items-center justify-center rounded-full group-hover:scale-110 transition-transform duration-300">
                <UploadCloud size={32} className={dragActive ? 'text-brand-400' : 'app-muted'} />
              </div>
              <h3 className="text-lg font-semibold app-heading">Drag & Drop Datalog CSV</h3>
              <p className="mt-1 max-w-sm text-center text-sm app-muted">Supports MHD and bootmod3 exported CSV files.</p>
              <div className="mt-6 flex flex-col sm:flex-row items-center gap-2 relative z-10">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="app-button-secondary px-5 py-2 text-sm font-medium"
                >
                  Browse File
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="app-button-primary px-5 py-2 text-sm font-medium"
                >
                  Import Folder
                </button>
                <input ref={fileInputRef} type="file" className="hidden" accept=".csv,text/csv,text/plain,application/vnd.ms-excel" onChange={handleFileChange} />
                <input ref={folderInputRef} type="file" className="hidden" webkitdirectory="" directory="" multiple onChange={handleFolderChange} />
              </div>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="surface-card min-h-[400px] p-16 flex flex-col items-center justify-center">
          <div className="w-12 h-12 border-2 border-gray-300 dark:border-white/10 border-t-brand-400 rounded-full animate-spin" />
          <h3 className="mt-6 text-lg font-semibold app-heading">Analyzing Telemetry...</h3>
          <p className="mt-1 text-sm app-muted">Checking AFR, HPFP targets, and timing corrections.</p>
        </div>
      )}

      {analysis && (
        <div className="space-y-6 animate-fade-in">
          {analysis.summary?.notes?.length > 0 && (
            <div className="space-y-2">
              {analysis.summary.notes.map((note, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${getStatusColor(analysis.status)}`}>
                  <AlertTriangle size={18} className="mt-0.5 shrink-0" />{note}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricBox title="AFR (Air/Fuel)" value={analysis.metrics.afr.actual ?? '—'} target={analysis.metrics.afr.target ? `Target: ${analysis.metrics.afr.target}` : 'WOT avg'} status={analysis.metrics.afr.status} />
            <MetricBox title="HPFP" value={analysis.metrics.hpfp.actual != null ? `${analysis.metrics.hpfp.actual} psi` : '—'} target={analysis.metrics.hpfp.target != null ? `Target: ${analysis.metrics.hpfp.target} psi` : 'No data'} status={analysis.metrics.hpfp.status} />
            <MetricBox title="Intake Air Temp" value={analysis.metrics.iat.peak_f != null ? `${Math.round(unitPref === 'Metric' ? (analysis.metrics.iat.peak_f - 32) * 5 / 9 : analysis.metrics.iat.peak_f)}°${unitPref === 'Metric' ? 'C' : 'F'}` : '—'} target="Peak value" status={analysis.metrics.iat.status} />
            <MetricBox title="Timing Corrections" value={analysis.metrics.timingCorrections.max_correction != null ? `${analysis.metrics.timingCorrections.max_correction}°` : '—'} target={analysis.metrics.timingCorrections.cylinders} status={analysis.metrics.timingCorrections.status} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 flex flex-col gap-4">
              {analysis.diagnostics?.length > 0 && (
                <div className="surface-card p-5 md:p-6">
                  <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                    <Info className="text-brand-400" size={18} /> Diagnostic Workflow
                  </h2>
                  <div className="space-y-3">
                    {analysis.diagnostics.map((card) => (
                      <div key={card.id} className="app-soft-panel p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold app-heading">{card.title}</h3>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${getStatusColor(card.severity)}`}>
                            {card.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed app-muted">{card.evidence}</p>
                        {card.likelyCauses?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide app-muted">Likely Causes</p>
                            <ul className="mt-1 space-y-1">
                              {card.likelyCauses.map((cause, i) => (
                                <li key={i} className="text-xs app-heading">• {cause}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {card.recommendedChecks?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide app-muted">Recommended Checks</p>
                            <ul className="mt-1 space-y-1">
                              {card.recommendedChecks.slice(0, 4).map((check, i) => (
                                <li key={i} className="text-xs app-heading">• {check}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.keyPoints?.length > 0 && (
                <div className="surface-card p-5 md:p-6">
                  <h2 className="mb-5 flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                    <Lightbulb className="text-brand-400" size={18} /> Key Insights
                  </h2>
                  <ul className="space-y-4">
                    {analysis.keyPoints.map((pt, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm app-heading">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 shrink-0 shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
                        <span className="leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.metrics.fuelTrims?.hasData && (
                <div className="surface-card p-5 md:p-6">
                  <h2 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                    <TrendingDown className="text-brand-400" size={18} /> Fuel Trims (LTFT+STFT)
                  </h2>
                  <div className="space-y-3">
                    {[{ label: 'Idle', key: 'idle', statusKey: 'idleStatus' }, { label: 'Cruise', key: 'cruise', statusKey: 'cruiseStatus' }, { label: 'High Load', key: 'highLoad', statusKey: 'highLoadStatus' }].map(({ label, key, statusKey }) => {
                      const val = analysis.metrics.fuelTrims[key];
                      const status = analysis.metrics.fuelTrims[statusKey];
                      if (val === null) return null;
                      return (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <span className="w-16 text-xs font-medium app-muted">{label}</span>
                          <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--app-card-inset)]">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--app-border-strong)]" />
                            <div className={`absolute inset-y-0 rounded-full ${val > 0 ? 'bg-yellow-400' : 'bg-blue-400'}`}
                              style={{ width: `${Math.min(Math.abs(val) * 5, 50)}%`, left: val > 0 ? '50%' : `${50 - Math.min(Math.abs(val) * 5, 50)}%` }} />
                          </div>
                          <span className={`w-10 text-right text-xs font-bold tabular-nums ${status === 'Caution' ? 'text-yellow-400' : 'app-heading'}`}>
                            {val > 0 ? '+' : ''}{val}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {annotations.length > 0 && (
                <div className="surface-card p-5 md:p-6">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                    <Tag size={16} className="text-brand-400" /> Annotations
                  </h2>
                  <ul className="space-y-2">
                    {annotations.map(a => (
                      <li key={a.id} className="group flex items-center justify-between text-xs app-muted">
                        <span><span className="font-mono text-brand-400 mr-2">t={a.time}s</span>{a.label}</span>
                        <button onClick={() => removeAnnotation(a.id)} className="opacity-0 group-hover:opacity-100 text-red-400 ml-2" aria-label={`Remove annotation ${a.label}`}>✕</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="app-toggle-group">
                  {[
                    { id: 'telemetry', label: 'Telemetry', icon: BarChart2 },
                    { id: 'knock', label: 'Knock Map', icon: Cpu },
                    ...(analysis.metrics.fuelTrims?.hasData ? [{ id: 'fueltrims', label: 'Fuel Trims', icon: TrendingDown }] : []),
                  ].map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTab(id)}
                      className={activeTab === id
                        ? 'app-toggle-option app-toggle-option-active flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold'
                        : 'app-toggle-option flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold'}
                      aria-pressed={activeTab === id}
                    >
                      <Icon size={13} />{label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={exportPng} className="app-button-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium">
                    <Download size={13} /> PNG
                  </button>
                  <button onClick={() => setShowCompare(v => !v)}
                    className={`flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-[1.15rem] transition-colors ${showCompare ? 'text-brand-400 border-brand-500/30 bg-brand-500/5' : 'app-button-secondary'}`}
                    aria-pressed={showCompare}
                  >
                    <GitCompare size={13} /> Compare
                  </button>
                  <button onClick={() => setShowAnnotationInput(v => !v)}
                    className={`flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-[1.15rem] transition-colors ${showAnnotationInput ? 'text-brand-400 border-brand-500/30 bg-brand-500/5' : 'app-button-secondary'}`}
                    aria-pressed={showAnnotationInput}
                  >
                    <MessageSquarePlus size={13} /> Annotate
                  </button>
                  <button onClick={reset} className="app-button-primary px-3 py-1.5 text-xs font-medium">
                    New Log
                  </button>
                </div>
              </div>

              {showCompare && (
                <div className="space-y-3 p-3 bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-xl">
                  <div className="flex items-center gap-3">
                    <GitCompare size={14} className="text-brand-500 shrink-0" />
                    <p className="text-xs text-slate-600 dark:text-gray-300 flex-1">
                      {compareAnalysis ? `Comparing: ${compareAnalysis.filename}` : 'Select a second log to overlay on the chart:'}
                    </p>
                    {compareLoading && <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />}
                    <label className="cursor-pointer text-xs font-bold text-brand-600 dark:text-brand-400 px-3 py-1.5 rounded-lg bg-brand-100 dark:bg-brand-500/20 hover:bg-brand-200 transition-colors">
                      {compareAnalysis ? 'Change' : 'Browse'}
                      <input type="file" className="hidden" accept=".csv" onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0], true); }} />
                    </label>
                    {compareAnalysis && <button onClick={() => setCompareAnalysis(null)} className="text-gray-400 hover:text-red-400 text-xs" aria-label="Clear compare log">✕</button>}
                  </div>

                  {compareAnalysis && (
                    <>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {compareSummary.map((item) => (
                          <div key={item.title} className="app-soft-panel p-2">
                            <p className="text-[10px] uppercase tracking-wide app-muted">{item.title}</p>
                            <p className="text-xs font-semibold app-heading">{item.value}</p>
                            <p className="text-[11px] app-muted">{item.detail}</p>
                          </div>
                        ))}
                      </div>

                      <div>
                        <p className="mb-1 text-[10px] uppercase tracking-wide app-muted">Compare channels</p>
                        <div className="flex flex-wrap gap-2">
                          {COMPARE_CHANNELS.map((channel) => (
                            <button
                              key={channel.key}
                              onClick={() => setCompareChannels((prev) => ({ ...prev, [channel.key]: !prev[channel.key] }))}
                              className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${compareChannels[channel.key] ? 'bg-white dark:bg-surface-300 text-gray-700 dark:text-gray-200 border-brand-300 dark:border-brand-500/30' : 'text-gray-400 border-gray-200 dark:border-white/10'}`}
                              aria-pressed={Boolean(compareChannels[channel.key])}
                            >
                              {channel.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {compareAnalysis && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {deltaCards.map((card) => (
                    <div key={card.title} className="surface-inset p-3">
                      <p className="text-[10px] uppercase tracking-wide app-muted">{card.title} Δ</p>
                      <p className={`text-sm font-bold ${card.delta == null ? 'text-gray-400' : card.delta <= 0 ? 'text-green-500' : 'text-red-400'}`}>
                        {card.delta == null ? '—' : `${card.delta > 0 ? '+' : ''}${card.delta}${card.unit}`}
                      </p>
                      <p className="text-[11px] app-muted">
                        {card.base == null ? 'No overlap' : `${card.base}${card.unit} → ${card.compare}${card.unit}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {showAnnotationInput && (
                <div className="flex items-center gap-2 p-3 bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-xl">
                  <Tag size={14} className="text-brand-500 shrink-0" />
                  <input type="text"
                    placeholder={pendingAnnotationTime !== null ? `Note for t=${pendingAnnotationTime}s` : 'Click chart to select timestamp, then type note'}
                    value={annotationInput} onChange={e => setAnnotationInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveAnnotation()}
                    className="flex-1 bg-transparent text-xs text-slate-800 dark:text-gray-200 outline-none placeholder-slate-400"
                  />
                  <button onClick={saveAnnotation} disabled={!annotationInput.trim() || pendingAnnotationTime === null}
                    className="text-xs font-bold text-brand-600 dark:text-brand-400 px-2 py-1 rounded-md bg-brand-100 dark:bg-brand-500/20 disabled:opacity-40 transition-colors">Save</button>
                  <button onClick={() => { setShowAnnotationInput(false); setPendingAnnotationTime(null); setAnnotationInput(''); }} className="text-gray-400 text-xs" aria-label="Cancel annotation">✕</button>
                </div>
              )}

              {activeTab === 'telemetry' && (
                <div ref={chartRef} className="surface-card p-5 md:p-6">
                  {(analysis.metrics.afr.lean_events > 0 || analysis.metrics.hpfp.status !== 'Safe' || analysis.metrics.timingCorrections.status !== 'Safe') && (
                    <div className="flex flex-wrap gap-3 mb-3 text-[11px] font-medium">
                      {analysis.metrics.afr.lean_events > 0 && (
                        <span className="flex items-center gap-1.5 text-red-400">
                          <span className="relative flex w-3 h-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-50" /><span className="relative inline-flex rounded-full w-3 h-3 bg-red-500" /></span>
                          Lean warning
                        </span>
                      )}
                      {analysis.metrics.hpfp.status !== 'Safe' && (
                        <span className="flex items-center gap-1.5 text-orange-400">
                          <span className="relative flex w-3 h-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-50" /><span className="relative inline-flex rounded-full w-3 h-3 bg-orange-500" /></span>
                          HPFP drop
                        </span>
                      )}
                      {analysis.metrics.timingCorrections.status !== 'Safe' && (
                        <span className="flex items-center gap-1.5 text-yellow-400">
                          <span className="inline-flex rounded-full w-3 h-3 bg-yellow-500" /> Timing pull
                        </span>
                      )}
                    </div>
                  )}

                  <div className="h-[280px] w-full rounded-lg border border-gray-200 bg-gray-50/50 p-2 dark:border-white/5 dark:bg-surface-300/30 md:h-[350px] xl:h-[420px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mergedChartData} margin={{ top: 10, right: 55, left: -20, bottom: 0 }} onClick={showAnnotationInput ? handleChartClick : undefined} onMouseMove={(state) => { if (state?.activeLabel != null) setHoverTime(state.activeLabel); }} onMouseLeave={() => setHoverTime(null)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" vertical={false} />
                        <XAxis dataKey="time" stroke="var(--app-chart-axis)" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" stroke="var(--app-chart-axis)" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                        <YAxis yAxisId="boost" orientation="right" stroke="var(--app-chart-axis)" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                        <YAxis yAxisId="hpfp" orientation="right" stroke="#a855f7" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={50} tickFormatter={v => `${(v/1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ backgroundColor: 'var(--app-card-elevated)', borderColor: 'var(--app-border)', color: 'var(--app-text)', borderRadius: '12px', fontSize: '12px', boxShadow: '0 10px 28px rgba(15,23,42,0.18)' }} itemStyle={{ color: 'var(--app-text)' }} formatter={(value, name) => name.startsWith('HPFP') ? [`${value} psi`, name] : [value, name]} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        <Line yAxisId="left" type="monotone" dataKey="afrActual" stroke="#14b8a6" name="AFR Actual" strokeWidth={2} dot={AfrWarningDot} connectNulls={false} />
                        <Line yAxisId="left" type="monotone" dataKey="afrTarget" stroke="#f43f5e" name="AFR Target" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
                        <Line yAxisId="boost" type="monotone" dataKey="boost" stroke="#3b82f6" name="Boost (psi)" strokeWidth={2} dot={BoostWarningDot} connectNulls={false} />
                        <Line yAxisId="hpfp" type="monotone" dataKey="hpfpActual" stroke="#a855f7" name="HPFP Actual" strokeWidth={1.5} dot={false} connectNulls={false} />
                        <Line yAxisId="hpfp" type="monotone" dataKey="hpfpTarget" stroke="#d8b4fe" name="HPFP Target" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />

                        {compareAnalysis && COMPARE_CHANNELS.filter(channel => compareChannels[channel.key]).map((channel) => (
                          <Line key={channel.key} yAxisId={channel.yAxisId} type="monotone" dataKey={`${channel.key}_b`} stroke={channel.color} name={`${channel.label} (${compareAnalysis.filename})`} strokeWidth={1.5} strokeDasharray={channel.dashed ? '6 3' : '4 2'} dot={false} connectNulls={false} />
                        ))}

                        {hoverTime !== null && <ReferenceLine x={hoverTime} yAxisId="left" stroke="var(--app-chart-axis-muted)" strokeWidth={1} strokeDasharray="2 2" />}

                        {(() => {
                          const pt = analysis.chartData.find(p => p.isHpfpWarning);
                          if (!pt) return null;
                          return <>
                            <ReferenceLine x={pt.time} yAxisId="boost" stroke="#f97316" strokeWidth={1.5} strokeOpacity={0.8} strokeDasharray="4 3" label={{ value: 'HPFP ↓', fill: '#f97316', fontSize: 9, fontWeight: 700, position: 'insideTopLeft', dy: -2 }} />
                            {pt.hpfpActual != null && <ReferenceDot x={pt.time} y={pt.hpfpActual} yAxisId="hpfp" r={5} fill="#f97316" stroke="#111113" strokeWidth={2} />}
                          </>;
                        })()}

                        {analysis.chartData.reduce((acc, pt, i, arr) => {
                          if (pt.isLeanWarning && (i === 0 || !arr[i - 1].isLeanWarning)) acc.push(pt.time);
                          return acc;
                        }, []).map(t => <ReferenceLine key={`lean-${t}`} x={t} yAxisId="left" stroke="#f43f5e" strokeWidth={1.5} strokeOpacity={0.75} strokeDasharray="4 3" label={{ value: 'Lean', fill: '#f43f5e', fontSize: 9, fontWeight: 700, position: 'insideTopLeft', dy: -2 }} />)}

                        {analysis.chartData.reduce((acc, pt, i, arr) => {
                          if (pt.isTimingWarning && (i === 0 || !arr[i - 1].isTimingWarning)) acc.push(pt.time);
                          return acc;
                        }, []).map(t => <ReferenceLine key={`timing-${t}`} x={t} yAxisId="left" stroke="#eab308" strokeWidth={1.5} strokeOpacity={0.75} strokeDasharray="4 3" label={{ value: 'Pull', fill: '#eab308', fontSize: 9, fontWeight: 700, position: 'insideTopLeft', dy: -2 }} />)}

                        {annotations.map(a => <ReferenceLine key={`ann-${a.id}`} x={a.time} yAxisId="left" stroke="#818cf8" strokeWidth={1.5} strokeDasharray="3 3" label={{ value: a.label, fill: '#818cf8', fontSize: 9, fontWeight: 700, position: 'insideTopLeft', dy: -2 }} />)}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {showAnnotationInput && <p className="mt-2 text-center text-xs app-muted">Click on the chart to pin an annotation to a timestamp.</p>}
                </div>
              )}

              {activeTab === 'knock' && (
                <div className="surface-card p-5 md:p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                      <Cpu size={16} className="text-brand-400" /> Knock Event Map
                    </h2>
                    <span className="text-xs app-muted">{analysis.knockScatter?.length ?? 0} events</span>
                  </div>
                  {analysis.knockScatter?.length > 0 ? (
                    <>
                      <div className="flex gap-4 mb-3 text-[11px]">
                        {[['Minor', '#eab308'], ['Caution', '#f97316'], ['Risk', '#f43f5e']].map(([label, color]) => (
                          <span key={label} className="flex items-center gap-1.5" style={{ color }}>
                            <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />{label}
                          </span>
                        ))}
                      </div>
                      <div className="h-[320px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ScatterChart margin={{ top: 10, right: 20, left: -20, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                            <XAxis type="number" dataKey="rpm" name="RPM" stroke="var(--app-chart-axis)" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} domain={[500, 8000]} label={{ value: 'RPM', position: 'insideBottom', offset: -10, fill: 'var(--app-chart-axis)', fontSize: 11 }} />
                            <YAxis type="number" dataKey="load" name="Load %" stroke="var(--app-chart-axis)" tick={{ fontSize: 11, fill: 'var(--app-chart-axis-muted)' }} tickLine={false} axisLine={false} domain={[0, 100]} label={{ value: 'Load %', angle: -90, position: 'insideLeft', fill: 'var(--app-chart-axis)', fontSize: 11 }} />
                            <ZAxis type="number" dataKey="pull" range={[40, 200]} />
                            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: 'var(--app-card-elevated)', borderColor: 'var(--app-border)', color: 'var(--app-text)', borderRadius: '12px', fontSize: '12px' }} formatter={(v, name) => [name === 'pull' ? `${v}°` : v, name === 'rpm' ? 'RPM' : name === 'load' ? 'Load %' : 'Timing Pull']} />
                            {['Minor', 'Caution', 'Risk'].map((sev, idx) => {
                              const colors = ['#eab308', '#f97316', '#f43f5e'];
                              const data = analysis.knockScatter.filter(p => p.severity === sev);
                              return data.length ? <Scatter key={sev} name={sev} data={data} fill={colors[idx]} opacity={0.8} /> : null;
                            })}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="mt-2 text-center text-xs app-muted">Each dot = one knock event. Dot size = magnitude. Cluster patterns identify problem load cells.</p>
                    </>
                  ) : (
                    <div className="app-muted flex h-48 flex-col items-center justify-center gap-2">
                      <CheckCircle size={32} className="text-green-400 opacity-60" />
                      <p className="text-sm font-medium">No knock events detected</p>
                      <p className="text-xs">{analysis.detectedColumns.timingColumns?.length ? 'All timing corrections were within normal range.' : 'No timing correction columns found in this log.'}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'fueltrims' && analysis.metrics.fuelTrims?.hasData && (
                <div className="surface-card p-5 md:p-6">
                  <h2 className="mb-6 flex items-center gap-2 text-sm font-bold uppercase tracking-wide app-heading">
                    <TrendingDown size={16} className="text-brand-400" /> Fuel Trim Health by RPM Zone
                  </h2>
                  <div className="space-y-6">
                    {[
                      { label: 'Idle', sublabel: '< 1500 RPM', key: 'idle', statusKey: 'idleStatus', desc: 'Idle trims indicate vacuum leaks or idle fueling calibration issues.' },
                      { label: 'Cruise', sublabel: '1500–3500 RPM', key: 'cruise', statusKey: 'cruiseStatus', desc: 'Cruise trims reflect steady-state fueling accuracy across normal driving.' },
                      { label: 'High Load', sublabel: '> 3500 RPM', key: 'highLoad', statusKey: 'highLoadStatus', desc: 'High-load trims indicate WOT or high-boost fueling correction.' },
                    ].map(({ label, sublabel, key, statusKey, desc }) => {
                      const val = analysis.metrics.fuelTrims[key];
                      const status = analysis.metrics.fuelTrims[statusKey];
                      if (val === null) return null;
                      const pct = Math.min(Math.abs(val) * 5, 50);
                      return (
                        <div key={key}>
                          <div className="flex justify-between items-center mb-1">
                            <div>
                              <span className="text-sm font-bold app-heading">{label}</span>
                              <span className="ml-2 text-xs app-muted">{sublabel}</span>
                            </div>
                            <span className={`text-sm font-bold tabular-nums ${status === 'Caution' ? 'text-yellow-400' : 'text-green-400'}`}>
                              {val > 0 ? '+' : ''}{val}%
                            </span>
                          </div>
                          <div className="relative h-3 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-1">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-zinc-600" />
                            <div className={`absolute inset-y-0 rounded-full ${val > 0 ? 'bg-yellow-400' : 'bg-blue-400'} ${status === 'Caution' ? 'opacity-100' : 'opacity-70'}`}
                              style={{ width: `${pct}%`, left: val > 0 ? '50%' : `${50 - pct}%` }} />
                          </div>
                          <p className="text-xs app-muted">{desc}</p>
                          {status === 'Caution' && <p className="text-xs text-yellow-400 mt-1 font-medium">⚠ Deviation greater than 5% — check fueling calibration for this RPM zone.</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {analysis.detectedColumns && (
            <details className="mt-2">
              <summary className="text-xs text-gray-400 dark:text-zinc-500 cursor-pointer select-none hover:text-gray-600 dark:hover:text-zinc-300 transition-colors w-fit">
                Detected columns ({analysis.row_count} rows, boost: {analysis.detectedColumns.boostUnit})
              </summary>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] font-mono">
                {Object.entries(analysis.detectedColumns).filter(([k]) => !['boostUnit', 'timingColumns'].includes(k)).map(([k, v]) => (
                  <div key={k} className={`px-2 py-1 rounded border ${v ? 'bg-green-50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400' : 'bg-gray-50 dark:bg-zinc-900/40 border-gray-200 dark:border-zinc-800 text-gray-400 dark:text-zinc-600'}`}>
                    <span className="font-bold">{k}:</span> {v ?? '—'}
                  </div>
                ))}
                {analysis.detectedColumns.timingColumns?.length > 0 && (
                  <div className="col-span-full px-2 py-1 rounded border bg-green-50 dark:bg-green-500/5 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400">
                    <span className="font-bold">timing:</span> {analysis.detectedColumns.timingColumns.join(', ')}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

const MetricBox = ({ title, value, target, status }) => {
  const getStatusColor = (s) => {
    if (s === 'Safe')    return 'text-green-400';
    if (s === 'Caution') return 'text-yellow-400';
    if (s === 'Risk')    return 'text-red-400';
    return 'text-gray-400 dark:text-gray-400';
  };
  const getStatusBgColor = (s) => {
    if (s === 'Safe')    return 'bg-green-500/10 border-green-500/20';
    if (s === 'Caution') return 'bg-yellow-500/10 border-yellow-500/20';
    if (s === 'Risk')    return 'bg-red-500/10 border-red-500/20';
    return 'surface-inset';
  };
  return (
    <div className="surface-card relative overflow-hidden p-5">
      <div className="flex justify-between items-start mb-2 relative z-10">
        <p className="text-xs font-semibold uppercase tracking-wide app-muted">{title}</p>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getStatusBgColor(status)} ${getStatusColor(status)}`}>{status}</span>
      </div>
      <p className="relative z-10 text-2xl font-bold app-heading">{value}</p>
      <p className="relative z-10 mt-1 text-xs app-muted">{target}</p>
    </div>
  );
};

export default LogAnalyzer;
