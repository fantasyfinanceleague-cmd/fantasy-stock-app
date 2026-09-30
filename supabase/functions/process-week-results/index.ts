import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { groupMatchupsByLeagueWeek } from './grouping.ts';
import {
  decideMatchupOutcome,
  willAdvanceWinner,
  planAdvance,
  isScoreableNow,
  findMissedAdvances,
  standingsIncrements,
  type RecordIncrement,
  type PlayoffRound,
  type PlayoffRowState,
} from './playoff-progression.ts';
import { isValidPlayoffTeams, playoffShape } from '../_shared/playoff-bracket.ts';
import {
  decideBatchScoring,
  decideUserScorer,
  decideMatchupScoring,
  ledgerPositionState,
  userWeekEndPricesComplete,
  BATCH_SKIP_REASON,
  MATCHUP_REFUSAL_REASON,
  type LedgerState,
  type MatchupRefusalReason,
} from './scoring-eligibility.ts';
import {
  calculatePortfolio,
  calculateUserScore,
  scoreCashOnlyUser,
  type WeekSnapshot,
  type MidWeekTrade,
  type UserScore,
} from './user-score.ts';
import { SKIP_SYMBOL } from '../_shared/draft-validation.ts';
import { updateJobStatus, noPendingMessage, scoredMessage } from './job-status.ts';
import { completeLeagueSeason, healUncompletedSeasons } from './season-completion.ts';
import {
  buildPlayoffBracket,
  decidePlayoffSeeds,
  needsRegularSeasonTransition,
  readPlayoffStart,
  type RpcResult,
  type TransitionLeague,
} from './season-transition.ts';

/**
 * Process Weekly Matchup Results
 *
 * This function runs automatically at market close on Fridays (4 PM ET / 21:00 UTC)
 * to calculate matchup results and update standings.
 *
 * For each matchup league:
 * 1. Find matchups where week has ended (week_end < now) and results not yet calculated
 * 2. Calculate each player's portfolio gain for the week
 * 3. Determine winner (higher gain wins)
 * 4. Update matchups table with results
 * 5. Update league_standings with W/L/T
 * 6. Advance current_week if all matchups for that week are done
 */

function env(k: string) { return Deno.env.get(k) ?? ''; }

const ALPACA_BASE = 'https://data.alpaca.markets/v2';

// Max age of an ENDED week that may still be scored WITHOUT week_snapshots,
// using current prices. Beyond this we refuse rather than fabricate results.
// ~3 days covers a normal week_end -> cron run plus a retry.
const FALLBACK_MAX_AGE_HOURS = 72;

// Simple response helper
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json' }
  });

// ── apikey auth (Phase 2b-2; pattern proven in 2b-1 snapshot-week-end) ────────
// Constant-time compare to avoid leaking the expected key via timing.
function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

const unauthorized = () => json({ error: 'Unauthorized' }, 401);

function isAuthorized(req: Request): boolean {
  const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expectedKey || expectedKey.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false;                       // fail closed
  }
  const providedKey = req.headers.get('apikey') ?? '';
  return constantTimeEqual(providedKey, expectedKey);
}

// Fetch latest prices from Alpaca (using service credentials)
async function fetchPrices(symbols: string[], alpacaKey: string, alpacaSecret: string): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  if (symbols.length === 0) return prices;

  // Use multi-quote endpoint
  const symbolsParam = symbols.join(',');
  const url = `${ALPACA_BASE}/stocks/quotes/latest?symbols=${encodeURIComponent(symbolsParam)}&feed=iex`;

  try {
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json();
      // Response format: { quotes: { AAPL: { ap: 150.25, ... }, ... } }
      if (data.quotes) {
        for (const [sym, quote] of Object.entries(data.quotes as Record<string, any>)) {
          const price = Number(quote?.ap) || Number(quote?.bp) || 0;
          if (price > 0) prices.set(sym.toUpperCase(), price);
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch prices:', e);
  }

  return prices;
}

// calculateWeeklyGainLegacy (scored a snapshotted-but-unclosed user from LIVE
// prices, ignoring every mid-week trade) was REMOVED here — it wrote an
// irreversible team1_gain for a week that was never actually closed, and the
// number depended on exactly when it ran relative to snapshot-week-end's
// retry chain (S7, docs/audits/2026-09-30-week-window-audit.md). Such a user
// is now 'close_incomplete' (see ./scoring-eligibility.ts) and the matchup is
// refused — recoverable, because the heal crons re-run process-week-results
// after snapshot-week-end's Friday retries finish.

type TransitionOutcome = { ok: true } | { ok: false; reason: string };

/**
 * End a league's regular season: seed the playoffs, or complete the season when
 * the league has none.
 *
 * Ranking comes ONLY from public.league_standings_ranked (20261011000000) — the
 * same order the standings screens show. The rpc result is validated in
 * ./season-transition.ts and a bad read REFUSES before anything is written, so
 * the league stays 'active' at its last regular week and the heal pass at the
 * top of the handler retries it next run. Never an unranked fallback.
 */
async function transitionAfterRegularSeason(
  supabase: any,
  leagueId: string,
  numWeeks: number,
  playoffTeams: number | null,
  expectedWeek: number
): Promise<TransitionOutcome> {
  // Every matchup league has playoffs: P is 2..managers (Giorgio, 2026-09-29)
  // and required on matchup leagues (20261012000000). There is no "no playoffs"
  // path any more, and no `playoff_teams || 4` default: an invalid P refuses
  // here (decidePlayoffSeeds) and is surfaced in skipped[].
  const rankRes: RpcResult = await supabase.rpc('league_standings_ranked', { p_league_id: leagueId });
  const seeding = decidePlayoffSeeds(rankRes, playoffTeams);
  if (!seeding.ok) return seeding;

  // Playoffs start the Tuesday after the last regular-season week ends.
  const { data: lastMatchup, error: lastErr } = await supabase
    .from('matchups')
    .select('week_end')
    .eq('league_id', leagueId)
    .eq('is_playoff', false)
    .order('week_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) {
    return { ok: false, reason: `last regular week read failed: ${lastErr.message ?? JSON.stringify(lastErr)}` };
  }
  // Refuse rather than date the bracket from "now": the heal pass only runs
  // with regular matchups present, so a missing week_end is a data problem.
  if (!lastMatchup?.week_end) {
    return { ok: false, reason: 'no regular-season week_end to schedule playoffs from' };
  }
  const playoffStartDate = new Date(lastMatchup.week_end);
  // Any P: byes are not rows (the bye seeds sit in their round-2 slots), and
  // every row carries its (round, position) address. See _shared/playoff-bracket.ts.
  const bracket = buildPlayoffBracket(seeding.seeds, playoffStartDate, numWeeks + 1);

  // ONE atomic call claims the league ('active' -> 'playoffs', current_week =
  // num_weeks + 1) and inserts the bracket, or does neither (20261011000003,
  // validation 20261012000001: the exact shape for this league's P). A
  // concurrent or repeated run gets already_transitioned and writes nothing, so
  // a double bracket or a half-written one is impossible.
  const started = readPlayoffStart(await supabase.rpc('start_league_playoffs', {
    p_league_id: leagueId,
    p_expected_week: expectedWeek, // compare-and-swap on the week this run read
    p_bracket: bracket,
  }));
  if (!started.ok) return started;
  console.log(
    started.claimed
      ? `League ${leagueId} transitioning to playoffs: ${bracket.length} bracket matchups created`
      : `League ${leagueId} already transitioned to playoffs by another run; nothing written`,
  );
  return { ok: true };
}

/**
 * Advance a playoff winner into its next-round slot, BY ADDRESS: the winner of
 * (round r, position p) plays in (r+1, floor(p/2)), slot team1 if p is even,
 * else team2 (planAdvance / nextSlot). Replaces the old "first empty slot of
 * any next-round row" fill, which made the bracket depend on processing order
 * (DEFECT 3 in playoff-progression.ts).
 *
 * The write is conditional on the slot still being NULL, so a retry (the
 * missed-advance heal) is idempotent: if the slot already holds this winner
 * that is success; if it holds someone else that is a conflict and nothing is
 * overwritten. Every { error } is checked (CLAUDE.md "Success signals" #5: the
 * old version discarded both update results and logged success regardless).
 */
async function advancePlayoffWinner(
  supabase: any,
  leagueId: string,
  row: { roundNumber: number; position: number; team1UserId: string; team2UserId: string | null;
    team1Seed: number | null; team2Seed: number | null },
  winnerId: string,
  weeks: number,
): Promise<TransitionOutcome> {
  let plan;
  try {
    plan = planAdvance(row, winnerId, weeks);
  } catch (e) {
    return { ok: false, reason: `playoff_advance_bad_address: ${(e as Error).message}` };
  }
  if (plan.kind === 'final') return { ok: true };

  const userCol = plan.slot === 'team1' ? 'team1_user_id' : 'team2_user_id';
  const seedCol = plan.slot === 'team1' ? 'team1_seed' : 'team2_seed';
  const { data: written, error: writeErr } = await supabase
    .from('matchups')
    .update({ [userCol]: winnerId, [seedCol]: plan.seed })
    .eq('league_id', leagueId)
    .eq('is_playoff', true)
    .eq('playoff_round_number', plan.round)
    .eq('bracket_position', plan.position)
    .is(userCol, null)
    .select('id');
  if (writeErr) {
    return { ok: false, reason: `playoff_advance_failed: ${writeErr.message ?? JSON.stringify(writeErr)}` };
  }
  if (Array.isArray(written) && written.length === 1) {
    console.log(`Advanced ${winnerId} (seed ${plan.seed}) to round ${plan.round} position ${plan.position} ${plan.slot}`);
    return { ok: true };
  }

  // Nothing written: the slot is already filled, or the row does not exist.
  const { data: target, error: readErr } = await supabase
    .from('matchups')
    .select(`id, ${userCol}`)
    .eq('league_id', leagueId)
    .eq('is_playoff', true)
    .eq('playoff_round_number', plan.round)
    .eq('bracket_position', plan.position)
    .maybeSingle();
  if (readErr) {
    return { ok: false, reason: `playoff_advance_recheck_failed: ${readErr.message ?? JSON.stringify(readErr)}` };
  }
  if (!target) {
    return { ok: false, reason: `playoff_target_missing: round ${plan.round} position ${plan.position}` };
  }
  if (target[userCol] === winnerId) return { ok: true }; // already advanced (a retry)
  return { ok: false, reason: `playoff_slot_taken: round ${plan.round} position ${plan.position} ${plan.slot}` };
}

/**
 * Heal pass for playoff advancement. A game is never re-selected once scored,
 * so a winner whose advance failed would never reach the next round and that
 * game could never be played. For every league in 'playoffs', re-apply any
 * missed advance (findMissedAdvances decides, per game) and report conflicts.
 * Runs before the pending-matchup query, so a healed slot is scoreable in the
 * same run. Never throws: whatever it cannot do is reported and retried.
 */
async function healMissedAdvances(supabase: any, leagueIdFilter: string | null): Promise<any[]> {
  const refusals: any[] = [];
  try {
    let lq = supabase
      .from('leagues')
      .select('id, playoff_teams')
      .eq('league_type', 'matchup')
      .eq('season_status', 'playoffs');
    if (leagueIdFilter) lq = lq.eq('id', leagueIdFilter);
    const { data: leagues, error: leaguesErr } = await lq;
    if (leaguesErr) {
      console.error('Advance heal: failed to read leagues (skipping this run):', leaguesErr);
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
        .select('id, week_number, playoff_round_number, bracket_position, team1_user_id, team2_user_id, team1_seed, team2_seed, team1_gain, winner_user_id')
        .eq('league_id', league.id)
        .eq('is_playoff', true);
      if (rowsErr) {
        console.error(`Advance heal: failed to read playoff rows for league ${league.id} (skipping):`, rowsErr);
        continue;
      }
      const state: PlayoffRowState[] = (rows ?? []).map((r: any) => ({
        id: r.id,
        roundNumber: r.playoff_round_number,
        position: r.bracket_position,
        team1UserId: r.team1_user_id,
        team2UserId: r.team2_user_id,
        team1Seed: r.team1_seed,
        team2Seed: r.team2_seed,
        scored: r.team1_gain !== null,
        winnerUserId: r.winner_user_id,
      }));
      const { advances, conflicts } = findMissedAdvances(state, weeks);
      for (const c of conflicts) {
        console.error(`Advance heal: league ${league.id} row ${c.fromId}: ${c.reason}`);
        refusals.push({ league_id: league.id, matchup_id: c.fromId, reason: c.reason });
      }
      for (const a of advances) {
        const from = state.find((r) => r.id === a.fromId)!;
        console.log(`Advance heal: league ${league.id} re-advancing ${a.plan.userId} from row ${a.fromId}`);
        const res = await advancePlayoffWinner(supabase, league.id, { ...from, team1UserId: from.team1UserId! }, a.plan.userId, weeks);
        if (!res.ok) refusals.push({ league_id: league.id, matchup_id: a.fromId, reason: res.reason });
      }
    }
  } catch (e) {
    console.error('Advance heal threw (skipping this run):', e);
  }
  return refusals;
}

/**
 * Heal pass: retry season transitions that an earlier run refused.
 *
 * The in-loop transition only runs inside a batch of PENDING matchups for the
 * league's current week. After the final regular week is scored there are none,
 * so a refused transition would never be re-entered. transitionAfterRegularSeason
 * refuses before writing anything, which leaves exactly the state
 * needsRegularSeasonTransition detects: 'active', past the last week, every
 * regular matchup scored, no playoff rows. Runs before the pending-matchup query
 * so it also runs on weeks with nothing to score.
 *
 * Returns the refusals (skipped[] entries). A failed read, or even a throw, is
 * logged and skipped here: the heal pass must never block this run's scoring,
 * and whatever it could not do is retried next run.
 */
async function healRefusedTransitions(supabase: any, leagueIdFilter: string | null): Promise<any[]> {
  try {
    return await healRefusedTransitionsInner(supabase, leagueIdFilter);
  } catch (e) {
    console.error('Heal pass threw (skipping heal this run):', e);
    return [];
  }
}

async function healRefusedTransitionsInner(supabase: any, leagueIdFilter: string | null): Promise<any[]> {
  const refusals: any[] = [];
  let lq = supabase
    .from('leagues')
    .select('id, league_type, season_status, draft_status, current_week, num_weeks, playoff_teams')
    .eq('league_type', 'matchup')
    .eq('season_status', 'active')
    .eq('draft_status', 'completed');
  if (leagueIdFilter) lq = lq.eq('id', leagueIdFilter);
  const { data: leagues, error: leaguesErr } = await lq;
  if (leaguesErr) {
    console.error('Heal pass: failed to read leagues (skipping heal this run):', leaguesErr);
    return refusals;
  }

  for (const league of (leagues ?? []) as Array<TransitionLeague & { id: string; playoff_teams: number | null }>) {
    if (league.current_week == null || !league.num_weeks || league.current_week < league.num_weeks) continue;

    const { data: rows, error: rowsErr } = await supabase
      .from('matchups')
      .select('is_playoff, team1_gain')
      .eq('league_id', league.id);
    if (rowsErr) {
      console.error(`Heal pass: failed to read matchups for league ${league.id} (skipping):`, rowsErr);
      continue;
    }
    const regular = (rows ?? []).filter((m: any) => m.is_playoff !== true);
    const counts = {
      regularTotal: regular.length,
      regularUnscored: regular.filter((m: any) => m.team1_gain === null).length,
      playoffTotal: (rows ?? []).length - regular.length,
    };
    if (!needsRegularSeasonTransition(league, counts)) continue;

    console.log(`Heal pass: league ${league.id} finished its regular season without transitioning; retrying`);
    // playoff_teams as stored: no default (see transitionAfterRegularSeason).
    const outcome = await transitionAfterRegularSeason(
      supabase, league.id, league.num_weeks, league.playoff_teams, league.current_week,
    );
    if (!outcome.ok) {
      console.error(`REFUSED season transition for league ${league.id} (heal pass): ${outcome.reason}`);
      refusals.push({ league_id: league.id, week_number: league.num_weeks, reason: outcome.reason });
    }
  }
  return refusals;
}

Deno.serve(async (req) => {
  // SECURITY: validate the apikey before anything else — before body parse,
  // DB connection, or business logic. This function runs with verify_jwt=false,
  // so this guard is the only thing protecting it.
  if (!isAuthorized(req)) {
    return unauthorized();
  }

  const JOB_NAME = 'process-week-results';
  // This can be triggered by cron or manually
  console.log('Processing weekly matchup results...');

  const SUPABASE_URL = env('SUPABASE_URL');
  const SECRET_KEY = env('SB_SECRET_KEY_INTERNAL');
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!SUPABASE_URL || !SECRET_KEY) {
    return json({ error: 'Missing Supabase configuration' }, 500);
  }

  // Optional: scope processing to a single league (used by simulation tests)
  let leagueIdFilter: string | null = null;
  try {
    const body = await req.json();
    if (body?.league_id) {
      leagueIdFilter = body.league_id;
      console.log(`Scoped to league: ${leagueIdFilter}`);
    }
  } catch {
    // No body or invalid JSON — process all leagues (normal cron behavior)
  }

  const supabase = createClient(SUPABASE_URL, SECRET_KEY);
  const now = new Date();

  // Update status to running.
  //
  // INVARIANT: every handler return from here on must first write a terminal
  // status ('success' | 'failed'). A return that skips it strands today's row
  // at 'running' forever, and a stranded row is byte-identical whether the run
  // hung, crashed, or finished with nothing to do (CLAUDE.md "Success signals"
  // #6). updateJobStatus never throws, so writing it cannot change the HTTP
  // response. (The `return error` statements further down belong to the nested
  // updateUserStandings helper, not the handler.)
  await updateJobStatus(supabase, JOB_NAME, 'running', 1);

  try {
    // 0. Retry season transitions refused on an earlier run (see
    //    healRefusedTransitions). Before the pending query so it runs on quiet weeks.
    //    Then re-apply playoff advances an earlier run failed to write, so a
    //    healed next-round game is scoreable in this same run. Then retry any
    //    season completion whose rpc call failed on an earlier run: a scored
    //    final is never re-selected (team1_gain IS NOT NULL), so without this
    //    heal a failed completeLeagueSeason call would strand the league at
    //    season_status='playoffs' forever (F-B: the "all-or-nothing guard,
    //    unrecoverable partial state" family — see season-completion.ts).
    const transitionRefusals = [
      ...(await healRefusedTransitions(supabase, leagueIdFilter)),
      ...(await healMissedAdvances(supabase, leagueIdFilter)),
      ...(await healUncompletedSeasons(supabase, leagueIdFilter)),
    ];
    let transitionsRefused = transitionRefusals.length;

    // 1. Find matchups that need processing (week_end has passed, no results yet)
    let query = supabase
      .from('matchups')
      .select(`
        id,
        league_id,
        week_number,
        team1_user_id,
        team2_user_id,
        team1_gain,
        team1_seed,
        team2_seed,
        week_start,
        week_end,
        is_playoff,
        playoff_round,
        playoff_round_number,
        bracket_position,
        leagues!inner(id, league_type, current_week, num_weeks, playoff_teams)
      `)
      .eq('leagues.league_type', 'matchup')
      .is('team1_gain', null)  // Results not yet calculated
      .not('team1_user_id', 'is', null) // Skip placeholder matchups (waiting for winners)
      .lt('week_end', now.toISOString());

    if (leagueIdFilter) {
      query = query.eq('league_id', leagueIdFilter);
    }

    const { data: pendingRows, error: matchupErr } = await query;

    if (matchupErr) {
      console.error('Error fetching matchups:', matchupErr);
      await updateJobStatus(
        supabase, JOB_NAME, 'failed', 1,
        `Failed to fetch matchups: ${matchupErr.message ?? JSON.stringify(matchupErr)}`,
      );
      return json({ error: 'Failed to fetch matchups', details: matchupErr }, 500);
    }

    // A playoff row with an empty slot is still awaiting its feeder's winner,
    // never a walkover (isScoreableNow, DEFECT 4). The query cannot express
    // "team2 required only on playoff rows" as simply, so it is filtered here.
    const pendingMatchups: any[] = ((pendingRows ?? []) as any[]).filter(isScoreableNow);
    const awaiting = ((pendingRows ?? []) as any[]).length - pendingMatchups.length;
    if (awaiting > 0) console.log(`${awaiting} playoff matchup(s) still await a feeder winner; not scored yet`);

    if (pendingMatchups.length === 0) {
      console.log('No pending matchups to process');
      // Terminal success: the common weekly path. The schema has no distinct
      // "nothing to do" status, so the message carries it.
      await updateJobStatus(supabase, JOB_NAME, 'success', 1, noPendingMessage(transitionsRefused));
      return json({
        message: 'No pending matchups',
        processed: 0,
        skipped: transitionRefusals,
        skipped_count: transitionRefusals.length,
      });
    }

    console.log(`Found ${pendingMatchups.length} matchups to process`);

    // Group pending matchups into one batch per (league_id, week_number),
    // ordered (leagueId, weekNumber ASC). Grouping by league alone was a bug and
    // the ordering is load-bearing for week-advancement — both are documented and
    // unit-tested in ./grouping.ts (see grouping.test.ts for the regression).
    const orderedBatches = groupMatchupsByLeagueWeek(pendingMatchups);

    let processedCount = 0;
    const results: any[] = [];
    const skipped: any[] = [...transitionRefusals];

    // Process each (league, week) batch. weekStart / weekEnd come off the batch,
    // not leagueMatchups[0] — every matchup in the batch shares the same window.
    for (const { leagueId, weekNumber, weekStart, weekEnd, matchups: leagueMatchups } of orderedBatches) {
      console.log(`Processing league ${leagueId} week ${weekNumber} with ${leagueMatchups.length} matchups`);

      // Get all user IDs for this batch (skip null for bye weeks)
      const userIds = new Set<string>();
      for (const m of leagueMatchups) {
        if (m.team1_user_id) userIds.add(m.team1_user_id);
        if (m.team2_user_id) userIds.add(m.team2_user_id);
      }

      // Fetch week snapshots for this league/week (including week_end_price)
      const { data: snapshotData, error: snapshotErr } = await supabase
        .from('week_snapshots')
        .select('user_id, symbol, quantity, week_start_price, week_end_price, entered_mid_week')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      // Build snapshots map by user
      const userSnapshots = new Map<string, WeekSnapshot[]>();
      const snapshotSymbols = new Set<string>();
      // LOGGING ONLY — "does ANY row in this league-week batch have a close
      // price yet". NEVER feed this into a scoring decision: a genuine
      // partial write from snapshot-week-end's non-atomic per-row update loop
      // (see userWeekEndPricesComplete's doc in ./scoring-eligibility.ts) can
      // make this true while one specific user's own rows are still NULL.
      // Each user's OWN completeness is computed per-user below, in the loop,
      // from that user's own `snapshots` via userWeekEndPricesComplete.
      const batchHasAnyWeekEndPrice = snapshotData?.some(s => s.week_end_price != null) ?? false;

      if (snapshotData && snapshotData.length > 0) {
        for (const s of snapshotData) {
          if (!userSnapshots.has(s.user_id)) {
            userSnapshots.set(s.user_id, []);
          }
          userSnapshots.get(s.user_id)!.push({
            symbol: s.symbol,
            quantity: Number(s.quantity),
            weekStartPrice: s.week_start_price != null ? Number(s.week_start_price) : null,
            enteredMidWeek: s.entered_mid_week === true,
            weekEndPrice: s.week_end_price != null ? Number(s.week_end_price) : null,
          });
          snapshotSymbols.add(s.symbol);
        }
        console.log(`Found ${snapshotData.length} week snapshots for week ${weekNumber}, batchHasAnyWeekEndPrice: ${batchHasAnyWeekEndPrice}`);
      } else {
        console.log(`No week snapshots found for week ${weekNumber}, using fallback calculation`);
      }

      let midWeekTradesData: any[] = [];
      // Stays null when the query is NOT attempted (a null week bound). That is
      // "not attempted", not "succeeded" — safe here only because
      // ledgerPositionState fails closed to HELD on a null bound, so no user can
      // reach cash_only off the empty list.
      let midWeekTradesErr: unknown = null;
      if (weekStart && weekEnd) {
        const { data: tradesDuringWeek, error } = await supabase
          .from('trades')
          .select('user_id, symbol, action, quantity, price, created_at')
          .eq('league_id', leagueId)
          .gte('created_at', weekStart)
          .lte('created_at', weekEnd);

        midWeekTradesErr = error;
        midWeekTradesData = tradesDuringWeek || [];
        console.log(`Found ${midWeekTradesData.length} mid-week trades`);
      }

      // Build mid-week trades map by user
      const userMidWeekTrades = new Map<string, MidWeekTrade[]>();
      for (const t of midWeekTradesData) {
        if (!userMidWeekTrades.has(t.user_id)) {
          userMidWeekTrades.set(t.user_id, []);
        }
        userMidWeekTrades.get(t.user_id)!.push({
          symbol: t.symbol,
          action: t.action as 'buy' | 'sell',
          quantity: Number(t.quantity),
          price: Number(t.price),
          createdAt: new Date(t.created_at),
        });
      }

      // Fetch drafts for this league (needed for fallback if no snapshots, and for
      // the all-cash ledger proof below)
      const { data: drafts, error: draftsErr } = await supabase
        .from('drafts')
        .select('user_id, symbol, entry_price, quantity')
        .eq('league_id', leagueId);

      // Fetch trades for this league (needed for fallback if no snapshots).
      // Bound to week_end so fallback holdings reflect state AS OF week_end, not
      // NOW. Without this, a user who held positions DURING the week but SOLD them
      // after week_end shows empty holdings -> hasPositions=false -> auto-loss,
      // flipping a legitimate win to a loss. (This only fixes WHICH trades count
      // toward holdings; calculatePortfolio is still cumulative-from-entry at
      // current prices — not a weekly delta.) weekEnd is normally truthy inside the
      // loop; guard anyway so a null bound never corrupts the query.
      let tradesQuery = supabase
        .from('trades')
        .select('user_id, symbol, action, quantity, price, created_at')
        .eq('league_id', leagueId);
      if (weekEnd) {
        tradesQuery = tradesQuery.lte('created_at', weekEnd);
      }
      const { data: trades, error: tradesErr } = await tradesQuery;

      // ---- The all-cash ledger proof (THE ALL-CASH RULE in ./scoring-eligibility.ts)
      // A snapshot-less user is not necessarily a broken snapshot: snapshot-week-start
      // only snapshots HELD symbols, so a user sitting in cash correctly has no row.
      // They may be scored as all-cash ONLY when drafts + trades prove them flat at
      // BOTH week_start and week_end. Computed before the batch guard because a
      // batch whose participants are ALL cash is complete, not broken.
      const ledgerStates = new Map<string, LedgerState>();
      for (const userId of userIds) {
        ledgerStates.set(
          userId,
          ledgerPositionState(userId, drafts || [], trades || [], weekStart, weekEnd),
        );
      }
      const allParticipantsCashOnly = userIds.size > 0 && [...userIds].every((userId) =>
        decideUserScorer({
          hasSnapshot: (userSnapshots.get(userId)?.length ?? 0) > 0,
          // Per-user, like the main loop below (userWeekEndPricesComplete's
          // doc) — though for THIS check it can never change the outcome: a
          // user reaching 'cash_only' has hasSnapshot=false, and
          // hasWeekEndPrices only matters when hasSnapshot is true. Computed
          // the same way regardless, so there is one source of truth.
          hasWeekEndPrices: userWeekEndPricesComplete(userSnapshots.get(userId) || []),
          weekNumber,
          ledger: ledgerStates.get(userId),
        }) === 'cash_only'
      );
      // supabase-js resolves `{ data, error }` rather than throwing. A failed query's
      // null data would read, via the `|| []` above, as "no rows" — no snapshots,
      // no holdings, everyone FLAT. Never score off that: refuse the batch.
      const scoringInputsFetchFailed =
        !!snapshotErr || !!draftsErr || !!tradesErr || !!midWeekTradesErr;
      // -------------------------------------------------------------------------

      // weekStart / weekEnd are destructured from the batch above (the whole batch
      // is one (league, week), so the window is shared) and drive the mid-week
      // trade query and the stale-week guard below.

      // ---- GUARDS 1 & 2: never fabricate results from the snapshot-less path ---
      // The snapshot-less fallback (calculatePortfolio) values holdings at TODAY's
      // market and returns CUMULATIVE gain from draft entry — not this week's
      // delta. Scoring off it fabricates results, and because league_standings
      // increments are irreversible, a re-run cannot undo it. Two batch-level
      // refusals (decision extracted + unit-tested in ./scoring-eligibility.ts —
      // see scoring-eligibility.test.ts):
      //   'stale_no_snapshots'     — snapshot-less week ended > FALLBACK_MAX_AGE_HOURS
      //                              ago (e.g. an Alpaca outage silently skipped
      //                              snapshots days back); every such week would
      //                              score the same cumulative number.
      //   'no_snapshots_week_gt_1' — snapshot-less week past week 1; even inside the
      //                              freshness window, cumulative-from-entry is
      //                              all-time P/L, not a weekly delta.
      // Either way: skip the whole batch, leave team1_gain NULL so the week stays
      // visible as pending work and becomes scoreable once snapshots are backfilled.
      const hasSnapshots = (snapshotData?.length ?? 0) > 0;
      const weekAgeHours = weekEnd
        ? (now.getTime() - new Date(weekEnd).getTime()) / 3_600_000
        : Number.POSITIVE_INFINITY;

      const batchDecision = decideBatchScoring({
        hasSnapshots,
        weekAgeHours,
        weekNumber,
        fallbackMaxAgeHours: FALLBACK_MAX_AGE_HOURS,
        scoringInputsFetchFailed,
        allParticipantsCashOnly,
      });
      if (batchDecision.action === 'skip') {
        // Distinct log + skipped[] shape per reason (the stale skip additionally
        // records week_age_hours) — the DECISION is single-sourced in the module,
        // the PRESENTATION stays here.
        if (batchDecision.reason === BATCH_SKIP_REASON.SCORING_INPUTS_FETCH_FAILED) {
          console.error(
            `SKIP league ${leagueId} week ${weekNumber}: a scoring-input query failed ` +
            `(snapshots: ${JSON.stringify(snapshotErr)}, drafts: ${JSON.stringify(draftsErr)}, ` +
            `trades: ${JSON.stringify(tradesErr)}, mid-week trades: ${JSON.stringify(midWeekTradesErr)}) ` +
            `— refusing to read a failed query as "no rows".`
          );
          skipped.push({
            league_id: leagueId,
            week_number: weekNumber,
            matchups: leagueMatchups.length,
            reason: batchDecision.reason,
          });
        } else if (batchDecision.reason === BATCH_SKIP_REASON.STALE_NO_SNAPSHOTS) {
          console.error(
            `SKIP league ${leagueId} week ${weekNumber}: no week_snapshots and week ` +
            `ended ${weekAgeHours.toFixed(1)}h ago (> ${FALLBACK_MAX_AGE_HOURS}h) — ` +
            `refusing to back-score with current prices.`
          );
          skipped.push({
            league_id: leagueId,
            week_number: weekNumber,
            matchups: leagueMatchups.length,
            week_age_hours: Math.round(weekAgeHours),
            reason: batchDecision.reason,
          });
        } else {
          console.error(
            `SKIP league ${leagueId} week ${weekNumber}: no week_snapshots and ` +
            `week_number > 1 — refusing cumulative-from-entry fallback (it is ` +
            `all-time P/L, not a weekly delta).`
          );
          skipped.push({
            league_id: leagueId,
            week_number: weekNumber,
            matchups: leagueMatchups.length,
            reason: batchDecision.reason,
          });
        }
        continue; // no matchup write, no standings increment
      }
      // -------------------------------------------------------------------------

      // Get all symbols (from snapshots or drafts/trades)
      const symbols = new Set<string>(snapshotSymbols);
      if (snapshotSymbols.size === 0) {
        for (const d of drafts || []) {
          // A SKIP row is a forfeited pick, not a ticker to quote.
          if (d.symbol && d.symbol.toUpperCase() !== SKIP_SYMBOL) symbols.add(d.symbol.toUpperCase());
        }
        for (const t of trades || []) {
          if (t.symbol) symbols.add(t.symbol.toUpperCase());
        }
      }

      // Fetch current prices
      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && symbols.size > 0) {
        prices = await fetchPrices(Array.from(symbols), ALPACA_KEY, ALPACA_SECRET);
      }

      // ---- GUARD 3a: per-user gate — the residual of the cumulative-vs-delta bug
      // The batch guards above key off hasSnapshots, which is true if ANYONE in
      // this league-week has a snapshot. But the scorer is chosen per-user here, so
      // in a PARTIALLY-snapshotted week>1 (some users snapshotted, one not — e.g.
      // Alpaca returned no price for that user's only symbol) a snapshot-less user
      // would still reach the cumulative-from-entry fallback (all-time P/L, not a
      // weekly delta). decideUserScorer marks such a user 'unscoreable'; the matchup
      // loop below refuses any matchup they're in rather than fabricating a score.
      // A snapshotted-but-unclosed user (S7) is the other unscoreable kind,
      // 'close_incomplete' — see ./scoring-eligibility.ts.
      // unscoreableUsers maps userId -> WHY (the specific MatchupRefusalReason),
      // not just THAT, so decideMatchupScoring and the skipped[] payload can tell
      // "never snapshotted" apart from "close never completed".
      const userScores = new Map<string, UserScore>();
      const unscoreableUsers = new Map<string, MatchupRefusalReason>();
      for (const userId of userIds) {
        const snapshots = userSnapshots.get(userId) || [];
        const midWeekTrades = userMidWeekTrades.get(userId) || [];

        const ledger = ledgerStates.get(userId);
        // THIS USER's OWN rows, all priced — not "some row in the batch has a
        // price". See userWeekEndPricesComplete's doc: a batch-level flag here
        // let a genuine partial write from snapshot-week-end's non-atomic
        // per-row update loop silently drop one user's unpriced position
        // instead of refusing it (found in review of this very fix).
        const hasWeekEndPrices = userWeekEndPricesComplete(snapshots);
        const scorerKind = decideUserScorer({
          hasSnapshot: snapshots.length > 0,
          hasWeekEndPrices,
          weekNumber,
          ledger,
        });

        if (scorerKind === 'full') {
          // Use new scoring system with week_start_price, week_end_price, and mid-week trades
          const score = calculateUserScore(userId, snapshots, midWeekTrades);
          userScores.set(userId, score);
          console.log(`User ${userId}: Dollar gain: $${score.dollarGain.toFixed(2)}, Percent: ${score.percentGain.toFixed(2)}%`);
        } else if (scorerKind === 'close_incomplete') {
          // This user has a week_snapshots row, but at least one of THEIR OWN
          // rows has no week_end_price yet. week_end has already passed (the
          // top-level query), so this only ever means snapshot-week-end hasn't
          // finished closing this user's rows — never score from live prices
          // (S7), and never assume another user's closed row means THIS user
          // is closed too. Refuse; enforced at the matchup level below. The
          // heal crons (22:00Z Friday, Saturday) re-run this once this user's
          // own close actually finishes.
          unscoreableUsers.set(userId, MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_CLOSE_PRICE);
          console.error(
            `UNSCOREABLE (close incomplete) user ${userId} in league ${leagueId} week ${weekNumber}: ` +
            `has a week_snapshot but no week_end_price — snapshot-week-end has not finished closing ` +
            `this week. Refusing to score from live prices. Matchup will be left pending for the heal crons.`
          );
        } else if (scorerKind === 'cash_only') {
          // No snapshot, and the ledger proves nothing was held at week_start OR at
          // week_end — so no snapshot row was ever expected, and every in-week lot
          // is a closed round trip priced from trades alone. Not a fallback: no
          // current prices, no cumulative-from-entry.
          const score = scoreCashOnlyUser(userId, midWeekTrades, ledger!.hasLedgerHistory);
          userScores.set(userId, score);
          console.log(
            `User ${userId}: scored as ALL-CASH (ledger flat at week_start and week_end, ` +
            `no week_snapshot expected). Dollar gain: $${score.dollarGain.toFixed(2)}, ` +
            `Percent: ${score.percentGain.toFixed(2)}%, hasPositions: ${score.hasPositions}`
          );
        } else if (scorerKind === 'unscoreable') {
          // Snapshot-less user AFTER week 1: refuse rather than write a fabricated
          // score. Recorded here, enforced at the matchup level below.
          unscoreableUsers.set(userId, MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT);
          console.error(
            `UNSCOREABLE user ${userId} in league ${leagueId} week ${weekNumber}: ` +
            `no week_snapshot, ledger shows holdings at week_start or week_end, and ` +
            `week_number > 1 — refusing cumulative-from-entry ` +
            `fallback (all-time P/L, not a weekly delta). Matchup will be left pending.`
          );
        } else {
          // scorerKind === 'fallback' — week 1 only: draft entry ~= week-1 start
          // price, so cumulative-from-entry is an acceptable proxy.
          const portfolio = calculatePortfolio(userId, drafts || [], trades || [], prices);
          userScores.set(userId, {
            dollarGain: portfolio.gain,
            percentGain: portfolio.totalCost > 0 ? (portfolio.gain / portfolio.totalCost) * 100 : 0,
            hasPositions: portfolio.holdings.length > 0
          });
        }
      }
      // -------------------------------------------------------------------------

      // Process each matchup
      for (const matchup of leagueMatchups) {
        // ---- GUARD 3b: matchup-level semantics for the per-user gate above -------
        // If EITHER participant is unscoreable (snapshot-less past week 1), refuse
        // the whole matchup: leave team1_gain NULL so it stays visible as pending
        // work and becomes scoreable after a snapshot backfill + re-run. The re-run
        // is idempotent — the top-level `.is('team1_gain', null)` re-selects only
        // still-NULL matchups; already-scored ones drop out, so no double count.
        // Writing a one-sided/fabricated result here would increment standings
        // irreversibly. Bye weeks have team2_user_id NULL, so only team1 gates.
        // Decision extracted + unit-tested in ./scoring-eligibility.ts (this is the
        // composition point pinned by the partially-snapshotted-week regression).
        const matchupDecision = decideMatchupScoring(
          matchup.team1_user_id,
          matchup.team2_user_id,
          unscoreableUsers,
        );
        if (matchupDecision.action === 'refuse') {
          console.error(
            `SKIP matchup ${matchup.id} (league ${leagueId} week ${matchup.week_number}): ` +
            `unscoreable participant (no week_snapshot, week > 1) — leaving team1_gain ` +
            `NULL pending snapshot backfill.`
          );
          skipped.push({
            league_id: leagueId,
            week_number: matchup.week_number,
            matchup_id: matchup.id,
            reason: matchupDecision.reason,
          });
          continue; // no matchup write, no standings increment
        }
        // -------------------------------------------------------------------------

        // Check for bye week (team2_user_id is null) - only in regular season
        const isByeWeek = !matchup.team2_user_id && !matchup.is_playoff;
        const isPlayoff = matchup.is_playoff === true;

        const team1Score = userScores.get(matchup.team1_user_id) ?? { dollarGain: 0, percentGain: 0, hasPositions: false };
        const team1Gain = team1Score.dollarGain;

        // On a bye there is no opponent, so team2 keeps the zero default and
        // team2Gain stays 0 — identical to the previous `let` initialisation.
        const team2Score: UserScore = isByeWeek
          ? { dollarGain: 0, percentGain: 0, hasPositions: false }
          : (userScores.get(matchup.team2_user_id) ?? { dollarGain: 0, percentGain: 0, hasPositions: false });
        const team2Gain = isByeWeek ? 0 : team2Score.dollarGain;

        // Winner determination is decided in ./playoff-progression.ts — pure and
        // unit-tested. Both former defects are fixed there: a both-empty PLAYOFF
        // matchup now resolves by seed (so the finals placeholder gets filled),
        // and the advancing seed is derived from the actual winner.
        // See playoff-progression.test.ts.
        // Casts, not conversions — erased at runtime, so behaviour is unaffected.
        // grouping.ts's MatchupRow types every column it does not itself read as
        // `unknown` (an index signature), so these fields arrive untyped. The old
        // inline code hid that by assigning them into pre-declared `let`s; the
        // module's typed parameter surfaces it at the boundary instead. Narrowing
        // here is the smallest honest fix — widening MatchupRow would change a
        // tested module's contract for a purely local need.
        const progressionMatchup = {
          team1UserId: matchup.team1_user_id as string,
          team2UserId: matchup.team2_user_id as string | null,
          team1Seed: matchup.team1_seed as number | null,
          team2Seed: matchup.team2_seed as number | null,
          isPlayoff,
          playoffRound: matchup.playoff_round as PlayoffRound | null,
        };
        const outcome = decideMatchupOutcome(progressionMatchup, team1Score, team2Score);
        const { winnerId, isTie, team1Won, team2Won } = outcome;

        // Logging stays here, keyed off outcome.reason, so the operational log
        // surface is byte-identical to the inline version. The module decides;
        // index.ts presents — same split as grouping.ts / scoring-eligibility.ts.
        switch (outcome.reason) {
          case 'bye_no_result':
            console.log(`Processing bye week for user ${matchup.team1_user_id} (no result)`);
            break;
          case 'both_empty_tie':
            console.log(`Both teams have empty portfolios - tie`);
            break;
          case 'both_empty_playoff_seed_tiebreak':
            console.log(
              `Both teams have empty portfolios in a PLAYOFF - seed tiebreaker: ` +
              `seed ${matchup.team1_seed || 999} vs ${matchup.team2_seed || 999}, winner: ${winnerId}`
            );
            break;
          case 'playoff_no_opponent':
            console.log(`Playoff matchup has no opponent (unfilled slot) - ${winnerId} advances`);
            break;
          case 'team1_empty_auto_loss':
            console.log(`Team 1 has empty portfolio - automatic loss`);
            break;
          case 'team2_empty_auto_loss':
            console.log(`Team 2 has empty portfolio - automatic loss`);
            break;
          case 'percent_tiebreak':
            console.log(
              `Dollar tie ($${team1Gain.toFixed(2)}), Team ${team1Won ? 1 : 2} wins on percent ` +
              `(${(team1Won ? team1Score : team2Score).percentGain.toFixed(2)}% vs ` +
              `${(team1Won ? team2Score : team1Score).percentGain.toFixed(2)}%)`
            );
            break;
          case 'playoff_seed_tiebreak':
            console.log(
              `Playoff double-tie, seed tiebreaker: seed ${matchup.team1_seed || 999} vs ` +
              `${matchup.team2_seed || 999}, winner: ${winnerId}`
            );
            break;
          case 'regular_season_true_tie':
            console.log(
              `True tie - both dollar ($${team1Gain.toFixed(2)}) and percent ` +
              `(${team1Score.percentGain.toFixed(2)}%) are equal`
            );
            break;
          // 'dollar_gain' logged nothing before; it still logs nothing.
        }
        // Update matchup with results
        const { error: updateErr } = await supabase
          .from('matchups')
          .update({
            team1_gain: team1Gain,
            team2_gain: isByeWeek ? null : team2Gain, // null for bye weeks
            winner_user_id: winnerId,
            is_tie: isTie,
          })
          .eq('id', matchup.id);

        if (updateErr) {
          console.error(`Failed to update matchup ${matchup.id}:`, updateErr);
          continue;
        }

        // For playoff matchups, advance winner to next round.
        // willAdvanceWinner is `isPlayoff && !!winnerId` — the same gate as before,
        // and the one DEFECT 1 trips when a playoff matchup ends both-empty.
        if (willAdvanceWinner(progressionMatchup, outcome)) {
          // deno-lint-ignore no-explicit-any
          const pm = matchup as any; // batch rows are untyped supabase rows
          const playoffTeams = pm.leagues?.playoff_teams;
          const advanced = isValidPlayoffTeams(playoffTeams)
            ? await advancePlayoffWinner(supabase, leagueId, {
                roundNumber: pm.playoff_round_number,
                position: pm.bracket_position,
                team1UserId: pm.team1_user_id,
                team2UserId: pm.team2_user_id,
                team1Seed: pm.team1_seed,
                team2Seed: pm.team2_seed,
              }, winnerId!, playoffShape(playoffTeams).weeks)
            : { ok: false as const, reason: `invalid_playoff_teams: ${String(playoffTeams)}` };
          if (!advanced.ok) {
            // The game IS scored; only the advance failed. Reported now and
            // retried by healMissedAdvances on the next run.
            console.error(`Playoff advance failed for matchup ${matchup.id}: ${advanced.reason}`);
            skipped.push({ league_id: leagueId, week_number: weekNumber, matchup_id: matchup.id, reason: advanced.reason });
          }
        }

        // Helper to update standings with proper increment
        async function updateUserStandings(
          lgId: string,
          oderId: string,
          inc: RecordIncrement,
          pointsFor: number,
          pointsAgainst: number
        ) {
          // Increments come from standingsIncrements: a bye adds no W/L/T (it is
          // not a game played); a tie adds only to ties.
          const winsIncrement = inc.wins;
          const lossesIncrement = inc.losses;
          const tiesIncrement = inc.ties;

          // First try to get existing record
          const { data: existing } = await supabase
            .from('league_standings')
            .select('*')
            .eq('league_id', lgId)
            .eq('user_id', oderId)
            .single();

          if (existing) {
            // Update existing - increment values
            const { error } = await supabase
              .from('league_standings')
              .update({
                wins: Number(existing.wins) + winsIncrement,
                losses: Number(existing.losses) + lossesIncrement,
                ties: Number(existing.ties) + tiesIncrement,
                points_for: Number(existing.points_for) + pointsFor,
                points_against: Number(existing.points_against) + pointsAgainst,
                updated_at: new Date().toISOString(),
              })
              .eq('league_id', lgId)
              .eq('user_id', oderId);
            return error;
          } else {
            // Insert new
            const { error } = await supabase
              .from('league_standings')
              .insert({
                league_id: lgId,
                user_id: oderId,
                wins: winsIncrement,
                losses: lossesIncrement,
                ties: tiesIncrement,
                points_for: pointsFor,
                points_against: pointsAgainst,
              });
            return error;
          }
        }

        // Only update standings for regular season matchups (not playoffs)
        if (!isPlayoff) {
          const increments = standingsIncrements(outcome);
          // Team 1 standings update. On a bye: no W/L/T, but the week's real
          // gain still counts toward season gain; points_against is 0.
          const stand1Err = await updateUserStandings(
            leagueId,
            matchup.team1_user_id,
            increments.team1,
            team1Gain,
            isByeWeek ? 0 : team2Gain
          );
          if (stand1Err) {
            console.error(`Failed to update standings for ${matchup.team1_user_id}:`, stand1Err);
          }

          // Team 2 standings update (none on a bye: increments.team2 is null)
          if (increments.team2) {
            const stand2Err = await updateUserStandings(
              leagueId,
              matchup.team2_user_id,
              increments.team2,
              team2Gain,
              team1Gain
            );
            if (stand2Err) {
              console.error(`Failed to update standings for ${matchup.team2_user_id}:`, stand2Err);
            }
          }
        }

        processedCount++;
        results.push({
          matchupId: matchup.id,
          week: matchup.week_number,
          team1: matchup.team1_user_id,
          team2: matchup.team2_user_id,
          team1Gain,
          team2Gain: isByeWeek ? null : team2Gain,
          winner: winnerId,
          isByeWeek,
          isPlayoff,
          playoffRound: matchup.playoff_round,
        });
      }

      // Check if all matchups for this batch's week are done, and advance if so.
      // One batch == one (league, week), so this runs at most once per week —
      // the same cardinality as the previous per-league loop over unique weeks.
      // Multi-week catch-up still works because batches are sorted week-ascending
      // and current_week is re-read from the DB here on every batch.
      const numWeeks = leagueMatchups[0]?.leagues?.num_weeks || 0;
      const playoffTeams: number | null = leagueMatchups[0]?.leagues?.playoff_teams ?? null;

      // Re-read current_week from DB (may have changed from a prior batch)
      const { data: leagueData } = await supabase
        .from('leagues')
        .select('current_week, season_status')
        .eq('id', leagueId)
        .single();

      const currentWeek = leagueData?.current_week || 1;
      const seasonCompleted = leagueData?.season_status === 'completed';

      // Skip advancement if the season is already done, or if this batch is not
      // the league's current week (e.g. an earlier week was skipped by the stale
      // guard, so the league must not advance past it).
      if (!seasonCompleted && weekNumber === currentWeek) {
        // Check if all matchups for this week are processed
        const { data: remainingMatchups } = await supabase
          .from('matchups')
          .select('id')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek)
          .is('team1_gain', null);

        if (!remainingMatchups || remainingMatchups.length === 0) {
          const isPlayoffWeek = leagueMatchups.some(m => m.is_playoff);

          if (isPlayoffWeek) {
            // Was this the final? Keyed on the ADDRESS (round W of W), never on
            // the playoff_round label. An invalid P finds no final here; its
            // advance already refused above and is reported in skipped[].
            const playoffWeeks = isValidPlayoffTeams(playoffTeams) ? playoffShape(playoffTeams).weeks : null;
            const finalsMatchup = leagueMatchups.find(m => m.playoff_round_number === playoffWeeks);
            if (finalsMatchup) {
              // Finals completed — complete the season (do NOT advance current_week)
              const finalsWinner = results.find(r => r.matchupId === finalsMatchup.id)?.winner;
              if (finalsWinner) {
                const loserId = finalsMatchup.team1_user_id === finalsWinner
                  ? finalsMatchup.team2_user_id
                  : finalsMatchup.team1_user_id;
                // The game IS scored; only the completion write can still fail
                // (a bad rpc `{ error }`, checked here — CLAUDE.md "Success
                // signals" #5). A failure is reported and retried by
                // healUncompletedSeasons on the next run: never a silent,
                // fabricated "Season completed" log (the exact bug this fixes).
                const completion = await completeLeagueSeason(supabase, leagueId, finalsWinner, loserId);
                if (completion.ok) {
                  console.log(`Season completed for league ${leagueId} - Champion: ${finalsWinner}`);
                } else {
                  console.error(`Season completion failed for league ${leagueId}: ${completion.reason}`);
                  skipped.push({ league_id: leagueId, week_number: weekNumber, reason: completion.reason });
                  transitionsRefused++;
                }
              } else {
                console.error(`Finals processed but no winner determined for league ${leagueId}`);
              }
            } else {
              // Non-finals playoff round — advance for next round
              await supabase.from('leagues')
                .update({ current_week: currentWeek + 1 })
                .eq('id', leagueId);
              console.log(`Advanced playoff week for league ${leagueId} to ${currentWeek + 1}`);
            }

          } else if (currentWeek >= numWeeks) {
            // Last regular-season week just completed. A refusal writes nothing,
            // so the heal pass at the top of the next run retries it.
            const transition = await transitionAfterRegularSeason(supabase, leagueId, numWeeks, playoffTeams, currentWeek);
            if (!transition.ok) {
              console.error(`REFUSED season transition for league ${leagueId}: ${transition.reason}`);
              skipped.push({ league_id: leagueId, week_number: weekNumber, reason: transition.reason });
              transitionsRefused++;
            }

          } else {
            // Mid-season — advance normally
            await supabase.from('leagues')
              .update({ current_week: currentWeek + 1 })
              .eq('id', leagueId);
            console.log(`Advanced league ${leagueId} to week ${currentWeek + 1}`);
          }
        }
      }

    }

    console.log(`Processed ${processedCount} matchups`);

    // Update status to success. Always with a summary — never NULL — so the
    // message column is never a scored-vs-nothing-to-do discriminator.
    await updateJobStatus(
      supabase, JOB_NAME, 'success', 1,
      scoredMessage(processedCount, skipped.length - transitionsRefused, transitionsRefused),
    );

    return json({
      message: 'Processing complete',
      processed: processedCount,
      results,
      skipped,
      skipped_count: skipped.length,
    });

  } catch (e) {
    console.error('Unhandled error:', e);

    // Update status to failed
    await updateJobStatus(supabase, JOB_NAME, 'failed', 1, String(e));

    return json({ error: 'Unhandled error', message: String(e) }, 500);
  }
});
