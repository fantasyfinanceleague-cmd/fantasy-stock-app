import { useRef, useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'motion/react';
import { Surface } from '../../design/Surface';
import { ScoreDigits } from '../../design/game/ScoreDigits';
import { TugBar } from '../../design/game/TugBar';
import { formatMoney } from '../../design/lib/money';
import { how } from './copy';
import { useEnhanced, useLandingMotion, useMediaQuery } from './hooks';
import { CLIMB_FRAMES, DRAFT_PICKS, LEAGUE, MATCHUP, WEEK, WEEK_CLOSES } from './sampleData';
import { Reveal } from './scroll';

// ── The phone's three screens ───────────────────────────────────────────

function DraftScreen({ picks }: { picks: number }) {
  const { reduced, duration, ease } = useLandingMotion();
  const rounds = [DRAFT_PICKS.slice(0, 6), DRAFT_PICKS.slice(6, 12).reverse()];
  const roster = DRAFT_PICKS.filter((p) => p.you && p.pick <= picks);
  const round = picks <= 6 ? 1 : 2;
  return (
    <div className="lp-screen lp-screen--draft">
      <div className="lp-screen__bar">
        <span className="lp-screen__tag">Snake draft</span>
        <span className="lp-screen__muted">Round {round}</span>
      </div>
      <div className="lp-draft">
        {rounds.map((row, r) => (
          <div key={r} className={r === 1 ? 'lp-draft__row lp-draft__row--rev' : 'lp-draft__row'}>
            {row.map((p) => {
              const taken = p.pick <= picks;
              return (
                <div
                  key={p.pick}
                  className={['lp-pick', taken ? 'lp-pick--taken' : '', p.you ? 'lp-pick--you' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="lp-pick__n">{p.pick}</span>
                  <span className="lp-pick__t">{taken ? p.t : '—'}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="lp-roster">
        <span className="lp-screen__muted">Your roster</span>
        <div className="lp-roster__slots">
          <AnimatePresence initial={false}>
            {roster.map((p) => (
              <motion.span
                key={p.t}
                className="lp-roster__chip"
                initial={reduced ? false : { scale: 0.6, opacity: 0, y: -18 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: duration.base, ease: ease.settle }}
              >
                {p.t}
              </motion.span>
            ))}
          </AnimatePresence>
          {Array.from({ length: Math.max(0, 2 - roster.length) }, (_, i) => (
            <span key={`empty-${i}`} className="lp-roster__chip lp-roster__chip--empty">
              ·
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function CompeteScreen({ day, final }: { day: number; final: boolean }) {
  const { reduced, duration, ease } = useLandingMotion();
  const d = WEEK_CLOSES[day];
  const lead = d.you - d.opp;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const reached = day === 0 ? 0 : days.indexOf(d.day) + 1;
  return (
    <div className="lp-screen lp-screen--compete">
      <div className="lp-screen__bar">
        <span className="lp-screen__tag">
          Week {WEEK} · {day === 0 ? 'Mon open' : final ? 'Final' : `${d.day} close`}
        </span>
      </div>
      <div className="lp-compete__names">
        <span className="lp-compete__name lp-compete__name--you">{MATCHUP.you.name}</span>
        <span className="lp-compete__name lp-compete__name--opp">{MATCHUP.opp.name}</span>
      </div>
      <div className="lp-compete__scores">
        <ScoreDigits value={formatMoney(d.you, { sign: 'always' })} className="lp-roll lp-roll--md" />
        <ScoreDigits value={formatMoney(d.opp, { sign: 'always' })} className="lp-roll lp-roll--md" />
      </div>
      <div aria-hidden="true">
        <TugBar you={d.you} opponent={d.opp} youLabel={MATCHUP.you.name} opponentLabel={MATCHUP.opp.name} />
      </div>
      <p className="lp-compete__lead">
        {lead === 0 ? (
          'Both start at $0.00'
        ) : (
          <>
            {lead > 0 ? MATCHUP.you.name : MATCHUP.opp.name} {final ? 'wins' : 'leads'} by{' '}
            <span className="lp-num">{formatMoney(Math.abs(lead))}</span>
          </>
        )}
      </p>
      <div className="lp-days" aria-hidden="true">
        {days.map((x, i) => (
          <span key={x} className={i < reached ? 'lp-days__d lp-days__d--on' : 'lp-days__d'}>
            {x}
          </span>
        ))}
      </div>
      <AnimatePresence>
        {final && (
          <motion.span
            key="final"
            className="lp-stamp"
            initial={reduced ? false : { opacity: 0, scale: 1.35, rotate: -14 }}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.slow, ease: ease.settle }}
          >
            Final
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function ClimbScreen({ frame }: { frame: number }) {
  const { reduced, duration, ease } = useLandingMotion();
  const rows = CLIMB_FRAMES[frame];
  return (
    <div className="lp-screen lp-screen--climb">
      <div className="lp-screen__bar">
        <span className="lp-screen__tag">Standings</span>
        <span className="lp-screen__muted">{LEAGUE}</span>
      </div>
      <ol className="lp-climb">
        {rows.map((r, i) => (
          <motion.li
            key={r.id}
            layout={reduced ? false : 'position'}
            transition={{ layout: { duration: duration.slow, ease: ease.settle } }}
            className={r.you ? 'lp-climb__row lp-climb__row--you' : 'lp-climb__row'}
          >
            <span className="lp-climb__rank">{i + 1}</span>
            <span className="lp-climb__name">{r.name}</span>
            {r.you && frame === 1 && <span className="lp-badge lp-badge--up">▲ 2</span>}
            <span className="lp-climb__rec">{r.rec}</span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}

function Phone({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={['lp-phone', className].filter(Boolean).join(' ')} aria-hidden="true">
      <span className="lp-phone__notch" />
      <Surface kind="game" className="lp-phone__screen">
        {children}
      </Surface>
    </div>
  );
}

function StepTitle({ i }: { i: number }) {
  const t = how.steps[i].title;
  return (
    <h3 className="lp-step__title">
      {t.emFirst ? (
        <>
          <em>{t.em}</em>
          {t.rest}
        </>
      ) : (
        <>
          {t.rest}
          <em>{t.em}</em>
        </>
      )}
    </h3>
  );
}

function Steps({ active }: { active: number | null }) {
  return (
    <ol className="lp-steps">
      {how.steps.map((s, i) => (
        <li key={s.num} className={active === i ? 'lp-step lp-step--active' : 'lp-step'} aria-current={active === i ? 'step' : undefined}>
          <span className="lp-step__num">{s.num}</span>
          <div>
            <StepTitle i={i} />
            <p className="lp-step__body">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Pinned, scroll-scrubbed chapter: the three steps on the left, a phone on
 * the right whose screen follows them — picks snapping into the roster, the
 * week scrubbing Mon → Fri to a FINAL stamp, your row climbing the table.
 * Native scroll; sticky pins the stage; progress is only read. */
function Chapter() {
  const { reduced, duration, ease } = useLandingMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  const [state, setState] = useState({ step: 0, picks: 0, day: 0, final: false, climb: 0 });

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    const step = Math.min(2, Math.floor(p * 3));
    const sub = Math.max(0, Math.min(1, p * 3 - step));
    const next = {
      step,
      picks: step > 0 ? 12 : Math.round(sub * 12),
      day: step > 1 ? 5 : step === 1 ? Math.min(5, Math.floor(sub * 6)) : 0,
      final: step > 1 || (step === 1 && sub > 0.86),
      climb: step === 2 && sub > 0.4 ? 1 : 0,
    };
    setState((s) =>
      s.step === next.step && s.picks === next.picks && s.day === next.day && s.final === next.final && s.climb === next.climb
        ? s
        : next
    );
  });

  const screens = [
    <DraftScreen key="draft" picks={state.picks} />,
    <CompeteScreen key="compete" day={state.day} final={state.final} />,
    <ClimbScreen key="climb" frame={state.climb} />,
  ];

  return (
    <div className="lp-chapter" ref={trackRef}>
      <div className="lp-chapter__stage">
        <div className="lp-wrap lp-chapter__grid">
          <Steps active={state.step} />
          <Phone className="lp-phone--live">
            {screens.map((screen, i) => (
              <motion.div
                key={i}
                className="lp-phone__layer"
                initial={false}
                animate={{ opacity: state.step === i ? 1 : 0, y: state.step === i ? 0 : i < state.step ? -24 : 24 }}
                transition={reduced ? { duration: 0 } : { duration: duration.base, ease: ease.settle }}
              >
                {screen}
              </motion.div>
            ))}
          </Phone>
        </div>
      </div>
    </div>
  );
}

/** Static version (reduced motion, JS off, short viewports): each step
 * beside its screen's final state. */
function StaticSteps() {
  return (
    <div className="lp-wrap">
      <ol className="lp-steps lp-steps--static">
        {how.steps.map((s, i) => (
          <li key={s.num} className="lp-step lp-step--static">
            <Phone>
              {i === 0 ? <DraftScreen picks={12} /> : i === 1 ? <CompeteScreen day={5} final /> : <ClimbScreen frame={1} />}
            </Phone>
            <div className="lp-step__text">
              <span className="lp-step__num">{s.num}</span>
              <StepTitle i={i} />
              <p className="lp-step__body">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HowItWorks() {
  const enhanced = useEnhanced();
  const roomy = useMediaQuery('(min-height: 640px)') === true;
  return (
    <section className="lp-section lp-how" id="how" aria-labelledby="lp-how-title">
      <div className="lp-wrap">
        <Reveal className="lp-head lp-head--center">
          <p className="lp-kicker">{how.kicker}</p>
          <h2 className="lp-h2" id="lp-how-title">
            {how.title.line1}
            <br />
            {how.title.line2}
            <em>{how.title.em}</em>
          </h2>
          <p className="lp-section-lede">{how.lede}</p>
        </Reveal>
      </div>
      {enhanced && roomy ? <Chapter /> : <StaticSteps />}
    </section>
  );
}

export default HowItWorks;
