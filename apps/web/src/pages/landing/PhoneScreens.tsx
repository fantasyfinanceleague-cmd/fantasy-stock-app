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
// round 3 review) — a status bar, the league header, the screen, and a tab
// bar whose active tab is the step being shown. Everything here is an
// illustration (aria-hidden by the Phone frame); the step text beside it
// carries the meaning.

export type PhoneTab = 'home' | 'draft' | 'matchup' | 'league';

const TABS: ReadonlyArray<{ id: PhoneTab; label: string; d: string }> = [
  { id: 'home', label: 'Home', d: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z' },
  { id: 'draft', label: 'Draft', d: 'M5 5h14v4H5zM5 11h6v8H5zM13 11h6v8h-6z' },
  { id: 'matchup', label: 'Matchup', d: 'M4 17 9 11l4 4 7-8M15 7h5v5' },
  { id: 'league', label: 'League', d: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3' },
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

/** `picks` = how many of the 12 shown picks are in (0–12); `clock` = how
 * far the current pick's clock has run (0–1). */
export function DraftScreen({ picks, clock }: { picks: number; clock: number }) {
  const { reduced, duration, ease } = useLandingMotion();
  const rows = [DRAFT_PICKS.slice(0, 6), DRAFT_PICKS.slice(6, 12).reverse()];
  const current = DRAFT_PICKS[Math.min(picks, DRAFT_PICKS.length - 1)];
  const done = picks >= DRAFT_PICKS.length;
  const yourTurn = !done && current.you;
  const mine = DRAFT_PICKS.filter((p) => p.you && p.pick <= picks).map((p) => p.t);
  const seconds = Math.max(0, Math.round(60 * (1 - clock)));
  const clockText = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <PhoneShell tab="draft" tag={done ? 'Round 3 next' : `Round ${picks < 6 ? 1 : 2}`}>
      <div className="lp-clock">
        <svg className="lp-clock__ring" viewBox="0 0 44 44" aria-hidden="true">
          <circle className="lp-clock__track" cx="22" cy="22" r="19" />
          <circle
            className={yourTurn ? 'lp-clock__arc lp-clock__arc--you' : 'lp-clock__arc'}
            cx="22"
            cy="22"
            r="19"
            pathLength={1}
            strokeDasharray={`${(done ? 0 : 1 - clock).toFixed(3)} 1`}
          />
        </svg>
        <span className="lp-clock__txt">
          <span className="lp-clock__who">{done ? 'Picks in' : yourTurn ? 'You’re on the clock' : 'On the clock'}</span>
          <span className="lp-clock__sub">
            {done ? `${mine.length} of 6 roster spots filled` : `Pick ${current.pick} · ${current.player} · ${clockText}`}
          </span>
        </span>
      </div>
      <div className="lp-draft">
        {rows.map((row, r) => (
          <div key={r} className="lp-draft__row">
            {row.map((p) => {
              const taken = p.pick <= picks;
              const now = !done && p.pick === current.pick;
              return (
                <div
                  key={p.pick}
                  className={['lp-pick', taken ? 'lp-pick--taken' : '', p.you ? 'lp-pick--you' : '', now ? 'lp-pick--now' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <span className="lp-pick__n">
                    {p.pick} · {p.player.split(' ')[0]}
                  </span>
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
