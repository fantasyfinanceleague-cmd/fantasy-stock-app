/**
 * Pure end-of-regular-season decisions for process-week-results.
 *
 * Same hermetic pattern as ./grouping.ts and ./scoring-eligibility.ts: no DB, no
 * Deno APIs, so the decisions are unit-tested in season-transition.test.ts.
 *
 * RANKING HAS ONE SOURCE: the SQL function public.league_standings_ranked
 * (20261011000000). Seeds and the podium are read from it, never re-sorted here.
 * The old generatePlayoffs sliced standings to the playoff count BEFORE its
 * head-to-head tiebreak (so a tied manager could be cut before H2H ran) and used
 * a non-transitive pairwise comparator for 3+ ties. Both are gone with it.
 *
 * REFUSE, DON'T FALL BACK. supabase-js resolves `.rpc()` to { data, error } and
 * does not throw (CLAUDE.md "Success signals" #5), so every read is checked here
 * and a bad read becomes a refusal. There is deliberately no fallback to an
 * unranked list: a wrong seed is silent and permanent once the bracket exists,
 * whereas a refusal is retried by the heal pass (needsRegularSeasonTransition)
 * on the next run, because the caller refuses BEFORE writing anything.
 */

import {
  isValidPlayoffTeams,
  planBracket,
  playoffRoundCode,
  playoffShape,
  type PlayoffRoundCode,
  type SlotSource,
} from '../_shared/playoff-bracket.ts';

export interface RankedStanding {
  user_id: string;
  rank: number;
}

/** The shape supabase-js resolves an rpc call to. */
export interface RpcResult {
  data: unknown;
  error: { message?: string } | null;
}

export type Refusal = { ok: false; reason: string };

const refuse = (why: string): Refusal => ({ ok: false, reason: `standings_rank_refused: ${why}` });

/**
 * Validate a league_standings_ranked result. The verdict "these are the ranks"
 * must cover the whole league, so the ranks must be exactly 1..N over unique
 * user ids: a gap or a shared rank means the read is not the full ranking.
 */
export function readRanking(res: RpcResult): { ok: true; ranked: RankedStanding[] } | Refusal {
  if (res.error) return refuse(`rpc error: ${res.error.message ?? 'unknown'}`);
  if (!Array.isArray(res.data) || res.data.length === 0) return refuse('no ranked standings');

  const ranked: RankedStanding[] = [];
  for (const r of res.data as Array<Record<string, unknown>>) {
    const id = r?.user_id;
    const rank = r?.rank;
    if (typeof id !== 'string' || id.length === 0 || !Number.isInteger(rank)) {
      return refuse('malformed ranking row');
    }
    ranked.push({ user_id: id, rank: rank as number });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  if (new Set(ranked.map((r) => r.user_id)).size !== ranked.length) return refuse('duplicate user in ranking');
  if (ranked.some((r, i) => r.rank !== i + 1)) return refuse('ranks are not exactly 1..N');
  return { ok: true, ranked };
}

/** Playoff seeds: the top `playoffTeams` ranks, seed = rank. playoffTeams
 * is leagues.playoff_teams as read: an integer >= 2 or this refuses (there is
 * no default; NULL used to read as 4 via `playoff_teams || 4`, and matchup
 * leagues now require it, 20261012000000). */
export function decidePlayoffSeeds(
  res: RpcResult,
  playoffTeams: number | null,
): { ok: true; seeds: Array<{ user_id: string; seed: number }> } | Refusal {
  if (!isValidPlayoffTeams(playoffTeams)) return { ok: false, reason: `invalid_playoff_teams: ${String(playoffTeams)}` };
  const r = readRanking(res);
  if (!r.ok) return r;
  if (r.ranked.length < playoffTeams) {
    return refuse(`${r.ranked.length} ranked managers for ${playoffTeams} playoff spots`);
  }
  return { ok: true, seeds: r.ranked.slice(0, playoffTeams).map((s) => ({ user_id: s.user_id, seed: s.rank })) };
}

export interface TransitionLeague {
  league_type: string | null;
  season_status: string | null;
  draft_status: string | null;
  current_week: number | null;
  num_weeks: number | null;
}

export interface MatchupCounts {
  regularTotal: number;
  /** Regular-season matchups with team1_gain IS NULL (unscored, incl. refused). */
  regularUnscored: number;
  playoffTotal: number;
}

/**
 * Heal-pass predicate: the regular season is over and fully scored, yet the
 * league never transitioned (no playoff rows, still 'active'). This is exactly
 * the state a refused transition leaves behind, because the transition refuses
 * before any write.
 *
 * Why a heal pass is needed at all: the in-loop transition only runs inside a
 * batch of PENDING matchups for the league's current week. Once the final week
 * is scored there are no pending matchups, so without this a refusal would never
 * be retried (the CLAUDE.md all-or-nothing family: a recoverable gap made
 * permanent).
 *
 * Every regular-season matchup must be scored, not just the final week's, so
 * a matchup left unscored by a scoring refusal blocks the transition until it
 * heals.
 */
export function needsRegularSeasonTransition(l: TransitionLeague, c: MatchupCounts): boolean {
  if (l.league_type !== 'matchup') return false;
  if (l.season_status !== 'active') return false;
  if (l.draft_status !== 'completed') return false;
  const numWeeks = l.num_weeks ?? 0;
  if (numWeeks <= 0 || l.current_week == null || l.current_week < numWeeks) return false;
  return c.regularTotal > 0 && c.regularUnscored === 0 && c.playoffTotal === 0;
}

// ---------------------------------------------------------------------------
// The bracket, and the atomic start_league_playoffs call
// ---------------------------------------------------------------------------

/** One playoff matchup row, shaped for public.start_league_playoffs (keys MUST
 * match its jsonb_to_recordset column list, 20261012000001).
 *
 * A null team is a placeholder awaiting the winner of its feeder game, and
 * that is the ONLY meaning a null team has on a playoff row. A bye is not a
 * row: the bye seed is already in its round-2 slot. The address
 * (playoff_round_number, bracket_position) is what advancement keys on;
 * playoff_round is the structural code by distance from the final. */
export interface PlayoffBracketRow {
  week_number: number;
  team1_user_id: string | null;
  team2_user_id: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  week_start: string; // ISO-8601 UTC
  week_end: string; // ISO-8601 UTC
  playoff_round: PlayoffRoundCode;
  playoff_round_number: number; // 1..W
  bracket_position: number; // 0..2^(W-round)-1
}

/**
 * Build the bracket from seeds (index 0 = seed 1) for ANY playoff size, from
 * the pure plan in _shared/playoff-bracket.ts (planBracket). Round r is played
 * in week startWeek + r - 1, starting on the first Tuesday strictly after
 * `startDate` (+1 week per round) at 14:30Z and ending that Friday at 21:00Z
 * (unchanged from the old 2/4/8-only builder, and the same windows
 * planSeason's league end date assumes). For 2, 4 and 8 teams the pairings
 * are the ones prod has always used (1v2; 1v4, 2v3; 1v8, 4v5, 3v6, 2v7).
 *
 * Returns [] for fewer than 2 seeds or a bracket longer than 4 rounds (more
 * than 16 teams, which has no round code); start_league_playoffs refuses both.
 */
export function buildPlayoffBracket(
  seeds: Array<{ user_id: string }>,
  startDate: Date,
  startWeek: number,
): PlayoffBracketRow[] {
  if (!isValidPlayoffTeams(seeds.length)) return [];
  const { weeks } = playoffShape(seeds.length);
  if (weeks > 4) return [];

  function timing(weekOffset: number) {
    const base = new Date(startDate);
    let daysUntilTuesday = (2 - base.getUTCDay() + 7) % 7;
    if (daysUntilTuesday === 0) daysUntilTuesday = 7;
    base.setUTCDate(base.getUTCDate() + daysUntilTuesday + weekOffset * 7);
    base.setUTCHours(14, 30, 0, 0);
    const end = new Date(base);
    end.setUTCDate(end.getUTCDate() + 3);
    end.setUTCHours(21, 0, 0, 0);
    return { week_start: base.toISOString(), week_end: end.toISOString() };
  }
  const side = (s: SlotSource) =>
    s.kind === 'seed'
      ? { user: seeds[s.seed - 1].user_id, seed: s.seed }
      : { user: null, seed: null }; // awaiting the feeder game's winner

  return planBracket(seeds.length).map((g) => {
    const t1 = side(g.team1), t2 = side(g.team2);
    return {
      week_number: startWeek + g.round - 1,
      team1_user_id: t1.user,
      team2_user_id: t2.user,
      team1_seed: t1.seed,
      team2_seed: t2.seed,
      ...timing(g.round - 1),
      playoff_round: playoffRoundCode(g.round, weeks),
      playoff_round_number: g.round,
      bracket_position: g.position,
    };
  });
}

/**
 * Interpret the start_league_playoffs rpc result. `started` and
 * `already_transitioned` are both success. The latter is the concurrency
 * backstop working (another run started the playoffs first) and writes nothing.
 * An rpc error means the function's transaction rolled back, so the league is
 * untouched and the heal pass retries it.
 */
export function readPlayoffStart(res: RpcResult): { ok: true; claimed: boolean } | Refusal {
  if (res.error) return { ok: false, reason: `start_league_playoffs failed: ${res.error.message ?? 'unknown'}` };
  const d = res.data as
    | { status?: unknown; reason?: unknown; current_week?: unknown; expected_week?: unknown }
    | null;
  if (d?.status === 'started') return { ok: true, claimed: true };
  if (d?.status === 'already_transitioned') return { ok: true, claimed: false };
  // Still active with no bracket, but current_week moved since the caller read
  // it. Nothing was written. Report it (not a silent success); the heal pass
  // re-reads the league on the next run.
  if (d?.status === 'not_eligible') {
    return {
      ok: false,
      reason: `start_league_playoffs not_eligible: current_week ${String(d.current_week)} != expected ${String(d.expected_week)}`,
    };
  }
  if (d?.status === 'refused') return { ok: false, reason: `start_league_playoffs refused: ${String(d.reason)}` };
  return { ok: false, reason: `start_league_playoffs: unexpected response ${JSON.stringify(res.data)}` };
}
