import { createContext, useContext, useRef } from 'react';

// 3c-2, UX rule 7: what a child needs to know whether something is "below the
// fold" of the scroll view it sits in: the view's visible box in window
// coordinates, and a scroll signal. BarsRefresh provides it (optional: a
// screen without it simply gets no pinning). Listeners are throttled, with a
// trailing call so the final position is always seen.

export interface ScrollFold {
  /** The scroll view's visible box, window coordinates (null until laid out). */
  viewport(): { top: number; bottom: number } | null;
  /** Called (throttled) whenever the view scrolls or lays out; returns unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export const ScrollFoldContext = createContext<ScrollFold | null>(null);

export function useScrollFold(): ScrollFold | null {
  return useContext(ScrollFoldContext);
}

const THROTTLE_MS = 80;

/** The provider's side: the context value, plus emit() and setViewport(). */
export function useScrollFoldSource(): { value: ScrollFold; emit: () => void; setViewport: (v: { top: number; bottom: number }) => void } {
  const ref = useRef<{
    value: ScrollFold;
    emit: () => void;
    setViewport: (v: { top: number; bottom: number }) => void;
  } | null>(null);
  if (!ref.current) {
    const listeners = new Set<() => void>();
    let box: { top: number; bottom: number } | null = null;
    let last = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      last = Date.now();
      listeners.forEach((l) => l());
    };
    const emit = () => {
      const wait = THROTTLE_MS - (Date.now() - last);
      if (wait <= 0) fire();
      if (trailing) clearTimeout(trailing);
      trailing = setTimeout(fire, Math.max(wait, THROTTLE_MS));
    };
    ref.current = {
      value: {
        viewport: () => box,
        subscribe: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      emit,
      setViewport: (v) => {
        box = v;
        emit();
      },
    };
  }
  return ref.current;
}
