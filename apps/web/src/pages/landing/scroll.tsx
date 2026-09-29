import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
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

/** How far a layer recedes while the next one covers it. */
const RECEDE_SCALE = 0.94;

/** One layer of the page's single transition grammar (Giorgio, round 4:
 * "every section boundary … the next section rises and swallows the
 * previous one"). Every top-level section is a Layer, siblings in <main>,
 * stacked in page order:
 *
 * - ARRIVE: as a layer's top travels from the viewport bottom to the top,
 *   it opens from an inset, rounded card to full bleed (clip-path) with a
 *   soft top-edge shadow — rising over the layer in front of it.
 * - HOLD: each layer is bottom-sticky (`top: min(0, 100svh − height)`), so
 *   once its end reaches the viewport bottom it stays put underneath while
 *   the next layer rises over it.
 * - RECEDE: meanwhile its content scales to 0.94 and drifts up 4vh — depth,
 *   never dimming (Design Lead: dimmed text would drop below AA mid-way).
 *
 * The clip only ever trims the layer's own inset margin, and content
 * gutters are wider than the inset, so text is always on its own solid
 * background. Server render, JS-off and reduced motion: plain document
 * flow — no sticking, no clipping, no scaling. */
export function Layer({
  id,
  tone,
  first = false,
  last = false,
  labelledBy,
  label,
  className,
  children,
}: {
  id?: string;
  tone: 'light' | 'dark';
  first?: boolean;
  last?: boolean;
  labelledBy?: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const enhanced = useEnhanced();
  const ref = useRef<HTMLElement>(null);
  const [top, setTop] = useState(0);

  // Bottom-sticky offset: 0 for a layer no taller than the viewport, else
  // negative so it only sticks once its END reaches the viewport bottom.
  useEffect(() => {
    const el = ref.current;
    if (!enhanced || !el || typeof ResizeObserver === 'undefined') return;
    const measure = () => setTop(Math.min(0, Math.round(window.innerHeight - el.offsetHeight)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enhanced]);

  const { scrollYProgress: arrive } = useScroll({ target: ref, offset: ['start end', 'start start'] });
  // Layout position (not the stuck one): its end passing from the viewport
  // bottom to the top is exactly the stretch the next layer spends rising.
  const { scrollYProgress: recede } = useScroll({ target: ref, offset: ['end end', 'end start'] });
  const clipPath = useTransform(arrive, (v) => {
    const k = Math.max(0, Math.min(1, v));
    if (k >= 0.999) return 'none';
    const r = (1 - k).toFixed(3);
    return `inset(0 calc(var(--lp-panel-inset) * ${r}) 0 calc(var(--lp-panel-inset) * ${r}) round calc(var(--sp-radius-xl) * ${r}) calc(var(--sp-radius-xl) * ${r}) 0 0)`;
  });
  const scale = useTransform(recede, [0, 1], [1, RECEDE_SCALE]);
  const y = useTransform(recede, [0, 1], ['0vh', '-4vh']);

  const body =
    tone === 'dark' ? (
      <Surface kind="game" className="lp-layer__surface lp-dark" style={{ backgroundColor: 'transparent' }}>
        {children}
      </Surface>
    ) : (
      children
    );

  return (
    <motion.section
      ref={ref}
      id={id}
      aria-labelledby={labelledBy}
      aria-label={label}
      className={['lp-layer', `lp-layer--${tone}`, enhanced ? 'lp-layer--stacked' : '', className].filter(Boolean).join(' ')}
      style={enhanced ? { top, clipPath: first ? undefined : clipPath } : undefined}
    >
      <motion.div className="lp-layer__inner" style={enhanced && !last ? { scale, y } : undefined}>
        {body}
      </motion.div>
    </motion.section>
  );
}
