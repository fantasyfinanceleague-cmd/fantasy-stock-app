import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  classifyCoverage,
  selectMissingHoldings,
  buildPricedRows,
  planWeekWindow,
  type Holding,
} from './plan.ts';
import { checkSnapshotReads, matchupParticipants, snapshotHoldings } from '../_shared/snapshot-holdings.ts';
import type { CalendarSession, Coverage as MarketCalendarCoverage } from '../_shared/week-window.ts';

/**
 * Snapshot Week Start Prices
 *
 * Runs on a fixed cron ('35 14 * * 1,2' — Monday and Tuesday, both ~9:35 AM
 * ET in EST) to capture each league's week-start baseline, but the cron
 * schedule is no longer what decides which day's prices get used or which
 * trades count. That decision is ./plan.ts's planWeekWindow, built on the
 * single-cut fix (../_shared/week-window.ts,
 * docs/audits/2026-09-30-week-window-audit.md): each league-week has ONE
 * real market-open instant (this week's first trading-day open, from
 * market_calendar) and the cron just checks per-league whether `now` has
 * reached it yet ('not_due' if not — the Tuesday run of a normal week hits
 * this every single time and correctly no-ops, since Monday's run already
 * handled it). This REPLACES the old Alpaca-/v2/calendar holiday check and
 * the Monday/Tuesday day-of-week branch entirely: a stale Alpaca key
 * returning a 401 used to read as "market closed" (CLAUDE.md "success
 * signals" #1) and silently skip every Monday; the calendar table is now the
 * only source of "is this a trading day."
 *
 * For each active matchup league:
 * 1. Compute this week's real cut (planWeekWindow) from market_calendar;
 *    skip leagues not yet due, retry leagues the calendar can't answer for yet.
 * 2. The FIRST run for a league-week (zero existing week_snapshots) rewrites
 *    matchups.week_start/week_end to the real cut, so every other consumer
 *    (process-week-results' trade window, get_home_league, mobile) sees the
 *    same real instants. A league already snapshotted under the OLD nominal
 *    window is NEVER re-windowed (see planWeekWindow's `rewrite` doc).
 * 3. Get all users' holdings from drafts + trades with created_at STRICTLY
 *    BEFORE the cut's open instant — not "all trades as of whenever this
 *    cron happens to run" (the Monday-gap defect, S1/S2/S3/S4 in the audit).
 * 4. Fetch official opening prices for the cut's own session date — not
 *    "today" (a Tuesday heal run used to re-price everyone at TUESDAY's
 *    open; it now uses the SAME date Monday's run would have).
 * 5. Insert snapshots into week_snapshots table
 *
 * Includes retry logic: up to 3 retries with 5-minute intervals
 */

function env(k: string) { return Deno.env.get(k) ?? ''; }

const ALPACA_BASE = 'https://data.alpaca.markets/v2';
const MAX_RETRIES = 3;

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

// Holding is defined in ./plan.ts (the pure planner) and imported above so the
// handler and the unit-tested decisions share one shape.

// isMarketOpenToday (Alpaca /v2/calendar) was REMOVED here — it decided the
// Monday-holiday skip from a LIVE Alpaca call, and a 401 from a stale key
// read as "market closed" (CLAUDE.md "success signals" #1), silently
// skipping every Monday. planWeekWindow's 'not_due' check (market_calendar,
// fetched once below as marketCalendarSessions/marketCalendarCoverage)
// replaces it for every league.

// Fetch every market_calendar row plus the single market_calendar_coverage
// row, ONCE per invocation (not per league — the calendar isn't
// league-specific). ~97 days of sessions per refresh-market-calendar's own
// LOOKBACK/LOOKAHEAD window, so this is a small, cheap read.
async function fetchMarketCalendar(
  supabase: any,
): Promise<{ sessions: CalendarSession[]; coverage: MarketCalendarCoverage | null; error: unknown }> {
  const [sessionsRes, coverageRes] = await Promise.all([
    supabase.from('market_calendar').select('session_date, open_et, close_et'),
    supabase.from('market_calendar_coverage').select('covered_from, covered_through').maybeSingle(),
  ]);
  if (sessionsRes.error || coverageRes.error) {
    return { sessions: [], coverage: null, error: sessionsRes.error ?? coverageRes.error };
  }
  const sessions: CalendarSession[] = (sessionsRes.data ?? []).map((r: any) => ({
    sessionDate: r.session_date,
    openEt: String(r.open_et).slice(0, 5), // Postgres TIME -> 'HH:MM:SS'; weekCut wants 'HH:MM'
    closeEt: String(r.close_et).slice(0, 5),
  }));
  const coverage: MarketCalendarCoverage | null = coverageRes.data
    ? { from: coverageRes.data.covered_from, through: coverageRes.data.covered_through }
    : null;
  return { sessions, coverage, error: null };
}

// Update job status for retry tracking
async function updateJobStatus(
  supabase: any,
  jobName: string,
  status: 'running' | 'success' | 'failed' | 'retrying',
  attemptNumber: number,
  errorMessage?: string
) {
  const today = new Date().toISOString().split('T')[0];

  try {
    await supabase
      .from('cron_job_status')
      .upsert({
        job_name: jobName,
        run_date: today,
        status,
        attempt_number: attemptNumber,
        error_message: errorMessage || null,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'job_name,run_date'
      });
  } catch (e) {
    console.error('Failed to update job status:', e);
  }
}

// Schedule a retry via the database function
// Returns true only if the retry was actually scheduled.
//
// The try/catch below is NOT what makes a failure here visible — supabase-js
// resolves `.rpc()` to { data, error } and does NOT throw on a Postgres error, so
// the catch only ever sees transport failures. This function previously discarded
// the result entirely and then logged "Scheduled retry N for X" unconditionally.
// For the whole life of the schedule_snapshot_retry timestamptz bug that log line
// asserted success on every single call while nothing was ever scheduled — a
// fabricated positive, which is worse than silence. Check `error` explicitly.
async function scheduleRetry(supabase: any, jobName: string, attemptNumber: number): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('schedule_snapshot_retry', {
      p_job_name: jobName,
      p_attempt: attemptNumber
    });
    if (error) {
      console.error(
        `FAILED to schedule retry ${attemptNumber} for ${jobName} — this run will NOT be re-attempted:`,
        error.message ?? error
      );
      return false;
    }
    console.log(`Scheduled retry ${attemptNumber} for ${jobName}`);
    return true;
  } catch (e) {
    console.error(`FAILED to schedule retry ${attemptNumber} for ${jobName} (transport):`, e);
    return false;
  }
}

/**
 * Fetch official opening prices from Alpaca bars, for `sessionDate` — the
 * cut's OWN openSessionDate (planWeekWindow), never "today". A Tuesday heal
 * run for a week that opened Monday must price at MONDAY's bar, not
 * Tuesday's — using "today" here was exactly S3's defect (the Tuesday heal
 * re-based an all-cash Monday buyer at Tuesday's open instead of Monday's).
 *
 * The latest-quote FALLBACK is only meaningful for the current day (a "latest
 * quote" reflects right now, not `sessionDate`), so it is skipped entirely
 * when `sessionDate` isn't today — a missing historical bar stays missing
 * (this league aborts and retries) rather than being silently mislabeled
 * with today's price.
 */
async function fetchOpenPrices(
  symbols: string[],
  alpacaKey: string,
  alpacaSecret: string,
  sessionDate: string,
): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  if (symbols.length === 0) return prices;

  const symbolsParam = symbols.join(',');

  // Use bars endpoint to get official OHLCV data
  const url = `${ALPACA_BASE}/stocks/bars?symbols=${encodeURIComponent(symbolsParam)}&timeframe=1Day&start=${sessionDate}&end=${sessionDate}&feed=iex`;

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
      if (data.bars) {
        for (const [sym, bars] of Object.entries(data.bars as Record<string, any[]>)) {
          // Get the most recent bar's open price
          const latestBar = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1] : null;
          const openPrice = latestBar?.o ? Number(latestBar.o) : 0;
          if (openPrice > 0) prices.set(sym.toUpperCase(), openPrice);
        }
      }
    }
  } catch (e) {
    console.error('Failed to fetch bar prices:', e);
  }

  // Fallback to quotes for any missing symbols — ONLY when sessionDate is
  // today (see the function doc). A missing bar for a PAST session date must
  // stay missing, not be silently filled with a live quote mislabeled as that
  // day's open.
  const isToday = sessionDate === new Date().toISOString().split('T')[0];
  const missingSymbols = isToday ? symbols.filter(s => !prices.has(s.toUpperCase())) : [];
  if (missingSymbols.length > 0) {
    console.log(`Falling back to quotes for ${missingSymbols.length} symbols:`, missingSymbols);
    const quotesUrl = `${ALPACA_BASE}/stocks/quotes/latest?symbols=${encodeURIComponent(missingSymbols.join(','))}&feed=iex`;

    try {
      const res = await fetch(quotesUrl, {
        headers: {
          'APCA-API-KEY-ID': alpacaKey,
          'APCA-API-SECRET-KEY': alpacaSecret,
          'Accept': 'application/json',
        },
      });

      if (res.ok) {
        const data = await res.json();
        if (data.quotes) {
          for (const [sym, quote] of Object.entries(data.quotes as Record<string, any>)) {
            const price = Number(quote?.ap) || Number(quote?.bp) || 0;
            if (price > 0 && !prices.has(sym.toUpperCase())) {
              prices.set(sym.toUpperCase(), price);
            }
          }
        }
      }
    } catch (e) {
      console.error('Failed to fetch fallback quotes:', e);
    }
  }

  return prices;
}

// Holdings come from ../_shared/snapshot-holdings.ts (shared with
// snapshot-week-end). The local copy this replaced coerced the SKIP sentinel's
// quantity 0 to a 1-share 'SKIP' holding (`quantity || 1`), which no price could
// satisfy, so it aborted the whole league's snapshot on every retry.

Deno.serve(async (req) => {
  // SECURITY: validate the apikey before anything else — before DB connection or
  // business logic. This function runs with verify_jwt=false, so this guard is the
  // only thing protecting it.
  if (!isAuthorized(req)) {
    return unauthorized();
  }

  const JOB_NAME = 'snapshot-week-start';
  console.log('Snapshotting week start prices...');

  const SUPABASE_URL = env('SUPABASE_URL');
  const SECRET_KEY = env('SB_SECRET_KEY_INTERNAL');
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!SUPABASE_URL || !SECRET_KEY) {
    return json({ error: 'Missing Supabase configuration' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SECRET_KEY);

  // Get retry attempt from header (set by retry mechanism)
  const retryAttempt = parseInt(req.headers.get('X-Retry-Attempt') || '1');

  // Update status to running
  await updateJobStatus(supabase, JOB_NAME, 'running', retryAttempt);

  try {
    // 0. Read the market calendar ONCE for this whole run (not league-specific).
    //    A failed read or a stale coverage window means every league whose week
    //    needs the calendar aborts this run and retries — never silently
    //    default to "no trading days" (CLAUDE.md "success signals" #1), which
    //    is exactly what the OLD Alpaca-/v2/calendar check risked on a 401.
    const { sessions: marketCalendarSessions, coverage: marketCalendarCoverage, error: calendarErr } =
      await fetchMarketCalendar(supabase);
    if (calendarErr) {
      console.error('Failed to read market_calendar:', calendarErr);
      throw new Error(`Failed to read market_calendar: ${(calendarErr as any).message ?? calendarErr}`);
    }

    // 1. Find all active matchup leagues and their current week
    const { data: leagues, error: leaguesErr } = await supabase
      .from('leagues')
      .select('id, current_week, num_weeks')
      .eq('league_type', 'matchup')
      .not('current_week', 'is', null);

    if (leaguesErr) {
      // Throw into the catch below so this run gets a terminal status and a
      // retry. Returning 500 here used to leave cron_job_status stranded at
      // 'running' with no retry scheduled.
      console.error('Error fetching leagues:', leaguesErr);
      throw new Error(`Failed to fetch leagues: ${leaguesErr.message ?? leaguesErr}`);
    }

    if (!leagues || leagues.length === 0) {
      console.log('No active matchup leagues found');
      return json({ message: 'No active matchup leagues', snapshots: 0 });
    }

    console.log(`Found ${leagues.length} active matchup leagues`);

    let totalSnapshots = 0;
    const results: any[] = [];
    // Set when a league is ABORTED this run — a missing price (per-league
    // all-or-nothing) or a failed read. Drives a single post-loop retry so the
    // gap self-heals, without throwing (which would abort the leagues that DID
    // snapshot).
    let anyIncomplete = false;

    // A failed read ABORTS the league for this run, exactly like a missing price:
    // never fall through to coverage with defaulted empty arrays (see
    // checkSnapshotReads in ../_shared/snapshot-holdings.ts).
    const abortOnFailedReads = (
      leagueId: string,
      week: number,
      failed: Array<{ read: string; message: string }>,
    ) => {
      anyIncomplete = true;
      console.error(
        `ABORT league ${leagueId} week ${week}: read failed — ` +
        failed.map((f) => `${f.read}: ${f.message}`).join('; ') +
        ` — refusing to classify coverage on missing inputs, will retry.`
      );
      results.push({ leagueId, week, snapshots: 0, incomplete: true, failedReads: failed.map((f) => f.read) });
    };

    for (const league of leagues) {
      const leagueId = league.id;
      const currentWeek = league.current_week;

      // NOTE: the "already snapshotted?" skip moved DOWN to the coverage gate
      // below (after holdings are known). It must test whether EVERY participant
      // with holdings has a snapshot — not merely that ANY row exists. The old
      // existence-only check made a partial write (a user whose only symbol lacked
      // a price ended up with zero rows) read as "done" and become permanently
      // unhealable: the retry skipped the league and the gap never filled. See
      // ./plan.ts.

      // 2. Get all matchups for current week to find all users. Extended with
      //    week_start/week_end/created_at — the inputs to planWeekWindow
      //    (single-cut fix) below.
      const matchupsRead = checkSnapshotReads({
        matchups: await supabase
          .from('matchups')
          .select('team1_user_id, team2_user_id, week_start, week_end, created_at')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek),
      });
      if (!matchupsRead.ok) {
        abortOnFailedReads(leagueId, currentWeek, matchupsRead.failed);
        continue;
      }
      const { matchups } = matchupsRead.rows;

      if (matchups.length === 0) {
        console.log(`No matchups found for league ${leagueId} week ${currentWeek}`);
        continue;
      }

      // ── Single-cut week window (S1-S4 fix) ──────────────────────────────────
      // Every matchup row for one (league, week) shares the same window, so
      // any row's week_start/week_end anchors the cut. `floor` is the EARLIEST
      // created_at across this league-week's rows (normally identical — all
      // inserted atomically by finalize_league_draft — but min() defensively
      // in case that ever isn't true). See ./plan.ts's planWeekWindow doc.
      const windowAnchor = new Date(matchups[0].week_start);
      const floorMs = Math.min(...matchups.map((m: any) => new Date(m.created_at).getTime()));
      const windowFloor = Number.isFinite(floorMs) ? new Date(floorMs) : null;
      const storedWeekStartIso = matchups[0].week_start;
      const storedWeekEndIso = matchups[0].week_end;

      // Cheap check BEFORE any further reads: 'not_due' and 'refuse' don't
      // depend on existingSnapshotCount (only the `rewrite` flag inside a
      // 'proceed' result does — recomputed below once that count is known).
      // This is what makes the common case (a Tuesday run of a normal,
      // already-Monday-snapshotted week) cost zero drafts/trades/snapshots
      // reads, mirroring the existing "no Alpaca call for a complete league"
      // discipline one step earlier.
      const earlyWindowPlan = planWeekWindow(
        new Date(), windowAnchor, windowFloor, marketCalendarSessions, marketCalendarCoverage,
        storedWeekStartIso, storedWeekEndIso, 0,
      );
      if (earlyWindowPlan.action === 'not_due') {
        console.log(`League ${leagueId} week ${currentWeek}: not due yet (this week's real open hasn't happened), skipping`);
        results.push({ leagueId, week: currentWeek, skipped: 'not_due' });
        continue;
      }
      if (earlyWindowPlan.action === 'refuse') {
        anyIncomplete = true;
        console.error(
          `ABORT league ${leagueId} week ${currentWeek}: week window refused (${earlyWindowPlan.reason}) — ` +
          `will retry.`
        );
        results.push({ leagueId, week: currentWeek, incomplete: true, windowRefused: earlyWindowPlan.reason });
        continue;
      }
      // ─────────────────────────────────────────────────────────────────────

      // Collect all participant IDs (null team2 = bye week). Bots are INCLUDED:
      // excluding them left every bot matchup unscoreable from week 2 on.
      const userIds = matchupParticipants(matchups);

      // 3–4. Fetch drafts + trades (holdings) and this week's existing snapshots
      //      (coverage). ALL must succeed before coverage is classified: a failed
      //      drafts/trades read would make everyone look empty ('none_expected',
      //      permanently skipped), and a failed snapshots read would make
      //      everyone look uncovered (re-upserting Monday's rows at today's price).
      const inputs = checkSnapshotReads({
        drafts: await supabase
          .from('drafts')
          .select('user_id, symbol, quantity')
          .eq('league_id', leagueId),
        // created_at is needed for the single-cut baseline filter below
        // (created_at < this week's real open) — the fix for the Monday-gap
        // defect (S1/S2/S3/S4): the OLD code read every trade with no time
        // bound at all, netting the ledger "as of whenever this cron happens
        // to run" instead of as of one fixed instant.
        trades: await supabase
          .from('trades')
          .select('user_id, symbol, action, quantity, created_at')
          .eq('league_id', leagueId),
        existingSnapshots: await supabase
          .from('week_snapshots')
          .select('user_id, week_end_price')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek),
      });
      if (!inputs.ok) {
        abortOnFailedReads(leagueId, currentWeek, inputs.failed);
        continue;
      }
      const { drafts, trades, existingSnapshots } = inputs.rows;

      // ── Re-derive the window now that existingSnapshots.length is known ────
      // (the cheap earlyWindowPlan above used a placeholder of 0 to decide
      // ONLY 'not_due'/'refuse' before this read; `rewrite` needs the real
      // count.) `now` moving forward between the two calls cannot flip
      // action away from 'proceed' — 'not_due' only ever gets LESS true as
      // time passes — but handled defensively rather than assumed.
      const windowPlan = planWeekWindow(
        new Date(), windowAnchor, windowFloor, marketCalendarSessions, marketCalendarCoverage,
        storedWeekStartIso, storedWeekEndIso, existingSnapshots.length,
      );
      if (windowPlan.action !== 'proceed') {
        console.log(`League ${leagueId} week ${currentWeek}: window plan changed to ${windowPlan.action} between reads, skipping this run`);
        results.push({ leagueId, week: currentWeek, skipped: windowPlan.action });
        continue;
      }

      // Rewrite matchups.week_start/week_end to the real cut — ONLY the
      // first time this league-week is ever snapshotted (windowPlan.rewrite
      // is false once ANY week_snapshots row exists; see planWeekWindow's
      // doc). Every OTHER consumer of these columns (process-week-results'
      // trade window, get_home_league, mobile) then sees the real instants
      // with no code change of its own.
      if (windowPlan.rewrite) {
        const oldStart = storedWeekStartIso, oldEnd = storedWeekEndIso;
        const { error: rewriteErr } = await supabase
          .from('matchups')
          .update({ week_start: windowPlan.open.toISOString(), week_end: windowPlan.close.toISOString() })
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek);
        if (rewriteErr) {
          // Abort rather than snapshot against a canonical window the stored
          // columns don't yet reflect — a later retry would otherwise see
          // existingSnapshots.length > 0 (from THIS run's own write, if we
          // pressed on) and skip the rewrite forever, permanently stuck on
          // the stale window while prices reflect the canonical one.
          anyIncomplete = true;
          console.error(`ABORT league ${leagueId} week ${currentWeek}: failed to rewrite matchups window:`, rewriteErr);
          results.push({ leagueId, week: currentWeek, incomplete: true, windowRewriteFailed: true });
          continue;
        }
        console.log(
          `League ${leagueId} week ${currentWeek}: rewrote matchups window ` +
          `${oldStart} .. ${oldEnd} -> ${windowPlan.open.toISOString()} .. ${windowPlan.close.toISOString()}`
        );
      }
      // ─────────────────────────────────────────────────────────────────────

      // 5. Calculate holdings for each user. Trades are filtered to STRICTLY
      //    BEFORE the window's real open — the single cut every consumer of
      //    "this week" now shares (in-week trades start at this same instant
      //    in process-week-results, which reads it off the matchups row this
      //    function just rewrote).
      const cutOpenIso = windowPlan.open.toISOString();
      const tradesBeforeOpen = trades.filter((t: any) => t.created_at < cutOpenIso);
      const userHoldings = new Map<string, Holding[]>();
      for (const userId of userIds) {
        userHoldings.set(userId, snapshotHoldings(userId, drafts, tradesBeforeOpen));
      }

      // ── Coverage gate (replaces the old existence-only skip) ────────────────
      // Fetch which participants already have a snapshot (and whether the week has
      // been end-priced). Skip ONLY when the league is PROVABLY complete. A
      // participant with zero rows reports 'incomplete' and is healed below rather
      // than being locked out. Completeness is per-participant (see ./plan.ts) so a
      // Monday-complete league is a no-op on Tuesday even if someone traded in
      // between. Done BEFORE the Alpaca fetch so a complete league costs no price call.
      // (existingSnapshots was read — and error-checked — with drafts/trades above.)
      const coveredUserIds = new Set<string>(
        existingSnapshots.map((r: any) => r.user_id)
      );

      // Guard: if ANY row already carries a Friday close, snapshot-week-end has run
      // and this week may already be scored — re-snapshotting week-START prices now
      // would pair a fresh start price with an old end price. Treat as complete.
      // Mirrors snapshot-week-end's own `alreadyProcessed` guard.
      const alreadyEndPriced = existingSnapshots.some((r: any) => r.week_end_price != null);
      if (alreadyEndPriced) {
        console.log(`League ${leagueId} week ${currentWeek} already has week_end_price(s) — week is being/has been scored, skipping week-start snapshot`);
        results.push({ leagueId, week: currentWeek, users: userIds.size, snapshots: coveredUserIds.size, skipped: 'already_end_priced' });
        continue;
      }

      const coverage = classifyCoverage(userHoldings, coveredUserIds);
      if (coverage === 'none_expected') {
        console.log(`No holdings to snapshot for league ${leagueId} week ${currentWeek}, skipping`);
        results.push({ leagueId, week: currentWeek, users: userIds.size, snapshots: 0, skipped: 'no_holdings' });
        continue;
      }
      if (coverage === 'complete') {
        console.log(`Snapshots already COMPLETE for league ${leagueId} week ${currentWeek} (${coveredUserIds.size} participants), skipping`);
        results.push({ leagueId, week: currentWeek, users: userIds.size, snapshots: coveredUserIds.size, skipped: 'already_complete' });
        continue;
      }

      // Heal: write ONLY the participants who have no snapshot yet, leaving any
      // already-correct rows untouched (never rebuilt with this run's prices).
      const usersToWrite = selectMissingHoldings(userHoldings, coveredUserIds);
      if (coveredUserIds.size > 0) {
        console.warn(`Incomplete prior snapshot for league ${leagueId} week ${currentWeek}: ${coveredUserIds.size} participant(s) present, ${usersToWrite.size} still missing — healing the missing only.`);
      }
      // ────────────────────────────────────────────────────────────────────────

      // 6. Fetch official opening prices — only for the symbols we're about to
      //    write (the missing participants). A heal run doesn't re-price the
      //    already-covered users' symbols; a first (Monday) run writes everyone, so
      //    this is the full set then.
      const symbolsToPrice = new Set<string>();
      for (const holdings of usersToWrite.values()) {
        for (const h of holdings) symbolsToPrice.add(h.symbol);
      }

      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && symbolsToPrice.size > 0) {
        prices = await fetchOpenPrices(Array.from(symbolsToPrice), ALPACA_KEY, ALPACA_SECRET, windowPlan.openSessionDate);
      }

      // 7. Build the snapshot rows for the missing participants — all-or-nothing
      //    (see ./plan.ts). A per-symbol price gap must NOT produce a partial
      //    write: that would read as "complete" to the coverage gate above AND to
      //    the downstream process-week-results batch-level `hasSnapshots`, silently
      //    corrupting scoring. So if ANY holding here is unpriced we write NOTHING
      //    for this league this run and let the retry re-attempt.
      const { rows: snapshots, missingSymbols } = buildPricedRows(
        leagueId, currentWeek, usersToWrite, prices
      );

      if (missingSymbols.length > 0) {
        // ABORT this league — write nothing; flag the run for a post-loop retry.
        // Other leagues this run are unaffected. A permanently-unpriceable symbol
        // (e.g. delisted) will exhaust retries and fall through to the downstream
        // per-user gate — the required backstop; this just makes it fire rarely.
        anyIncomplete = true;
        console.error(
          `ABORT league ${leagueId} week ${currentWeek}: no price for ` +
          `${missingSymbols.length} symbol(s) [${missingSymbols.join(', ')}] — ` +
          `refusing partial snapshot, will retry.`
        );
        results.push({
          leagueId,
          week: currentWeek,
          users: userIds.size,
          snapshots: 0,
          incomplete: true,
          missingSymbols,
        });
        continue;
      }

      // 8. Upsert the missing participants' rows. The unique (league_id, user_id,
      //    week_number, symbol) constraint makes this idempotent (safe against
      //    overlapping retries); because we only write not-yet-covered users, no
      //    already-correct row is overwritten.
      const { error: upsertErr } = await supabase
        .from('week_snapshots')
        .upsert(snapshots, { onConflict: 'league_id,user_id,week_number,symbol' });

      if (upsertErr) {
        // A failed write leaves the league incomplete — treat like an abort so the
        // retry re-attempts rather than reporting a false success.
        anyIncomplete = true;
        console.error(`Failed to upsert snapshots for league ${leagueId}:`, upsertErr);
        results.push({ leagueId, week: currentWeek, users: userIds.size, snapshots: 0, writeError: true });
        continue;
      }

      console.log(`Snapshotted ${snapshots.length} rows for ${usersToWrite.size} participant(s) in league ${leagueId} week ${currentWeek}`);
      totalSnapshots += snapshots.length;
      results.push({ leagueId, week: currentWeek, users: userIds.size, snapshots: snapshots.length });
    }

    console.log(`Total snapshots created: ${totalSnapshots}`);

    // If any league was ABORTED for a missing price, schedule a retry (self-heal)
    // instead of reporting success. Same retry path the catch block uses, but
    // reached WITHOUT throwing — so leagues that snapshotted this run are
    // preserved and only the incomplete ones are re-attempted (the coverage gate
    // skips the complete ones on the next pass).
    if (anyIncomplete) {
      if (retryAttempt < MAX_RETRIES) {
        console.log(`One or more leagues incomplete (missing prices or failed reads); scheduling retry ${retryAttempt + 1}`);
        await scheduleRetry(supabase, JOB_NAME, retryAttempt + 1);
        await updateJobStatus(supabase, JOB_NAME, 'retrying', retryAttempt, 'Incomplete: missing prices or failed reads for some leagues');
        return json({
          message: 'Snapshot incomplete — retry scheduled',
          totalSnapshots,
          results,
          retryScheduled: true,
          attempt: retryAttempt,
        });
      }
      // Retries exhausted with leagues still incomplete — almost certainly a
      // permanently-unpriceable (e.g. delisted) symbol. Give up on those leagues;
      // the downstream per-user gate is the backstop. Report failed for ops
      // visibility, but do NOT throw (the leagues that snapshotted are valid).
      console.error(`Max retries (${MAX_RETRIES}) reached; some leagues still incomplete (likely unpriceable/delisted symbols).`);
      await updateJobStatus(supabase, JOB_NAME, 'failed', retryAttempt, 'Incomplete after max retries: unpriceable holdings or failed reads');
      return json({
        message: 'Snapshot incomplete after max retries',
        totalSnapshots,
        results,
        incomplete: true,
      }, 500);
    }

    // Update status to success
    await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt);

    return json({
      message: 'Snapshot complete',
      totalSnapshots,
      results,
    });

  } catch (e) {
    console.error('Unhandled error:', e);
    const errorMessage = String(e);

    // Handle retries
    if (retryAttempt < MAX_RETRIES) {
      console.log(`Attempt ${retryAttempt} failed, scheduling retry ${retryAttempt + 1}`);
      await scheduleRetry(supabase, JOB_NAME, retryAttempt + 1);
      await updateJobStatus(supabase, JOB_NAME, 'retrying', retryAttempt, errorMessage);
      return json({ error: 'Failed, retry scheduled', attempt: retryAttempt, message: errorMessage }, 500);
    } else {
      // Max retries reached, mark as failed
      console.error(`Max retries (${MAX_RETRIES}) reached, giving up`);
      await updateJobStatus(supabase, JOB_NAME, 'failed', retryAttempt, errorMessage);
      return json({ error: 'Failed after max retries', attempts: retryAttempt, message: errorMessage }, 500);
    }
  }
});
