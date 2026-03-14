import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Home, Activity, Droplet, MonitorPlay, Settings, Archive, MoonStar, SunMedium, X } from 'lucide-react';
import AppShellRail from './AppShellRail';
import { cn } from './ui';
import { getActiveBlend, getRecentLogs, saveSetting } from '../utils/storage';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { name: 'Dashboard', path: '/dashboard', icon: Home },
      { name: 'Garage',    path: '/garage',    icon: Archive },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { name: 'Log Viewer',   path: '/viewer',   icon: MonitorPlay },
      { name: 'Log Analyzer', path: '/analyzer', icon: Activity, experimental: true },
    ],
  },
  {
    label: 'Fuel',
    items: [
      { name: 'Blend Calculator', path: '/calculator', icon: Droplet },
    ],
  },
  {
    label: 'System',
    items: [
      { name: 'Settings', path: '/settings', icon: Settings },
    ],
  },
];

const SIDEBAR_STATE_KEY = 'ethos_sidebar_collapsed';

export default function Layout({ children }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isRailCollapsed, setIsRailCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_STATE_KEY) === 'true',
  );
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark'),
  );
  const [shellData, setShellData] = useState(() => ({
    recentLog:   getRecentLogs()[0] || null,
    activeBlend: getActiveBlend(),
  }));
  const location  = useLocation();
  const isViewer  = location.pathname === '/viewer';

  useEffect(() => {
    localStorage.setItem(SIDEBAR_STATE_KEY, String(isRailCollapsed));
  }, [isRailCollapsed]);

  useEffect(() => {
    setShellData({
      recentLog:   getRecentLogs()[0] || null,
      activeBlend: getActiveBlend(),
    });
    setIsDark(document.documentElement.classList.contains('dark'));
  }, [location.pathname]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const vehicle = useMemo(() => {
    const { recentLog, activeBlend } = shellData;
    const name =
      recentLog?.engine && recentLog.engine !== '—'
        ? recentLog.engine.includes('B58') ? 'BMW F30 340i' : recentLog.engine
        : 'BMW F30 340i';
    const tune  = recentLog?.tune && recentLog.tune !== '—' ? recentLog.tune : 'Stage 2+';
    const blend = activeBlend?.resultingBlend ?? recentLog?.ethanol ?? 50;
    return { name, subtitle: `${tune} E${blend}` };
  }, [shellData]);

  const toggleTheme = () => {
    const nextDark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', nextDark);
    saveSetting('theme', nextDark ? 'dark' : 'light');
    setIsDark(nextDark);
  };

  return (
    <div className="app-shell flex min-h-dvh overflow-hidden">

      {/* ── Desktop Sidebar ───────────────────────── */}
      <aside
        className={cn(
          'app-rail relative hidden shrink-0 border-r transition-[width] duration-200 md:flex md:flex-col',
          isRailCollapsed ? 'w-[60px]' : 'w-[200px]',
        )}
      >
        {/* hairline right edge */}
        <div className="absolute inset-y-0 right-0 w-px bg-white/[0.05]" />

        <div className="flex-1 overflow-y-auto px-2.5 pb-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
          <AppShellRail
            navItems={NAV_GROUPS}
            collapsed={isRailCollapsed}
            onToggleCollapse={() => setIsRailCollapsed((v) => !v)}
            vehicle={vehicle}
          />
        </div>
      </aside>

      {/* ── Main Area ────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">

        {/* Mobile top bar */}
        <div className="app-rail border-b px-4 pb-3 md:hidden" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)' }}>
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label={isMobileMenuOpen ? 'Close navigation' : 'Open navigation'}
              className="app-icon-button flex h-9 w-9 items-center justify-center"
              onClick={() => setIsMobileMenuOpen((v) => !v)}
            >
              {isMobileMenuOpen ? <X size={15} /> : <Menu size={15} />}
            </button>

            <span className="text-sm font-semibold tracking-tight text-white/90">
              ETHOS<span className="text-brand-400">58</span>
            </span>

            <button
              type="button"
              aria-label={isDark ? 'Light theme' : 'Dark theme'}
              className="app-icon-button flex h-9 w-9 items-center justify-center"
              onClick={toggleTheme}
            >
              {isDark ? <SunMedium size={14} /> : <MoonStar size={14} />}
            </button>
          </div>

          {isMobileMenuOpen && (
            <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5 animate-fade-in">
              <AppShellRail
                navItems={NAV_GROUPS}
                mobile
                onNavigate={() => setIsMobileMenuOpen(false)}
                vehicle={vehicle}
              />
            </div>
          )}
        </div>

        {/* Canvas */}
        <main className="app-canvas relative flex min-h-0 flex-1 overflow-hidden">
          <div className="relative flex min-h-0 flex-1 flex-col">

            {/* Desktop top-right controls */}
            <div className="hidden items-center justify-end gap-2 px-6 md:flex xl:px-7" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 1rem)' }}>
              <button
                type="button"
                aria-label={isDark ? 'Light theme' : 'Dark theme'}
                className="app-icon-button flex h-8 w-8 items-center justify-center"
                onClick={toggleTheme}
              >
                {isDark ? <SunMedium size={14} /> : <MoonStar size={14} />}
              </button>
            </div>

            <div
              className={cn(
                'flex-1 overflow-y-auto',
                isViewer ? 'p-0' : 'px-5 pb-10 pt-4 md:px-6 md:pb-10 xl:px-8',
              )}
              data-scroll-container
              style={{
                paddingBottom: 'var(--app-bottom-inset, env(safe-area-inset-bottom))',
                overscrollBehaviorY: 'none',
                WebkitOverflowScrolling: 'touch',
              }}
            >
              {isViewer ? (
                children
              ) : (
                <div className="app-workspace mx-auto h-full max-w-[1560px] animate-fade-in">
                  {children}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
