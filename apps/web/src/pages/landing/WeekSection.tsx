import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';
import { ScoreDigits } from '../../design/game/ScoreDigits';
import { MatchBoard } from './MatchBoard';
import { Surface } from '../../design/Surface';
import { Text } from '../../design/Text';
import { formatMoney } from '../../design/lib/money';
import { useLandingMotion, useMediaQuery } from './hooks';
import { HERO, LEAGUE_NAME, STEPS, WEEK_PANELS, WEEK_STATES, type StepId, type WeekState } from './sampleData';

const stateById = (id: string) => WEEK_STATES.find((s) => s.id === id) ?? WEEK_STATES[0];

/** Scroll progress (0–1 through the pinned stretch) → which week state is
 * showing. Draft and Monday open get a beat each, the week's four daily
 * closes share the middle, Friday's final holds the last stretch. */
const BREAKPOINTS = [0.12, 0.26, 0.38, 0.5, 0.62, 0.76];
export function stateIndexAt(progress: number): number {
  const i = BREAKPOINTS.findIndex((b) => progress < b);
  return i === -1 ? WEEK_STATES.length - 1 : i;
}

function StepList({ active }: { active: StepId | null }) {
  return (
    <ol className="lp-steps">
      {STEPS.map((step, i) => (
        <li
          key={step.id}
          className={active === step.id ? 'lp-step lp-step--active' : 'lp-step'}
          aria-current={active === step.id ? 'step' : undefined}
        >
          <span className="lp-step__num" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <h3 className="lp-step__title">{step.title}</h3>
            <p className="lp-step__body">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SectionHead() {
  return (
    <>
      <h2 className="lp-h2" id="lp-how-title">
        How a week works
      </h2>
      <p className="lp-section-lede">Every matchup runs Monday’s open to Friday’s close, on real prices.</p>
    </>
  );
}

function leadLine(state: WeekState) {
  const diff = state.you - state.opponent;
  if (diff === 0) return 'Both scores start at $0.00.';
  const amount = <span className="lp-num">{formatMoney(Math.abs(diff))}</span>;
  if (state.step === 'close') return <>Final: {diff > 0 ? 'you win' : 'Priya wins'} by {amount}</>;
  return diff > 0 ? <>You lead by {amount}</> : <>Priya leads by {amount}</>;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** Pinned + scrubbed (full motion, JS on, tall-enough viewport). Native
 * scroll throughout: sticky positioning pins the stage and `useScroll`
 * only READS progress — no wheel capture, no snapping, no speed change.
 * The pinned stretch is 180vh (budget ≤ 200vh; landing.css .lp-scrub). */
function WeekScrub() {
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const [index, setIndex] = useState(0);
  const [chyron, setChyron] = useState<string | null>(null);

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const next = stateIndexAt(p);
    if (next === index) return;
    // Call the play only when moving forward into a lead change.
    const msg = next > index ? WEEK_STATES[next].chyron : undefined;
    setIndex(next);
    setChyron(msg ?? null);
  });

  // Wide screens keep the heading on the pinned stage beside the steps;
  // phones need the height, so there it scrolls away above the stage.
  // (WeekScrub only ever renders after hydration, so this is known.)
  const wide = useMediaQuery('(min-width: 1024px)') === true;

  const state = WEEK_STATES[index];
  return (
    <>
      {!wide && (
        <div className="lp-wrap">
          <SectionHead />
        </div>
      )}
      <div className="lp-scrub" ref={trackRef}>
        <div className="lp-scrub__stage">
          <div className="lp-wrap lp-week__grid">
            <div className="lp-week__copy">
              {wide && <SectionHead />}
              <StepList active={state.step} />
            </div>
            <div className="lp-week__visual">
              <Surface kind="game" className="lp-week__surface">
                <MatchBoard
                  className="lp-board--compact"
                  tag={`Week ${HERO.week} · ${state.label}`}
                  youName="You"
                  oppName="Priya"
                  youScore={<ScoreDigits value={formatMoney(state.you, { sign: 'always' })} className="lp-board__score" />}
                  oppScore={
                    <ScoreDigits value={formatMoney(state.opponent, { sign: 'always' })} className="lp-board__score" />
                  }
                  tugYou={state.you}
                  tugOpp={state.opponent}
                  lead={leadLine(state)}
                  chyron={chyron}
                  onChyronDismiss={() => setChyron(null)}
                />
                <div className="lp-rail" aria-hidden="true">
                  <div className="lp-rail__track">
                    <motion.div className="lp-rail__fill" style={{ scaleX: scrollYProgress }} />
                  </div>
                  <div className="lp-rail__days">
                    {DAYS.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                  </div>
                </div>
              </Surface>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Static four-panel sequence (reduced motion, JS off, short viewports). */
function WeekPanels() {
  return (
    <div className="lp-wrap">
      <SectionHead />
      <div className="lp-week__grid lp-week__grid--static">
        <StepList active={null} />
        <ol className="lp-panels" aria-label={`Week ${HERO.week} in four moments`}>
          {WEEK_PANELS.map((panel) => {
            const state = stateById(panel.stateId);
            return (
              <li key={panel.title} className="lp-panel">
                <div className="lp-panel__title">
                  <Text variant="headline" as="h3">
                    {panel.title}
                  </Text>
                </div>
                {panel.title === 'Final' ? (
                  <Surface kind="game" className="lp-panel__final">
                    <Text variant="tag" tone="secondary">
                      Final · Week {HERO.week}
                    </Text>
                    <p className="lp-panel__final-line">
                      You win by <span className="lp-num">{formatMoney(state.you - state.opponent)}</span>
                    </p>
                    <Text variant="callout" tone="secondary" as="p">
                      Record 3–0 in {LEAGUE_NAME}
                    </Text>
                  </Surface>
                ) : (
                  <Surface kind="game" className="lp-panel__surface">
                    <MatchBoard
                      className="lp-board--compact"
                      tag={`Week ${HERO.week} · ${state.label}`}
                      youName="You"
                      oppName="Priya"
                      youScore={
                        <ScoreDigits value={formatMoney(state.you, { sign: 'always' })} className="lp-board__score" />
                      }
                      oppScore={
                        <ScoreDigits value={formatMoney(state.opponent, { sign: 'always' })} className="lp-board__score" />
                      }
                      tugYou={state.you}
                      tugOpp={state.opponent}
                      lead={leadLine(state)}
                      chyron={null}
                      onChyronDismiss={() => undefined}
                    />
                  </Surface>
                )}
                <p className="lp-panel__note">{panel.note}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Section 3. Server render and first client render are ALWAYS the static
 * panels (so hydration matches and JS-off readers get the whole sequence);
 * the scrub replaces them one commit after hydration, below the fold. */
export function WeekSection() {
  const { hydrated, reduced } = useLandingMotion();
  // The pinned stage needs room for the steps and the board together.
  const roomy = useMediaQuery('(min-height: 640px)');
  const scrub = hydrated && !reduced && roomy === true;
  return (
    <section className="lp-section lp-week" id="how" aria-labelledby="lp-how-title">
      {scrub ? <WeekScrub /> : <WeekPanels />}
    </section>
  );
}

export default WeekSection;
