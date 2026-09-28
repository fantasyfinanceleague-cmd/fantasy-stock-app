import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Surface } from '../../design/Surface';
import { useEnhanced } from './hooks';

/** A section heading's scroll-linked mask reveal (Design Lead, round 3):
 * the clip opens while the heading is still in the lower quarter of the
 * viewport and is fully open by the time its top reaches 75% of the
 * viewport height — so it is never clipped where anyone reads it, and an
 * anchor jump always lands on it fully revealed. The text stays in the DOM
 * (clip-path, never display/visibility). Server render, JS-off and reduced
 * motion: no clip at all. */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const enhanced = useEnhanced();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.75'] });
  const clipPath = useTransform(scrollYProgress, (p) =>
    p >= 0.999 ? 'none' : `inset(0 0 ${((1 - p) * 100).toFixed(2)}% 0)`
  );
  const y = useTransform(scrollYProgress, [0, 1], [24, 0]);
  return (
    <motion.div ref={ref} className={className} style={enhanced ? { clipPath, y } : undefined}>
      {children}
    </motion.div>
  );
}

/** The navy "stadium" register for a whole section, and the page's
 * light ↔ navy transition. Rather than crossfading a backdrop behind text
 * (which would put text on a half-blended colour), the navy is a solid
 * panel that opens from an inset, rounded card to full bleed as the section
 * scrolls in. Only an EMPTY background layer is clipped, and the content's
 * gutter is wider than the largest inset, so every text pixel is on solid
 * navy and every pixel outside is on solid snow at all times (Design Lead
 * condition 3). `progress` lets a caller drive it from its own scroll range. */
export function DarkPanel({
  id,
  className,
  labelledBy,
  children,
  progress,
}: {
  id?: string;
  className?: string;
  labelledBy?: string;
  children: ReactNode;
  progress?: MotionValue<number>;
}) {
  const enhanced = useEnhanced();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.1'] });
  const p = progress ?? scrollYProgress;
  const clipPath = useTransform(p, (v) => {
    const k = Math.max(0, Math.min(1, v));
    if (k >= 0.999) return 'none';
    // Inset shrinks from var(--lp-panel-inset) to 0; corners from xl radius to 0.
    return `inset(0 calc(var(--lp-panel-inset) * ${(1 - k).toFixed(3)}) 0 calc(var(--lp-panel-inset) * ${(1 - k).toFixed(3)}) round calc(var(--sp-radius-xl) * ${(1 - k).toFixed(3)}))`;
  });
  return (
    <section ref={ref} id={id} className={['lp-dark', className].filter(Boolean).join(' ')} aria-labelledby={labelledBy}>
      <motion.div className="lp-dark__bg" aria-hidden="true" style={enhanced ? { clipPath } : undefined} />
      <Surface kind="game" className="lp-dark__content" style={{ backgroundColor: 'transparent' }}>
        {children}
      </Surface>
    </section>
  );
}
