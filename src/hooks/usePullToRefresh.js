import { useEffect, useRef, useState } from 'react';

export function usePullToRefresh(rootRef, {
  enabled = true,
  threshold = 70,
  maxDistance = 120,
  settleMs = 500,
  cooldownMs = 3000,
  getScrollContainer,
  onRefresh,
} = {}) {
  const startTouchYRef = useRef(null);
  const pullDistanceRef = useRef(0);
  const refreshingRef = useRef(false);
  const lastRefreshTimeRef = useRef(0);
  const refreshTimeoutRef = useRef(null);
  const onRefreshRef = useRef(onRefresh);
  const getScrollContainerRef = useRef(getScrollContainer);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    getScrollContainerRef.current = getScrollContainer;
  }, [getScrollContainer]);

  const finishRefresh = () => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      refreshingRef.current = false;
      setPullDistance(0);
      setRefreshing(false);
      refreshTimeoutRef.current = null;
    }, settleMs);
  };

  const triggerRefresh = async () => {
    const now = Date.now();
    if (refreshingRef.current || !enabled) return;
    if (now - lastRefreshTimeRef.current < cooldownMs) return;
    lastRefreshTimeRef.current = now;
    refreshingRef.current = true;
    setRefreshing(true);

    const safetyTimeout = window.setTimeout(finishRefresh, 5000);
    try {
      await onRefreshRef.current?.();
    } finally {
      window.clearTimeout(safetyTimeout);
      finishRefresh();
    }
  };

  useEffect(() => () => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = rootRef.current;
    if (!el) return undefined;

    const resolveScrollContainer = () => getScrollContainerRef.current?.() ?? el.closest('[data-scroll-container]') ?? null;

    const onStart = (event) => {
      if (refreshingRef.current) {
        startTouchYRef.current = null;
        return;
      }
      const scrollEl = resolveScrollContainer();
      if (!scrollEl || scrollEl.scrollTop > 0) {
        startTouchYRef.current = null;
        return;
      }
      startTouchYRef.current = event.touches[0].clientY;
    };

    const onMove = (event) => {
      if (refreshingRef.current || startTouchYRef.current === null) return;
      const scrollEl = resolveScrollContainer();
      if (!scrollEl || scrollEl.scrollTop > 0) return;

      const delta = event.touches[0].clientY - startTouchYRef.current;
      if (delta <= 0) {
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }

      event.preventDefault();
      const clamped = Math.min(delta, maxDistance);
      pullDistanceRef.current = clamped;
      setPullDistance(clamped);
    };

    const onEnd = () => {
      if (refreshingRef.current) {
        startTouchYRef.current = null;
        pullDistanceRef.current = 0;
        setPullDistance(0);
        return;
      }
      if (startTouchYRef.current === null) return;
      startTouchYRef.current = null;
      const dist = pullDistanceRef.current;
      pullDistanceRef.current = 0;
      setPullDistance(0);
      if (dist >= threshold) {
        void triggerRefresh();
      }
    };

    const onCancel = () => {
      startTouchYRef.current = null;
      pullDistanceRef.current = 0;
      setPullDistance(0);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onCancel, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onCancel);
    };
  }, [enabled, maxDistance, rootRef, threshold]);

  return { pullDistance, refreshing, triggerRefresh };
}
