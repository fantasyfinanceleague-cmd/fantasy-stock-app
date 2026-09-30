import { useRef, useState } from 'react';
import { useMotionValueEvent, useScroll, useSpring } from 'motion/react';
import { how } from './copy';
import { FullSlot } from './FullSlot';
import { useEnhanced, useMediaQuery } from './hooks';
import { ChapterScreens, ClimbScreen, CompeteScreen, DraftScreen, Phone } from './PhoneScreens';
import { Layer, Reveal } from './scroll';
import { CHAPTER_BEATS, chapterStateAt } from './pacing';

/** ≈ ScrollTrigger `scrub: 0.8` — a critically-damped trail. */
const SCRUB_SPRING = { stiffness: 90, damping: 24, mass: 1, restDelta: 0.0002 };

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
  const trackRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  // The stage's arrival (the chapter's top from the viewport bottom to the
  // top): the FULL device dives in over it.
  const { scrollYProgress: arrive } = useScroll({ target: trackRef, offset: ['start end', 'start start'] });
  const [state, setState] = useState(() => chapterStateAt(0));

  // Scrub smoothing (Design Lead: ≈ ScrollTrigger scrub 0.8): the chapter
  // follows a spring that trails the scroll position, so a flick glides
  // through the beats instead of skipping them. A filter, not an animation
  // duration — it has no length of its own.
  const smooth = useSpring(scrollYProgress, SCRUB_SPRING);
  useMotionValueEvent(smooth, 'change', (p) => {
    const next = chapterStateAt(p);
    setState((s) =>
      s.step === next.step &&
      s.picks === next.picks &&
      s.clock === next.clock &&
      s.day === next.day &&
      s.final === next.final &&
      s.climb === next.climb
        ? s
        : next
    );
  });

  return (
    <div className="lp-chapter" ref={trackRef} style={{ height: `calc(${CHAPTER_BEATS.total}svh + 100svh)` }}>
      <div className="lp-chapter__stage">
        {/* FULL: the 3D device dives in and takes over the phone slot. */}
        <FullSlot name="chapter" slot={phoneRef} state={state} arrive={arrive} />
        <div className="lp-wrap lp-chapter__grid">
          <Steps active={state.step} />
          <div ref={phoneRef} className="lp-chapter__slot">
            <Phone className="lp-phone--live">
              <ChapterScreens state={state} />
            </Phone>
          </div>
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
              {i === 0 ? <DraftScreen picks={12} clock={0} /> : i === 1 ? <CompeteScreen day={5} final /> : <ClimbScreen final />}
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
    <Layer tone="light" id="how" labelledBy="lp-how-title" className="lp-how">
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
    </Layer>
  );
}

export default HowItWorks;
