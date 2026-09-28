import { useEffect, useRef } from 'react';
import { motion, useAnimate, useScroll, useTransform } from 'motion/react';
import { brand } from '../../brand';
import { formatMoney } from '../../design/lib/money';
import { why } from './copy';
import { useEnhanced, useInView, useLandingMotion } from './hooks';
import { DAILY_MOVES, LEAGUE, WEEK } from './sampleData';
import { Reveal } from './scroll';

function IconActivity() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}
function IconExpand() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 3h5v5" /><path d="M8 3H3v5" /><path d="M21 3l-7 7" /><path d="M3 3l7 7" /><path d="M16 21h5v-5" /><path d="M8 21H3v-5" /><path d="M21 21l-7-7" /><path d="M3 21l7-7" />
    </svg>
  );
}
function IconTrophy() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 21h8" /><path d="M12 17v4" /><path d="M7 4h10v5a5 5 0 0 1-10 0V4z" /><path d="M17 4h3v3a3 3 0 0 1-3 3" /><path d="M7 4H4v3a3 3 0 0 0 3 3" />
    </svg>
  );
}

/** "Real prices." — the old page's five M–F bars, now data (Design Lead:
 * "no decorative data viz on a page about real data"): the sample
 * portfolio's dollar change per day, signed, labelled with its value, on a
 * zero baseline, gain/loss coloured. They grow from the baseline once, the
 * first time they come into view (scaleY — transform only); with reduced
 * motion or JS off they are simply drawn. */
function DailyBars() {
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const inView = useInView(wrapRef, { threshold: 0.4 });
  const state = useRef<'idle' | 'armed' | 'done'>('idle');
  // One scale for both directions: the zero line sits where the largest
  // loss would reach, so a -$41 bar is visibly shorter than a +$188 one.
  const up = Math.max(0, ...DAILY_MOVES.map((d) => d.v));
  const down = Math.max(0, ...DAILY_MOVES.map((d) => -d.v));
  const range = up + down || 1;
  const total = DAILY_MOVES.reduce((a, d) => a + d.v, 0);

  useEffect(() => {
    if (!hydrated || reduced || state.current === 'done') return;
    const bars = scope.current?.querySelectorAll('.lp-dbar__fill');
    if (!bars?.length) return;
    if (state.current === 'idle' && inView === false) {
      state.current = 'armed';
      animate(bars, { scaleY: 0 }, { duration: 0 });
    } else if (inView) {
      state.current = 'done';
      animate(bars, { scaleY: 1 }, { duration: duration.slow, ease: ease.settle, delay: (i: number) => i * 0.06 });
    }
  }, [hydrated, reduced, inView, animate, scope, duration.slow, ease.settle]);

  return (
    <div ref={wrapRef} className="lp-dbars-wrap">
      <div
        ref={scope}
        className="lp-dbars"
        style={{ ['--lp-zero' as string]: (down / range).toFixed(3) }}
        role="img"
        aria-label={`${LEAGUE}, week ${WEEK}: portfolio change by day — ${DAILY_MOVES.map((d) => `${d.day} ${formatMoney(d.v, { sign: 'always' })}`).join(', ')}.`}
      >
        {DAILY_MOVES.map((d, i) => (
          <div key={`${d.l}-${i}`} className="lp-dbar">
            <span className={d.v >= 0 ? 'lp-dbar__v lp-dbar__v--gain' : 'lp-dbar__v lp-dbar__v--loss'}>
              {formatMoney(d.v, { sign: 'always' })}
            </span>
            <div className="lp-dbar__track">
              <span
                className={d.v >= 0 ? 'lp-dbar__fill lp-dbar__fill--gain' : 'lp-dbar__fill lp-dbar__fill--loss'}
                style={{ ['--lp-h' as string]: (Math.abs(d.v) / range).toFixed(3) }}
              />
            </div>
            <span className="lp-dbar__l">{d.l}</span>
          </div>
        ))}
      </div>
      <p className="lp-dbars__cap">
        Week {WEEK}: <span className="lp-num">{formatMoney(total, { sign: 'always' })}</span>
      </p>
    </div>
  );
}

/** A bento cell rising a little as it scrolls in (transform only, from a
 * visible resting state; static without JS or with reduced motion). */
function Cell({ className, depth, children }: { className?: string; depth: number; children: React.ReactNode }) {
  const enhanced = useEnhanced();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const y = useTransform(scrollYProgress, [0, 1], [`${depth}px`, '0px']);
  return (
    <motion.div ref={ref} className={['lp-bento__cell', className].filter(Boolean).join(' ')} style={enhanced ? { y } : undefined}>
      {children}
    </motion.div>
  );
}

export function Why() {
  const [prices, gamified, free] = why.cells;
  return (
    <section className="lp-section lp-why" id="why" aria-labelledby="lp-why-title">
      <div className="lp-wrap">
        <Reveal className="lp-head lp-head--center">
          <p className="lp-kicker">{why.kicker(brand.name)}</p>
          <h2 className="lp-h2" id="lp-why-title">
            {why.title.line1}
            <br />
            {why.title.line2}
            <em>{why.title.em}</em>
          </h2>
        </Reveal>
        <div className="lp-bento">
          <Cell className="lp-bento__cell--tall" depth={24}>
            <span className="lp-bento__icon">
              <IconActivity />
            </span>
            <h3 className="lp-bento__title">
              {prices.title.line1}
              <br />
              <em>{prices.title.em}</em>
            </h3>
            <p className="lp-bento__body">{prices.body as string}</p>
            <DailyBars />
          </Cell>
          <Cell depth={48}>
            <span className="lp-bento__icon">
              <IconExpand />
            </span>
            <h3 className="lp-bento__title">
              {gamified.title.line1}
              <em>{gamified.title.em}</em>
            </h3>
            <p className="lp-bento__body">{gamified.body as string}</p>
          </Cell>
          <Cell depth={72}>
            <span className="lp-bento__icon">
              <IconTrophy />
            </span>
            <h3 className="lp-bento__title">
              {free.title.line1}
              <em>{free.title.em}</em>
            </h3>
            <p className="lp-bento__body">{(free.body as (n: string) => string)(brand.name)}</p>
          </Cell>
        </div>
      </div>
    </section>
  );
}

export default Why;
