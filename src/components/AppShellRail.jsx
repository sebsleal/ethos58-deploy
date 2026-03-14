import { NavLink } from 'react-router-dom';
import { Activity, CarFront, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from './ui';

export default function AppShellRail({
  navItems,
  mobile = false,
  collapsed = false,
  onNavigate,
  onToggleCollapse,
  vehicle,
}) {
  const compact = mobile ? false : collapsed;

  return (
    <div className={cn('flex flex-col', mobile ? 'gap-1' : 'h-full')}>

      {/* ── Logo ─────────────────────────────────── */}
      <div className={cn('mb-5', mobile ? 'hidden' : 'block')}>
        <div className={cn('flex items-center', compact ? 'justify-center' : 'justify-between')}>
          <div className={cn('flex items-center gap-2.5', compact && 'justify-center')}>
            <div className="app-rail-accent flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]">
              <Activity size={14} strokeWidth={2.4} className="text-brand-400" />
            </div>
            {!compact && (
              <span className="text-[13px] font-semibold tracking-tight text-white/90">
                ETHOS<span className="text-brand-400">58</span>
              </span>
            )}
          </div>
          {!compact && onToggleCollapse && (
            <button
              type="button"
              aria-label="Collapse sidebar"
              className="flex h-6 w-6 items-center justify-center rounded-[3px] text-white/25 transition-colors hover:bg-white/5 hover:text-white/50"
              onClick={onToggleCollapse}
            >
              <PanelLeftClose size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ── Vehicle Selector ─────────────────────── */}
      {!mobile && (
        <div className={cn('mb-5', compact ? '' : '')}>
          <div
            className={cn(
              'app-vehicle-card cursor-pointer',
              compact ? 'justify-center px-0 py-2' : 'px-2.5 py-2',
            )}
          >
            <div className={cn('flex w-full items-center', compact ? 'justify-center' : 'gap-2.5')}>
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] bg-brand-500/10 text-brand-400/70">
                <CarFront size={13} />
              </div>
              {!compact && (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-medium leading-tight text-white/80">
                      {vehicle?.name || 'BMW F30 340i'}
                    </p>
                    <p className="truncate text-[10.5px] leading-tight text-white/35">
                      {vehicle?.subtitle || 'Stage 2+ E50'}
                    </p>
                  </div>
                  <ChevronRight size={11} className="shrink-0 text-white/20" />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Navigation Groups ────────────────────── */}
      <div className={cn('flex-1', mobile ? 'space-y-3' : 'space-y-4')}>
        {navItems.map((group) => (
          <div key={group.label || group.items[0]?.path}>
            {!compact && group.label && (
              <div className="mb-1 px-2">
                <span className="text-[9.5px] font-semibold uppercase tracking-[0.2em] text-white/22">
                  {group.label}
                </span>
              </div>
            )}

            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={onNavigate}
                    title={compact ? item.name : undefined}
                    className={({ isActive }) =>
                      cn(
                        'app-rail-link flex items-center text-[12.5px] font-medium transition-all',
                        compact ? 'justify-center px-0 py-2' : 'gap-2.5 px-2 py-1.5',
                        isActive && 'app-rail-link-active',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <Icon
                          size={14}
                          strokeWidth={isActive ? 2.2 : 1.75}
                          className={cn(
                            'shrink-0 transition-colors',
                            isActive ? 'text-brand-400' : 'text-white/38',
                          )}
                        />
                        {!compact && (
                          <span
                            className={cn(
                              'flex min-w-0 flex-1 items-center gap-2 truncate',
                              isActive ? 'text-white/90' : 'text-white/50',
                            )}
                          >
                            <span className="truncate">{item.name}</span>
                            {item.experimental && (
                              <span className="rounded-[3px] border border-brand-500/20 bg-brand-500/10 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-brand-400/80">
                                Beta
                              </span>
                            )}
                          </span>
                        )}
                        {isActive && !compact && (
                          <div className="ml-auto h-1 w-1 rounded-full bg-brand-400/60" />
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Collapse toggle (compact mode) ───────── */}
      {!mobile && compact && onToggleCollapse && (
        <button
          type="button"
          aria-label="Expand sidebar"
          className="mx-auto mt-auto flex h-6 w-6 items-center justify-center rounded-[3px] text-white/25 transition-colors hover:bg-white/5 hover:text-white/50"
          onClick={onToggleCollapse}
        >
          <PanelLeftOpen size={13} />
        </button>
      )}
    </div>
  );
}
