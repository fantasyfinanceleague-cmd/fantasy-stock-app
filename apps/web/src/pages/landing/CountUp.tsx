import { useEffect, useRef, useState } from 'react';
import { animate } from 'motion/react';
import { formatMoney } from '../../design/lib/money';
import { useMotion } from '../../design/useMotion';
import '../../design/game/a11y.css';

export interface CountUpProps {
  from: number;
  to: number;
  /** Starts the count. It runs once: flipping `run` back does nothing. */
  run: boolean;
  /** Reduced motion: jump straight to `to`, no tween. */
  instant: boolean;
  align?: 'start' | 'end';
  className?: string;
}

const format = (v: number) => formatMoney(v, { sign: 'always' });

/** The hero's one-time score count-up (Design Lead, 2026-09-26: hero-only,
 * lives in the landing folder until a second surface needs it).
 *
 * Why not ScoreDigits: that primitive deliberately never animates on first
 * paint and rolls per changed digit, so a 0 → final tween through it would
 * re-roll every frame. This writes the tweened text straight to the DOM
 * node (no React render per frame), in the same score styles.
 *
 * - Zero layout shift: an invisible copy of the FINAL string sits in the
 *   same grid cell and fixes the width from the first paint.
 * - The moving digits are aria-hidden; assistive tech reads the
 *   visually-hidden settled value (the start value until the count lands). */
export function CountUp({ from, to, run, instant, align = 'start', className }: CountUpProps) {
  const { duration, ease } = useMotion();
  const liveRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!run || startedRef.current) return;
    const el = liveRef.current;
    if (!el) return;
    startedRef.current = true;
    if (instant) {
      el.textContent = format(to);
      setSettled(true);
      return;
    }
    const controls = animate(from, to, {
      duration: duration.feature,
      ease: ease.settle,
      onUpdate: (v) => {
        el.textContent = format(v);
      },
      onComplete: () => setSettled(true),
    });
    return () => {
      // StrictMode's dev-only unmount/remount: let the rerun start over.
      controls.stop();
      startedRef.current = false;
    };
  }, [run, instant, from, to, duration.feature, ease.settle]);

  return (
    <span className={['lp-count', `lp-count--${align}`, className].filter(Boolean).join(' ')}>
      <span className="lp-count__sizer" aria-hidden="true">
        {format(to)}
      </span>
      <span className="lp-count__live" aria-hidden="true" ref={liveRef}>
        {format(from)}
      </span>
      <span className="sp-visually-hidden">{format(settled ? to : from)}</span>
    </span>
  );
}

export default CountUp;
