import { onBeforeUnmount, ref, type Ref } from 'vue';

export type SwipeAxis = 'x' | 'y';

export type UseSwipeOptions = {
  /** Min distance (px) to count as a swipe. */
  threshold?: number;
  /** Ignore opposite-axis noise above this ratio. */
  lockRatio?: number;
  axis?: SwipeAxis;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
};

/**
 * Lightweight touch swipe (no deps). Button/keyboard fallbacks stay in the UI.
 * Used for cart swipe-to-remove and category/tab cycling on mobile.
 */
export function useSwipe(options: UseSwipeOptions = {}) {
  const threshold = options.threshold ?? 56;
  const lockRatio = options.lockRatio ?? 1.2;
  const axis = options.axis ?? 'x';

  const startX = ref(0);
  const startY = ref(0);
  const deltaX = ref(0);
  const deltaY = ref(0);
  const tracking = ref(false);

  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    if (!t) return;
    tracking.value = true;
    startX.value = t.clientX;
    startY.value = t.clientY;
    deltaX.value = 0;
    deltaY.value = 0;
  }

  function onTouchMove(e: TouchEvent): void {
    if (!tracking.value) return;
    const t = e.touches[0];
    if (!t) return;
    deltaX.value = t.clientX - startX.value;
    deltaY.value = t.clientY - startY.value;
  }

  function onTouchEnd(): void {
    if (!tracking.value) return;
    tracking.value = false;
    const dx = deltaX.value;
    const dy = deltaY.value;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (axis === 'x') {
      if (absX < threshold || absX < absY * lockRatio) {
        deltaX.value = 0;
        deltaY.value = 0;
        return;
      }
      if (dx < 0) options.onSwipeLeft?.();
      else options.onSwipeRight?.();
    } else {
      if (absY < threshold || absY < absX * lockRatio) {
        deltaX.value = 0;
        deltaY.value = 0;
        return;
      }
      if (dy < 0) options.onSwipeUp?.();
      else options.onSwipeDown?.();
    }
    deltaX.value = 0;
    deltaY.value = 0;
  }

  const handlers = {
    touchstart: onTouchStart,
    touchmove: onTouchMove,
    touchend: onTouchEnd,
    touchcancel: onTouchEnd,
  };

  return { deltaX, deltaY, tracking, handlers, onTouchStart, onTouchMove, onTouchEnd };
}

/**
 * Horizontal reveal offset for swipe-to-action rows (clamped).
 * Bind transform: translateX(offsetPx).
 */
export function useSwipeReveal(opts: {
  maxReveal?: number;
  threshold?: number;
  onCommit: () => void;
}) {
  const maxReveal = opts.maxReveal ?? 96;
  const threshold = opts.threshold ?? 64;
  const offset = ref(0);
  const startX = ref(0);
  const startY = ref(0);
  const locked: Ref<'h' | 'v' | null> = ref(null);

  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    if (!t) return;
    startX.value = t.clientX;
    startY.value = t.clientY;
    locked.value = null;
  }

  function onTouchMove(e: TouchEvent): void {
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX.value;
    const dy = t.clientY - startY.value;
    if (locked.value == null) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      locked.value = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (locked.value !== 'h') return;
    // Only swipe left to reveal remove.
    offset.value = Math.max(-maxReveal, Math.min(0, dx));
    if (e.cancelable) e.preventDefault();
  }

  function onTouchEnd(): void {
    if (locked.value === 'h' && offset.value <= -threshold) {
      opts.onCommit();
    }
    offset.value = 0;
    locked.value = null;
  }

  return { offset, onTouchStart, onTouchMove, onTouchEnd };
}

/** Cycle an index through a list on horizontal swipe (category / admin tabs). */
export function useSwipeCycle(
  index: Ref<number>,
  length: Ref<number> | (() => number),
  options: { threshold?: number } = {},
) {
  const getLen = typeof length === 'function' ? length : () => length.value;

  const { handlers } = useSwipe({
    threshold: options.threshold ?? 48,
    onSwipeLeft: () => {
      const len = getLen();
      if (len <= 0) return;
      index.value = (index.value + 1) % len;
    },
    onSwipeRight: () => {
      const len = getLen();
      if (len <= 0) return;
      index.value = (index.value - 1 + len) % len;
    },
  });

  onBeforeUnmount(() => {
    /* no listeners retained outside element bindings */
  });

  return handlers;
}
