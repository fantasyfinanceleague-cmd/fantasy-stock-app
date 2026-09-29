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

/** Playoff seeds: the top `playoffTeams` ranks, seed = rank. */
export function decidePlayoffSeeds(
  res: RpcResult,
  playoffTeams: number,
): { ok: true; seeds: Array<{ user_id: string; seed: number }> } | Refusal {
  const r = readRanking(res);
  if (!r.ok) return r;
  if (r.ranked.length < playoffTeams) {
    return refuse(`${r.ranked.length} ranked managers for ${playoffTeams} playoff spots`);
  }
  return { ok: true, seeds: r.ranked.slice(0, playoffTeams).map((s) => ({ user_id: s.user_id, seed: s.rank })) };
}

/** Champion and runner-up for a league that ends without playoffs. */
export function decidePodium(res: RpcResult): { ok: true; champion: string; runnerUp: string } | Refusal {
  const r = readRanking(res);
  if (!r.ok) return r;
  if (r.ranked.length < 2) return refuse('fewer than two ranked managers');
  return { ok: true, champion: r.ranked[0].user_id, runnerUp: r.ranked[1].user_id };
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
 * match its jsonb_to_recordset column list in 20261011000003). A null team is a
 * placeholder filled later by advancePlayoffWinner. */
export interface PlayoffBracketRow {
  week_number: number;
  team1_user_id: string | null;
  team2_user_id: string | null;
  team1_seed: number | null;
  team2_seed: number | null;
  week_start: string; // ISO-8601 UTC
  week_end: string; // ISO-8601 UTC
  playoff_round: 'quarter' | 'semi' | 'finals';
}

/**
 * Build the bracket from seeds (index 0 = seed 1). Moved verbatim in logic from
 * index.ts generateBracket: each round starts on the first Tuesday strictly
 * after `startDate` (+1 week per round) at 14:30Z and ends that Friday at 21:00Z;
 * 2 teams = finals only; 4 = 1v4, 2v3 semis + finals placeholder; 8 = 1v8, 4v5,
 * 2v7, 3v6 quarters + two semi placeholders + finals placeholder. Any other
 * size returns [], which start_league_playoffs refuses.
 */
export function buildPlayoffBracket(
  seeds: Array<{ user_id: string }>,
  startDate: Date,
  startWeek: number,
): PlayoffBracketRow[] {
  const numTeams = seeds.length;
  const rows: PlayoffBracketRow[] = [];

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
  const game = (offset: number, round: PlayoffBracketRow['playoff_round'], i1?: number, i2?: number): PlayoffBracketRow => ({
    week_number: startWeek + offset,
    team1_user_id: i1 === undefined ? null : seeds[i1].user_id,
    team2_user_id: i2 === undefined ? null : seeds[i2].user_id,
    team1_seed: i1 === undefined ? null : i1 + 1,
    team2_seed: i2 === undefined ? null : i2 + 1,
    ...timing(offset),
    playoff_round: round,
  });

  if (numTeams === 2) {
    rows.push(game(0, 'finals', 0, 1));
  } else if (numTeams === 4) {
    rows.push(game(0, 'semi', 0, 3), game(0, 'semi', 1, 2), game(1, 'finals'));
  } else if (numTeams === 8) {
    for (const [a, b] of [[0, 7], [3, 4], [1, 6], [2, 5]]) rows.push(game(0, 'quarter', a, b));
    rows.push(game(1, 'semi'), game(1, 'semi'), game(2, 'finals'));
  }
  return rows;
}

/**
 * Interpret the start_league_playoffs rpc result. `claimed` and
 * `already_transitioned` are both success. The latter is the concurrency
 * backstop working (another run started the playoffs first) and writes nothing.
 * An rpc error means the function's transaction rolled back, so the league is
 * untouched and the heal pass retries it.
 */
export function readPlayoffStart(res: RpcResult): { ok: true; claimed: boolean } | Refusal {
  if (res.error) return { ok: false, reason: `start_league_playoffs failed: ${res.error.message ?? 'unknown'}` };
  const d = res.data as { status?: unknown; reason?: unknown } | null;
  if (d?.status === 'claimed') return { ok: true, claimed: true };
  if (d?.status === 'already_transitioned') return { ok: true, claimed: false };
  if (d?.status === 'refused') return { ok: false, reason: `start_league_playoffs refused: ${String(d.reason)}` };
  return { ok: false, reason: `start_league_playoffs: unexpected response ${JSON.stringify(res.data)}` };
}
