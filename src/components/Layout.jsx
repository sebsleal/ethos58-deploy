import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Home,
  Activity,
  User,
  Menu,
  Search,
  Droplet,
  MonitorPlay,
  Settings,
  Archive,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

const Layout = ({ children }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: Home },
    { name: 'Blend Calc', path: '/calculator', icon: Droplet },
    { name: 'Log Viewer', path: '/viewer', icon: MonitorPlay },
    { name: 'Log Analyzer', path: '/analyzer', icon: Activity, experimental: true },
    { name: 'Garage', path: '/garage', icon: Archive },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="h-dvh bg-gray-50 dark:bg-[#09090B] text-gray-900 dark:text-gray-100 flex flex-col md:flex-row overflow-hidden font-sans selection:bg-brand-500/20 selection:text-brand-700">

      {/* ── Mobile layout (hidden on md+) ── */}
      <div className="md:hidden flex flex-col flex-1 overflow-hidden">

        {/* Mobile Header */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-6 pb-4 border-b border-gray-200 dark:border-zinc-800"
          style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}
        >
          <button
            type="button"
            aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="flex flex-col gap-1.5 w-6 cursor-pointer"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <div className="h-0.5 w-full bg-gray-900 dark:bg-white rounded-full"></div>
            <div className="h-0.5 w-full bg-gray-900 dark:bg-white rounded-full"></div>
            <div className="h-0.5 w-2/3 bg-gray-900 dark:bg-white rounded-full"></div>
          </button>
        </div>

        {/* Mobile Nav (shown below header when open) */}
        {isMobileMenuOpen && (
          <nav
            className="flex-shrink-0 flex flex-col px-6 py-4 border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-[#09090B] gap-1.5"
            style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className={({ isActive }) => cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                    isActive
                      ? "bg-gray-100 dark:bg-zinc-800/80 text-gray-900 dark:text-white"
                      : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800/50 hover:text-gray-900 dark:hover:text-white"
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={18} strokeWidth={isActive ? 2 : 1.5} className={isActive ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-zinc-400"} />
                      <span className="flex items-center gap-2">
                        {item.name}
                        {item.experimental && (
                          <span className="text-[10px] uppercase font-bold bg-brand-50/50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 px-1.5 py-0.5 rounded border border-brand-200 dark:border-brand-500/20 leading-none">
                            Beta
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        )}

        {/* Mobile Page Content */}
        <main
          className="flex-1 overflow-y-auto"
          data-scroll-container
          style={{ paddingBottom: 'var(--app-bottom-inset, env(safe-area-inset-bottom))' }}
        >
          <div className={cn(
            location.pathname === '/viewer' ? "p-0 h-full" : "px-4 pt-6 pb-12 max-w-6xl mx-auto"
          )}>
            {children}
          </div>
        </main>
      </div>

      {/* ── Desktop layout (hidden on mobile) ── */}
      <nav className="hidden md:flex flex-shrink-0 flex-col h-screen w-[260px] p-6 lg:p-8 bg-white dark:bg-[#09090B] border-r border-gray-200 dark:border-zinc-800">
        {/* Sidebar Logo */}
        <div className="mb-10 mt-2 px-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center text-white shadow-sm shadow-brand-500/20">
              <Activity size={18} strokeWidth={2.5} />
            </div>
            <span className="font-bold tracking-tight text-lg text-gray-900 dark:text-white flex-shrink-0 whitespace-nowrap">
              ETHOS<span className="text-brand-500">58</span>
            </span>
          </div>
        </div>

        {/* Desktop Nav Links */}
        <div className="flex-1 flex flex-col gap-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                  isActive
                    ? "bg-gray-100 dark:bg-zinc-800/80 text-gray-900 dark:text-white"
                    : "text-gray-600 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800/50 hover:text-gray-900 dark:hover:text-white"
                )}
              >
                {({ isActive }) => (
                  <>
                    <Icon size={18} strokeWidth={isActive ? 2 : 1.5} className={isActive ? "text-gray-900 dark:text-white" : "text-gray-500 dark:text-zinc-400"} />
                    <span className="flex items-center gap-2">
                      {item.name}
                      {item.experimental && (
                        <span className="text-[10px] uppercase font-bold bg-brand-50/50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 px-1.5 py-0.5 rounded border border-brand-200 dark:border-brand-500/20 leading-none">
                          Beta
                        </span>
                      )}
                    </span>
                  </>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {/* Desktop Main Content */}
      <main className="hidden md:flex flex-1 flex-col overflow-hidden relative bg-gray-50 dark:bg-[#09090B]">
        <div className={cn("absolute top-6 right-8 z-10 flex", location.pathname === '/viewer' && "!hidden")}>
          <div className="w-8 h-8 rounded-md border border-gray-200 dark:border-zinc-800 bg-white dark:bg-[#121214] flex items-center justify-center text-gray-500 dark:text-zinc-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-zinc-700 transition-colors cursor-pointer shadow-sm">
            <Search size={16} strokeWidth={2} />
          </div>
        </div>

        <div className={cn(
          "flex-1 overflow-y-auto",
          location.pathname === '/viewer' ? "p-0" : "px-8 lg:px-12 pt-16 pb-12"
        )} data-scroll-container>
          <div className={cn(
            "mx-auto animate-fade-in h-full",
            location.pathname === '/viewer' ? "max-w-none" : "max-w-6xl"
          )}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Layout;
