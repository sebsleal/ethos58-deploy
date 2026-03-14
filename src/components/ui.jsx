import { memo } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link } from 'react-router-dom';
import { ChevronRight, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';

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
