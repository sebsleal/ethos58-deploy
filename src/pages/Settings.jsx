import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Settings, User, Bell, Shield, Database, Info, Sparkles } from 'lucide-react';
import { getSettings, saveSetting, getLastSeenVersion } from '../utils/storage';
import { CURRENT_VERSION } from '../constants/version';

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
    { id: 'notifications', label: 'Notifications',  icon: Bell },
    { id: 'security',     label: 'Security',        icon: Shield },
    { id: 'integrations', label: 'Integrations',    icon: Database },
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-3">
          <Settings className="text-brand-400" size={32} />
          Settings
        </h1>
        <p className="text-gray-400 dark:text-gray-400 mt-2">Manage your Ethos58 preferences, account, and application settings.</p>
      </header>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Settings Navigation */}
        <div className="w-full md:w-64 shrink-0">
          <nav className="flex md:flex-col overflow-x-auto custom-scrollbar md:overflow-visible gap-1 bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-2 shadow-sm dark:shadow-none">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${activeTab === tab.id
                    ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20 shadow-sm dark:shadow-none'
                    : 'text-gray-400 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-200 border border-transparent'
                  }`}
                >
                  <Icon size={18} className={activeTab === tab.id ? 'text-brand-400' : 'text-gray-400 dark:text-gray-500'} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Settings Content */}
        <div className="flex-1 bg-white dark:bg-surface-200 border border-gray-200 dark:border-white/5 rounded-xl p-6 shadow-sm dark:shadow-none min-h-[400px]">

          {activeTab === 'account' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Account Profile</h2>
                <p className="text-sm text-gray-400 dark:text-gray-400 mt-1">Update your personal information and public profile.</p>
              </div>
              <hr className="border-gray-200 dark:border-white/5" />
              <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Display Name</label>
                    <input
                      type="text"
                      defaultValue={s.displayName || 'B58 Enthusiast'}
                      onBlur={e => update('displayName', e.target.value)}
                      className="w-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-lg px-4 py-2.5 text-gray-900 dark:text-gray-100 text-sm outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 dark:text-gray-400 mb-1.5 uppercase tracking-wide">Email Address</label>
                    <input
                      type="email"
                      defaultValue={s.email || 'user@example.com'}
                      onBlur={e => update('email', e.target.value)}
                      className="w-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 rounded-lg px-4 py-2.5 text-gray-900 dark:text-gray-100 text-sm outline-none transition-all"
                    />
                  </div>
                </div>
                <div className="shrink-0 flex flex-col items-center gap-3">
                  <div className="w-24 h-24 rounded-full bg-gray-50 dark:bg-surface-300 border border-gray-300 dark:border-white/10 flex items-center justify-center overflow-hidden">
                    <User size={40} className="text-gray-400 dark:text-gray-500" />
                  </div>
                  <button className="text-xs font-medium bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 border border-gray-300 dark:border-white/10 px-3 py-1.5 rounded-md text-gray-700 dark:text-gray-300 transition-colors">Change Avatar</button>
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <button className="bg-brand-500 hover:bg-brand-400 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow-lg shadow-brand-500/20">Save Changes</button>
              </div>
            </div>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-8 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Preferences</h2>
                <p className="text-sm text-gray-400 dark:text-gray-400 mt-1">Customize your Ethos58 application experience.</p>
              </div>

              {/* Appearance */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Interface & Appearance</h3>
                <div className="space-y-5 bg-gray-50/50 dark:bg-surface-300/30 border border-gray-200 dark:border-white/5 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Theme Preference</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Select your preferred visual style.</p>
                    </div>
                    <select
                      value={s.theme}
                      onChange={e => update('theme', e.target.value)}
                      className="bg-white dark:bg-[#121214] border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none focus:border-brand-500 transition-colors shadow-sm dark:shadow-none"
                    >
                      <option value="system">System Sync</option>
                      <option value="dark">Dark Mode</option>
                      <option value="light">Light Mode</option>
                    </select>
                  </div>

                  <hr className="border-gray-200 dark:border-white/5" />

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Compact View</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Reduce spacing in tables and layout elements.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={s.compactView}
                        onChange={e => update('compactView', e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-gray-200 dark:bg-surface-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white peer-checked:after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-500 border border-gray-300 dark:border-transparent"></div>
                    </label>
                  </div>
                </div>
              </div>

              {/* Log Viewer */}
              <div className="space-y-4">
                <h3 className="text-xs font-bold text-brand-500 uppercase tracking-wider">Log Viewer</h3>
                <div className="space-y-5 bg-gray-50/50 dark:bg-surface-300/30 border border-gray-200 dark:border-white/5 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Data Downsampling</h4>
                        <div className="group relative flex items-center">
                          <Info size={14} className="text-gray-400 dark:text-gray-500 cursor-help hover:text-brand-500 transition-colors" />
                          <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 p-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 text-[10px] leading-tight rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg text-center font-medium">
                            Downsampling skips points in giant log files to keep your browser from lagging.
                            <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] border-transparent border-t-gray-900 dark:border-t-white"></div>
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Lower quality improves performance on large logs.</p>
                    </div>
                    <select
                      value={s.downsampling}
                      onChange={e => update('downsampling', e.target.value)}
                      className="bg-white dark:bg-[#121214] border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none focus:border-brand-500 transition-colors shadow-sm dark:shadow-none"
                    >
                      <option>Fast (800 pts)</option>
                      <option>High Quality (1600 pts)</option>
                      <option>Original (All Data)</option>
                    </select>
                  </div>

                  <hr className="border-gray-200 dark:border-white/5" />

                  <div className="flex items-center justify-between">
                    <div className="pr-12">
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Default On-Load Preset</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Automatically select a channel preset when opening a new CSV.</p>
                    </div>
                    <select
                      value={s.defaultPreset}
                      onChange={e => update('defaultPreset', e.target.value)}
                      className="bg-white dark:bg-[#121214] border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none focus:border-brand-500 transition-colors shadow-sm dark:shadow-none"
                    >
                      <option>Tuner Preset</option>
                      <option>Fueling Preset</option>
                      <option>None (Clear)</option>
                    </select>
                  </div>

                  <hr className="border-gray-200 dark:border-white/5" />

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Chart Line Thickness</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Adjust the visual weight of telemetry graph lines.</p>
                    </div>
                    <select
                      value={s.lineThickness}
                      onChange={e => update('lineThickness', e.target.value)}
                      className="bg-white dark:bg-[#121214] border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none focus:border-brand-500 transition-colors shadow-sm dark:shadow-none"
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
                <div className="space-y-5 bg-gray-50/50 dark:bg-surface-300/30 border border-gray-200 dark:border-white/5 rounded-xl p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Measurement Units</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Choose between Imperial and Metric system defaults.</p>
                    </div>
                    <div className="flex bg-gray-200 dark:bg-black/40 rounded-lg p-1 border border-gray-300 dark:border-white/5">
                      <button
                        onClick={() => update('units', 'US')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${s.units === 'US' ? 'bg-white dark:bg-[#121214] text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/10' : 'text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-white'}`}
                      >
                        US Standard
                      </button>
                      <button
                        onClick={() => update('units', 'Metric')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${s.units === 'Metric' ? 'bg-white dark:bg-[#121214] text-gray-900 dark:text-white shadow-sm border border-gray-200 dark:border-white/10' : 'text-gray-500 hover:text-gray-700 dark:text-zinc-400 dark:hover:text-white'}`}
                      >
                        Metric
                      </button>
                    </div>
                  </div>

                  <hr className="border-gray-200 dark:border-white/5" />

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Time Format</h4>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Display log axis time as elapsed seconds or absolute timestamp.</p>
                    </div>
                    <select
                      value={s.timeFormat}
                      onChange={e => update('timeFormat', e.target.value)}
                      className="bg-white dark:bg-[#121214] border border-gray-300 dark:border-white/10 rounded-lg px-3 py-2 text-gray-800 dark:text-gray-200 text-sm outline-none focus:border-brand-500 transition-colors shadow-sm dark:shadow-none"
                    >
                      <option>Elapsed (Seconds)</option>
                      <option>Absolute Time</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'updates' && (
            <div className="space-y-6 animate-fade-in">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Update Log</h2>
                <p className="text-sm text-gray-400 dark:text-gray-400 mt-1">View all product updates anytime.</p>
              </div>
              <div className="bg-gray-50/50 dark:bg-surface-300/30 border border-gray-200 dark:border-white/5 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Current app version</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{CURRENT_VERSION}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-gray-300">Last seen changelog</span>
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{lastSeenVersion || 'Never opened'}</span>
                </div>
                <button
                  onClick={() => setShowChangelog(true)}
                  className="w-full py-2.5 bg-brand-500 hover:bg-brand-400 text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  Open Update Log
                </button>
              </div>
            </div>
          )}

          {activeTab !== 'account' && activeTab !== 'preferences' && activeTab !== 'updates' && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 py-12">
              <Settings size={48} className="opacity-20 mb-4" />
              <p className="text-sm font-medium text-gray-400 dark:text-gray-400">Settings for {activeTab} coming soon.</p>
            </div>
          )}

        </div>
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
