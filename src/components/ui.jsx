import { memo, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2, AlertTriangle, ShieldAlert, X, Info } from 'lucide-react';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/* ── Page Header ─────────────────────────────────────────────── */
export function PageHeader({ eyebrow, title, description, meta, action, className, titleClassName }) {
  return (
    <header className={cn('space-y-4', className)}>
      {eyebrow && (
        <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-brand-500/70">
          {eyebrow}
        </div>
      )}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-2">
          <h1
            className={cn(
              'text-[1.85rem] font-semibold tracking-[-0.03em] app-heading md:text-[2.4rem]',
              titleClassName,
            )}
          >
            {title}
          </h1>
          {description && (
            <p className="max-w-2xl text-sm leading-relaxed app-muted">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {meta && <div className="flex flex-wrap gap-2">{meta}</div>}
    </header>
  );
}

/* ── Surface Cards ───────────────────────────────────────────── */
export const SurfaceCard = memo(function SurfaceCard({
  children,
  className,
  strong = false,
  padded = true,
}) {
  return (
    <section
      className={cn(
        strong ? 'surface-card-strong' : 'surface-card',
        padded && 'p-5 md:p-5',
        className,
      )}
    >
      {children}
    </section>
  );
});

export const InsetCard = memo(function InsetCard({ children, className, padded = true }) {
  return (
    <div className={cn('surface-inset', padded && 'p-4', className)}>
      {children}
    </div>
  );
});

/* ── Section Title ───────────────────────────────────────────── */
export function SectionTitle({ icon: Icon, title, subtitle, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex items-start gap-2.5">
        {Icon && (
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[var(--app-border)] bg-[var(--app-card-inset)] text-brand-500">
            <Icon size={14} strokeWidth={2} />
          </div>
        )}
        <div>
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] app-heading">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] leading-relaxed app-muted">{subtitle}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ── Metric Pill ─────────────────────────────────────────────── */
export const MetricPill = memo(function MetricPill({ icon: Icon, label, value, className }) {
  return (
    <div
      className={cn(
        'app-pill flex items-center gap-2 px-3 py-1.5 text-[11.5px] font-medium',
        className,
      )}
    >
      {Icon && <Icon size={11} className="shrink-0 text-brand-500/70" />}
      <span className="app-muted">{label}</span>
      {value !== undefined && value !== null && (
        <span className="font-semibold app-heading">{value}</span>
      )}
    </div>
  );
});

/* ── Status Pill ─────────────────────────────────────────────── */
export const StatusPill = memo(function StatusPill({ status, className }) {
  const normalized = String(status || 'Unknown').toLowerCase();
  const styles =
    normalized === 'safe'
      ? 'app-status-safe'
      : normalized === 'caution'
        ? 'app-status-caution'
        : normalized === 'risk'
          ? 'app-status-risk'
          : 'app-pill';
  const Icon =
    normalized === 'safe'
      ? CheckCircle2
      : normalized === 'caution'
        ? AlertTriangle
        : normalized === 'risk'
          ? ShieldAlert
          : null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        styles,
        className,
      )}
    >
      {Icon && <Icon size={10} />}
      {status}
    </span>
  );
});

/* ── Action Tile ─────────────────────────────────────────────── */
export function ActionTile({
  to,
  onClick,
  icon: Icon,
  title,
  description,
  meta,
  className,
  iconClassName,
  emphasized = false,
}) {
  const content = (
    <div
      className={cn(
        'group flex h-full flex-col rounded border p-4 text-left transition-all duration-150',
        emphasized
          ? 'border-brand-500/20 bg-brand-500/5 hover:border-brand-500/30 hover:bg-brand-500/8 dark:bg-brand-500/6'
          : 'surface-inset hover:border-[var(--app-border-strong)]',
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            'mb-4 flex h-8 w-8 items-center justify-center rounded border border-[var(--app-border)] bg-[var(--app-card-elevated)] text-[var(--app-text-muted)]',
            emphasized && 'border-brand-500/20 text-brand-500',
            iconClassName,
          )}
        >
          <Icon size={16} strokeWidth={1.75} />
        </div>
      )}
      <div className="space-y-1.5">
        <h3 className="text-[15px] font-semibold tracking-[-0.02em] app-heading">{title}</h3>
        {description && (
          <p className="text-[12.5px] leading-relaxed app-muted">{description}</p>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between pt-4 text-xs">
        {meta ? <span className="app-muted">{meta}</span> : <span />}
        <ChevronRight
          size={13}
          className="app-muted transition-transform duration-150 group-hover:translate-x-0.5"
        />
      </div>
    </div>
  );

  if (to) return <Link to={to}>{content}</Link>;
  return (
    <button type="button" onClick={onClick} className="h-full w-full">
      {content}
    </button>
  );
}

/* ── Skeleton ────────────────────────────────────────────────── */
export const SkeletonLine = memo(function SkeletonLine({ className }) {
  return <div className={cn('skeleton h-3', className)} />;
});

export const SkeletonCard = memo(function SkeletonCard({ className, lines = 3 }) {
  return (
    <div className={cn('rounded-[10px] border border-[var(--border)] bg-[var(--bg-surface)] p-4 space-y-3', className)}>
      <SkeletonLine className="w-1/3" />
      {Array.from({ length: lines - 1 }).map((_, i) => (
        <SkeletonLine key={i} className={i === lines - 2 ? 'w-2/3' : 'w-full'} />
      ))}
    </div>
  );
});

/* ── Toast system ────────────────────────────────────────────── */
const ToastContext = createContext(null);

let _addToast = null;

export function useToast() {
  const ctx = useContext(ToastContext);
  if (ctx) return ctx;
  // Fallback for components outside provider: use the global ref
  return { toast: _addToast ?? (() => {}) };
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, state: 'leaving' } : t));
    timers.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timers.current[id];
    }, 200);
  }, []);

  const toast = useCallback((message, { variant = 'info', duration = 3500 } = {}) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, variant, state: 'entering' }]);
    if (duration > 0) {
      timers.current[id] = setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  // Expose globally for use outside React tree
  _addToast = toast;

  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  const icons = {
    success: <CheckCircle2 size={14} className="shrink-0 mt-px text-[var(--success-text)]" />,
    error:   <ShieldAlert size={14} className="shrink-0 mt-px text-[var(--danger-text)]" />,
    warn:    <AlertTriangle size={14} className="shrink-0 mt-px text-[var(--warn-text)]" />,
    info:    <Info size={14} className="shrink-0 mt-px text-[var(--text-muted)]" />,
  };

  const toastRoot = typeof document !== 'undefined'
    ? (document.getElementById('toast-root') ?? (() => {
        const el = document.createElement('div');
        el.id = 'toast-root';
        document.body.appendChild(el);
        return el;
      })())
    : null;

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {toastRoot && createPortal(
        toasts.map((t) => (
          <div key={t.id} className="toast-item" data-variant={t.variant} data-state={t.state}>
            {icons[t.variant] ?? icons.info}
            <span className="flex-1 text-[12px] leading-[1.5]">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        )),
        toastRoot,
      )}
    </ToastContext.Provider>
  );
}

/* ── Empty State ─────────────────────────────────────────────── */
export function EmptyStateCard({ icon: Icon, title, body, actionLabel, onAction, className }) {
  return (
    <div className={cn(
      'rounded-[10px] border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-6 py-10 text-center',
      className,
    )}>
      {Icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--bg-muted)] text-[var(--text-dark-muted)]">
          <Icon size={18} strokeWidth={1.8} />
        </div>
      )}
      <h3 className="mt-4 text-[14px] font-medium text-[var(--text-primary)]">{title}</h3>
      {body && <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-[1.6] text-[var(--text-secondary)]">{body}</p>}
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-[8px] bg-[var(--text-primary)] px-4 py-2 text-[12px] font-medium text-[var(--bg-page)] transition-opacity hover:opacity-80"
        >
          {actionLabel}
          <ChevronRight size={12} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

/* ── Chart Card ──────────────────────────────────────────────── */
export const ChartCard = memo(function ChartCard({
  icon: Icon,
  title,
  subtitle,
  action,
  children,
  className,
  contentClassName,
}) {
  return (
    <SurfaceCard className={className}>
      <SectionTitle icon={Icon} title={title} subtitle={subtitle} action={action} />
      <div className={cn('mt-4', contentClassName)}>{children}</div>
    </SurfaceCard>
  );
});
