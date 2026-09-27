import { useEffect, useRef, useState } from 'react';
import { Surface } from '../../design/Surface';
import { formatMoney } from '../../design/lib/money';
import { CountUp } from './CountUp';
import { MatchBoard } from './MatchBoard';
import { Ticker } from './Ticker';
import { useLandingMotion } from './hooks';
import { HERO } from './sampleData';
import { displayFontReady } from './head';

type Phase = 'kickoff' | 'counting' | 'settled';

/** Longest the sequence waits for the display face before running anyway
 * (Design Lead, phase 3a review). A load-gating cap, not an animation. */
const FONT_WAIT_MS = 600;

/** Milliseconds left on the CSS band wipe (landing.css `lp-band-wipe`,
 * `slow`), read from the running animation itself. The wipe starts at
 * first paint — before hydration — so the JS half of the sequence waits
 * for whatever is left of it rather than restarting it. 0 when it isn't
 * running (reduced motion, finished, or no Web Animations API). */
function msUntilWipeEnds(band: Element | null): number {
  if (!band || typeof band.getAnimations !== 'function') return 0;
  const wipe = band.getAnimations().find((a) => (a as CSSAnimation).animationName === 'lp-band-wipe');
  if (!wipe || wipe.playState === 'finished') return 0;
  const end = Number(wipe.effect?.getComputedTiming().endTime ?? 0);
  const now = Number(wipe.currentTime ?? 0);
  return Math.max(0, end - now);
}

/** The hero's one `feature` sequence (phase3a-landing.md §2):
 *   band wipe (CSS, at first paint, `slow`/settle)
 *   → scores count up once from $0.00 (`feature`/settle)
 *   → TugBar settles to 0.59 with spring.lively (a lead change: tied → you)
 *   → the chyron slides in.
 * ≤ 1.4s end to end. The prerendered (and JS-off) state is "Monday open":
 * both scores $0.00, the bar even — a true state of the week, labelled as
 * such. Reduced motion: the final state is set in one step, chyron static. */
function HeroScoreboard() {
  const { hydrated, reduced, duration } = useLandingMotion();
  const [phase, setPhase] = useState<Phase>('kickoff');
  const [tugLive, setTugLive] = useState(false);
  const [chyron, setChyron] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || startedRef.current) return;
    startedRef.current = true;
    if (reduced) {
      setPhase('settled');
      setTugLive(true);
      setChyron(HERO.chyron);
      return;
    }
    const ms = (s: number) => s * 1000;
    // The count renders in the display face, so it waits for that face as
    // well as for the band wipe: whichever finishes later. The font wait is
    // capped (FONT_WAIT_MS) so a slow font never holds the sequence back.
    const wipeLeft = msUntilWipeEnds(document.querySelector('.lp-band'));
    const t0 = performance.now();
    let cancelled = false;
    let timers: number[] = [];
    displayFontReady(FONT_WAIT_MS).then(() => {
      if (cancelled) return;
      const start = Math.max(0, wipeLeft - (performance.now() - t0));
      timers = [
        window.setTimeout(() => setPhase('counting'), start),
        // The bar follows the count's opening beat; spring.lively settles
        // in ~0.6s, inside the count's `feature` window.
        window.setTimeout(() => setTugLive(true), start + ms(duration.quick)),
        window.setTimeout(() => setPhase('settled'), start + ms(duration.feature)),
        // The chyron starts sliding as the count lands, so the whole
        // sequence is wipe + feature + base − quick ≈ 1.16s after first paint.
        window.setTimeout(() => setChyron(HERO.chyron), start + ms(duration.feature - duration.quick)),
      ];
    });
    return () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      startedRef.current = false;
    };
  }, [hydrated, reduced, duration]);

  const running = phase !== 'kickoff';
  const status = running ? HERO.live : HERO.kickoff;
  const you = tugLive ? HERO.you.gain : 0;
  const opp = tugLive ? HERO.opponent.gain : 0;
  const margin = HERO.you.gain - HERO.opponent.gain;

  return (
    <MatchBoard
      tag={`Week ${HERO.week} · ${status.tag}`}
      aside={status.clock}
      youName={HERO.you.name}
      oppName={HERO.opponent.name}
      youScore={<CountUp from={0} to={HERO.you.gain} run={running} instant={reduced} className="lp-board__score" />}
      oppScore={
        <CountUp
          from={0}
          to={HERO.opponent.gain}
          run={running}
          instant={reduced}
          align="end"
          className="lp-board__score"
        />
      }
      tugYou={you}
      tugOpp={opp}
      lead={
        phase === 'settled' ? (
          <>
            You lead by <span className="lp-num">{formatMoney(margin)}</span>
          </>
        ) : (
          'Scores count from Monday’s open.'
        )
      }
      chyron={chyron}
      onChyronDismiss={() => undefined}
    />
  );
}

export function Hero() {
  return (
    <section className="lp-hero" id="top" aria-labelledby="lp-hero-title">
      <div className="lp-wrap lp-hero__copy">
        <h1 id="lp-hero-title" className="lp-hero__title">
          <span className="lp-line">Your portfolio</span>{' '}
          <span className="lp-line">
            vs. your <span className="lp-line-split">friends.</span>
          </span>{' '}
          <span className="lp-line">Every week.</span>
        </h1>
        <p className="lp-hero__lede">
          Draft real stocks, then go head to head with one friend each week. The bigger dollar gain at Friday’s close
          wins.
        </p>
      </div>
      <Surface kind="game" className="lp-band">
        <div className="lp-wrap">
          <HeroScoreboard />
        </div>
      </Surface>
      <Ticker />
    </section>
  );
}

export default Hero;
