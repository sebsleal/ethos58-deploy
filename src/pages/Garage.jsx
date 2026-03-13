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
    const text = await file.text();
    const data = JSON.parse(text);
    importGarageBackup(data, 'merge');
    setLogs(getGarageLogs());
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3"><Archive className="text-brand-400" /> Log Garage</h1>
          <p className="text-gray-400 mt-2">Long-term log archive with notes, tags, and backup/import tools.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={exportCsv} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 text-sm flex items-center gap-2"><FileSpreadsheet size={16} /> Export CSV</button>
          <button onClick={exportJson} className="px-3 py-2 rounded-lg border border-gray-300 dark:border-white/10 text-sm flex items-center gap-2"><FileJson size={16} /> Backup JSON</button>
          <button onClick={() => importRef.current?.click()} className="px-3 py-2 rounded-lg bg-brand-500 text-white text-sm flex items-center gap-2"><FileUp size={16} /> Import JSON</button>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </header>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-2 relative">
          <Search size={16} className="absolute left-3 top-3.5 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search filename or notes" className="w-full pl-9 pr-3 py-2.5 rounded-lg bg-white dark:bg-surface-200 border border-gray-300 dark:border-white/10" />
        </div>
        <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} className="px-3 py-2.5 rounded-lg bg-white dark:bg-surface-200 border border-gray-300 dark:border-white/10">
          <option value="all">All tags</option>
          {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
        </select>
      </div>

      <div className="space-y-3">
        {filtered.map((log) => (
          <article key={log.id} className="p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-surface-200">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold">{log.filename}</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">{new Date(log.createdAt).toLocaleString()} · {log.status} · Score {log.healthScore ?? '—'}</p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => openAnalysis(log.id)} className="text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-white/10">Open Analysis</button>
                <button onClick={() => reopenCsv(log.id)} disabled={!log.hasCsv} className="text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-white/10 disabled:opacity-50">Re-open CSV</button>
                <button onClick={() => deleteGarageLog(log.id) || setLogs(getGarageLogs())} className="text-xs px-2.5 py-1.5 rounded border border-red-300 text-red-500 flex items-center gap-1"><Trash2 size={12} /> Delete</button>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-3 mt-3">
              <label className="text-xs text-gray-500 dark:text-gray-400">Tags (comma separated)
                <input defaultValue={(log.tags || []).join(', ')} onBlur={(e) => onTagEdit(log.id, e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-surface-300 border border-gray-200 dark:border-white/10" />
              </label>
              <label className="text-xs text-gray-500 dark:text-gray-400">Notes
                <textarea defaultValue={log.notes || ''} onBlur={(e) => onNotesEdit(log.id, e.target.value)} rows={2} className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-50 dark:bg-surface-300 border border-gray-200 dark:border-white/10" />
              </label>
            </div>
          </article>
        ))}
        {!filtered.length && (
          <div className="p-8 text-center rounded-xl border border-dashed border-gray-300 dark:border-white/10 text-gray-500">No garage logs found.</div>
        )}
      </div>
    </div>
  );
};

export default Garage;
