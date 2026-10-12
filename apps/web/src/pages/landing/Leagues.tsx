import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Chyron } from '../../design/game/Chyron';
import { ScoreDigits } from '../../design/game/ScoreDigits';
import { leagues } from './copy';
import { FullSlot } from './FullSlot';
import { fmtPct } from './Opening';
import { useEnhanced, useFinePointer, useInView, useLandingMotion, useLoop, usePageVisible, useTilt } from './hooks';
import { BOARD_FRAMES, LEAGUE, WEEK, WEEKS, boardMoves, boardRanked } from './sampleData';
import { Layer, Reveal } from './scroll';

/** Board pacing: how long each live frame is up, and how long the Friday
 * FINAL holds before the week restarts. Content pacing, not animation. */
const BOARD_TICK_MS = 4200;
const BOARD_FINAL_MS = 7000;

/** The Stock Scudetto board, live. While on screen it ticks through the
 * sample week: rows re-order with FLIP moves, movers flash and wear a
 * ▲/▼ rank-change badge, a chyron names the move, and Friday's close locks
 * the week (FINAL) with records updated — then the week restarts. It stops
 * off-screen or when the tab is hidden and holds on hover and focus.
 * Reduced motion / JS off: the board sits at its first frame, unmoving. */
function Board({ onFrame }: { onFrame: (frame: number) => void }) {
  const enhanced = useEnhanced();
  const fine = useFinePointer();
  const { reduced, duration, ease } = useLandingMotion();
  const boardRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  useTilt(tiltRef, enhanced && fine);
  const inView = useInView(boardRef, { threshold: 0.35 });
  const visible = usePageVisible();
  const [held, setHeld] = useState(false);
  const frame = useLoop(BOARD_FRAMES.length, BOARD_TICK_MS, enhanced && inView === true && visible && !held, BOARD_FINAL_MS);
  useEffect(() => onFrame(frame), [frame, onFrame]);

  // Rank changes relative to the previous frame (badges, flashes). The
  // frames are fixed data, so this is a pure function of `frame`; frame 0
  // (the restart after FINAL) names no moves.
  const rows = boardRanked(frame);
  const moves = boardMoves(frame);

  const f = BOARD_FRAMES[frame];
  return (
    <div
      ref={boardRef}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div ref={tiltRef} className="lp-tilt">
        <div className="lp-board-card">
          <div className="lp-board-card__head">
            <div>
              <div className="lp-board-card__ttl">{LEAGUE}</div>
              <div className="lp-board-card__meta">
                Standings · Week {WEEK} of {WEEKS}
              </div>
            </div>
            <span className={f.final ? 'lp-live lp-live--final' : 'lp-live'}>
              <span className="lp-live__dot" aria-hidden="true" />
              {f.final ? 'Final' : 'Live'}
            </span>
          </div>
          {/* Focusable once (not per row) so keyboard users can hold the
              board still, the same as hovering it. */}
          <ol className="lp-srows" tabIndex={0} aria-label={`${LEAGUE} standings, sample`}>
            {rows.map((r) => {
              const moved = moves[r.id];
              return (
                <motion.li
                  key={r.id}
                  layout={reduced ? false : 'position'}
                  transition={{ layout: { duration: duration.slow, ease: ease.settle } }}
                  className={r.you ? 'lp-srow lp-srow--you' : 'lp-srow'}
                >
                  {moved ? <span key={`${frame}-flash`} className="lp-srow__flash" aria-hidden="true" /> : null}
                  <span className={r.rank <= 3 ? `lp-srow__rank lp-srow__rank--${r.rank}` : 'lp-srow__rank'}>{r.rank}</span>
                  <span className="lp-srow__player">
                    <span className={r.you ? 'lp-avatar lp-avatar--you' : 'lp-avatar'} aria-hidden="true">
                      {r.init}
                    </span>
                    <span className="lp-srow__name">
                      {r.name}
                      {r.you && <span className="lp-srow__you"> (you)</span>}
                    </span>
                  </span>
                  <span className="lp-srow__badge">
                    {moved ? (
                      <span key={`${frame}-badge`} className={moved > 0 ? 'lp-badge lp-badge--up' : 'lp-badge lp-badge--down'}>
                        {moved > 0 ? '▲' : '▼'} {Math.abs(moved)}
                      </span>
                    ) : null}
                  </span>
                  <span className="lp-srow__rec">{r.rec}</span>
                  <ScoreDigits value={fmtPct(r.pct)} className={r.pct >= 0 ? 'lp-roll lp-roll--pct lp-roll--gain' : 'lp-roll lp-roll--pct lp-roll--loss'} />
                </motion.li>
              );
            })}
          </ol>
          <Chyron message={frame === 0 ? null : (f.chyron ?? null)} onDismiss={() => undefined} className="lp-board-card__chyron" />
        </div>
      </div>
    </div>
  );
}

export function Leagues() {
  // The board's live frame, shared with the FULL arena behind it.
  const [frame, setFrame] = useState(0);
  const boardSlot = useRef<HTMLDivElement>(null);
  return (
    <Layer tone="dark" id="leagues" className="lp-leagues" labelledBy="lp-leagues-title">
      <FullSlot name="leagues" frame={frame} board={boardSlot} />
      <div className="lp-wrap lp-leagues__grid">
        <div className="lp-leagues__copy">
          <Reveal>
            <p className="lp-kicker">{leagues.kicker}</p>
            <h2 className="lp-h2" id="lp-leagues-title">
              {leagues.title.text}
              <em>{leagues.title.em}</em>
            </h2>
          </Reveal>
          <p className="lp-section-lede">{leagues.lede}</p>
          <ul className="lp-bullets">
            {leagues.bullets.map((b) => (
              <li key={b}>
                <span className="lp-bullets__arr" aria-hidden="true">
                  →
                </span>{' '}
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div ref={boardSlot}>
          <Board onFrame={setFrame} />
        </div>
      </div>
    </Layer>
  );
}

export default Leagues;
