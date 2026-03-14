import { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Zap, ArrowUpCircle } from 'lucide-react';
import { setLastSeenVersion } from '../utils/storage';
import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

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
  const dialogRef = useRef(null);

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

  const { dragDelta, swipeBind } = useSwipeDismiss(handleClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const focusable = dialog.querySelector('button');
    focusable?.focus();

    const handleKeyDown = (event) => {
      if (event.key !== 'Tab') return;
      const nodes = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const focusableNodes = Array.from(nodes).filter((node) => !node.hasAttribute('disabled'));
      if (!focusableNodes.length) return;
      const first = focusableNodes[0];
      const last = focusableNodes[focusableNodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, []);

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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/50 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div
        ref={dialogRef}
        className="surface-panel animate-modal-in flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="What is new in Ethos58"
        style={{
          transform: dragDelta > 0 ? `translateY(${Math.min(dragDelta, 140)}px)` : 'translateY(0)',
          transition: dragDelta > 0 ? 'none' : 'transform 0.25s ease',
        }}
      >
        <div
          className="pt-3 pb-1 flex justify-center cursor-grab active:cursor-grabbing"
          {...swipeBind}
        >
          <span className="h-1 w-12 rounded-full bg-slate-300/90 dark:bg-white/12" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-4 pb-4 border-b app-divider shrink-0">
          <div className="flex items-center gap-2">
            <div className="rounded-xl border border-brand-500/20 bg-brand-500/10 p-2">
              <Sparkles size={16} className="text-brand-500" />
            </div>
            <div>
              <h2 className="text-base font-semibold app-heading">What's New</h2>
              {latest && (
                <p className="text-xs app-muted">Version {latest.version}</p>
              )}
            </div>
          </div>
          <button onClick={handleClose} className="app-icon-button p-2" aria-label="Close update log">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-3 border-b app-divider shrink-0">
          <div className="inline-flex rounded-full border app-divider overflow-hidden bg-[var(--app-card-inset)]">
            {[
              { id: 'all', label: 'All' },
              { id: 'web', label: 'Web' },
              { id: 'ios', label: 'iOS' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setPlatformFilter(tab.id)}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${platformFilter === tab.id ? 'bg-brand-500 text-white' : 'text-[var(--app-text-muted)] hover:text-[var(--app-heading)]'}`}
                aria-pressed={platformFilter === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">
          {filteredEntries.length === 0 && (
            <div className="text-center py-12 text-sm app-muted">
              No updates in this platform filter yet.
            </div>
          )}
          {filteredEntries.map((entry, idx) => (
            <div key={entry.version} className="surface-inset p-4">
              <div className="flex items-center gap-2 mb-3">
                {idx === 0 ? (
                  <Zap size={14} className="text-brand-500 shrink-0" />
                ) : (
                  <ArrowUpCircle size={14} className="app-muted shrink-0" />
                )}
                <p className="text-xs font-bold app-heading">{entry.version} — {entry.title}</p>
                <p className="text-xs app-muted ml-auto shrink-0">{entry.date}</p>
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
                      <span className="text-xs flex-1 app-heading">{c.text}</span>
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
        <div className="px-6 py-4 border-t app-divider shrink-0">
          <button
            onClick={handleClose}
            className="w-full py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-[1rem] text-sm font-semibold transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
