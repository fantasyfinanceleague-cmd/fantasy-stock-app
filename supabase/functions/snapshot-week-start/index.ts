import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  classifyCoverage,
  selectMissingHoldings,
  buildPricedRows,
  type Holding,
} from './plan.ts';

/**
 * Snapshot Week Start Prices
 *
 * This function runs automatically at Monday market open (9:30 AM ET / 14:30 UTC)
 * to capture the starting prices for weekly matchup calculations.
 * Also runs Tuesday in case Monday is a market holiday.
 *
 * For each active matchup league:
 * 1. Check if market is open today (skip if holiday)
 * 2. Find the current week's matchups
 * 3. Get all users' holdings (from drafts + trades)
 * 4. Fetch current prices for all symbols
 * 5. Insert snapshots into week_snapshots table
 *
 * Includes retry logic: up to 3 retries with 5-minute intervals
 */

function env(k: string) { return Deno.env.get(k) ?? ''; }

const ALPACA_BASE = 'https://data.alpaca.markets/v2';
const ALPACA_TRADING_BASE = 'https://paper-api.alpaca.markets/v2';
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

// Check if the market is open today using Alpaca Calendar API
async function isMarketOpenToday(alpacaKey: string, alpacaSecret: string): Promise<{ open: boolean; date: string }> {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  try {
    const url = `${ALPACA_TRADING_BASE}/calendar?start=${today}&end=${today}`;
    const res = await fetch(url, {
      headers: {
        'APCA-API-KEY-ID': alpacaKey,
        'APCA-API-SECRET-KEY': alpacaSecret,
        'Accept': 'application/json',
      },
    });

    if (res.ok) {
      const calendar = await res.json();
      // If today is in the calendar, market is open
      if (Array.isArray(calendar) && calendar.length > 0) {
        return { open: true, date: today };
      }
    }
  } catch (e) {
    console.error('Failed to check market calendar:', e);
  }

  return { open: false, date: today };
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

// Fetch official opening prices from Alpaca bars (today's open)
async function fetchOpenPrices(symbols: string[], alpacaKey: string, alpacaSecret: string): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  if (symbols.length === 0) return prices;

  const today = new Date().toISOString().split('T')[0];
  const symbolsParam = symbols.join(',');

  // Use bars endpoint to get official OHLCV data
  const url = `${ALPACA_BASE}/stocks/bars?symbols=${encodeURIComponent(symbolsParam)}&timeframe=1Day&start=${today}&end=${today}&feed=iex`;

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

  // Fallback to quotes for any missing symbols
  const missingSymbols = symbols.filter(s => !prices.has(s.toUpperCase()));
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

// Calculate user's current holdings from drafts and trades
function calculateHoldings(
  userId: string,
  drafts: any[],
  trades: any[]
): Holding[] {
  const holdings = new Map<string, number>();

  // Process drafts
  for (const draft of drafts.filter(d => d.user_id === userId)) {
    const sym = draft.symbol?.toUpperCase();
    if (!sym) continue;

    const qty = Number(draft.quantity || 1);
    holdings.set(sym, (holdings.get(sym) || 0) + qty);
  }

  // Process trades
  for (const trade of trades.filter(t => t.user_id === userId)) {
    const sym = trade.symbol?.toUpperCase();
    if (!sym) continue;

    const qty = Number(trade.quantity || 0);

    if (trade.action === 'buy') {
      holdings.set(sym, (holdings.get(sym) || 0) + qty);
    } else if (trade.action === 'sell') {
      holdings.set(sym, (holdings.get(sym) || 0) - qty);
    }
  }

  // Return holdings with positive quantity
  return Array.from(holdings.entries())
    .filter(([_, qty]) => qty > 0)
    .map(([symbol, quantity]) => ({ symbol, quantity }));
}

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
    // 0. Check if market is open today (for holiday handling)
    if (ALPACA_KEY && ALPACA_SECRET) {
      const marketStatus = await isMarketOpenToday(ALPACA_KEY, ALPACA_SECRET);
      const today = new Date();
      const dayOfWeek = today.getUTCDay(); // 0 = Sunday, 1 = Monday, etc.

      if (!marketStatus.open) {
        // Market is closed today
        if (dayOfWeek === 1) {
          // Monday and market closed = holiday, skip (Tuesday will run)
          console.log('Monday is a market holiday, skipping. Tuesday run will handle this week.');
          await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt, 'Skipped - Monday holiday');
          return json({ message: 'Market closed (holiday), skipping Monday run', date: marketStatus.date });
        } else if (dayOfWeek === 2) {
          // Tuesday and market closed = unusual, maybe wait?
          console.log('Market closed on Tuesday, unusual situation');
        }
      }
    }

    // 1. Find all active matchup leagues and their current week
    const { data: leagues, error: leaguesErr } = await supabase
      .from('leagues')
      .select('id, current_week, num_weeks')
      .eq('league_type', 'matchup')
      .not('current_week', 'is', null);

    if (leaguesErr) {
      console.error('Error fetching leagues:', leaguesErr);
      return json({ error: 'Failed to fetch leagues' }, 500);
    }

    if (!leagues || leagues.length === 0) {
      console.log('No active matchup leagues found');
      return json({ message: 'No active matchup leagues', snapshots: 0 });
    }

    console.log(`Found ${leagues.length} active matchup leagues`);

    let totalSnapshots = 0;
    const results: any[] = [];
    // Set when a league is ABORTED for a missing price this run (per-league
    // all-or-nothing). Drives a single post-loop retry so the gap self-heals,
    // without throwing (which would abort the leagues that DID snapshot).
    let anyIncomplete = false;

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

      // 2. Get all matchups for current week to find all users
      const { data: matchups } = await supabase
        .from('matchups')
        .select('team1_user_id, team2_user_id')
        .eq('league_id', leagueId)
        .eq('week_number', currentWeek);

      if (!matchups || matchups.length === 0) {
        console.log(`No matchups found for league ${leagueId} week ${currentWeek}`);
        continue;
      }

      // Collect all user IDs (excluding null for bye weeks and bots)
      const userIds = new Set<string>();
      for (const m of matchups) {
        if (m.team1_user_id && !m.team1_user_id.startsWith('bot-')) {
          userIds.add(m.team1_user_id);
        }
        if (m.team2_user_id && !m.team2_user_id.startsWith('bot-')) {
          userIds.add(m.team2_user_id);
        }
      }

      // 3. Fetch drafts for this league
      const { data: drafts } = await supabase
        .from('drafts')
        .select('user_id, symbol, quantity')
        .eq('league_id', leagueId);

      // 4. Fetch trades for this league
      const { data: trades } = await supabase
        .from('trades')
        .select('user_id, symbol, action, quantity')
        .eq('league_id', leagueId);

      // 5. Calculate holdings for each user
      const userHoldings = new Map<string, Holding[]>();
      for (const userId of userIds) {
        userHoldings.set(userId, calculateHoldings(userId, drafts || [], trades || []));
      }

      // ── Coverage gate (replaces the old existence-only skip) ────────────────
      // Fetch which participants already have a snapshot (and whether the week has
      // been end-priced). Skip ONLY when the league is PROVABLY complete. A
      // participant with zero rows reports 'incomplete' and is healed below rather
      // than being locked out. Completeness is per-participant (see ./plan.ts) so a
      // Monday-complete league is a no-op on Tuesday even if someone traded in
      // between. Done BEFORE the Alpaca fetch so a complete league costs no price call.
      const { data: existingSnapshots } = await supabase
        .from('week_snapshots')
        .select('user_id, week_end_price')
        .eq('league_id', leagueId)
        .eq('week_number', currentWeek);

      const coveredUserIds = new Set<string>(
        (existingSnapshots ?? []).map((r: any) => r.user_id)
      );

      // Guard: if ANY row already carries a Friday close, snapshot-week-end has run
      // and this week may already be scored — re-snapshotting week-START prices now
      // would pair a fresh start price with an old end price. Treat as complete.
      // Mirrors snapshot-week-end's own `alreadyProcessed` guard.
      const alreadyEndPriced = (existingSnapshots ?? []).some((r: any) => r.week_end_price != null);
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
        prices = await fetchOpenPrices(Array.from(symbolsToPrice), ALPACA_KEY, ALPACA_SECRET);
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
        console.log(`One or more leagues incomplete (missing prices); scheduling retry ${retryAttempt + 1}`);
        await scheduleRetry(supabase, JOB_NAME, retryAttempt + 1);
        await updateJobStatus(supabase, JOB_NAME, 'retrying', retryAttempt, 'Incomplete: missing prices for some holdings');
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
      await updateJobStatus(supabase, JOB_NAME, 'failed', retryAttempt, 'Incomplete after max retries: unpriceable holdings');
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
