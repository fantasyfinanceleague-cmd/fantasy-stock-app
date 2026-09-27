import { useEffect, useRef } from 'react';
import { useAnimate } from 'motion/react';
import { Surface } from '../../design/Surface';
import { Text } from '../../design/Text';
import { Money } from '../../design/Money';
import { formatMoney } from '../../design/lib/money';
import { useInView, useLandingMotion } from './hooks';
import { LEAGUE_NAME, PORTFOLIO } from './sampleData';

const W = 560;
const H = 200;
const PAD_Y = 16;

function geometry(points: readonly number[]) {
  const min = Math.min(0, ...points);
  const max = Math.max(0, ...points);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => PAD_Y + ((max - v) / (max - min)) * (H - PAD_Y * 2);
  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  return { d, zeroY: y(0), end: { x: x(points.length - 1), y: y(points[points.length - 1]) } };
}

/** Cumulative gain since joining, on a zero baseline (DESIGN_DIRECTION §3
 * chart decision, PR #38): gain colour above zero, loss colour below — one
 * path drawn twice, each copy clipped to its side of the baseline. Draws
 * once when it first scrolls into view (`feature`); drawn from the start
 * under reduced motion, with JS off, or if it's already on screen at load. */
function GainChart() {
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate<SVGSVGElement>();
  const inView = useInView(wrapRef, { threshold: 0.5 });
  const drawState = useRef<'idle' | 'armed' | 'done'>('idle');
  const { d, zeroY, end } = geometry(PORTFOLIO.cumulative);

  useEffect(() => {
    if (!hydrated || reduced || drawState.current === 'done') return;
    const paths = scope.current?.querySelectorAll('.lp-chart__line');
    if (!paths?.length) return;
    if (drawState.current === 'idle' && inView === false) {
      // Off screen: undraw now, where no one can see it happen.
      drawState.current = 'armed';
      animate(paths, { pathLength: 0 }, { duration: 0 });
    } else if (drawState.current === 'armed' && inView) {
      drawState.current = 'done';
      animate(paths, { pathLength: 1 }, { duration: duration.feature, ease: ease.settle });
    } else if (drawState.current === 'idle' && inView) {
      drawState.current = 'done';
    }
  }, [hydrated, reduced, inView, animate, scope, duration.feature, ease.settle]);

  return (
    <div ref={wrapRef} className="lp-chart">
      <svg
        ref={scope}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Sample chart: gain since joining, from $0.00 down to ${formatMoney(Math.min(...PORTFOLIO.cumulative))} in week 1, then up to ${formatMoney(PORTFOLIO.cumulative[PORTFOLIO.cumulative.length - 1], { sign: 'always' })} by the end of week 3.`}
      >
        <defs>
          <clipPath id="lp-chart-above">
            <rect x="-4" y="-4" width={W + 8} height={zeroY + 4} />
          </clipPath>
          <clipPath id="lp-chart-below">
            <rect x="-4" y={zeroY} width={W + 8} height={H - zeroY + 4} />
          </clipPath>
        </defs>
        <line className="lp-chart__zero" x1="0" x2={W} y1={zeroY} y2={zeroY} />
        <path className="lp-chart__line lp-chart__line--gain" d={d} clipPath="url(#lp-chart-above)" />
        <path className="lp-chart__line lp-chart__line--loss" d={d} clipPath="url(#lp-chart-below)" />
        <circle className="lp-chart__end" cx={end.x} cy={end.y} r="4" />
      </svg>
      <div className="lp-chart__axis" aria-hidden="true">
        <span>Week 1</span>
        <span>Week 2</span>
        <span>Week 3</span>
      </div>
    </div>
  );
}

export function MoneySide() {
  const total = PORTFOLIO.cumulative[PORTFOLIO.cumulative.length - 1];
  return (
    <section className="lp-section lp-money" aria-labelledby="lp-money-title">
      <div className="lp-wrap lp-money__grid">
        <div className="lp-money__copy">
          <h2 className="lp-h2" id="lp-money-title">
            Real prices. No real money.
          </h2>
          <dl className="lp-facts">
            <div>
              <dt>Real market data</dt>
              <dd>Scores follow real stock prices, slightly delayed, so a good week means you picked well.</dd>
            </div>
            <div>
              <dt>Free to play</dt>
              <dd>No entry fee and no subscription.</dd>
            </div>
            <div>
              <dt>No real money</dt>
              <dd>Nothing to deposit or withdraw, and no cash prizes. You play for the standings.</dd>
            </div>
          </dl>
        </div>
        <Surface kind="money" elevated className="lp-card">
          <div className="lp-card__head">
            <div>
              <Text variant="caption" tone="secondary" as="p">
                Portfolio value
              </Text>
              <Money value={PORTFOLIO.value} size="display" colorBySign={false} as="p" />
            </div>
            <div className="lp-card__week">
              <Money value={PORTFOLIO.weekGain} sign="always" size="headline" as="p" />
              <Text variant="caption" tone="secondary" as="p">
                this week
              </Text>
            </div>
          </div>
          <div className="lp-card__chart-head">
            <Text variant="callout" tone="secondary" as="p">
              Gain since joining {LEAGUE_NAME}
            </Text>
            <Money value={total} sign="always" size="callout" as="p" />
          </div>
          <GainChart />
          {/* Text sets margin: 0 inline, so spacing lives on a wrapper. */}
          <div className="lp-card__note">
            <Text variant="caption" tone="secondary" as="p">
              Sample portfolio with a $10,000 league budget.
            </Text>
          </div>
        </Surface>
      </div>
    </section>
  );
}

export default MoneySide;
