import { AnimatePresence, motion } from 'motion/react';
import { ScoreDigits } from '../../design/game/ScoreDigits';
import { TugBar } from '../../design/game/TugBar';
import { Chyron } from '../../design/game/Chyron';
import { formatMoney } from '../../design/lib/money';
import { useLandingMotion } from './hooks';
import { fmtPct } from './Opening';
import {
  BOARD_FRAMES,
  DRAFT_PICKS,
  LEAGUE,
  LINEUPS,
  MATCHUP,
  ROSTER_SLOTS,
  WEEK,
  WEEK_CLOSES,
  boardMoves,
  boardRanked,
} from './sampleData';

// The /01 chapter's phone: three full Game Day app screens (Design Lead,
// round 3 review) — a status bar, the league header, the screen, and the
// app's tab bar with the step's tab active (Draft → League, Compete →
// Matchup, Climb → League). Everything here is an
// illustration (aria-hidden by the Phone frame); the step text beside it
// carries the meaning.

// The app's real IA (DESIGN_DIRECTION §3): Home · Matchup · League ·
// Portfolio. The draft is reached from League, so the Draft step shows League.
export type PhoneTab = 'home' | 'matchup' | 'league' | 'portfolio';

const TABS: ReadonlyArray<{ id: PhoneTab; label: string; d: string }> = [
  { id: 'home', label: 'Home', d: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z' },
  { id: 'matchup', label: 'Matchup', d: 'M4 17 9 11l4 4 7-8M15 7h5v5' },
  { id: 'league', label: 'League', d: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3' },
  { id: 'portfolio', label: 'Portfolio', d: 'M4 20V10M10 20V4M16 20v-8M22 20H2' },
];

function StatusBar() {
  return (
    <div className="lp-os">
      <span className="lp-os__time">9:41</span>
      <span className="lp-os__icons">
        <span className="lp-os__signal">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="lp-os__battery">
          <i />
        </span>
      </span>
    </div>
  );
}

function TabBar({ active }: { active: PhoneTab }) {
  return (
    <nav className="lp-tabs">
      {TABS.map((t) => (
        <span key={t.id} className={t.id === active ? 'lp-tabs__t lp-tabs__t--on' : 'lp-tabs__t'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={t.d} />
          </svg>
          {t.label}
        </span>
      ))}
    </nav>
  );
}

export function PhoneShell({ tab, tag, children }: { tab: PhoneTab; tag: string; children: React.ReactNode }) {
  return (
    <div className="lp-app">
      <StatusBar />
      <div className="lp-app__head">
        <span className="lp-app__league">{LEAGUE}</span>
        <span className="lp-screen__tag">{tag}</span>
      </div>
      <div className="lp-app__body">{children}</div>
      <TabBar active={tab} />
    </div>
  );
}

// ── Draft ────────────────────────────────────────────────────────────────

// The snake, drawn (Giorgio, round 4: it "goes in the right order, then
// jumps to the bottom and goes backwards"). Teams are columns, rounds are
// rows; round 1 runs left → right, round 2 right → left, joined by a
// U-turn. A track runs through every cell in pick order BEHIND the cells —
// visible in the gaps and around the turn — and draws forward as picks
// land; the on-the-clock ring sits on the live pick. Geometry is in the
// phone's fixed 300px design space, so it is exact at every scale.
const SNAKE = (() => {
  const W = 232; // grid width (body 248 minus the turn's margin)
  const gap = 4;
  const col = (W - gap * 5) / 6;
  const row = 42;
  const rowGap = 14;
  const top = 0;
  const cx = (c: number) => c * (col + gap) + col / 2;
  const cy = (r: number) => top + r * (row + rowGap) + row / 2;
  const left = cx(0);
  const right = cx(5);
  const turnX = W + 12;
  const y1 = cy(0);
  const y2 = cy(1);
  const d = `M ${left} ${y1} H ${right} C ${turnX} ${y1} ${turnX} ${y2} ${right} ${y2} H ${left}`;
  const rowLen = right - left;
  const turnLen = (y2 - y1) * 1.45; // cubic bulge ≈ 1.45 × its chord here
  const total = rowLen * 2 + turnLen;
  /** Path-length fraction at pick n's cell centre (1–12). */
  const at = (n: number) => {
    const i = n - 1;
    if (i < 6) return (cx(i) - left) / total;
    const c = 11 - i; // round 2 runs back from the last column
    return (rowLen + turnLen + (right - cx(c))) / total;
  };
  const pos = (n: number) => {
    const i = n - 1;
    return i < 6 ? { x: cx(i), y: y1 } : { x: cx(11 - i), y: y2 };
  };
  return { W, col, row, rowGap, d, at, pos, height: row * 2 + rowGap, turnX };
})();

const TEAMS = ['PM', 'RB', 'AD', 'FT', 'GB', 'AP'];

function SnakeBoard({ picks, done }: { picks: number; done: boolean }) {
  const current = Math.min(picks + 1, 12);
  const drawn = done ? 1 : SNAKE.at(current);
  const ring = SNAKE.pos(current);
  const cell = (n: number) => DRAFT_PICKS[n - 1];
  const rows = [
    [1, 2, 3, 4, 5, 6],
    [12, 11, 10, 9, 8, 7],
  ];
  return (
    <div className="lp-snake">
      <div className="lp-snake__teams">
        {TEAMS.map((t) => (
          <span key={t} className={t === 'RB' ? 'lp-snake__team lp-snake__team--you' : 'lp-snake__team'}>
            {t}
          </span>
        ))}
      </div>
      <div className="lp-snake__labels">
        <span>Round 1 →</span>
      </div>
      <div className="lp-snake__grid" style={{ height: SNAKE.height }}>
        <svg className="lp-snake__track" width={SNAKE.turnX + 4} height={SNAKE.height} aria-hidden="true">
          <path className="lp-snake__path lp-snake__path--all" d={SNAKE.d} pathLength={1} />
          <path className="lp-snake__path lp-snake__path--drawn" d={SNAKE.d} pathLength={1} strokeDasharray={`${drawn.toFixed(4)} 1`} />
          {/* The turn's arrowhead, pointing into round 2. */}
          <path className="lp-snake__arrow" d={`M ${SNAKE.turnX - 7} ${SNAKE.height - SNAKE.row / 2 - 5} l -6 5 l 6 5`} />
        </svg>
        {rows.map((r, ri) =>
          r.map((n, ci) => {
            const p = cell(n);
            const taken = n <= picks;
            const live = !done && n === current;
            return (
              <div
                key={n}
                className={['lp-pick', taken ? 'lp-pick--taken' : '', p.you ? 'lp-pick--you' : '', live ? 'lp-pick--now' : '']
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: ci * (SNAKE.col + 4),
                  top: ri * (SNAKE.row + SNAKE.rowGap),
                  width: SNAKE.col,
                  height: SNAKE.row,
                }}
              >
                <span className="lp-pick__n">{n}</span>
                <span className="lp-pick__t">{taken ? p.t : ''}</span>
              </div>
            );
          })
        )}
        {!done && (
          <span
            className="lp-snake__ring"
            aria-hidden="true"
            style={{ transform: `translate(${ring.x - 24}px, ${ring.y - 24}px)` }}
          />
        )}
      </div>
      <div className="lp-snake__labels lp-snake__labels--end">
        <span>← Round 2</span>
      </div>
    </div>
  );
}

/** `picks` = how many of the 12 shown picks are in (0–12); `clock` = how
 * far the current pick's clock has run (0–1). */
export function DraftScreen({ picks, clock }: { picks: number; clock: number }) {
  const { reduced, duration, ease } = useLandingMotion();
  const current = DRAFT_PICKS[Math.min(picks, DRAFT_PICKS.length - 1)];
  const done = picks >= DRAFT_PICKS.length;
  const yourTurn = !done && current.you;
  const mine = DRAFT_PICKS.filter((p) => p.you && p.pick <= picks).map((p) => p.t);
  const seconds = Math.max(0, Math.round(60 * (1 - clock)));
  const clockText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <PhoneShell tab="league" tag={done ? 'Round 3 next' : `Round ${picks < 6 ? 1 : 2}`}>
      <div className="lp-clock">
        <svg className="lp-clock__ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle className="lp-clock__track" cx="22" cy="22" r="19" />
          <circle
            className={done ? 'lp-clock__arc lp-clock__arc--done' : yourTurn ? 'lp-clock__arc lp-clock__arc--you' : 'lp-clock__arc'}
            cx="22"
            cy="22"
            r="19"
            pathLength={1}
            strokeDasharray={`${(done ? 1 : 1 - clock).toFixed(3)} 1`}
          />
        </svg>
        <span className="lp-clock__txt">
          <span className="lp-clock__who">{done ? 'Picks in' : yourTurn ? 'You’re on the clock' : 'On the clock'}</span>
          <span className="lp-clock__sub">
            {done ? `${mine.length} of 6 roster spots filled` : `Pick ${current.pick} · ${current.player} · ${clockText}`}
          </span>
        </span>
      </div>
      <SnakeBoard picks={picks} done={done} />
      <div className="lp-roster">
        <span className="lp-screen__muted">Your roster</span>
        <div className="lp-roster__slots">
          {ROSTER_SLOTS.map((slot, i) => {
            const t = mine[i];
            return (
              <span key={slot} className={t ? 'lp-roster__slot lp-roster__slot--filled' : 'lp-roster__slot'}>
                <AnimatePresence initial={false} mode="popLayout">
                  {t ? (
                    <motion.span
                      key={t}
                      className="lp-roster__chip"
                      initial={reduced ? false : { scale: 0.6, opacity: 0, y: -22 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      transition={{ duration: duration.base, ease: ease.settle }}
                    >
                      {t}
                    </motion.span>
                  ) : (
                    <span key="empty" className="lp-roster__empty">
                      {slot}
                    </span>
                  )}
                </AnimatePresence>
              </span>
            );
          })}
        </div>
      </div>
    </PhoneShell>
  );
}

// ── Compete ──────────────────────────────────────────────────────────────

const LEAD_CHANGE_DAY = WEEK_CLOSES.findIndex((d, i) => i > 0 && d.you > d.opp && WEEK_CLOSES[i - 1].you <= WEEK_CLOSES[i - 1].opp);

export function CompeteScreen({ day, final }: { day: number; final: boolean }) {
  const { reduced, duration, ease } = useLandingMotion();
  const d = WEEK_CLOSES[day];
  const lead = d.you - d.opp;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const reached = day === 0 ? 0 : days.indexOf(d.day) + 1;
  const tag = day === 0 ? 'Mon open' : final ? 'Final' : `${d.day} close`;
  // The chyron calls the lead change while the week is still live.
  const chyron = !final && day >= LEAD_CHANGE_DAY ? LINEUPS.leadChangeCall : null;
  const line = (side: 'you' | 'opp') =>
    LINEUPS[side].map((h) => ({ t: h.t, v: (side === 'you' ? d.you : d.opp) * h.w }));
  return (
    <PhoneShell tab="matchup" tag={`Week ${WEEK} · ${tag}`}>
      <div className="lp-compete__names">
        <span className="lp-compete__name lp-compete__name--you">{MATCHUP.you.name}</span>
        <span className="lp-compete__name lp-compete__name--opp">{MATCHUP.opp.name}</span>
      </div>
      <div className="lp-compete__scores">
        <ScoreDigits value={formatMoney(d.you, { sign: 'always' })} className="lp-roll lp-roll--md" />
        <ScoreDigits value={formatMoney(d.opp, { sign: 'always' })} className="lp-roll lp-roll--md" />
      </div>
      <TugBar you={d.you} opponent={d.opp} youLabel={MATCHUP.you.name} opponentLabel={MATCHUP.opp.name} />
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
      <Chyron message={chyron} onDismiss={() => undefined} className="lp-compete__chyron" />
      <div className="lp-lineups">
        {(['you', 'opp'] as const).map((side) => (
          <ul key={side} className="lp-lineup">
            {line(side).map((h) => (
              <li key={h.t} className="lp-lineup__row">
                <span className="lp-lineup__t">{h.t}</span>
                <span
                  className={
                    Math.round(h.v * 100) === 0 ? 'lp-lineup__v' : h.v > 0 ? 'lp-lineup__v lp-lineup__v--gain' : 'lp-lineup__v lp-lineup__v--loss'
                  }
                >
                  {formatMoney(h.v, { sign: 'always' })}
                </span>
              </li>
            ))}
          </ul>
        ))}
      </div>
      <div className="lp-days">
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
            animate={{ opacity: 1, scale: 1, rotate: reduced ? 0 : -8 }}
            exit={{ opacity: 0 }}
            transition={{ duration: duration.slow, ease: ease.settle }}
          >
            Final
          </motion.span>
        )}
      </AnimatePresence>
    </PhoneShell>
  );
}

// ── Climb ────────────────────────────────────────────────────────────────

/** Week 6's final table climbing out of the live one: the same six players
 * and numbers as the /02 board (its first frame → its FINAL frame). */
export function ClimbScreen({ final }: { final: boolean }) {
  const { reduced, duration, ease } = useLandingMotion();
  const frame = final ? BOARD_FRAMES.length - 1 : 0;
  const rows = boardRanked(frame);
  const moves = final ? boardMoves(BOARD_FRAMES.length - 1, 0) : {};
  return (
    <PhoneShell tab="league" tag="Standings">
      <div className={final ? 'lp-banner lp-banner--final' : 'lp-banner'}>
        <span className="lp-banner__dot" aria-hidden="true" />
        Week {WEEK} · {final ? 'Final' : 'Live'}
      </div>
      <ol className="lp-climb">
        {rows.map((r) => {
          const m = moves[r.id];
          return (
            <motion.li
              key={r.id}
              layout={reduced ? false : 'position'}
              transition={{ layout: { duration: duration.slow, ease: ease.settle } }}
              className={r.you ? 'lp-climb__row lp-climb__row--you' : 'lp-climb__row'}
            >
              <span className="lp-climb__rank">{r.rank}</span>
              <span className="lp-climb__name">{r.name}</span>
              <span className="lp-climb__delta">
                {m ? <span className={m > 0 ? 'lp-badge lp-badge--up' : 'lp-badge lp-badge--down'}>{m > 0 ? `▲ ${m}` : `▼ ${-m}`}</span> : null}
              </span>
              <span className="lp-climb__rec">{r.rec}</span>
              <span className={r.pct >= 0 ? 'lp-climb__pct lp-climb__pct--gain' : 'lp-climb__pct lp-climb__pct--loss'}>{fmtPct(r.pct)}</span>
            </motion.li>
          );
        })}
      </ol>
    </PhoneShell>
  );
}
