/**
 * useDrawIn: the chart line's draw-in progress (0..1), shared by Home's
 * SeasonChart and 3e's stock chart (M2). A JS frame loop over `durationMs`
 * (ease-out cubic) builds the line up to the returned fraction —
 * react-native-svg ignores `pathLength` at runtime (2026-10-05), so a dash
 * offset drew the line as dots; the caller instead renders
 * chartGeometry.partialLinePath(points, progress, lineLength).
 *
 * Reduce Motion: progress is 1 immediately, no loop. `skipFirst`: the very
 * first effective run of this mount is shown already drawn (a league switch,
 * or any caller that wants its FIRST paint to skip the draw-in) — later
 * `key` changes still draw in as usual.
 */
import { useEffect, useRef, useState } from 'react';

export interface UseDrawInOptions {
  /** What triggers a redraw — a new value runs the draw-in again. */
  key: string;
  lineLength: number;
  reduced: boolean;
  durationMs: number;
  /** The first effective run of this mount shows fully drawn, no draw-in. */
  skipFirst?: boolean;
}

export function useDrawIn({ key, lineLength, reduced, durationMs, skipFirst = false }: UseDrawInOptions): number {
  const skippedFirst = useRef(false);
  const [progress, setProgress] = useState(reduced || skipFirst ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      setProgress(1);
      return;
    }
    // Wait for layout: a draw that starts at length 0 would finish unseen.
    if (lineLength <= 0) return;
    if (!skippedFirst.current) {
      skippedFirst.current = true;
      if (skipFirst) {
        setProgress(1);
        return;
      }
    }
    let raf = 0;
    const start = Date.now();
    const total = Math.max(durationMs, 1);
    setProgress(0);
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / total);
      setProgress(1 - Math.pow(1 - t, 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new key draws in; skipFirst is read once per mount and durationMs is stable per render.
  }, [key, reduced, lineLength > 0]);

  return progress;
}
