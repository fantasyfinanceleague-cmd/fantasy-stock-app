import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * Snapshot Week Start Prices
 *
 * This function runs automatically at Tuesday market open (9:30 AM ET / 14:30 UTC)
 * to capture the starting prices for weekly matchup calculations.
 *
 * For each active matchup league:
 * 1. Find the current week's matchups
 * 2. Get all users' holdings (from drafts + trades)
 * 3. Fetch current prices for all symbols
 * 4. Insert snapshots into week_snapshots table
 */

function env(k: string) { return Deno.env.get(k) ?? ''; }

const ALPACA_BASE = 'https://data.alpaca.markets/v2';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json' }
  });

interface Holding {
  symbol: string;
  quantity: number;
}

// Fetch latest prices from Alpaca
async function fetchPrices(symbols: string[], alpacaKey: string, alpacaSecret: string): Promise<Map<string, number>> {
  const prices = new Map<string, number>();

  if (symbols.length === 0) return prices;

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
  console.log('Snapshotting week start prices...');

  const SUPABASE_URL = env('SUPABASE_URL');
  const SERVICE_ROLE = env('SUPABASE_SERVICE_ROLE_KEY');
  const ALPACA_KEY = env('ALPACA_API_KEY');
  const ALPACA_SECRET = env('ALPACA_API_SECRET');

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: 'Missing Supabase configuration' }, 500);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  const now = new Date();

  try {
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

    for (const league of leagues) {
      const leagueId = league.id;
      const currentWeek = league.current_week;

      // Skip if we've already created snapshots for this week
      const { data: existingSnapshots } = await supabase
        .from('week_snapshots')
        .select('id')
        .eq('league_id', leagueId)
        .eq('week_number', currentWeek)
        .limit(1);

      if (existingSnapshots && existingSnapshots.length > 0) {
        console.log(`Snapshots already exist for league ${leagueId} week ${currentWeek}, skipping`);
        continue;
      }

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

      // 5. Calculate holdings for each user and collect all symbols
      const userHoldings = new Map<string, Holding[]>();
      const allSymbols = new Set<string>();

      for (const userId of userIds) {
        const holdings = calculateHoldings(userId, drafts || [], trades || []);
        userHoldings.set(userId, holdings);
        for (const h of holdings) {
          allSymbols.add(h.symbol);
        }
      }

      // 6. Fetch current prices for all symbols
      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && allSymbols.size > 0) {
        prices = await fetchPrices(Array.from(allSymbols), ALPACA_KEY, ALPACA_SECRET);
      }

      // 7. Create snapshots for each user's holdings
      const snapshots: any[] = [];

      for (const [userId, holdings] of userHoldings) {
        for (const h of holdings) {
          const price = prices.get(h.symbol);
          if (!price) {
            console.warn(`No price found for ${h.symbol}, skipping`);
            continue;
          }

          snapshots.push({
            league_id: leagueId,
            user_id: userId,
            week_number: currentWeek,
            symbol: h.symbol,
            quantity: h.quantity,
            week_start_price: price,
          });
        }
      }

      // 8. Insert all snapshots
      if (snapshots.length > 0) {
        const { error: insertErr } = await supabase
          .from('week_snapshots')
          .insert(snapshots);

        if (insertErr) {
          console.error(`Failed to insert snapshots for league ${leagueId}:`, insertErr);
        } else {
          console.log(`Created ${snapshots.length} snapshots for league ${leagueId} week ${currentWeek}`);
          totalSnapshots += snapshots.length;
        }
      }

      results.push({
        leagueId,
        week: currentWeek,
        users: userIds.size,
        snapshots: snapshots.length,
      });
    }

    console.log(`Total snapshots created: ${totalSnapshots}`);
    return json({
      message: 'Snapshot complete',
      totalSnapshots,
      results,
    });

  } catch (e) {
    console.error('Unhandled error:', e);
    return json({ error: 'Unhandled error', message: String(e) }, 500);
  }
});
