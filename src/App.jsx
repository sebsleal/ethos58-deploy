import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import Layout from './components/Layout';
import Calculator from './pages/Calculator';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import { isOnboardingDone, getLastSeenVersion } from './utils/storage';
import { CURRENT_VERSION } from './constants/version';

const loadLogAnalyzer = () => import('./pages/LogAnalyzer');
const loadLogViewer = () => import('./pages/LogViewer');
const loadOnboarding = () => import('./components/Onboarding');
const loadChangelog = () => import('./components/Changelog');

const LogAnalyzer = lazy(loadLogAnalyzer);
const LogViewer = lazy(loadLogViewer);
const Onboarding = lazy(loadOnboarding);
const Changelog = lazy(loadChangelog);

function LoadingFallback() {
  return (
    <div className="h-full min-h-[240px] flex items-center justify-center text-sm font-medium text-gray-500 dark:text-zinc-400">
      Loading...
    </div>
  );
}

function App() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = null;
    let idleId = null;

    const preloadHeavyViews = () => {
      if (cancelled) return;
      void loadLogViewer();
      void loadLogAnalyzer();
      void loadOnboarding();
      void loadChangelog();
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(preloadHeavyViews, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(preloadHeavyViews, 450);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && 'cancelIdleCallback' in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    let keyboardWillShowListener = null;
    let keyboardWillHideListener = null;
    let isMounted = true;

    const syncNativeChrome = async () => {
      if (!isMounted || !Capacitor.isNativePlatform()) return;
      const isDark = document.documentElement.classList.contains('dark');
      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        if (!isMounted) return;
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setBackgroundColor({ color: '#00000000' });
        await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
      } catch {
        // ignore if unavailable in current runtime
      }

      try {
        const { Keyboard, KeyboardResize, KeyboardStyle } = await import('@capacitor/keyboard');
        if (!isMounted) return;
        await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
        await Keyboard.setStyle({ style: isDark ? KeyboardStyle.Dark : KeyboardStyle.Light });
      } catch {
        // ignore if unavailable in current runtime
      }
    };

    // Apply theme
    const theme = localStorage.getItem('theme') || 'system';
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else if (theme === 'light') {
      root.classList.remove('dark');
    } else {
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    }
    document.documentElement.style.setProperty('--app-bottom-inset', 'env(safe-area-inset-bottom)');
    syncNativeChrome();

    const observer = new MutationObserver(() => {
      syncNativeChrome();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    if (Capacitor.isNativePlatform()) {
      import('@capacitor/keyboard')
        .then(async ({ Keyboard }) => {
          if (!isMounted) return;
          keyboardWillShowListener = await Keyboard.addListener('keyboardWillShow', () => {
            document.body.classList.add('keyboard-open');
            document.documentElement.style.setProperty('--app-bottom-inset', '0px');
          });
          if (!isMounted) {
            if (keyboardWillShowListener?.remove) keyboardWillShowListener.remove();
            keyboardWillShowListener = null;
            return;
          }
          keyboardWillHideListener = await Keyboard.addListener('keyboardWillHide', () => {
            document.body.classList.remove('keyboard-open');
            document.documentElement.style.setProperty('--app-bottom-inset', 'env(safe-area-inset-bottom)');
          });
          if (!isMounted && keyboardWillHideListener?.remove) {
            keyboardWillHideListener.remove();
            keyboardWillHideListener = null;
          }
        })
        .catch(() => {
          // ignore when keyboard plugin isn't available
        });
    }

    // Guard against iOS/WKWebView double-tap zoom on non-interactive empty areas.
    let lastTouchEnd = 0;
    const interactiveTargetSelector = 'a, button, input, textarea, select, label, summary, [role="button"], [contenteditable="true"], [data-allow-double-tap]';
    const handleTouchEnd = (event) => {
      if (event.changedTouches.length !== 1) return;

      const now = Date.now();
      const delta = now - lastTouchEnd;
      lastTouchEnd = now;
      if (delta <= 0 || delta > 300) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(interactiveTargetSelector)) return;

      event.preventDefault();
    };

    document.addEventListener('touchend', handleTouchEnd, { passive: false });

    // Show onboarding on first launch
    if (!isOnboardingDone()) {
      setShowOnboarding(true);
    } else {
      // Show changelog when version advances
      const lastSeen = getLastSeenVersion();
      if (lastSeen !== CURRENT_VERSION) {
        setShowChangelog(true);
      }
    }

    return () => {
      isMounted = false;
      observer.disconnect();
      document.removeEventListener('touchend', handleTouchEnd);
      document.body.classList.remove('keyboard-open');
      document.documentElement.style.setProperty('--app-bottom-inset', 'env(safe-area-inset-bottom)');
      if (keyboardWillShowListener?.remove) keyboardWillShowListener.remove();
      if (keyboardWillHideListener?.remove) keyboardWillHideListener.remove();
    };
  }, []);

  useEffect(() => {
    let removeNativeListener = null;
    let isMounted = true;

    const applyStatus = (connected) => {
      if (!isMounted) return;
      setIsOffline(!connected);
    };

    if (Capacitor.isNativePlatform()) {
      import('@capacitor/network')
        .then(async ({ Network }) => {
          if (!isMounted) return;
          const status = await Network.getStatus();
          if (!isMounted) return;
          applyStatus(status.connected);
          const listener = await Network.addListener('networkStatusChange', (s) => applyStatus(s.connected));
          if (!isMounted) {
            if (listener?.remove) listener.remove();
            return;
          }
          removeNativeListener = listener;
        })
        .catch(() => {
          applyStatus(navigator.onLine);
        });
    } else {
      const handleOnline = () => applyStatus(true);
      const handleOffline = () => applyStatus(false);
      applyStatus(navigator.onLine);
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        isMounted = false;
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }

    return () => {
      isMounted = false;
      if (removeNativeListener?.remove) {
        removeNativeListener.remove();
      }
    };
  }, []);

  function handleOnboardingDone() {
    setShowOnboarding(false);
    const lastSeen = getLastSeenVersion();
    if (lastSeen !== CURRENT_VERSION) {
      setShowChangelog(true);
    }
  }

  return (
    <Router>
      {isOffline && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[60] px-4 py-2 rounded-xl bg-red-500/95 text-white text-xs font-semibold shadow-lg backdrop-blur-sm"
          style={{ top: 'max(0.5rem, env(safe-area-inset-top))' }}
        >
          You are offline. Some features may be unavailable.
        </div>
      )}
      <Layout>
        <Suspense fallback={<LoadingFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/calculator" element={<Calculator />} />
            <Route path="/analyzer" element={<LogAnalyzer />} />
            <Route path="/viewer" element={<LogViewer />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Suspense>
      </Layout>

      {showOnboarding && (
        <Suspense fallback={null}>
          <Onboarding onDone={handleOnboardingDone} />
        </Suspense>
      )}

      {!showOnboarding && showChangelog && (
        <Suspense fallback={null}>
          <Changelog
            currentVersion={CURRENT_VERSION}
            onClose={() => setShowChangelog(false)}
          />
        </Suspense>
      )}
    </Router>
  );
}

export default App;
