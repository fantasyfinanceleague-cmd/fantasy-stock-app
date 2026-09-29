import { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, useScroll, useTransform } from 'motion/react';
import { brand } from '../../brand';
import { Surface } from '../../design/Surface';
import { ScoreDigits } from '../../design/game/ScoreDigits';
import { TugBar } from '../../design/game/TugBar';
import { formatMoney } from '../../design/lib/money';
import { hero, inside } from './copy';
import { FlyOut } from './FlyOut';
import { FullSlot, useFullReady } from './FullSlot';
import { HomeScreen, Phone } from './PhoneScreens';
import { Layer } from './scroll';
import { LaunchingSoon } from './Nav';
import { SplitLetters } from './Kinetic';
import {
  useEnhanced,
  useFinePointer,
  useInView,
  useLandingMotion,
  useLoop,
  useMagnet,
  useMediaQuery,
  usePageVisible,
  usePointerGlow,
  useTilt,
} from './hooks';
import {
  LEAGUE,
  MATCHUP,
  MATCHUP_FRAMES,
  PORTFOLIO_FRAMES,
  RANGES,
  SPARKLINE,
  WEEK,
  moversRanked,
} from './sampleData';

/** Live-loop pacing for the "look inside" cards: how long each tick of
 * sample prices stays up. Content pacing, not an animation duration. */
const INSIDE_TICK_MS = 2800;

/** "+2.34%" / "−0.52%" (U+2212, like the money formatter); zero unsigned. */
export function fmtPct(v: number): string {
  const r = Math.round(Math.abs(v) * 100) / 100;
  if (r === 0) return '0.00%';
  return `${v > 0 ? '+' : '−'}${r.toFixed(2)}%`;
}

function LivePill({ label = 'Live' }: { label?: string }) {
  return (
    <span className="lp-live">
      <span className="lp-live__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** A mock card with the pointer tilt + cursor-light (fine pointers only,
 * off under reduced motion). */
function TiltCard({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const enhanced = useEnhanced();
  const fine = useFinePointer();
  useTilt(ref, enhanced && fine);
  return (
    <div ref={ref} className={['lp-tilt', className].filter(Boolean).join(' ')}>
      {children}
      <span className="lp-tilt__light" aria-hidden="true" />
    </div>
  );
}

function Sparkline({ draw }: { draw: boolean }) {
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const [scope, animate] = useAnimate<SVGSVGElement>();
  const state = useRef<'idle' | 'armed' | 'done'>('idle');
  useEffect(() => {
    if (!hydrated || reduced || state.current === 'done') return;
    const line = scope.current?.querySelector('.lp-spark__line');
    if (!line) return;
    if (state.current === 'idle' && !draw) {
      state.current = 'armed';
      animate(line, { pathLength: 0 }, { duration: 0 });
    } else if (draw) {
      state.current = 'done';
      animate(line, { pathLength: 1 }, { duration: duration.feature, ease: ease.settle });
    }
  }, [hydrated, reduced, draw, animate, scope, duration.feature, ease.settle]);
  const pts = SPARKLINE.split(' ');
  const [ex, ey] = pts[pts.length - 1].split(',');
  return (
    <svg ref={scope} className="lp-spark" viewBox="0 0 320 80" aria-hidden="true">
      <polyline className="lp-spark__line" points={SPARKLINE} />
      <circle className="lp-spark__end" cx={ex} cy={ey} r="4" />
    </svg>
  );
}

function PortfolioCard({ frame, drawn }: { frame: number; drawn: boolean }) {
  const f = PORTFOLIO_FRAMES[frame];
  return (
    <TiltCard className="lp-inside__main">
      <Surface kind="money" elevated className="lp-card lp-card--portfolio">
        <div className="lp-card__head">
          <div>
            <div className="lp-card__lbl">Portfolio · {LEAGUE}</div>
            <div className="lp-card__title">Week {WEEK} · Live</div>
          </div>
          <LivePill />
        </div>
        <ScoreDigits value={formatMoney(f.value)} className="lp-roll lp-roll--xl" />
        <div className="lp-card__delta">
          <span className="lp-delta lp-delta--gain">
            ▲ {formatMoney(f.today)} · {fmtPct(f.todayPct)}
          </span>
          <span className="lp-card__muted">today</span>
        </div>
        <Sparkline draw={drawn} />
        <div className="lp-ranges" aria-hidden="true">
          {RANGES.map((r) => (
            <span key={r} className={r === '1M' ? 'lp-range lp-range--on' : 'lp-range'}>
              {r}
            </span>
          ))}
        </div>
        <ul className="lp-holdings">
          {f.holdings.map((h) => (
            <li key={h.t} className="lp-holding">
              <span className={h.pct >= 0 ? 'lp-sd lp-sd--gain' : 'lp-sd lp-sd--loss'} aria-hidden="true" />
              <span className="lp-holding__name">
                <span className="lp-holding__t">{h.t}</span>
                <span className="lp-holding__co">
                  {h.co} · {h.sh} sh
                </span>
              </span>
              <ScoreDigits value={formatMoney(h.value)} className="lp-roll lp-roll--sm" />
              <span className={h.pct >= 0 ? 'lp-delta lp-delta--gain' : 'lp-delta lp-delta--loss'}>{fmtPct(h.pct)}</span>
            </li>
          ))}
        </ul>
      </Surface>
    </TiltCard>
  );
}

function MatchupCard({ frame }: { frame: number }) {
  const f = MATCHUP_FRAMES[frame];
  const lead = f.you - f.opp;
  const leader = lead >= 0 ? MATCHUP.you.name : MATCHUP.opp.name;
  return (
    <TiltCard>
      <Surface kind="game" level="raised" className="lp-card lp-card--matchup">
        <div className="lp-card__head">
          <span className="lp-card__lbl">This week’s matchup</span>
          <LivePill />
        </div>
        <div className="lp-mrow">
          <span className="lp-avatar lp-avatar--you" aria-hidden="true">
            {MATCHUP.you.init}
          </span>
          <span className="lp-mrow__who">
            <span className="lp-mrow__name">{MATCHUP.you.name}</span>
            <span className="lp-mrow__sub">{MATCHUP.you.role}</span>
          </span>
          <span className={f.youPct >= 0 ? 'lp-delta lp-delta--gain' : 'lp-delta lp-delta--loss'}>{fmtPct(f.youPct)}</span>
        </div>
        <div className="lp-mbar" aria-hidden="true">
          <TugBar you={f.you} opponent={f.opp} youLabel={MATCHUP.you.name} opponentLabel={MATCHUP.opp.name} />
        </div>
        <div className="lp-mrow lp-mrow--opp">
          <span className={f.oppPct >= 0 ? 'lp-delta lp-delta--gain' : 'lp-delta lp-delta--loss'}>{fmtPct(f.oppPct)}</span>
          <span className="lp-mrow__who">
            <span className="lp-mrow__name">{MATCHUP.opp.name}</span>
            <span className="lp-mrow__sub">{MATCHUP.opp.role}</span>
          </span>
          <span className="lp-avatar lp-avatar--opp" aria-hidden="true">
            {MATCHUP.opp.init}
          </span>
        </div>
        <div className="lp-card__foot">
          {/* Was "Win prob 72%" on the old mock: no win-probability model
              exists, so the foot shows the lead in dollars instead. */}
          <span>
            {leader} leads by <span className="lp-num">{formatMoney(Math.abs(lead))}</span>
          </span>
          <span>{MATCHUP.left}</span>
        </div>
      </Surface>
    </TiltCard>
  );
}

function MoversCard({ frame }: { frame: number }) {
  const { reduced, duration, ease } = useLandingMotion();
  const rows = moversRanked(frame);
  return (
    <TiltCard>
      <Surface kind="game" level="raised" className="lp-card lp-card--movers">
        <div className="lp-card__head">
          <span className="lp-card__lbl">This week’s movers</span>
        </div>
        <ul className="lp-movers">
          {rows.map((m) => (
            <motion.li
              key={m.t}
              layout={reduced ? false : 'position'}
              transition={{ layout: { duration: duration.base, ease: ease.settle } }}
              className="lp-mover"
            >
              <span className={m.pct >= 0 ? 'lp-sd lp-sd--gain' : 'lp-sd lp-sd--loss'} aria-hidden="true" />
              <span className="lp-mover__t">{m.t}</span>
              <span className="lp-mover__co">{m.co}</span>
              <span className={m.pct >= 0 ? 'lp-delta lp-delta--gain' : 'lp-delta lp-delta--loss'}>{fmtPct(m.pct)}</span>
            </motion.li>
          ))}
        </ul>
      </Surface>
    </TiltCard>
  );
}

function SeeHowItWorks() {
  const ref = useRef<HTMLAnchorElement>(null);
  const enhanced = useEnhanced();
  const fine = useFinePointer();
  useMagnet(ref, enhanced && fine);
  return (
    <a ref={ref} className="lp-link lp-magnet lp-press" href={hero.link.href}>
      {hero.link.label}
    </a>
  );
}

/** The opening shot: the hero, then "A look inside" rising over it — the
 * first two layers of the page's swallow grammar (scroll.tsx Layer). On
 * large screens the look-inside stage then pins while its product cards
 * rise into place and drift in parallax depth as they tick live. Server
 * render, JS-off and reduced motion: both sections static, the cards at
 * their first frame, everything readable. */
export function Opening() {
  const enhanced = useEnhanced();
  const bigStage = useMediaQuery('(min-width: 1024px) and (min-height: 700px)') === true;
  const pinned = enhanced && bigStage;
  // FULL + pinned: the cards launch out of the 3D device (FlyOut).
  const fullReady = useFullReady();
  const fly = pinned && fullReady;

  const deviceRef = useRef<HTMLDivElement>(null);
  const insideDeviceRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  // Approach: the stage's top from the viewport bottom to the top.
  const { scrollYProgress: approach } = useScroll({ target: trackRef, offset: ['start end', 'start start'] });
  // Dwell: the pinned stretch.
  const { scrollYProgress: dwell } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const cardsRise = useTransform(approach, [0.15, 1], ['22vh', '0vh']);
  const depthMain = useTransform(dwell, [0, 1], ['0vh', '-2vh']);
  const depthSide = useTransform(dwell, [0, 1], ['0vh', '-7vh']);

  // Live loop: only while the cards are on screen, the tab is visible and
  // nobody is pointing at / focused in them.
  const inView = useInView(cardsRef, { threshold: 0.25 });
  const visible = usePageVisible();
  const [held, setHeld] = useState(false);
  const frame = useLoop(PORTFOLIO_FRAMES.length, INSIDE_TICK_MS, enhanced && inView === true && visible && !held);
  usePointerGlow(stageRef, enhanced);

  // Kinetic headline: as the next layer rises over the hero, the lines
  // drift apart in depth and "Win the league." grows toward the camera.
  const { scrollY } = useScroll();
  const heroCover = useTransform(scrollY, (v) => Math.min(1, Math.max(0, v / (typeof window === 'undefined' ? 1 : window.innerHeight))));
  const drift0 = useTransform(heroCover, [0, 1], ['0em', '-0.28em']);
  const drift1 = useTransform(heroCover, [0, 1], ['0em', '-0.12em']);
  const grow2 = useTransform(heroCover, [0, 1], [1, 1.1]);
  const lineDrift = [{ y: drift0 }, { y: drift1 }, { scale: grow2 }];

  // The hero device's screen ticks through the same frames as the cards.
  const heroInView = useInView(deviceRef, { threshold: 0.1 });
  const heroFrame = useLoop(PORTFOLIO_FRAMES.length, INSIDE_TICK_MS, enhanced && heroInView === true && visible);

  return (
    <>
      <Layer id="top" tone="light" first labelledBy="lp-hero-title" className="lp-hero-layer">
        <div className="lp-hero">
          {/* FULL tier: the WebGL stage behind the copy (skyline + the 3D
              device, anchored to the device slot below). */}
          <FullSlot name="hero" slot={deviceRef} frame={heroFrame} />
          <div className="lp-wrap lp-hero__inner">
            <div className="lp-hero__copy">
              <p className="lp-eyebrow lp-hero__eyebrow">
                <span className="lp-eyebrow__dot" aria-hidden="true" />
                {hero.eyebrow}
              </p>
              <h1 id="lp-hero-title" className="lp-hero__title">
                {/* Kinetic type: the verbatim headline for assistive tech,
                    the split letters (aria-hidden) for the eye. */}
                <span className="lp-sr">{hero.lines.join(' ')}</span>
                <span aria-hidden="true">
                  {hero.lines.map((line, i) => (
                    <motion.span
                      key={line}
                      className="lp-line"
                      style={enhanced ? { ['--lp-i' as string]: i, ...lineDrift[i] } : { ['--lp-i' as string]: i }}
                    >
                      <span className="lp-line__in">
                        {i === hero.lines.length - 1 ? (
                          <em>
                            <SplitLetters text={line} />
                          </em>
                        ) : (
                          <SplitLetters text={line} />
                        )}
                      </span>
                      {i < hero.lines.length - 1 ? ' ' : null}
                    </motion.span>
                  ))}
                </span>
              </h1>
              <p className="lp-hero__lede">{hero.lede(brand.name)}</p>
              <div className="lp-hero__cta">
                <LaunchingSoon label={hero.status} />
                <SeeHowItWorks />
              </div>
              <p className="lp-hero__meta">
                {hero.meta.map((m, i) => (
                  <span key={m.strong}>
                    {i > 0 && (
                      <span className="lp-hero__sep" aria-hidden="true">
                        ·
                      </span>
                    )}
                    <b>{m.strong}</b>
                    {m.rest}
                  </span>
                ))}
              </p>
            </div>
            {/* The device slot. Its DOM phone is the first paint in every
                tier (no blank moment); FULL crossfades the 3D device over
                it once the first WebGL frame is presented. */}
            <div ref={deviceRef} className={enhanced ? 'lp-hero__device lp-hero__device--live' : 'lp-hero__device'}>
              <Phone className="lp-hero__phone">
                <HomeScreen frame={heroFrame} />
              </Phone>
            </div>
          </div>
          {/* The one scroll cue on the page (Design Lead, round 4). */}
          <span className="lp-scroll-cue" aria-hidden="true">
            <span className="lp-scroll-cue__line" />
          </span>
        </div>
      </Layer>

      <Layer tone="dark" label={inside.label(brand.name)} className={pinned ? 'lp-inside lp-inside--pinned' : 'lp-inside'}>
        <div ref={trackRef} className="lp-inside__track">
          <div ref={stageRef} className="lp-inside__stage">
            <span className="lp-glow" aria-hidden="true" />
            {pinned && (
              <>
                <div ref={insideDeviceRef} className="lp-inside__device" aria-hidden="true" />
                <FullSlot name="inside" slot={insideDeviceRef} frame={frame} approach={approach} dwell={dwell} />
              </>
            )}
            <div className="lp-wrap lp-inside__content">
              <p className="lp-inside__label">
                <span>{inside.label(brand.name)}</span>
                <span className="lp-inside__dash" aria-hidden="true" />
              </p>
              <motion.div
                ref={cardsRef}
                className="lp-inside__cards"
                style={pinned && !fly ? { y: cardsRise } : undefined}
                onPointerEnter={() => setHeld(true)}
                onPointerLeave={() => setHeld(false)}
                onFocus={() => setHeld(true)}
                onBlur={() => setHeld(false)}
              >
                <motion.div className="lp-inside__col" style={pinned ? { y: depthMain } : undefined}>
                  <FlyOut i={0} on={fly} progress={dwell} slot={insideDeviceRef} stage={stageRef}>
                    <PortfolioCard frame={frame} drawn={inView === true} />
                  </FlyOut>
                </motion.div>
                <motion.div className="lp-inside__col lp-inside__side" style={pinned ? { y: depthSide } : undefined}>
                  <FlyOut i={1} on={fly} progress={dwell} slot={insideDeviceRef} stage={stageRef}>
                    <MatchupCard frame={frame} />
                  </FlyOut>
                  <FlyOut i={2} on={fly} progress={dwell} slot={insideDeviceRef} stage={stageRef}>
                    <MoversCard frame={frame} />
                  </FlyOut>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </div>
      </Layer>
    </>
  );
}

export default Opening;
