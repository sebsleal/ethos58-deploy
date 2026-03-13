import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  UploadCloud, Activity, AlertTriangle, CheckCircle, BarChart2, XCircle,
  Lightbulb, Info, Download, GitCompare, MessageSquarePlus, Tag, Cpu, TrendingDown,
} from 'lucide-react';
import { analyzeLog } from '../utils/logAnalyzer';
import { saveRecentLog, saveGarageLog, getAnnotations, saveAnnotations } from '../utils/storage';
import { trackEvent, trackError } from '../utils/telemetry';
import { saveRecentLog, getAnnotations, saveAnnotations } from '../utils/storage';
import { trackEvent, trackUploadFailure, trackParserMismatch, trackPerformanceIssue, trackExportFailure } from '../utils/telemetry';
import { hapticSuccess, hapticWarning, hapticError } from '../utils/haptics';
import { mergeCompareChartData } from '../utils/logCompare';
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

  const [annotations, setAnnotations] = useState([]);
  const [annotationInput, setAnnotationInput] = useState('');
  const [pendingAnnotationTime, setPendingAnnotationTime] = useState(null);
  const [showAnnotationInput, setShowAnnotationInput] = useState(false);

  useEffect(() => {
    if (location.state?.analysis) {
      const a = location.state.analysis;
      setAnalysis(a);
      setAnnotations(getAnnotations(a.filename + '_' + a.row_count));
    }
  }, []);

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
      const onMessage = (event) => {
        if (event.data?.id !== requestId) return;
        worker.removeEventListener('message', onMessage);
        if (event.data.ok) resolve(event.data.result);
        else reject(new Error(event.data.error || 'Failed to analyze log.'));
      };
      worker.addEventListener('message', onMessage);
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
        saveRecentLog(result);
        lastResult = result;
        importedCount += 1;
      } catch (err) {
        trackError('log_analyzer_batch_upload_failed', err, { filename: file.name });
      }
    }

    if (lastResult) {
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
        if (!isCompare) {
          setError(err.message);
          trackUploadFailure(err, { source: 'log_analyzer', filename: file.name, elapsed_ms: Math.round(performance.now() - startedAt), is_compare: isCompare });
        }
      } finally {
        setter(false);
      }
    };
    reader.onerror = () => {
      const readError = reader.error || new Error('Failed to read file.');
      trackUploadFailure(readError, { source: 'file_reader', filename: file.name, is_compare: isCompare });
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

  const AfrWarningDot = (props) => {
    const { cx = 0, cy = 0, payload } = props;
    if (!payload?.isLeanWarning) return <circle r={0} fill="none" />;
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill="#f43f5e" opacity={0.35} className="animate-ping" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={3.5} fill="#f43f5e" stroke="#111113" strokeWidth={1.5} />
      </g>
    );
  };

  const BoostWarningDot = (props) => {
    const { cx = 0, cy = 0, payload } = props;
    if (payload?.isHpfpWarning) return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill="#f97316" opacity={0.35} className="animate-ping" style={{ transformOrigin: `${cx}px ${cy}px` }} />
        <circle cx={cx} cy={cy} r={3.5} fill="#f97316" stroke="#111113" strokeWidth={1.5} />
      </g>
    );
    if (payload?.isTimingWarning) return <circle cx={cx} cy={cy} r={3.5} fill="#eab308" stroke="#111113" strokeWidth={1.5} />;
    return <circle r={0} fill="none" />;
  };

  const mergedChartData = React.useMemo(
    () => mergeCompareChartData(analysis, compareAnalysis),
    [analysis, compareAnalysis]
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
            <Activity className="text-brand-400" size={32} />
            Log Analyzer
            <span className="text-[10px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-500/10 border border-orange-200 dark:border-orange-500/20 px-2 py-0.5 rounded-full ml-1">
              Beta Models
            </span>
          </h1>
          <p className="text-gray-400 dark:text-gray-400 mt-2">Upload BM3 or MHD CSV datalogs for instant health analysis.</p>
          <div className="flex items-center gap-2 mt-3 text-sm text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/5 border border-orange-100 dark:border-orange-500/10 px-3 py-2 rounded-lg">
            <AlertTriangle size={16} className="shrink-0" />
            <p><strong>Heads up:</strong> Analysis models are currently being trained. Information provided may be inaccurate.</p>
          </div>
        </div>

        {analysis && (
          <div className="flex items-center gap-3 animate-fade-in flex-wrap">
            {analysis.logFormat && analysis.logFormat !== 'Unknown' && (
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${FORMAT_COLOR[analysis.logFormat] || FORMAT_COLOR.Unknown}`}>
                {analysis.logFormat}
              </span>
            )}
            <span className="text-xs font-medium text-gray-400 dark:text-gray-400 bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 px-3 py-1.5 rounded-md">
              {analysis.carDetails?.engine || 'B58'} · E{analysis.carDetails?.ethanol ?? 10} · {analysis.carDetails?.tuneStage || 'Stage 1'}
            </span>
            <div className={`px-4 py-1.5 rounded-md border flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${getStatusColor(analysis.status)}`}>
              {getStatusIcon(analysis.status)}{analysis.status}
            </div>
          </div>
        )}
      </header>

      {!analysis && !loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm h-fit">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-5">Vehicle Profile</h3>
            <div className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Engine</label>
                <select value={carDetails.engine} onChange={e => setCarDetails(prev => ({ ...prev, engine: e.target.value }))}
                  className="w-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 focus:border-brand-500 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none transition-colors">
                  {ENGINE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Tune Stage</label>
                <select value={carDetails.tuneStage} onChange={e => setCarDetails(prev => ({ ...prev, tuneStage: e.target.value }))}
                  className="w-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 focus:border-brand-500 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none transition-colors">
                  {TUNE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Fuel Mix</label>
                <div className="flex gap-2 flex-wrap">
                  {ETHANOL_OPTIONS.map(e => (
                    <button key={e} onClick={() => setCarDetails(prev => ({ ...prev, ethanol: e }))}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${carDetails.ethanol === e ? 'bg-slate-900 dark:bg-brand-500 text-white' : 'bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 text-gray-600 dark:text-gray-400 hover:border-brand-500/50'}`}
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
              className={`border-2 border-dashed rounded-xl h-full min-h-[300px] flex flex-col items-center justify-center transition-colors relative overflow-hidden group ${dragActive ? 'border-brand-500 bg-brand-500/5' : 'border-gray-300 dark:border-white/10 bg-white dark:bg-surface-200 hover:border-gray-400 dark:hover:border-white/20'}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
              <div className="w-16 h-16 rounded-full bg-gray-50 dark:bg-surface-300 border border-gray-200 dark:border-white/5 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                <UploadCloud size={32} className={dragActive ? 'text-brand-400' : 'text-gray-400'} />
              </div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Drag & Drop Datalog CSV</h3>
              <p className="text-gray-400 mt-1 text-sm text-center max-w-sm">Supports MHD and bootmod3 exported CSV files.</p>
              <div className="mt-6 flex flex-col sm:flex-row items-center gap-2 relative z-10">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-300 dark:border-white/10 text-gray-800 dark:text-gray-200 px-5 py-2 rounded-md text-sm font-medium transition-all"
                >
                  Browse File
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  className="bg-brand-50 dark:bg-brand-500/10 hover:bg-brand-100 dark:hover:bg-brand-500/20 border border-brand-200 dark:border-brand-500/20 text-brand-700 dark:text-brand-300 px-5 py-2 rounded-md text-sm font-medium transition-all"
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
        <div className="bg-white dark:bg-surface-200 rounded-xl p-16 flex flex-col items-center justify-center border border-gray-200 dark:border-white/5 min-h-[400px]">
          <div className="w-12 h-12 border-2 border-gray-300 dark:border-white/10 border-t-brand-400 rounded-full animate-spin" />
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-6">Analyzing Telemetry...</h3>
          <p className="text-gray-400 mt-1 text-sm">Checking AFR, HPFP targets, and timing corrections.</p>
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
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4 uppercase tracking-wide">
                    <Info className="text-brand-400" size={18} /> Diagnostic Workflow
                  </h2>
                  <div className="space-y-3">
                    {analysis.diagnostics.map((card) => (
                      <div key={card.id} className="border border-gray-200 dark:border-white/10 rounded-lg p-3.5 bg-gray-50/80 dark:bg-surface-300/50">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{card.title}</h3>
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${getStatusColor(card.severity)}`}>
                            {card.severity}
                          </span>
                        </div>
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">{card.evidence}</p>
                        {card.likelyCauses?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Likely Causes</p>
                            <ul className="mt-1 space-y-1">
                              {card.likelyCauses.map((cause, i) => (
                                <li key={i} className="text-xs text-gray-700 dark:text-gray-300">• {cause}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {card.recommendedChecks?.length > 0 && (
                          <div className="mt-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Recommended Checks</p>
                            <ul className="mt-1 space-y-1">
                              {card.recommendedChecks.slice(0, 4).map((check, i) => (
                                <li key={i} className="text-xs text-gray-700 dark:text-gray-300">• {check}</li>
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
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-5 uppercase tracking-wide">
                    <Lightbulb className="text-brand-400" size={18} /> Key Insights
                  </h2>
                  <ul className="space-y-4">
                    {analysis.keyPoints.map((pt, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-gray-700 dark:text-gray-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 shrink-0 shadow-[0_0_8px_rgba(20,184,166,0.8)]" />
                        <span className="leading-relaxed">{pt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.metrics.fuelTrims?.hasData && (
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-4 uppercase tracking-wide">
                    <TrendingDown className="text-brand-400" size={18} /> Fuel Trims (LTFT+STFT)
                  </h2>
                  <div className="space-y-3">
                    {[{ label: 'Idle', key: 'idle', statusKey: 'idleStatus' }, { label: 'Cruise', key: 'cruise', statusKey: 'cruiseStatus' }, { label: 'High Load', key: 'highLoad', statusKey: 'highLoadStatus' }].map(({ label, key, statusKey }) => {
                      const val = analysis.metrics.fuelTrims[key];
                      const status = analysis.metrics.fuelTrims[statusKey];
                      if (val === null) return null;
                      return (
                        <div key={key} className="flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium w-16">{label}</span>
                          <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-zinc-800 overflow-hidden relative">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300 dark:bg-zinc-600" />
                            <div className={`absolute inset-y-0 rounded-full ${val > 0 ? 'bg-yellow-400' : 'bg-blue-400'}`}
                              style={{ width: `${Math.min(Math.abs(val) * 5, 50)}%`, left: val > 0 ? '50%' : `${50 - Math.min(Math.abs(val) * 5, 50)}%` }} />
                          </div>
                          <span className={`text-xs font-bold tabular-nums w-10 text-right ${status === 'Caution' ? 'text-yellow-400' : 'text-gray-700 dark:text-gray-200'}`}>
                            {val > 0 ? '+' : ''}{val}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {annotations.length > 0 && (
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-5 shadow-sm">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2 mb-3 uppercase tracking-wide">
                    <Tag size={16} className="text-brand-400" /> Annotations
                  </h2>
                  <ul className="space-y-2">
                    {annotations.map(a => (
                      <li key={a.id} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 group">
                        <span><span className="font-mono text-brand-400 mr-2">t={a.time}s</span>{a.label}</span>
                        <button onClick={() => removeAnnotation(a.id)} className="opacity-0 group-hover:opacity-100 text-red-400 ml-2">✕</button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-1 p-1 bg-gray-100 dark:bg-surface-300/50 rounded-lg">
                  {[
                    { id: 'telemetry', label: 'Telemetry', icon: BarChart2 },
                    { id: 'knock', label: 'Knock Map', icon: Cpu },
                    ...(analysis.metrics.fuelTrims?.hasData ? [{ id: 'fueltrims', label: 'Fuel Trims', icon: TrendingDown }] : []),
                  ].map(({ id, label, icon: Icon }) => (
                    <button key={id} onClick={() => setActiveTab(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activeTab === id ? 'bg-white dark:bg-surface-200 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                    >
                      <Icon size={13} />{label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={exportPng} className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-brand-400 border border-gray-200 dark:border-white/5 hover:border-brand-500/30 px-3 py-1.5 rounded-md transition-colors">
                    <Download size={13} /> PNG
                  </button>
                  <button onClick={() => setShowCompare(v => !v)}
                    className={`flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-md transition-colors ${showCompare ? 'text-brand-400 border-brand-500/30 bg-brand-500/5' : 'text-gray-400 hover:text-brand-400 border-gray-200 dark:border-white/5'}`}>
                    <GitCompare size={13} /> Compare
                  </button>
                  <button onClick={() => setShowAnnotationInput(v => !v)}
                    className={`flex items-center gap-1.5 text-xs font-medium border px-3 py-1.5 rounded-md transition-colors ${showAnnotationInput ? 'text-brand-400 border-brand-500/30 bg-brand-500/5' : 'text-gray-400 hover:text-brand-400 border-gray-200 dark:border-white/5'}`}>
                    <MessageSquarePlus size={13} /> Annotate
                  </button>
                  <button onClick={reset} className="text-xs font-medium text-brand-400 hover:text-brand-300 bg-brand-500/10 hover:bg-brand-500/20 px-3 py-1.5 rounded-md transition-colors">
                    New Log
                  </button>
                </div>
              </div>

              {showCompare && (
                <div className="flex items-center gap-3 p-3 bg-brand-50 dark:bg-brand-500/5 border border-brand-200 dark:border-brand-500/20 rounded-xl">
                  <GitCompare size={14} className="text-brand-500 shrink-0" />
                  <p className="text-xs text-slate-600 dark:text-gray-300 flex-1">
                    {compareAnalysis ? `Comparing: ${compareAnalysis.filename}` : 'Select a second log to overlay on the chart:'}
                  </p>
                  {compareLoading && <div className="w-4 h-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />}
                  <label className="cursor-pointer text-xs font-bold text-brand-600 dark:text-brand-400 px-3 py-1.5 rounded-lg bg-brand-100 dark:bg-brand-500/20 hover:bg-brand-200 transition-colors">
                    {compareAnalysis ? 'Change' : 'Browse'}
                    <input type="file" className="hidden" accept=".csv" onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0], true); }} />
                  </label>
                  {compareAnalysis && <button onClick={() => setCompareAnalysis(null)} className="text-gray-400 hover:text-red-400 text-xs">✕</button>}
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
                  <button onClick={() => { setShowAnnotationInput(false); setPendingAnnotationTime(null); setAnnotationInput(''); }} className="text-gray-400 text-xs">✕</button>
                </div>
              )}

              {activeTab === 'telemetry' && (
                <div ref={chartRef} className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
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

                  <div className="h-[350px] w-full bg-gray-50/50 dark:bg-surface-300/30 rounded-lg p-2 border border-gray-200 dark:border-white/5">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mergedChartData} margin={{ top: 10, right: 55, left: -20, bottom: 0 }} onClick={showAnnotationInput ? handleChartClick : undefined}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272A" vertical={false} />
                        <XAxis dataKey="time" stroke="#71717A" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis yAxisId="left" stroke="#71717A" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                        <YAxis yAxisId="boost" orientation="right" stroke="#71717A" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} />
                        <YAxis yAxisId="hpfp" orientation="right" stroke="#a855f7" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} domain={['auto', 'auto']} width={50} tickFormatter={v => `${(v/1000).toFixed(1)}k`} />
                        <Tooltip contentStyle={{ backgroundColor: '#18181B', borderColor: '#27272A', color: '#F4F4F5', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} itemStyle={{ color: '#F4F4F5' }} formatter={(value, name) => name.startsWith('HPFP') ? [`${value} psi`, name] : [value, name]} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                        <Line yAxisId="left" type="monotone" dataKey="afrActual" stroke="#14b8a6" name="AFR Actual" strokeWidth={2} dot={AfrWarningDot} connectNulls={false} />
                        <Line yAxisId="left" type="monotone" dataKey="afrTarget" stroke="#f43f5e" name="AFR Target" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} />
                        <Line yAxisId="boost" type="monotone" dataKey="boost" stroke="#3b82f6" name="Boost (psi)" strokeWidth={2} dot={BoostWarningDot} connectNulls={false} />
                        <Line yAxisId="hpfp" type="monotone" dataKey="hpfpActual" stroke="#a855f7" name="HPFP Actual" strokeWidth={1.5} dot={false} connectNulls={false} />
                        <Line yAxisId="hpfp" type="monotone" dataKey="hpfpTarget" stroke="#d8b4fe" name="HPFP Target" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls={false} />

                        {compareAnalysis && <>
                          <Line yAxisId="left" type="monotone" dataKey="afrActual_b" stroke="#f59e0b" name={`AFR (${compareAnalysis.filename})`} strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={false} />
                          <Line yAxisId="boost" type="monotone" dataKey="boost_b" stroke="#60a5fa" name="Boost B" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={false} />
                        </>}

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
                  {showAnnotationInput && <p className="text-xs text-gray-400 mt-2 text-center">Click on the chart to pin an annotation to a timestamp.</p>}
                </div>
              )}

              {activeTab === 'knock' && (
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide flex items-center gap-2">
                      <Cpu size={16} className="text-brand-400" /> Knock Event Map
                    </h2>
                    <span className="text-xs text-gray-400">{analysis.knockScatter?.length ?? 0} events</span>
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#27272A" />
                            <XAxis type="number" dataKey="rpm" name="RPM" stroke="#71717A" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[500, 8000]} label={{ value: 'RPM', position: 'insideBottom', offset: -10, fill: '#71717A', fontSize: 11 }} />
                            <YAxis type="number" dataKey="load" name="Load %" stroke="#71717A" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} domain={[0, 100]} label={{ value: 'Load %', angle: -90, position: 'insideLeft', fill: '#71717A', fontSize: 11 }} />
                            <ZAxis type="number" dataKey="pull" range={[40, 200]} />
                            <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ backgroundColor: '#18181B', borderColor: '#27272A', color: '#F4F4F5', borderRadius: '8px', fontSize: '12px' }} formatter={(v, name) => [name === 'pull' ? `${v}°` : v, name === 'rpm' ? 'RPM' : name === 'load' ? 'Load %' : 'Timing Pull']} />
                            {['Minor', 'Caution', 'Risk'].map((sev, idx) => {
                              const colors = ['#eab308', '#f97316', '#f43f5e'];
                              const data = analysis.knockScatter.filter(p => p.severity === sev);
                              return data.length ? <Scatter key={sev} name={sev} data={data} fill={colors[idx]} opacity={0.8} /> : null;
                            })}
                          </ScatterChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-xs text-gray-400 mt-2 text-center">Each dot = one knock event. Dot size = magnitude. Cluster patterns identify problem load cells.</p>
                    </>
                  ) : (
                    <div className="h-48 flex flex-col items-center justify-center text-gray-400 gap-2">
                      <CheckCircle size={32} className="text-green-400 opacity-60" />
                      <p className="text-sm font-medium">No knock events detected</p>
                      <p className="text-xs">{analysis.detectedColumns.timingColumns?.length ? 'All timing corrections were within normal range.' : 'No timing correction columns found in this log.'}</p>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'fueltrims' && analysis.metrics.fuelTrims?.hasData && (
                <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide flex items-center gap-2 mb-6">
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
                              <span className="text-sm font-bold text-gray-800 dark:text-gray-200">{label}</span>
                              <span className="ml-2 text-xs text-gray-400">{sublabel}</span>
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
                          <p className="text-xs text-gray-400">{desc}</p>
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
    return 'bg-gray-50 dark:bg-surface-300 border-gray-200 dark:border-white/5';
  };
  return (
    <div className="bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-5 shadow-sm relative overflow-hidden">
      <div className="flex justify-between items-start mb-2 relative z-10">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getStatusBgColor(status)} ${getStatusColor(status)}`}>{status}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 relative z-10">{value}</p>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 relative z-10">{target}</p>
    </div>
  );
};

export default LogAnalyzer;
