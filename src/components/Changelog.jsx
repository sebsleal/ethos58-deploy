import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Zap, ArrowUpCircle } from 'lucide-react';
import { setLastSeenVersion } from '../utils/storage';

const TYPE_STYLES = {
  new:      { label: 'New',      cls: 'bg-brand-500/10 text-brand-500 dark:text-brand-400' },
  improved: { label: 'Improved', cls: 'bg-green-500/10 text-green-600 dark:text-green-400' },
  fixed:    { label: 'Fixed',    cls: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400' },
};

const PLATFORM_STYLES = {
  web:  { label: 'Web',  cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  ios:  { label: 'iOS',  cls: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  both: { label: 'Web+iOS', cls: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-300' },
};

export default function Changelog({ currentVersion, onClose }) {
  const [entries, setEntries] = useState([]);
  const [platformFilter, setPlatformFilter] = useState('all');
  const touchStartYRef = useRef(null);
  const [dragDelta, setDragDelta] = useState(0);

  useEffect(() => {
    fetch('/CHANGELOG.json')
      .then(r => r.json())
      .then(data => setEntries(data))
      .catch(() => {});
  }, []);

  function handleClose() {
    setLastSeenVersion(currentVersion);
    onClose();
  }

  const handleSwipeStart = (e) => {
    touchStartYRef.current = e.touches[0].clientY;
    setDragDelta(0);
  };

  const handleSwipeMove = (e) => {
    if (touchStartYRef.current === null) return;
    const delta = e.touches[0].clientY - touchStartYRef.current;
    setDragDelta(Math.max(0, delta));
  };

  const handleSwipeEnd = () => {
    if (dragDelta > 60) handleClose();
    touchStartYRef.current = null;
    setDragDelta(0);
  };

  const latest = entries[0];
  const filteredEntries = entries
    .map(entry => {
      const filteredChanges = (entry.changes || []).filter(c => {
        const platform = c.platform || 'both';
        if (platformFilter === 'all') return true;
        if (platformFilter === 'web') return platform === 'web' || platform === 'both';
        if (platformFilter === 'ios') return platform === 'ios' || platform === 'both';
        return true;
      });
      return { ...entry, changes: filteredChanges };
    })
    .filter(entry => entry.changes.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div
        className="bg-white dark:bg-[#0f0f11] border border-gray-200 dark:border-zinc-800 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
        style={{
          transform: dragDelta > 0 ? `translateY(${Math.min(dragDelta, 140)}px)` : 'translateY(0)',
          transition: dragDelta > 0 ? 'none' : 'transform 0.25s ease',
        }}
      >
        <div
          className="pt-2 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
          onTouchStart={handleSwipeStart}
          onTouchMove={handleSwipeMove}
          onTouchEnd={handleSwipeEnd}
        >
          <span className="h-1 w-12 rounded-full bg-gray-300 dark:bg-zinc-700" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <div className="bg-brand-500/10 p-1.5 rounded-lg">
              <Sparkles size={16} className="text-brand-500" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">What's New</h2>
              {latest && (
                <p className="text-xs text-gray-400 dark:text-zinc-500">Version {latest.version}</p>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-zinc-800 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
            {[
              { id: 'all', label: 'All' },
              { id: 'web', label: 'Web' },
              { id: 'ios', label: 'iOS' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setPlatformFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${platformFilter === tab.id ? 'bg-brand-500 text-white' : 'bg-white dark:bg-[#0f0f11] text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {filteredEntries.length === 0 && (
            <div className="text-center py-12 text-sm text-gray-500 dark:text-zinc-400">
              No updates in this platform filter yet.
            </div>
          )}
          {filteredEntries.map((entry, idx) => (
            <div key={entry.version}>
              <div className="flex items-center gap-2 mb-3">
                {idx === 0 ? (
                  <Zap size={14} className="text-brand-500 shrink-0" />
                ) : (
                  <ArrowUpCircle size={14} className="text-gray-400 dark:text-zinc-600 shrink-0" />
                )}
                <p className="text-xs font-bold text-gray-900 dark:text-white">{entry.version} — {entry.title}</p>
                <p className="text-xs text-gray-400 dark:text-zinc-600 ml-auto shrink-0">{entry.date}</p>
              </div>
              <ul className="space-y-2">
                {entry.changes.map((c, i) => {
                  const style = TYPE_STYLES[c.type] || TYPE_STYLES.new;
                  const platform = c.platform || 'both';
                  const platformStyle = PLATFORM_STYLES[platform] || PLATFORM_STYLES.both;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${style.cls}`}>
                        {style.label}
                      </span>
                      <span className="text-xs text-gray-700 dark:text-zinc-300 flex-1">{c.text}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${platformStyle.cls}`}>
                        {platformStyle.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 dark:border-zinc-800 shrink-0">
          <button
            onClick={handleClose}
            className="w-full py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
