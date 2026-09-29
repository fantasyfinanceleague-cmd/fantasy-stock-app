import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { classifyCloseCoverage, buildCloseWork, type Holding } from './close.ts';
import { checkSnapshotReads, matchupParticipants, snapshotHoldings } from '../_shared/snapshot-holdings.ts';

/**
 * Snapshot Week End Prices
 *
 * This function runs automatically at Friday market close (4:05 PM ET / 21:05 UTC)
 * to capture the ending prices for weekly matchup calculations.
 *
 * For each active matchup league:
 * 1. Find existing week snapshots (from Monday)
 * 2. Fetch current prices for all symbols
 * 3. Update snapshots with week_end_price
 * 4. Create new snapshots for stocks bought mid-week (only week_end_price)
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

// Constant-time string comparison. Avoids the early-exit timing leak of ===/!==.
// Equal-length check first, then a full XOR-accumulate over every byte.
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

// Generic 401. No detail about why (missing vs wrong vs malformed) to avoid leakage.
const unauthorized = () => json({ error: 'Unauthorized' }, 401);

// Validate the incoming apikey header against SB_SECRET_KEY_CRON.
// Fails closed: if the expected key is unset/empty, ALL requests are rejected.
// This is the only guard once verify_jwt = false exposes the function publicly.
function isAuthorized(req: Request): boolean {
  const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expectedKey || expectedKey.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false;
  }
  const providedKey = req.headers.get('apikey') ?? '';
  return constantTimeEqual(providedKey, expectedKey);
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

// Fetch official closing prices from Alpaca bars (today's close)
async function fetchClosePrices(symbols: string[], alpacaKey: string, alpacaSecret: string): Promise<Map<string, number>> {
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
          // Get the most recent bar's close price
          const latestBar = Array.isArray(bars) && bars.length > 0 ? bars[bars.length - 1] : null;
          const closePrice = latestBar?.c ? Number(latestBar.c) : 0;
          if (closePrice > 0) prices.set(sym.toUpperCase(), closePrice);
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

// Holdings come from ../_shared/snapshot-holdings.ts (shared with
// snapshot-week-start). The local copy this replaced coerced the SKIP sentinel's
// quantity 0 to a 1-share 'SKIP' holding (`quantity || 1`), which no close price
// could satisfy, so it aborted the whole league's week-end write on every retry.
// midWeekEntryPrice moved to ./close.ts so it is covered by the hermetic
// tests in close.test.ts. Keeping a second copy here would let the tested
// and untested implementations drift.

Deno.serve(async (req) => {
  // SECURITY: apikey validation must be the first thing we do — before reading
  // the body, before any DB connection, before any business logic. With
  // verify_jwt = false this function is publicly invocable, so this check is
  // the only authentication guard.
  if (!isAuthorized(req)) {
    return unauthorized();
  }

  const JOB_NAME = 'snapshot-week-end';
  console.log('Snapshotting week end prices...');

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
    // 1. Find all active matchup leagues and their current week
    const { data: leagues, error: leaguesErr } = await supabase
      .from('leagues')
      .select('id, current_week, num_weeks')
      .eq('league_type', 'matchup')
      .not('current_week', 'is', null);

    if (leaguesErr) {
      console.error('Error fetching leagues:', leaguesErr);
      throw new Error(`Failed to fetch leagues: ${leaguesErr.message ?? leaguesErr}`);
    }

    if (!leagues || leagues.length === 0) {
      console.log('No active matchup leagues found');
      await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt);
      return json({ message: 'No active matchup leagues', updates: 0 });
    }

    console.log(`Found ${leagues.length} active matchup leagues`);

    // Set by any league that could not be fully closed this run (unpriceable
    // symbol, a failed read, or a failed write). Forces terminal status 'retrying' instead of
    // 'success', so a partial run never reports clean — CLAUDE.md silent-failure.
    let anyIncomplete = false;

    let totalUpdates = 0;
    let totalNewSnapshots = 0;
    const results: any[] = [];

    for (const league of leagues) {
      const leagueId = league.id;
      const currentWeek = league.current_week;

      // 2–4. Read everything coverage depends on: this week's existing snapshots
      //      (KIND 1), the participants, and their drafts + trades (holdings and
      //      KIND 2). ALL must succeed before coverage is classified — see
      //      checkSnapshotReads in ../_shared/snapshot-holdings.ts. A failed
      //      drafts/trades/matchups read used to default to [] and read as
      //      "nothing held": Monday rows closed, mid-week buys silently dropped,
      //      and the league then classified 'complete' forever. A failed snapshots
      //      read used to `continue` with no retry and a 'success' status.
      //      `price` on trades is needed for a real mid-week entry price (see the
      //      entered_mid_week migration); week_start_price is read for cost basis
      //      in the UI, so a placeholder is never acceptable.
      const inputs = checkSnapshotReads({
        existingSnapshots: await supabase
          .from('week_snapshots')
          .select('id, user_id, symbol, quantity, week_start_price, week_end_price')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek),
        matchups: await supabase
          .from('matchups')
          .select('team1_user_id, team2_user_id')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek),
        drafts: await supabase
          .from('drafts')
          .select('user_id, symbol, quantity')
          .eq('league_id', leagueId),
        trades: await supabase
          .from('trades')
          .select('user_id, symbol, action, quantity, price')
          .eq('league_id', leagueId),
      });
      if (!inputs.ok) {
        // ABORT this league for this run, exactly like an unpriceable symbol:
        // write nothing, flag the run so the existing retry path re-runs it.
        anyIncomplete = true;
        console.error(
          `ABORT league ${leagueId} week ${currentWeek}: read failed — ` +
          inputs.failed.map((f) => `${f.read}: ${f.message}`).join('; ') +
          ` — refusing to classify coverage on missing inputs, will retry.`
        );
        results.push({ leagueId, week: currentWeek, updated: 0, newSnapshots: 0, incomplete: true, failedReads: inputs.failed.map((f) => f.read) });
        continue;
      }
      const { existingSnapshots, matchups, drafts, trades } = inputs.rows;

      // NOTE: the completeness gate is NOT here. It cannot run yet — coverage
      // depends on current holdings (KIND 2, mid-week buys), which are computed
      // below. The old existence-only check `existingSnapshots.some(s =>
      // s.week_end_price != null)` ran at this point and skipped the league on a
      // SINGLE priced row, which is exactly what made a partial week-end write
      // unhealable. See close.ts for the two kinds of "missing".

      // Collect all participant IDs (null team2 = bye week). Bots are INCLUDED:
      // excluding them left every bot matchup unscoreable from week 2 on.
      const userIds = matchupParticipants(matchups);

      // Calculate current holdings for each user
      const userHoldings = new Map<string, Holding[]>();
      const allSymbols = new Set<string>();

      for (const userId of userIds) {
        const holdings = snapshotHoldings(userId, drafts, trades);
        userHoldings.set(userId, holdings);
        for (const h of holdings) {
          allSymbols.add(h.symbol);
        }
      }

      // Also add symbols from existing snapshots
      for (const snap of existingSnapshots) {
        if (snap.symbol) allSymbols.add(snap.symbol.toUpperCase());
      }

      // 5. COVERAGE GATE — replaces the old existence-only `alreadyProcessed`.
      //    Runs BEFORE the Alpaca call so a complete league costs no quota.
      const coverage = classifyCloseCoverage(userHoldings, existingSnapshots);
      if (coverage === 'none_expected') {
        console.log(`League ${leagueId} week ${currentWeek}: nothing held and no rows — nothing to close`);
        continue;
      }
      if (coverage === 'complete') {
        console.log(`League ${leagueId} week ${currentWeek}: already fully closed, skipping`);
        continue;
      }
      // 'incomplete' falls through — INCLUDING the partial state the old guard
      // misread as done. Healing writes only what is missing.

      // 6. Fetch official closing prices for all symbols
      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && allSymbols.size > 0) {
        prices = await fetchClosePrices(Array.from(allSymbols), ALPACA_KEY, ALPACA_SECRET);
      }

      // 7. Build ALL the writes for this league, all-or-nothing.
      //    entered_mid_week rows keep the basis fix from cc26857: week_start_price
      //    carries the real weighted entry price, never a NULL or a placeholder.
      const work = buildCloseWork(
        leagueId,
        currentWeek,
        userHoldings,
        existingSnapshots,
        prices,
        trades,
      );

      // Positions priced but with no derivable entry price. NOT retryable — no
      // amount of re-running invents a trade record — so they are reported and
      // skipped rather than blocking the league forever.
      for (const p of work.unbasedPositions) {
        console.error(
          `No entry price derivable for mid-week position ${p.userId}/${p.symbol} ` +
          `in league ${leagueId} — skipping rather than writing a fabricated basis.`
        );
      }

      // ABORT: any unpriceable symbol means we write NOTHING for this league this
      // run. Writing "the ones we could" is precisely what produced the
      // unhealable partial the old code left behind.
      if (work.missingSymbols.length > 0) {
        anyIncomplete = true;
        console.error(
          `League ${leagueId} week ${currentWeek}: no close price for ` +
          `${work.missingSymbols.join(', ')} — refusing partial week-end write, will retry`
        );
        continue;
      }

      // 8. Apply the writes. Both paths are idempotent on the
      //    (league_id, user_id, week_number, symbol) unique constraint, so an
      //    overlapping retry re-converges instead of duplicating or failing.
      let updatesForLeague = 0;
      for (const u of work.updates) {
        const { error: updateErr } = await supabase
          .from('week_snapshots')
          .update({ week_end_price: u.week_end_price })
          .eq('id', u.id);

        if (updateErr) {
          console.error(`Failed to close snapshot ${u.id}:`, updateErr);
          anyIncomplete = true;
        } else {
          updatesForLeague++;
        }
      }

      const newSnapshots = work.inserts;
      if (newSnapshots.length > 0) {
        const { error: upsertErr } = await supabase
          .from('week_snapshots')
          .upsert(newSnapshots, { onConflict: 'league_id,user_id,week_number,symbol' });

        if (upsertErr) {
          console.error(`Failed to write mid-week snapshots for league ${leagueId}:`, upsertErr);
          anyIncomplete = true;
        } else {
          console.log(`Created ${newSnapshots.length} new snapshots for mid-week purchases in league ${leagueId}`);
          totalNewSnapshots += newSnapshots.length;
        }
      }

      totalUpdates += updatesForLeague;
      results.push({
        leagueId,
        week: currentWeek,
        updated: updatesForLeague,
        newSnapshots: newSnapshots.length,
      });

      console.log(`League ${leagueId} week ${currentWeek}: Updated ${updatesForLeague} snapshots, created ${newSnapshots.length} new`);
    }

    console.log(`Total updates: ${totalUpdates}, Total new snapshots: ${totalNewSnapshots}`);

    // Terminal status must reflect whether every league actually closed.
    if (anyIncomplete) {
      if (retryAttempt < MAX_RETRIES) {
        await scheduleRetry(supabase, JOB_NAME, retryAttempt + 1);
        await updateJobStatus(supabase, JOB_NAME, 'retrying', retryAttempt,
          'One or more leagues incomplete (unpriced symbols or failed write)');
      } else {
        await updateJobStatus(supabase, JOB_NAME, 'failed', retryAttempt,
          'One or more leagues still incomplete after max retries');
      }
    } else {
      await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt);
    }

    return json({
      message: anyIncomplete ? 'Week end snapshot INCOMPLETE' : 'Week end snapshot complete',
      incomplete: anyIncomplete,
      totalUpdates,
      totalNewSnapshots,
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
