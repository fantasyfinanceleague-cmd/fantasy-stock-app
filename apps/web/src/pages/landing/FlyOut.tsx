import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { motion, useTransform, type MotionValue } from 'motion/react';

// FULL tier, "A look inside" (round 4): the three cards launch out of the
// 3D device's screen to their places in the grid. The cards are the real,
// accessible DOM — this only animates their transform/opacity — and the
// start point is the device slot's centre, measured in the stage's own
// layout coordinates (offsets, not rects), so the sticky stage and the
// layer's recede transforms never skew it.

const FLY = 0.3; // each card's share of the dwell
export const FLY_STARTS = [0.04, 0.12, 0.2] as const;
const FROM_SCALE = 0.16;

function offsetWithin(el: HTMLElement, ancestor: HTMLElement) {
  let x = 0;
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== ancestor) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return { x: x + el.offsetWidth / 2, y: y + el.offsetHeight / 2 };
}

const ease = (k: number) => 1 - (1 - k) ** 3;

export function FlyOut({
  i,
  on,
  progress,
  slot,
  stage,
  children,
}: {
  i: number;
  on: boolean;
  progress: MotionValue<number>;
  slot: RefObject<HTMLElement | null>;
  stage: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [d, setD] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    const s = slot.current;
    const st = stage.current;
    if (!on || !el || !s || !st) return;
    const measure = () => {
      const a = offsetWithin(el, st);
      const b = offsetWithin(s, st);
      setD({ x: b.x - a.x, y: b.y - a.y });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    return () => ro.disconnect();
  }, [on, slot, stage]);

  const k = useTransform(progress, (v) => ease(Math.min(1, Math.max(0, (v - FLY_STARTS[i]) / FLY))));
  const x = useTransform(k, (e) => d.x * (1 - e));
  const y = useTransform(k, (e) => d.y * (1 - e));
  const scale = useTransform(k, (e) => FROM_SCALE + (1 - FROM_SCALE) * e);
  const opacity = useTransform(k, (e) => Math.min(1, e * 4));

  return (
    <div ref={ref} className="lp-fly">
      <motion.div className="lp-fly__in" style={on ? { x, y, scale, opacity } : undefined}>
        {children}
      </motion.div>
    </div>
  );
}
