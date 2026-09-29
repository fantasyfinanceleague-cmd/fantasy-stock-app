import { useEffect, useRef } from 'react';
import { motion, useAnimate, useScroll, useTransform } from 'motion/react';
import { brand } from '../../brand';
import { formatMoney } from '../../design/lib/money';
import { why } from './copy';
import { useEnhanced, useInView, useLandingMotion } from './hooks';
import { MATCHUP, WEEK, raceSeries } from './sampleData';
import { Layer, Reveal } from './scroll';

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

const CW = 560;
const CH = 220;
const PAD = { top: 16, right: 12, bottom: 30, left: 12 };

/** "Real prices." — a two-player race chart (Giorgio, round 4, replacing
 * the Mon–Fri bars; Design Lead: the SAME Roberto vs Gianluigi Week 6 as
 * the /01 Compete chapter). Both cumulative dollar gains from Monday's
 * open to Friday's close on one chart, a zero baseline, the area between
 * the lines tinted by whoever leads (split exactly at the crossing), a
 * glowing head on the leader, labelled day ticks. Draws on once when it
 * first comes into view (pathLength — stroke only); drawn from the start
 * under reduced motion or with JS off. */
function RaceChart() {
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate<SVGSVGElement>();
  const inView = useInView(wrapRef, { threshold: 0.4 });
  const state = useRef<'idle' | 'armed' | 'done'>('idle');
  const series = raceSeries();
  const all = series.flatMap((p) => [p.you, p.opp, 0]);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const x = (i: number) => PAD.left + (i / (series.length - 1)) * (CW - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + ((max - v) / (max - min || 1)) * (CH - PAD.top - PAD.bottom);
  const line = (k: 'you' | 'opp') => series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');

  // Lead areas, split where the lines cross.
  const areas: Array<{ d: string; you: boolean }> = [];
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i];
    const b = series[i + 1];
    const da = a.you - a.opp;
    const db = b.you - b.opp;
    const poly = (x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number) =>
      `M${x0.toFixed(1)} ${y0a.toFixed(1)} L${x1.toFixed(1)} ${y1a.toFixed(1)} L${x1.toFixed(1)} ${y1b.toFixed(1)} L${x0.toFixed(1)} ${y0b.toFixed(1)} Z`;
    if (da * db < 0) {
      const t = da / (da - db);
      const xm = x(i) + t * (x(i + 1) - x(i));
      const vm = a.you + t * (b.you - a.you);
      areas.push({ d: poly(x(i), y(a.you), y(a.opp), xm, y(vm), y(vm)), you: da > 0 });
      areas.push({ d: poly(xm, y(vm), y(vm), x(i + 1), y(b.you), y(b.opp)), you: db > 0 });
    } else if (da !== 0 || db !== 0) {
      areas.push({ d: poly(x(i), y(a.you), y(a.opp), x(i + 1), y(b.you), y(b.opp)), you: da + db > 0 });
    }
  }
  const last = series[series.length - 1];
  const leader: 'you' | 'opp' = last.you >= last.opp ? 'you' : 'opp';
  const head = { x: x(series.length - 1), y: y(last[leader]) };

  useEffect(() => {
    if (!hydrated || reduced || state.current === 'done') return;
    const svg = scope.current;
    const lines = svg?.querySelectorAll('.lp-race__line');
    const fills = svg?.querySelectorAll('.lp-race__area, .lp-race__head');
    if (!lines?.length || !fills) return;
    if (state.current === 'idle' && inView === false) {
      state.current = 'armed';
      animate(lines, { pathLength: 0 }, { duration: 0 });
      animate(fills, { opacity: 0 }, { duration: 0 });
    } else if (inView) {
      state.current = 'done';
      animate(lines, { pathLength: 1 }, { duration: duration.feature, ease: ease.settle });
      animate(fills, { opacity: 1 }, { duration: duration.slow, ease: ease.settle, delay: duration.feature * 0.6 });
    }
  }, [hydrated, reduced, inView, animate, scope, duration.feature, duration.slow, ease.settle]);

  return (
    <div ref={wrapRef} className="lp-race">
      <div className="lp-race__legend">
        <span className="lp-race__week">Week {WEEK}</span>
        <span className="lp-race__who">
          <span className="lp-race__key lp-race__key--you" aria-hidden="true" />
          {MATCHUP.you.name} <span className={last.you >= 0 ? 'lp-race__v lp-race__v--gain' : 'lp-race__v lp-race__v--loss'}>{formatMoney(last.you, { sign: 'always' })}</span>
        </span>
        <span className="lp-race__who">
          <span className="lp-race__key lp-race__key--opp" aria-hidden="true" />
          {MATCHUP.opp.name} <span className={last.opp >= 0 ? 'lp-race__v lp-race__v--gain' : 'lp-race__v lp-race__v--loss'}>{formatMoney(last.opp, { sign: 'always' })}</span>
        </span>
      </div>
      <svg
        ref={scope}
        className="lp-race__chart"
        viewBox={`0 0 ${CW} ${CH}`}
        role="img"
        aria-label={`Week ${WEEK}, cumulative dollar gain from Monday's open to Friday's close: ${MATCHUP.you.name} ${series.map((p) => formatMoney(p.you, { sign: 'always' })).join(', ')}; ${MATCHUP.opp.name} ${series.map((p) => formatMoney(p.opp, { sign: 'always' })).join(', ')}. ${MATCHUP.opp.name} led after Monday; ${MATCHUP.you.name} led from Tuesday and won by ${formatMoney(last.you - last.opp)}.`}
      >
        {areas.map((a, i) => (
          <path key={i} className={a.you ? 'lp-race__area lp-race__area--you' : 'lp-race__area lp-race__area--opp'} d={a.d} />
        ))}
        <line className="lp-race__zero" x1={PAD.left} x2={CW - PAD.right} y1={y(0)} y2={y(0)} />
        <text className="lp-race__zero-label" x={CW - PAD.right} y={y(0) - 6} textAnchor="end">
          $0
        </text>
        <path className="lp-race__line lp-race__line--opp" d={line('opp')} />
        <path className="lp-race__line lp-race__line--you" d={line('you')} />
        <g className="lp-race__head">
          <circle className={`lp-race__glow lp-race__glow--${leader}`} cx={head.x} cy={head.y} r="12" />
          <circle className={`lp-race__dot lp-race__dot--${leader}`} cx={head.x} cy={head.y} r="5" />
        </g>
        {series.map((p, i) => (
          <text key={i} className="lp-race__tick" x={x(i)} y={CH - 8} textAnchor={i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle'}>
            {p.label}
          </text>
        ))}
      </svg>
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
    <Layer tone="light" id="why" className="lp-why" labelledBy="lp-why-title">
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
            <RaceChart />
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
    </Layer>
  );
}

export default Why;
