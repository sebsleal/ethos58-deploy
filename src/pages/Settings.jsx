import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Settings, User, Info, Sparkles } from 'lucide-react';
import { getSettings, saveSetting, getLastSeenVersion } from '../utils/storage';
import { CURRENT_VERSION } from '../constants/version';
import { PageHeader, SurfaceCard, cn } from '../components/ui';

const Changelog = lazy(() => import('../components/Changelog'));

const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState('account');
  const [s, setS] = useState(getSettings);
  const [showChangelog, setShowChangelog] = useState(false);
  const [lastSeenVersion, setLastSeenVersion] = useState(getLastSeenVersion());

  // Apply theme to DOM whenever it changes
  useEffect(() => {
    const root = document.documentElement;
    if (s.theme === 'dark') {
      root.classList.add('dark');
    } else if (s.theme === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.toggle('dark', window.matchMedia('(prefers-color-scheme: dark)').matches);
    }
  }, [s.theme]);

  const update = (key, value) => {
    saveSetting(key, value);
    setS(prev => ({ ...prev, [key]: value }));
  };

  const tabs = [
    { id: 'account',      label: 'Account Profile', icon: User },
    { id: 'preferences',  label: 'Preferences',     icon: Settings },
    { id: 'updates',      label: 'Update Log',      icon: Sparkles },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Preferences"
        title="Settings"
        description="Manage your Ethos58 preferences, account profile, and release history with the same unified shell and card system."
      />

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings Navigation */}
        <div className="w-full md:w-64 shrink-0">
          <nav className="surface-card flex md:flex-col overflow-x-auto custom-scrollbar md:overflow-visible gap-1 p-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  aria-pressed={activeTab === tab.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded text-[13px] font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                    ? 'bg-brand-500/8 text-brand-500 border border-brand-500/16'
                    : 'app-muted hover:bg-[var(--app-card-inset)] hover:text-[var(--app-heading)] border border-transparent'
                  }`}
                >
                  <Icon size={18} className={activeTab === tab.id ? 'text-brand-500' : 'app-muted'} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Settings Content */}
        <SurfaceCard className="flex-1 min-h-[400px]">

          {activeTab === 'account' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold app-heading">Account Profile</h2>
                <p className="text-sm app-muted mt-1">Update your personal information and public profile.</p>
              </div>
              <hr className="app-divider" />
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold app-muted mb-1.5 uppercase tracking-wide">Display Name</label>
                    <input
                      type="text"
                      defaultValue={s.displayName || 'B58 Enthusiast'}
                      onBlur={e => update('displayName', e.target.value)}
                      className="app-input w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold app-muted mb-1.5 uppercase tracking-wide">Email Address</label>
                    <input
                      type="email"
                      defaultValue={s.email || 'user@example.com'}
                      onBlur={e => update('email', e.target.value)}
                      className="app-input w-full px-4 py-2.5 text-sm"
                    />
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-center gap-3">
                  <div className="w-20 h-20 rounded-lg surface-inset flex items-center justify-center overflow-hidden">
                    <User size={40} className="app-muted" />
                  </div>
                  <button className="app-button-secondary px-3 py-1.5 text-xs font-medium opacity-60 cursor-not-allowed" disabled title="Avatar uploads are not available yet">
                    Change Avatar
                  </button>
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <button className="app-button-primary px-5 py-2 text-sm font-semibold shadow-lg shadow-brand-500/20 opacity-60 cursor-not-allowed" disabled title="Profile save is not available yet">
                  Save Changes
                </button>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-8 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold app-heading">Preferences</h2>
                <p className="text-sm app-muted mt-1">Customize your Ethos58 application experience.</p>
              </div>

              {/* Appearance */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Interface & Appearance</h3>
                <div className="space-y-5 surface-inset p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold app-heading">Theme Preference</h4>
                      <p className="mt-1 text-xs app-muted">Select your preferred visual style.</p>
                    </div>
                    <select
                      value={s.theme}
                      onChange={e => update('theme', e.target.value)}
                      className="app-input px-3 py-2 text-sm"
                    >
                      <option value="system">System Sync</option>
                      <option value="dark">Dark Mode</option>
                      <option value="light">Light Mode</option>
                    </select>
                  </div>

                  <hr className="app-divider" />

                </div>
              </div>

              {/* Log Viewer */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Log Viewer</h3>
                <div className="space-y-5 surface-inset p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-semibold app-heading">Data Downsampling</h4>
                        <div className="group relative flex items-center">
                          <Info size={14} className="app-muted cursor-help hover:text-brand-500 transition-colors" />
                          <div className="app-chart-tooltip absolute left-1/2 bottom-full z-10 mb-2 w-48 -translate-x-1/2 p-2 text-center text-[10px] font-medium leading-tight opacity-0 transition-opacity pointer-events-none group-hover:opacity-100">
                            Downsampling skips points in giant log files to keep your browser from lagging.
                            <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-[var(--app-card-elevated)]"></div>
                          </div>
                        </div>
                      </div>
                      <p className="mt-1 text-xs app-muted">Lower quality improves performance on large logs.</p>
                    </div>
                    <select
                      value={s.downsampling}
                      onChange={e => update('downsampling', e.target.value)}
                      className="app-input px-3 py-2 text-sm"
                    >
                      <option>Fast (800 pts)</option>
                      <option>High Quality (1600 pts)</option>
                      <option>Original (All Data)</option>
                    </select>
                  </div>

                  <hr className="app-divider" />

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold app-heading">Chart Line Thickness</h4>
                      <p className="mt-1 text-xs app-muted">Adjust the visual weight of telemetry graph lines.</p>
                    </div>
                    <select
                      value={s.lineThickness}
                      onChange={e => update('lineThickness', e.target.value)}
                      className="app-input px-3 py-2 text-sm"
                    >
                      <option>Thin (1px)</option>
                      <option>Normal (1.5px)</option>
                      <option>Thick (2px)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Formatting */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Formatting</h3>
                <div className="space-y-5 surface-inset p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold app-heading">Measurement Units</h4>
                      <p className="mt-1 text-xs app-muted">Choose between Imperial and Metric system defaults.</p>
                    </div>
                    <div className="app-toggle-group">
                      <button
                        onClick={() => update('units', 'US')}
                        className={cn('app-toggle-option px-3 py-1.5 text-xs font-semibold', s.units === 'US' && 'app-toggle-option-active')}
                        aria-pressed={s.units === 'US'}
                      >
                        US Standard
                      </button>
                      <button
                        onClick={() => update('units', 'Metric')}
                        className={cn('app-toggle-option px-3 py-1.5 text-xs font-semibold', s.units === 'Metric' && 'app-toggle-option-active')}
                        aria-pressed={s.units === 'Metric'}
                      >
                        Metric
                      </button>
                    </div>
                  </div>

                  <hr className="app-divider" />

                </div>
              </div>
            </div>
          )}

          {activeTab === 'updates' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold app-heading">Update Log</h2>
                <p className="text-sm app-muted mt-1">View all product updates anytime.</p>
              </div>
              <div className="surface-inset p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm app-muted">Current app version</span>
                  <span className="text-sm font-bold app-heading">{CURRENT_VERSION}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm app-muted">Last seen changelog</span>
                  <span className="text-sm font-semibold app-heading">{lastSeenVersion || 'Never opened'}</span>
                </div>
                <button
                  onClick={() => setShowChangelog(true)}
                  className="app-button-primary w-full py-2.5 text-sm font-semibold"
                >
                  Open Update Log
                </button>
              </div>
            </div>
          )}

        </SurfaceCard>
      </div>

      {showChangelog && (
        <Suspense fallback={null}>
          <Changelog
            currentVersion={CURRENT_VERSION}
            onClose={() => {
              setShowChangelog(false);
              setLastSeenVersion(getLastSeenVersion() || CURRENT_VERSION);
            }}
          />
        </Suspense>
      )}
    </div>
  );
};

export default SettingsPage;
