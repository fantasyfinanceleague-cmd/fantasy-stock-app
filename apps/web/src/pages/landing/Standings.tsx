import { useEffect, useRef, useState } from 'react';
import { motion, useAnimate, stagger } from 'motion/react';
import { Surface } from '../../design/Surface';
import { Text } from '../../design/Text';
import { Money } from '../../design/Money';
import { Chyron } from '../../design/game/Chyron';
import { useInView, useLandingMotion, usePageVisible } from './hooks';
import { HERO, LEAGUE_NAME, STANDINGS_ROWS, STANDINGS_SNAPSHOTS } from './sampleData';

/** ~6s between lead changes, per phase3a-landing.md §4. Content pacing (how
 * long a reader gets with each board), not an animation duration. */
const RESORT_INTERVAL_MS = 6000;
/** Stagger per DESIGN_DIRECTION §4 Lists: 30 milliseconds apart, max 8 items. */
const STAGGER_S = 0.03;

function ranked(snapshotIndex: number) {
  const { gains } = STANDINGS_SNAPSHOTS[snapshotIndex];
  return [...STANDINGS_ROWS].sort((a, b) => gains[b.id] - gains[a.id]).map((row) => ({ ...row, gain: gains[row.id] }));
}

/** Section 4's live board. Rows stagger in once on first view (transform
 * only, from a visible resting state), then the board re-sorts on a lead
 * change every ~6s while it is on screen — stopping when it scrolls away or
 * the tab is hidden, and holding while hovered or focused. Reduced motion:
 * rows simply sit there, no stagger and no automatic re-sort. */
function Board() {
  const { hydrated, reduced, duration, ease } = useLandingMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const [scope, animate] = useAnimate<HTMLOListElement>();
  const inView = useInView(boardRef, { threshold: 0.35 });
  const pageVisible = usePageVisible();
  const [held, setHeld] = useState(false);
  const [snapshot, setSnapshot] = useState(0);
  const snapshotRef = useRef(0);
  const [chyron, setChyron] = useState<string | null>(null);
  const staggerState = useRef<'idle' | 'armed' | 'done'>('idle');

  // Stagger-in, once. Rows are offset while still off screen (so nothing
  // visible jumps), then settle when the board arrives. They never hide.
  useEffect(() => {
    if (!hydrated || reduced || staggerState.current === 'done') return;
    const rows = scope.current?.querySelectorAll('li');
    if (!rows?.length) return;
    if (staggerState.current === 'idle' && inView === false) {
      staggerState.current = 'armed';
      animate(rows, { y: 12 }, { duration: 0 });
    } else if (staggerState.current === 'armed' && inView) {
      staggerState.current = 'done';
      animate(rows, { y: 0 }, { duration: duration.base, ease: ease.settle, delay: stagger(STAGGER_S) });
    } else if (staggerState.current === 'idle' && inView) {
      staggerState.current = 'done';
    }
  }, [hydrated, reduced, inView, animate, scope, duration.base, ease.settle]);

  const running = hydrated && !reduced && inView === true && pageVisible && !held;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      const next = (snapshotRef.current + 1) % STANDINGS_SNAPSHOTS.length;
      snapshotRef.current = next;
      setSnapshot(next);
      setChyron(STANDINGS_SNAPSHOTS[next].chyron ?? null);
    }, RESORT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [running]);

  const rows = ranked(snapshot);
  return (
    <div
      ref={boardRef}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <Surface kind="game" className="lp-standings">
        <div className="lp-standings__header">
          <Text variant="tag" tone="secondary">
            {LEAGUE_NAME} · Week {HERO.week}
          </Text>
          <Text variant="caption" tone="secondary">
            Ranked by this week’s gain
          </Text>
        </div>
        {/* Focusable once (not per row) so keyboard users can hold the
            board still, the same as hovering it. */}
        <ol className="lp-standings__rows" ref={scope} tabIndex={0} aria-label="Sample league board, ranked by this week’s gain">
          {rows.map((row, i) => (
            <motion.li
              key={row.id}
              layout={reduced ? false : 'position'}
              transition={{ layout: { duration: duration.base, ease: ease.settle } }}
              className={row.you ? 'lp-row lp-row--you' : 'lp-row'}
            >
              <span className="lp-row__rank">{i + 1}</span>
              <span className="lp-row__name">
                {row.name}
                {row.you && <span className="sp-visually-hidden"> (your team)</span>}
              </span>
              <span className="lp-row__record">{row.record}</span>
              <Money value={row.gain} sign="always" size="headline" className="lp-row__gain" />
            </motion.li>
          ))}
        </ol>
        <Chyron message={chyron} onDismiss={() => setChyron(null)} className="lp-standings__chyron" />
      </Surface>
    </div>
  );
}

export function Standings() {
  return (
    <section className="lp-section lp-leagues" id="leagues" aria-labelledby="lp-leagues-title">
      <div className="lp-wrap lp-leagues__grid">
        <div className="lp-leagues__copy">
          <h2 className="lp-h2" id="lp-leagues-title">
            Leagues in action
          </h2>
          <p className="lp-section-lede">
            Play in a league of friends. Every week you face one of them, and every result moves the standings. During the
            week, the board updates as prices move.
          </p>
          <p className="lp-note">Sample league. Names and numbers are illustrative.</p>
        </div>
        <Board />
      </div>
    </section>
  );
}

export default Standings;
