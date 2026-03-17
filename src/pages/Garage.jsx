import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Trash2, Search, FileJson, FileSpreadsheet, FileUp } from 'lucide-react';
import {
  getGarageLogs,
  updateGarageLogMeta,
  deleteGarageLog,
  getLogResult,
  exportGarageBackup,
  exportGarageSummaryCsv,
  importGarageBackup,
} from '../utils/storage';
import { InsetCard, PageHeader, StatusPill, SurfaceCard } from '../components/ui';
import { hapticSuccess, hapticWarning } from '../utils/haptics';

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const Garage = () => {
  const navigate = useNavigate();
  const importRef = useRef(null);
  const [logs, setLogs] = useState(() => getGarageLogs());
  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('all');
  const [importError, setImportError] = useState(null);

  const allTags = useMemo(() => {
    const tags = new Set();
    logs.forEach((log) => (log.tags || []).forEach((tag) => tags.add(tag)));
    return [...tags].sort();
  }, [logs]);

  const filtered = useMemo(() => logs.filter((log) => {
    const matchSearch = !search || `${log.filename} ${log.notes || ''}`.toLowerCase().includes(search.toLowerCase());
    const matchTag = tagFilter === 'all' || (log.tags || []).includes(tagFilter);
    return matchSearch && matchTag;
  }), [logs, search, tagFilter]);

  const onTagEdit = (id, raw) => {
    const tags = raw.split(',').map((t) => t.trim()).filter(Boolean);
    updateGarageLogMeta(id, { tags });
    setLogs(getGarageLogs());
  };

  const onNotesEdit = (id, notes) => {
    updateGarageLogMeta(id, { notes });
    setLogs(getGarageLogs());
  };

  const openAnalysis = (id) => {
    const payload = getLogResult(id);
    if (!payload?.analysis) return;
    navigate('/analyzer', { state: { analysis: payload.analysis } });
  };

  const reopenCsv = (id) => {
    const payload = getLogResult(id);
    if (!payload?.csvText) return;
    navigate('/viewer', { state: { csvText: payload.csvText, filename: payload.analysis?.filename || 'garage-log.csv' } });
  };

  const exportJson = () => {
    const backup = exportGarageBackup();
    downloadBlob(`ethos58-garage-${Date.now()}.json`, JSON.stringify(backup, null, 2), 'application/json');
  };

  const exportCsv = () => {
    const csv = exportGarageSummaryCsv();
    downloadBlob(`ethos58-garage-summary-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  };

  const importJson = async (file) => {
    try {
      setImportError(null);
      const text = await file.text();
      const data = JSON.parse(text);
      importGarageBackup(data, 'merge');
      setLogs(getGarageLogs());
      hapticSuccess();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Could not import that backup file.');
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Archive"
        title="Log Garage"
        description="Long-term log archive with notes, tags, and backup/import tools for the sessions that matter."
        action={(
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={exportCsv} className="app-input px-3 py-2 text-sm flex items-center gap-2"><FileSpreadsheet size={16} /> Export CSV</button>
            <button onClick={exportJson} className="app-input px-3 py-2 text-sm flex items-center gap-2"><FileJson size={16} /> Backup JSON</button>
            <button onClick={() => importRef.current?.click()} className="px-3 py-2 rounded-[1rem] bg-brand-500 text-white text-sm flex items-center gap-2"><FileUp size={16} /> Import JSON</button>
          </div>
        )}
      />
      <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />

      {importError && (
        <SurfaceCard className="border-red-300/70 text-sm text-red-500">
          {importError}
        </SurfaceCard>
      )}

      <SurfaceCard>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="md:col-span-2 relative">
            <Search size={16} className="absolute left-3 top-3.5 app-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search filename or notes" className="app-input w-full pl-9 pr-3 py-2.5" />
          </div>
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="app-input px-3 py-2.5">
            <option value="all">All tags</option>
            {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </div>
      </SurfaceCard>

      <div className="space-y-3">
        {!logs.length && (
          <SurfaceCard className="border-dashed text-center py-12">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/10 text-3xl">🧰</div>
            <h2 className="text-lg font-semibold app-heading">No logs in your garage yet</h2>
            <p className="text-sm app-muted mt-2 max-w-md mx-auto">Analyze your first CSV in Log Analyzer and it will appear here automatically with health score, tags, and notes.</p>
          </SurfaceCard>
        )}

        {filtered.map((log) => (
          <SurfaceCard key={log.id}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <StatusPill status={log.status} />
                  <span className="text-xs app-muted">Score {log.healthScore ?? '—'}</span>
                </div>
                <div>
                  <h2 className="text-xl font-semibold tracking-tight app-heading">{log.filename}</h2>
                  <p className="text-xs app-muted">{new Date(log.createdAt).toLocaleString()} · {log.engine} · E{log.ethanol} · {log.tune}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => openAnalysis(log.id)} className="app-input text-xs px-2.5 py-1.5">Open Analysis</button>
                <button onClick={() => reopenCsv(log.id)} disabled={!log.hasCsv} className="app-input text-xs px-2.5 py-1.5 disabled:opacity-50">Re-open CSV</button>
                <button
                  onClick={() => {
                    if (!window.confirm(`Delete ${log.filename} from the garage?`)) return;
                    deleteGarageLog(log.id);
                    setLogs(getGarageLogs());
                    hapticWarning();
                  }}
                  className="text-xs px-2.5 py-1.5 rounded-[1rem] border border-red-300/70 text-red-500 flex items-center gap-1"
                  aria-label={`Delete ${log.filename}`}
                >
                  <Trash2 size={12} /> Delete
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-4">
              <InsetCard>
                <label className="text-xs app-muted">Tags (comma separated)
                  <input defaultValue={(log.tags || []).join(', ')} onBlur={(e) => onTagEdit(log.id, e.target.value)} className="app-input mt-2 w-full px-3 py-2" />
                </label>
              </InsetCard>
              <InsetCard>
                <label className="text-xs app-muted">Notes
                  <textarea defaultValue={log.notes || ''} onBlur={(e) => onNotesEdit(log.id, e.target.value)} rows={2} className="app-input mt-2 w-full px-3 py-2" />
                </label>
              </InsetCard>
            </div>
          </SurfaceCard>
        ))}
        {!filtered.length && logs.length > 0 && (
          <SurfaceCard className="border-dashed text-center py-10">
            <p className="text-sm app-muted">No garage logs match your current search/filter.</p>
          </SurfaceCard>
        )}
      </div>
    </div>
  );
};

export default Garage;
