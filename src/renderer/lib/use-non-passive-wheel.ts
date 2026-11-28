import { useCallback, useRef } from 'react';

/**
 * React attaches wheel listeners as passive, so `e.preventDefault()` in `onWheel` is ignored (and
 * logs a warning). This returns a callback ref that attaches a non-passive native listener, so
 * wheel-to-zoom on canvases doesn't also scroll the page.
 */
export function useNonPassiveWheel<T extends HTMLElement | SVGElement>(handler: (e: WheelEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const cleanupRef = useRef<(() => void) | null>(null);

  return useCallback((el: T | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!el) return;
    const listener = (e: Event) => {
      e.preventDefault();
      handlerRef.current(e as WheelEvent);
    };
    el.addEventListener('wheel', listener, { passive: false });
    cleanupRef.current = () => el.removeEventListener('wheel', listener);
  }, []);
}
