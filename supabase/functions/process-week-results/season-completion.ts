/**
 * Heal pass for season completion. Same family as season-transition.ts
 * (regular-season -> playoffs) and healMissedAdvances (playoff-progression.ts):
 * a write that can fail after the deciding event is already permanent
 * (CLAUDE.md "all-or-nothing guard, unrecoverable partial state").
 *
 * THE BUG THIS HEALS: completeSeasonFromPlayoffs used to call the
 * complete_league_season RPC and only LOG its `{ error }` (CLAUDE.md "Success
 * signals" #5 — supabase-js `.rpc()` resolves to `{ data, error }` and never
 * throws on a Postgres error). Nothing ever retried it, so one failed
 * completion left the league at season_status='playoffs' forever with its
 * final matchup already scored: the final is never re-selected once scored
 * (`team1_gain IS NULL` is the pending-matchup filter), so the in-loop call
 * site was the ONLY call site, and it ran exactly once. A read-only
 * `get_season_result` rpc drafted on a separate, not-yet-merged branch
 * (`feat/season-result-summary`, commit dceeb40) would then correctly, and
 * permanently, report the league as not_complete -- named here only as the
 * reporting side this heal is the write-side counterpart to, not as
 * something this branch depends on or has landed.
 *
 * THE FIX HAS TWO HALVES, run from opposite ends:
 *   - completeLeagueSeason (below) checks the rpc's `{ error }` and reports
 *     failure instead of asserting success it never confirmed.
 *   - healUncompletedSeasons (below) is a heal pass, run before the pending-
 *     matchup query (same placement as healRefusedTransitions /
 *     healMissedAdvances), so it also runs on the common early-return path
 *     where there is nothing pending to score (index.ts ~:919) — the exact
 *     path a stranded league takes every week thereafter.
 *   - complete_league_season itself is hardened at the SQL layer
 *     (20261015000000): idempotent on a re-call with the same champion,
 *     refuses a re-call with a different one, refuses a non-'playoffs'
 *     league, and verifies the champion/runner-up against the scored final
 *     before writing. The heal calls this RPC repeatedly by design, so the
 *     RPC must not trust its caller either.
 *
 * decideSeasonCompletion is pure (no DB, no Deno APIs): unit-tested in
 * season-completion.test.ts, same hermetic pattern as season-transition.ts.
 */

import { isValidPlayoffTeams, playoffShape } from '../_shared/playoff-bracket.ts';

/**
 * A playoff row as the season-completion heal reads it. roundNumber/position
 * are typed nullable because the DB column type is nullable — even though the
 * `matchups_playoff_address` CHECK constraint (20261012000000) has made a
 * NULL address on an `is_playoff` row impossible in prod since that migration
 * applied (every is_playoff row must carry both fields, or neither pairs with
 * is_playoff=false). This is defense in depth for a manually-written row or a
 * future regression, not a live prod gap; `final_unaddressed` below is the
 * name for it so it is reported distinctly rather than silently refused as
 * "no final found".
 */
export interface SeasonPlayoffRow {
  id: string;
  roundNumber: number | null;
  position: number | null;
  team1UserId: string | null;
  team2UserId: string | null;
  scored: boolean; // team1_gain IS NOT NULL
  winnerUserId: string | null;
}

export type SeasonCompletionDecision =
  | { kind: 'not_ready' }
  | { kind: 'complete'; championUserId: string; runnerUpUserId: string }
  | { kind: 'refuse'; reason: string };

/**
 * Decide whether a league's playoffs are ready to complete, from its full set
 * of playoff rows. The final is identified BY ADDRESS (round === weeks,
 * exactly one row), the same discipline advancePlayoffWinner/planAdvance use
 * — never by the playoff_round label (CLAUDE.md: keyed on the address, an
 * invalid P finds no final and its advance already refused elsewhere).
 *
 * `weeks` is derived from playoffShape(playoffTeams) by the caller so this
 * function never re-derives it, and never falls back to a default P
 * (matchup leagues require playoff_teams, 20261012000000).
 */
export function decideSeasonCompletion(rows: SeasonPlayoffRow[], weeks: number): SeasonCompletionDecision {
  if (rows.length === 0) return { kind: 'not_ready' }; // no bracket yet (or not a matchup league)

  const unaddressed = rows.filter((r) => r.roundNumber === null || r.position === null);
  if (unaddressed.length > 0) {
    return {
      kind: 'refuse',
      reason: `final_unaddressed: ${unaddressed.length} of ${rows.length} playoff row(s) missing a bracket address`,
    };
  }

  const finals = rows.filter((r) => r.roundNumber === weeks);
  if (finals.length === 0) {
    return { kind: 'refuse', reason: `final_missing: no round ${weeks} row found among ${rows.length} playoff row(s)` };
  }
  if (finals.length > 1) {
    return { kind: 'refuse', reason: `final_ambiguous: ${finals.length} rows in round ${weeks}` };
  }
  const final = finals[0];

  if (!final.scored) return { kind: 'not_ready' };

  // Structurally unreachable via the current scorer: a scored playoff final
  // always names a winner (resolveBySeed resolves every playoff tie —
  // playoff-progression.ts "DEFECT 1 FIXED"). Checked anyway: this heal calls
  // rows written by whatever scored them, not only today's decideMatchupOutcome.
  if (!final.winnerUserId) {
    return { kind: 'refuse', reason: 'final_scored_without_winner' };
  }
  if (!final.team1UserId || !final.team2UserId) {
    return { kind: 'refuse', reason: 'final_empty_slot' };
  }
  if (final.winnerUserId !== final.team1UserId && final.winnerUserId !== final.team2UserId) {
    return { kind: 'refuse', reason: 'final_winner_not_a_participant' };
  }

  const runnerUpUserId = final.winnerUserId === final.team1UserId ? final.team2UserId : final.team1UserId;
  return { kind: 'complete', championUserId: final.winnerUserId, runnerUpUserId };
}

export type CompletionOutcome = { ok: true } | { ok: false; reason: string };

/**
 * Call complete_league_season and check its `{ error }` (CLAUDE.md "Success
 * signals" #5: the old caller destructured nothing and logged success
 * unconditionally). The SQL guard (20261015000000) makes a re-call with the
 * SAME champion a no-op success, so this is safe for the heal to retry.
 */
export async function completeLeagueSeason(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  leagueId: string,
  championUserId: string,
  runnerUpUserId: string,
): Promise<CompletionOutcome> {
  const { error } = await supabase.rpc('complete_league_season', {
    p_league_id: leagueId,
    p_champion_user_id: championUserId,
    p_runner_up_user_id: runnerUpUserId,
  });
  if (error) {
    return { ok: false, reason: `complete_league_season_failed: ${error.message ?? JSON.stringify(error)}` };
  }
  return { ok: true };
}

/**
 * Heal pass: (re)attempt season completion for every matchup league whose
 * playoffs are done but whose season never completed. Never throws — whatever
 * it cannot do is reported in the returned refusals and retried next run.
 */
export async function healUncompletedSeasons(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  leagueIdFilter: string | null,
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  try {
    return await healUncompletedSeasonsInner(supabase, leagueIdFilter);
  } catch (e) {
    console.error('Season-completion heal threw (skipping this run):', e);
    return [];
  }
}

async function healUncompletedSeasonsInner(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  leagueIdFilter: string | null,
  // deno-lint-ignore no-explicit-any
): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const refusals: any[] = [];
  let lq = supabase
    .from('leagues')
    .select('id, playoff_teams')
    .eq('league_type', 'matchup')
    .eq('season_status', 'playoffs');
  if (leagueIdFilter) lq = lq.eq('id', leagueIdFilter);
  const { data: leagues, error: leaguesErr } = await lq;
  if (leaguesErr) {
    console.error('Season-completion heal: failed to read leagues (skipping this run):', leaguesErr);
    return refusals;
  }

  for (const league of leagues ?? []) {
    if (!isValidPlayoffTeams(league.playoff_teams)) {
      refusals.push({ league_id: league.id, reason: `invalid_playoff_teams: ${String(league.playoff_teams)}` });
      continue;
    }
    const weeks = playoffShape(league.playoff_teams).weeks;

    const { data: rows, error: rowsErr } = await supabase
      .from('matchups')
      .select('id, playoff_round_number, bracket_position, team1_user_id, team2_user_id, team1_gain, winner_user_id')
      .eq('league_id', league.id)
      .eq('is_playoff', true);
    if (rowsErr) {
      console.error(`Season-completion heal: failed to read playoff rows for league ${league.id} (skipping):`, rowsErr);
      continue;
    }

    // deno-lint-ignore no-explicit-any
    const state: SeasonPlayoffRow[] = (rows ?? []).map((r: any) => ({
      id: r.id,
      roundNumber: r.playoff_round_number,
      position: r.bracket_position,
      team1UserId: r.team1_user_id,
      team2UserId: r.team2_user_id,
      scored: r.team1_gain !== null,
      winnerUserId: r.winner_user_id,
    }));

    const decision = decideSeasonCompletion(state, weeks);
    if (decision.kind === 'not_ready') continue;
    if (decision.kind === 'refuse') {
      console.error(`Season-completion heal: league ${league.id}: ${decision.reason}`);
      refusals.push({ league_id: league.id, reason: decision.reason });
      continue;
    }

    console.log(`Season-completion heal: league ${league.id} completing (champion ${decision.championUserId})`);
    const res = await completeLeagueSeason(supabase, league.id, decision.championUserId, decision.runnerUpUserId);
    if (!res.ok) {
      console.error(`Season-completion heal: league ${league.id}: ${res.reason}`);
      refusals.push({ league_id: league.id, reason: res.reason });
    } else {
      console.log(`Season-completion heal: league ${league.id} completed (champion ${decision.championUserId})`);
    }
  }
  return refusals;
}
