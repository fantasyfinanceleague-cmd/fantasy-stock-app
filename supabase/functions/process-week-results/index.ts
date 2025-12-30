import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

// Simple response helper
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json' }
  });

interface PortfolioHolding {
  symbol: string;
  quantity: number;
  totalCost: number;
}

interface UserPortfolio {
  userId: string;
  holdings: PortfolioHolding[];
  totalCost: number;
  totalValue: number;
  gain: number;
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

// Calculate user's portfolio from drafts and trades
function calculatePortfolio(
  userId: string,
  drafts: any[],
  trades: any[],
  prices: Map<string, number>
): UserPortfolio {
  const holdings = new Map<string, PortfolioHolding>();

  // Process drafts
  for (const draft of drafts.filter(d => d.user_id === userId)) {
    const sym = draft.symbol?.toUpperCase();
    if (!sym) continue;

    const qty = Number(draft.quantity || 1);
    const price = Number(draft.entry_price || 0);

    if (!holdings.has(sym)) {
      holdings.set(sym, { symbol: sym, quantity: 0, totalCost: 0 });
    }
    const h = holdings.get(sym)!;
    h.quantity += qty;
    h.totalCost += price * qty;
  }

  // Process trades
  for (const trade of trades.filter(t => t.user_id === userId)) {
    const sym = trade.symbol?.toUpperCase();
    if (!sym) continue;

    const qty = Number(trade.quantity || 0);
    const price = Number(trade.price || 0);

    if (!holdings.has(sym)) {
      holdings.set(sym, { symbol: sym, quantity: 0, totalCost: 0 });
    }
    const h = holdings.get(sym)!;

    if (trade.action === 'buy') {
      h.quantity += qty;
      h.totalCost += price * qty;
    } else if (trade.action === 'sell') {
      const avgCost = h.quantity > 0 ? h.totalCost / h.quantity : price;
      h.quantity -= qty;
      h.totalCost -= avgCost * qty;
    }
  }

  // Calculate totals
  let totalCost = 0;
  let totalValue = 0;
  const holdingsArray: PortfolioHolding[] = [];

  for (const h of holdings.values()) {
    if (h.quantity <= 0) continue;

    const currentPrice = prices.get(h.symbol) || (h.totalCost / h.quantity);
    const value = currentPrice * h.quantity;

    totalCost += h.totalCost;
    totalValue += value;
    holdingsArray.push(h);
  }

  return {
    userId,
    holdings: holdingsArray,
    totalCost,
    totalValue,
    gain: totalValue - totalCost,
  };
}

Deno.serve(async (req) => {
  // This can be triggered by cron or manually
  console.log('Processing weekly matchup results...');

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
    // 1. Find matchups that need processing (week_end has passed, no results yet)
    const { data: pendingMatchups, error: matchupErr } = await supabase
      .from('matchups')
      .select(`
        id,
        league_id,
        week_number,
        team1_user_id,
        team2_user_id,
        team1_gain,
        week_end,
        leagues!inner(id, league_type, current_week)
      `)
      .eq('leagues.league_type', 'matchup')
      .is('team1_gain', null)  // Results not yet calculated
      .lt('week_end', now.toISOString());

    if (matchupErr) {
      console.error('Error fetching matchups:', matchupErr);
      return json({ error: 'Failed to fetch matchups', details: matchupErr }, 500);
    }

    if (!pendingMatchups || pendingMatchups.length === 0) {
      console.log('No pending matchups to process');
      return json({ message: 'No pending matchups', processed: 0 });
    }

    console.log(`Found ${pendingMatchups.length} matchups to process`);

    // Group matchups by league for efficient processing
    const matchupsByLeague = new Map<string, any[]>();
    for (const m of pendingMatchups) {
      if (!matchupsByLeague.has(m.league_id)) {
        matchupsByLeague.set(m.league_id, []);
      }
      matchupsByLeague.get(m.league_id)!.push(m);
    }

    let processedCount = 0;
    const results: any[] = [];

    // Process each league
    for (const [leagueId, leagueMatchups] of matchupsByLeague) {
      console.log(`Processing league ${leagueId} with ${leagueMatchups.length} matchups`);

      // Get all user IDs for this batch
      const userIds = new Set<string>();
      for (const m of leagueMatchups) {
        userIds.add(m.team1_user_id);
        userIds.add(m.team2_user_id);
      }

      // Fetch drafts for this league
      const { data: drafts } = await supabase
        .from('drafts')
        .select('user_id, symbol, entry_price, quantity')
        .eq('league_id', leagueId);

      // Fetch trades for this league
      const { data: trades } = await supabase
        .from('trades')
        .select('user_id, symbol, action, quantity, price')
        .eq('league_id', leagueId);

      // Get all symbols
      const symbols = new Set<string>();
      for (const d of drafts || []) {
        if (d.symbol) symbols.add(d.symbol.toUpperCase());
      }
      for (const t of trades || []) {
        if (t.symbol) symbols.add(t.symbol.toUpperCase());
      }

      // Fetch current prices
      let prices = new Map<string, number>();
      if (ALPACA_KEY && ALPACA_SECRET && symbols.size > 0) {
        prices = await fetchPrices(Array.from(symbols), ALPACA_KEY, ALPACA_SECRET);
      }

      // Calculate portfolio for each user
      const portfolios = new Map<string, UserPortfolio>();
      for (const userId of userIds) {
        const portfolio = calculatePortfolio(userId, drafts || [], trades || [], prices);
        portfolios.set(userId, portfolio);
      }

      // Process each matchup
      for (const matchup of leagueMatchups) {
        const p1 = portfolios.get(matchup.team1_user_id);
        const p2 = portfolios.get(matchup.team2_user_id);

        const team1Gain = p1?.gain ?? 0;
        const team2Gain = p2?.gain ?? 0;

        // Determine winner
        let winnerId: string | null = null;
        if (team1Gain > team2Gain) {
          winnerId = matchup.team1_user_id;
        } else if (team2Gain > team1Gain) {
          winnerId = matchup.team2_user_id;
        }
        // null = tie

        // Update matchup with results
        const { error: updateErr } = await supabase
          .from('matchups')
          .update({
            team1_gain: team1Gain,
            team2_gain: team2Gain,
            winner_user_id: winnerId,
          })
          .eq('id', matchup.id);

        if (updateErr) {
          console.error(`Failed to update matchup ${matchup.id}:`, updateErr);
          continue;
        }

        // Update standings for both users
        const isTie = winnerId === null;
        const team1Won = winnerId === matchup.team1_user_id;
        const team2Won = winnerId === matchup.team2_user_id;

        // Helper to update standings with proper increment
        async function updateUserStandings(
          lgId: string,
          oderId: string,
          won: boolean,
          lost: boolean,
          tied: boolean,
          pointsFor: number,
          pointsAgainst: number
        ) {
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
                wins: existing.wins + (won ? 1 : 0),
                losses: existing.losses + (lost ? 1 : 0),
                ties: existing.ties + (tied ? 1 : 0),
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
                wins: won ? 1 : 0,
                losses: lost ? 1 : 0,
                ties: tied ? 1 : 0,
                points_for: pointsFor,
                points_against: pointsAgainst,
              });
            return error;
          }
        }

        // Team 1 standings update
        const stand1Err = await updateUserStandings(
          leagueId,
          matchup.team1_user_id,
          team1Won,
          team2Won,
          isTie,
          team1Gain,
          team2Gain
        );
        if (stand1Err) {
          console.error(`Failed to update standings for ${matchup.team1_user_id}:`, stand1Err);
        }

        // Team 2 standings update
        const stand2Err = await updateUserStandings(
          leagueId,
          matchup.team2_user_id,
          team2Won,
          team1Won,
          isTie,
          team2Gain,
          team1Gain
        );
        if (stand2Err) {
          console.error(`Failed to update standings for ${matchup.team2_user_id}:`, stand2Err);
        }

        processedCount++;
        results.push({
          matchupId: matchup.id,
          week: matchup.week_number,
          team1: matchup.team1_user_id,
          team2: matchup.team2_user_id,
          team1Gain,
          team2Gain,
          winner: winnerId,
        });
      }

      // Check if all matchups for the current week are done, advance week
      const currentWeek = leagueMatchups[0]?.leagues?.current_week || 1;
      const weekNumber = leagueMatchups[0]?.week_number;

      if (weekNumber === currentWeek) {
        // Check if all matchups for this week are processed
        const { data: remainingMatchups } = await supabase
          .from('matchups')
          .select('id')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek)
          .is('team1_gain', null);

        if (!remainingMatchups || remainingMatchups.length === 0) {
          // All matchups done, advance to next week
          const { error: advanceErr } = await supabase
            .from('leagues')
            .update({ current_week: currentWeek + 1 })
            .eq('id', leagueId);

          if (advanceErr) {
            console.error(`Failed to advance week for league ${leagueId}:`, advanceErr);
          } else {
            console.log(`Advanced league ${leagueId} to week ${currentWeek + 1}`);
          }
        }
      }
    }

    console.log(`Processed ${processedCount} matchups`);
    return json({
      message: 'Processing complete',
      processed: processedCount,
      results
    });

  } catch (e) {
    console.error('Unhandled error:', e);
    return json({ error: 'Unhandled error', message: String(e) }, 500);
  }
});
