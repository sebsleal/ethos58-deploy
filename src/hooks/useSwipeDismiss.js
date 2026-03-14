import { useRef, useState } from 'react';

export function useSwipeDismiss(onDismiss, { threshold = 60, maxDistance = 140 } = {}) {
  const touchStartYRef = useRef(null);
  const [dragDelta, setDragDelta] = useState(0);

  const handleSwipeStart = (event) => {
    touchStartYRef.current = event.touches[0].clientY;
    setDragDelta(0);
  };

  const handleSwipeMove = (event) => {
    if (touchStartYRef.current === null) return;
    const delta = event.touches[0].clientY - touchStartYRef.current;
    setDragDelta(Math.max(0, Math.min(delta, maxDistance)));
  };

  const handleSwipeEnd = () => {
    if (dragDelta > threshold) onDismiss();
    touchStartYRef.current = null;
    setDragDelta(0);
  };

  return {
    dragDelta,
    swipeBind: {
      onTouchStart: handleSwipeStart,
      onTouchMove: handleSwipeMove,
      onTouchEnd: handleSwipeEnd,
    },
  };
}
