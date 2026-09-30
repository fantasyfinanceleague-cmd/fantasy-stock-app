import { useEffect, useState, type RefObject } from 'react';
import { useMotion } from '../../design/useMotion';

// Every hook here is SSR-safe: nothing touches window/document during
// render, and each one's FIRST client render returns exactly what the
// server rendered (so hydration of the prerendered landing never
// mismatches). Browser-only facts — reduced motion, viewport size,
// visibility, intersection — arrive one effect later.

/** False on the server and during hydration; true after the first commit. */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

/** useMotion(), with `reduced` held at false until hydration so the first
 * client render equals the prerendered markup. Components switch to their
 * reduced-motion form one commit later. */
export function useLandingMotion() {
  const motion = useMotion();
  const hydrated = useHydrated();
  return { ...motion, hydrated, reduced: hydrated && motion.reduced };
}

/** matchMedia as state; null until hydrated. */
export function useMediaQuery(query: string): boolean | null {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/** True while the document is visible (tab not hidden). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

/** Whether `ref` is intersecting the viewport. null until the observer has
 * reported; true where IntersectionObserver doesn't exist (the content is
 * then simply shown in its final state). */
export function useInView(
  ref: RefObject<Element | null>,
  { rootMargin = '0px', threshold = 0 }: { rootMargin?: string; threshold?: number } = {}
): boolean | null {
  const [inView, setInView] = useState<boolean | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin, threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, threshold]);
  return inView;
}

/** Full-motion enhancements are on: hydrated and not reduced motion. The
 * server render and the JS-off / reduced-motion page are the static
 * versions of every section; this flips them to the pinned, live ones. */
export function useEnhanced(): boolean {
  const { hydrated, reduced } = useLandingMotion();
  return hydrated && !reduced;
}

/** A fine, hovering pointer (mouse/trackpad). Tilt, cursor-light and the
 * magnetic link only run on these (Design Lead, round 3). */
export function useFinePointer(): boolean {
  return useMediaQuery('(hover: hover) and (pointer: fine)') === true;
}

/** Steps through `count` frames every `intervalMs` while `active`; holds
 * the current frame (never resets) while paused. `holdLastMs` lets the
 * last frame (e.g. a FINAL) stay up longer before the loop restarts. */
export function useLoop(count: number, intervalMs: number, active: boolean, holdLastMs = intervalMs): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active || count < 2) return;
    const delay = frame === count - 1 ? holdLastMs : intervalMs;
    const t = window.setTimeout(() => setFrame((f) => (f + 1) % count), delay);
    return () => window.clearTimeout(t);
  }, [active, count, frame, intervalMs, holdLastMs]);
  return frame;
}

/** Pointer tilt (≤ maxDeg) and a cursor-light position for a mock card.
 * Writes CSS custom properties straight to the element (no React render
 * per move); the stylesheet turns them into a transform and a highlight
 * opacity. Off for coarse pointers and reduced motion. */
export function useTilt<T extends HTMLElement>(ref: RefObject<T | null>, enabled: boolean, maxDeg = 4) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--lp-rx', `${((0.5 - y) * 2 * maxDeg).toFixed(2)}deg`);
        el.style.setProperty('--lp-ry', `${((x - 0.5) * 2 * maxDeg).toFixed(2)}deg`);
        el.style.setProperty('--lp-lx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--lp-ly', `${(y * 100).toFixed(1)}%`);
        el.dataset.lit = 'true';
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--lp-rx', '0deg');
      el.style.setProperty('--lp-ry', '0deg');
      el.dataset.lit = 'false';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      leave();
    };
  }, [ref, enabled, maxDeg]);
}

/** A pointer-follow glow position for a navy stage (CSS vars on the
 * element; the stylesheet draws it). */
export function usePointerGlow<T extends HTMLElement>(ref: RefObject<T | null>, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--lp-gx', `${e.clientX - r.left}px`);
        el.style.setProperty('--lp-gy', `${e.clientY - r.top}px`);
        el.dataset.glow = 'true';
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.dataset.glow = 'false';
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [ref, enabled]);
}

/** Magnetic pull toward the pointer, at most `maxPx` (Design Lead: ≤ 6px). */
export function useMagnet<T extends HTMLElement>(ref: RefObject<T | null>, enabled: boolean, maxPx = 6) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.setProperty('--lp-mx', `${(Math.max(-1, Math.min(1, dx)) * maxPx).toFixed(2)}px`);
        el.style.setProperty('--lp-my', `${(Math.max(-1, Math.min(1, dy)) * maxPx).toFixed(2)}px`);
      });
    };
    const leave = () => {
      cancelAnimationFrame(raf);
      el.style.setProperty('--lp-mx', '0px');
      el.style.setProperty('--lp-my', '0px');
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      leave();
    };
  }, [ref, enabled, maxPx]);
}
