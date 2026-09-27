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
