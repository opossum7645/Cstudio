import { useEffect, useState, useCallback, useRef } from 'react';

export type LayoutMode = 'phone' | 'tablet-portrait' | 'tablet' | 'desktop';

function compute(): { mode: LayoutMode; coarse: boolean; width: number; height: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  let mode: LayoutMode;
  if (w < 640 || (h < 500 && coarse && w < 960)) mode = 'phone';
  else if (w < 1024 && h >= w) mode = 'tablet-portrait';
  else if (w < 1024) mode = 'tablet-portrait';
  else if (coarse && w <= 1400) mode = 'tablet';
  else mode = 'desktop';
  return { mode, coarse, width: w, height: h };
}

/** Device category used to switch between layouts (not just CSS breakpoints). */
export function useLayoutMode() {
  const [state, setState] = useState(compute);
  useEffect(() => {
    const on = () => setState(compute());
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    const mq = window.matchMedia('(pointer: coarse)');
    mq.addEventListener?.('change', on);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('orientationchange', on);
      mq.removeEventListener?.('change', on);
    };
  }, []);
  return state;
}

/** Tracks the on-screen keyboard (visualViewport) so the C key bar stays above it. */
export function useVirtualKeyboard(): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => {
      const o = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setOffset(o > 60 ? o : 0);
    };
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return offset;
}

/** Pointer-based drag (mouse + touch + pen) for resizers. */
export function useDrag(onMove: (dx: number, dy: number) => void, onEnd?: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      start.current = { x: e.clientX, y: e.clientY };
      setDragging(true);
    },
    [],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      onMove(e.clientX - start.current.x, e.clientY - start.current.y);
    },
    [onMove],
  );
  const onPointerUp = useCallback(() => {
    start.current = null;
    setDragging(false);
    onEnd?.();
  }, [onEnd]);
  return { dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

/** Long press (touch) → context menu. */
export function useLongPress(cb: (x: number, y: number) => void, ms = 480) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pos = useRef({ x: 0, y: 0 });
  const clear = () => {
    if (t.current) clearTimeout(t.current);
    t.current = null;
  };
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      pos.current = { x: touch.clientX, y: touch.clientY };
      clear();
      t.current = setTimeout(() => cb(pos.current.x, pos.current.y), ms);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch && (Math.abs(touch.clientX - pos.current.x) > 8 || Math.abs(touch.clientY - pos.current.y) > 8)) clear();
    },
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}
