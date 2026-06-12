import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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
async function scheduleRetry(supabase: any, jobName: string, attemptNumber: number) {
  try {
    await supabase.rpc('schedule_snapshot_retry', {
      p_job_name: jobName,
      p_attempt: attemptNumber
    });
    console.log(`Scheduled retry ${attemptNumber} for ${jobName}`);
  } catch (e) {
    console.error('Failed to schedule retry:', e);
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

interface Holding {
  symbol: string;
  quantity: number;
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
      throw new Error('Failed to fetch leagues');
    }

    if (!leagues || leagues.length === 0) {
      console.log('No active matchup leagues found');
      await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt);
      return json({ message: 'No active matchup leagues', updates: 0 });
    }

    console.log(`Found ${leagues.length} active matchup leagues`);

    let totalUpdates = 0;
    let totalNewSnapshots = 0;
    const results: any[] = [];

    for (const league of leagues) {
      const leagueId = league.id;
      const currentWeek = league.current_week;

      // 2. Get existing week snapshots from Monday (have week_start_price but no week_end_price)
      const { data: existingSnapshots, error: snapErr } = await supabase
        .from('week_snapshots')
        .select('id, user_id, symbol, quantity, week_start_price, week_end_price')
        .eq('league_id', leagueId)
        .eq('week_number', currentWeek);

      if (snapErr) {
        console.error(`Error fetching snapshots for league ${leagueId}:`, snapErr);
        continue;
      }

      // Check if week_end_price is already filled (prevent re-running)
      const alreadyProcessed = existingSnapshots?.some(s => s.week_end_price != null);
      if (alreadyProcessed) {
        console.log(`Week end snapshots already exist for league ${leagueId} week ${currentWeek}, skipping`);
        continue;
      }

      // 3. Get all matchups for current week to find all users
      const { data: matchups } = await supabase
        .from('matchups')
        .select('team1_user_id, team2_user_id')
        .eq('league_id', leagueId)
        .eq('week_number', currentWeek);

      // Collect all user IDs
      const userIds = new Set<string>();
      for (const m of matchups || []) {
        if (m.team1_user_id && !m.team1_user_id.startsWith('bot-')) {
          userIds.add(m.team1_user_id);
        }
        if (m.team2_user_id && !m.team2_user_id.startsWith('bot-')) {
          userIds.add(m.team2_user_id);
        }
      }

      // 4. Fetch current holdings for each user (to detect mid-week purchases)
      const { data: drafts } = await supabase
        .from('drafts')
        .select('user_id, symbol, quantity')
        .eq('league_id', leagueId);

      const { data: trades } = await supabase
        .from('trades')
        .select('user_id, symbol, action, quantity')
        .eq('league_id', leagueId);

      // Calculate current holdings for each user
      const userHoldings = new Map<string, Holding[]>();
      const allSymbols = new Set<string>();

      for (const userId of userIds) {
        const holdings = calculateHoldings(userId, drafts || [], trades || []);
        userHoldings.set(userId, holdings);
        for (const h of holdings) {
          allSymbols.add(h.symbol);
        }
      }

      // Also add symbols from existing snapshots
      for (const snap of existingSnapshots || []) {
        if (snap.symbol) allSymbols.add(snap.symbol.toUpperCase());
      }

      // 5. Fetch official closing prices for all symbols
      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && allSymbols.size > 0) {
        prices = await fetchClosePrices(Array.from(allSymbols), ALPACA_KEY, ALPACA_SECRET);
      }

      // 6. Update existing snapshots with week_end_price
      let updatesForLeague = 0;
      for (const snap of existingSnapshots || []) {
        const price = prices.get(snap.symbol?.toUpperCase());
        if (price) {
          const { error: updateErr } = await supabase
            .from('week_snapshots')
            .update({ week_end_price: price })
            .eq('id', snap.id);

          if (updateErr) {
            console.error(`Failed to update snapshot ${snap.id}:`, updateErr);
          } else {
            updatesForLeague++;
          }
        }
      }

      // 7. Create new snapshots for stocks bought mid-week (not in existing snapshots)
      const existingUserSymbols = new Set(
        (existingSnapshots || []).map(s => `${s.user_id}:${s.symbol?.toUpperCase()}`)
      );

      const newSnapshots: any[] = [];
      for (const [userId, holdings] of userHoldings) {
        for (const h of holdings) {
          const key = `${userId}:${h.symbol}`;
          if (!existingUserSymbols.has(key)) {
            // This is a mid-week purchase - create snapshot with only week_end_price
            const price = prices.get(h.symbol);
            if (price) {
              newSnapshots.push({
                league_id: leagueId,
                user_id: userId,
                week_number: currentWeek,
                symbol: h.symbol,
                quantity: h.quantity,
                week_start_price: null, // No start price - bought mid-week
                week_end_price: price,
              });
            }
          }
        }
      }

      // 8. Insert new snapshots for mid-week purchases
      if (newSnapshots.length > 0) {
        const { error: insertErr } = await supabase
          .from('week_snapshots')
          .insert(newSnapshots);

        if (insertErr) {
          console.error(`Failed to insert new snapshots for league ${leagueId}:`, insertErr);
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

    // Update status to success
    await updateJobStatus(supabase, JOB_NAME, 'success', retryAttempt);

    return json({
      message: 'Week end snapshot complete',
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
