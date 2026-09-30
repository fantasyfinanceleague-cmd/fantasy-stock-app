/**
 * homePhase: the ONE function that decides which of Home's ten states to
 * render (Phase 3b-2 spec: "Nothing on Home guesses the phase on its own").
 *
 * Every caller (Home, and later the Home dev fixture) reads the phase from
 * here — never from getSeasonPhase alone, a market-hours weekday rule, or
 * an inline clock check. The rules are evaluated top-down; the first match
 * wins. See docs/superpowers/plans/2026-09-29-mobile-home-3b2.md ("homePhase")
 * for the state table this implements.
 */

export type MarketStatus = 'open' | 'closed' | 'unknown';

/** market_session_status()'s row, trimmed to what homePhase reads. */
export interface MarketInfo {
  status: MarketStatus;
  /** 'regular_session' | 'pre_market' | 'after_hours' | 'weekend' | 'holiday' | 'no_coverage' */
  reason: string;
  /** ISO/parseable timestamp, set whenever status != 'open'. Null under
   * 'unknown' (no_coverage) — never invent a resume time. */
  nextOpenAt: string | null;
}

export interface HomeLeagueInput {
  draftStatus: 'not_started' | 'in_progress' | 'completed';
  leagueStartDate: string | null;
  seasonStatus: 'active' | 'playoffs' | 'completed';
  currentWeek: number;
  numWeeks: number | null;
  playoffTeams: number | null;
}

export interface MatchupRow {
  week: number;
  weekStart: string; // ISO
  weekEnd: string; // ISO
  isPlayoff: boolean;
  /** The caller's own gain for this row; null = not scored yet. */
  myGain: number | null;
  /** The opponent's gain; null = not scored yet. Also null when there is
   * genuinely no opponent (see hasOpponent). */
  opponentGain: number | null;
  /** False for a bye (no team on the other side) — distinct from "not
   * scored yet", which still has an opponent. */
  hasOpponent: boolean;
}

export interface HomePhaseInput {
  league: HomeLeagueInput;
  /** The matchup row for `league.currentWeek`, or null if none exists yet
   * (e.g. pre-season, or the schedule hasn't reached this far). */
  current: MatchupRow | null;
  /** The matchup row for `league.currentWeek - 1` — read on the weekend
   * after `current_week` has already advanced past a just-scored week
   * (spec F5: "process-week-results advances current_week on Friday once
   * scoring succeeds"). */
  previous: MatchupRow | null;
  /** The REAL week_number of my next scheduled playoff row (a bye into
   * that round), or null — used only when `current`/`previous` show no
   * row for this week during playoffs. Never arithmetic (playoff weeks
   * can skip numbers and rounds vary in length) — read straight from
   * `matchups` by the caller. */
  laterPlayoffWeek: number | null;
  /** True when I lost my most recent playoff game and have no later row —
   * "eliminated" rather than "missed" (never reachable pre-playoffs). */
  lastPlayoffLoss: boolean;
  /** The REAL week_number of that last (lost) playoff row, for the round
   * label — null unless `lastPlayoffLoss` is true. */
  lastPlayoffWeek: number | null;
  /** get_draft_order: true while the order isn't set/revealed yet. */
  draftOrderWaiting: boolean;
  now: Date;
  market: MarketInfo;
}

interface BaseResult {
  numWeeks: number | null;
}

export type PhaseResult =
  | ({ kind: 'complete' } & BaseResult)
  | ({ kind: 'pre_draft'; waiting: boolean } & BaseResult)
  | ({ kind: 'drafting' } & BaseResult)
  | ({ kind: 'pre_season' } & BaseResult)
  | ({ kind: 'scoring'; week: number; isPlayoff: boolean; round: string | null; weekEnd: string } & BaseResult)
  | ({ kind: 'scored'; week: number; won: boolean | null; isPlayoff: boolean; round: string | null; nextStart: string | null } & BaseResult)
  | ({ kind: 'bye'; week: number; nextStart: string | null } & BaseResult)
  | ({ kind: 'playoff_bye'; week: number; round: string | null } & BaseResult)
  | ({ kind: 'eliminated'; round: string | null } & BaseResult)
  /** Playoffs are on, but I was never seeded into the bracket at all — no
   * playoff row EVER (not a bye-to-later-round, not a scored loss). Found
   * by the code review (2026-09-29): without this branch, a team that
   * didn't make the playoffs fell through to `pre_season`, which reads
   * as "the season hasn't started" — actively wrong mid-playoffs. */
  | ({ kind: 'missed_playoffs' } & BaseResult)
  | ({ kind: 'live_open'; week: number; isPlayoff: boolean; round: string | null; weekEnd: string } & BaseResult)
  | ({ kind: 'live_closed'; week: number; isPlayoff: boolean; round: string | null; reason: string; resumesAt: string | null; weekEnd: string } & BaseResult);

function isBetween(now: Date, startIso: string, endIso: string): boolean {
  const t = now.getTime();
  return t >= new Date(startIso).getTime() && t < new Date(endIso).getTime();
}

function bothScored(row: MatchupRow): boolean {
  return row.myGain !== null && (row.opponentGain !== null || !row.hasOpponent);
}

function roundLabelForWeek(
  playoffRoundLabelForWeek: (week: number | null | undefined, numWeeks: number | null | undefined, playoffTeams: number | null | undefined) => string | null,
  week: number,
  numWeeks: number | null,
  playoffTeams: number | null,
): string | null {
  return playoffRoundLabelForWeek(week, numWeeks, playoffTeams);
}

/**
 * `playoffRoundLabelForWeek` is injected rather than imported directly so
 * this module stays free of a hard dependency on lib/playoffs.ts's own
 * import graph — the deno test imports both and passes the real one, and
 * that's the only caller that matters (Home does the same).
 */
export function homePhase(
  input: HomePhaseInput,
  playoffRoundLabelForWeek: (week: number | null | undefined, numWeeks: number | null | undefined, playoffTeams: number | null | undefined) => string | null,
): PhaseResult {
  const { league, current, previous, laterPlayoffWeek, lastPlayoffLoss, lastPlayoffWeek, draftOrderWaiting, now, market } = input;
  const numWeeks = league.numWeeks;
  const base: BaseResult = { numWeeks };

  // 8. Season complete.
  if (league.seasonStatus === 'completed') {
    return { kind: 'complete', ...base };
  }
  // 6/7. Draft not started / in progress.
  if (league.draftStatus === 'not_started') {
    return { kind: 'pre_draft', waiting: draftOrderWaiting, ...base };
  }
  if (league.draftStatus === 'in_progress') {
    return { kind: 'drafting', ...base };
  }
  // 5. Draft done, but the season hasn't started yet.
  if (league.leagueStartDate && new Date(league.leagueStartDate).getTime() > now.getTime()) {
    return { kind: 'pre_season', ...base };
  }

  const isPlayoffs = league.seasonStatus === 'playoffs';

  // Which row is "the one in play" right now.
  //
  // `current` (the row for league.current_week) is used once it has
  // started. Before it starts, the honest phase is either:
  //   - the just-concluded PREVIOUS week, still shown as scored, during the
  //     Fri-close -> next-open grace period (F5: current_week already
  //     advanced once scoring succeeded, so `current` points at an
  //     unstarted future row while the caller is still looking at last
  //     week's result); or
  //   - pre_season, when there is nothing before it to show instead (week
  //     1 itself, before Monday's open).
  // `current === null` (no row at all for this week) skips this block
  // entirely and falls through to the "no row this week" handling below,
  // which is where playoffs bye/eliminated live — a null current must
  // NEVER be papered over with `previous`, or an eliminated team's last
  // (scored) playoff loss would keep reading as "scored" forever instead
  // of "eliminated".
  let row: MatchupRow | null = null;
  if (current) {
    const started = now.getTime() >= new Date(current.weekStart).getTime();
    if (started) {
      row = current;
    } else if (previous && bothScored(previous)) {
      row = previous;
    } else {
      return { kind: 'pre_season', ...base };
    }
  }

  if (row) {
    const round = roundLabelForWeek(playoffRoundLabelForWeek, row.week, numWeeks, league.playoffTeams);
    const ended = now.getTime() >= new Date(row.weekEnd).getTime();

    if (ended) {
      if (!bothScored(row)) {
        return { kind: 'scoring', week: row.week, isPlayoff: row.isPlayoff, round, weekEnd: row.weekEnd, ...base };
      }
      // Both sides are in (or there was never an opponent to wait on).
      const won = row.hasOpponent ? (row.myGain ?? 0) > (row.opponentGain ?? 0) : null;
      // nextStart: the OTHER row's start (whichever of current/previous is
      // not `row`), so a holiday-shifted Monday reads from real data, never
      // a weekday rule.
      const other = row === current ? null : current;
      const nextStart = other ? other.weekStart : null;
      if (now.getTime() < (nextStart ? new Date(nextStart).getTime() : Infinity)) {
        return { kind: 'scored', week: row.week, won, isPlayoff: row.isPlayoff, round, nextStart, ...base };
      }
      // Fall through: nothing starts after `row` and we're past its end —
      // treat as scored with an unknown next start rather than crash.
      return { kind: 'scored', week: row.week, won, isPlayoff: row.isPlayoff, round, nextStart: null, ...base };
    }

    // Row is live (weekStart <= now < weekEnd).
    if (!row.hasOpponent) {
      // A true bye seed never has a row for the round it's skipping (the
      // bracket writes it straight into its later round instead) — a row
      // AT the current week with no opponent means the OTHER bracket path
      // hasn't been decided yet, not a bye (Design Lead ruling,
      // 2026-09-30: "A NULL opponent in the current week means waiting on
      // the previous round's winner ... it isn't a bye"). No fixture or
      // design exists yet for that narrow case, so it falls through to
      // the plain bye copy below rather than guessing a new state.
      const nextStart = current && current !== row ? current.weekStart : null;
      return { kind: 'bye', week: row.week, nextStart, ...base };
    }
    if (market.status === 'open') {
      return { kind: 'live_open', week: row.week, isPlayoff: row.isPlayoff, round, weekEnd: row.weekEnd, ...base };
    }
    return {
      kind: 'live_closed',
      week: row.week,
      isPlayoff: row.isPlayoff,
      round,
      reason: market.reason,
      resumesAt: market.status === 'unknown' ? null : market.nextOpenAt,
      weekEnd: row.weekEnd,
      ...base,
    };
  }

  // No row at all this week (playoffs with no matchup scheduled for me —
  // bye-to-a-later-round or eliminated — or a genuinely empty schedule).
  if (isPlayoffs) {
    if (laterPlayoffWeek != null) {
      const round = roundLabelForWeek(playoffRoundLabelForWeek, laterPlayoffWeek, numWeeks, league.playoffTeams);
      return { kind: 'playoff_bye', week: laterPlayoffWeek, round, ...base };
    }
    if (lastPlayoffLoss && lastPlayoffWeek != null) {
      const round = roundLabelForWeek(playoffRoundLabelForWeek, lastPlayoffWeek, numWeeks, league.playoffTeams);
      return { kind: 'eliminated', round, ...base };
    }
    // Playoffs are on, no row for me now, no later row, and no scored
    // loss to point to: I was never in the bracket.
    return { kind: 'missed_playoffs', ...base };
  }
  // Regular season, no row, market otherwise irrelevant: pre-season is the
  // only honest default left (a schedule that hasn't been generated yet).
  return { kind: 'pre_season', ...base };
}
