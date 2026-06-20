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

// Update job status for tracking
async function updateJobStatus(
  supabase: any,
  jobName: string,
  status: 'running' | 'success' | 'failed',
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

interface PortfolioHolding {
  symbol: string;
  quantity: number;
  totalCost: number;
}

interface WeekSnapshot {
  symbol: string;
  quantity: number;
  weekStartPrice: number | null;  // null for mid-week purchases
  weekEndPrice: number | null;    // Friday close price
}

interface MidWeekTrade {
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  createdAt: Date;
}

interface UserScore {
  dollarGain: number;
  percentGain: number;
  hasPositions: boolean;
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

// Calculate user's portfolio from drafts and trades (fallback if no snapshots)
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

/**
 * Calculate user's score for the week using snapshots and mid-week trades.
 *
 * Score calculation (by individual trade):
 * - Stocks held all week: quantity × (week_end_price - week_start_price)
 * - Stocks sold mid-week: sold_qty × (sale_price - week_start_price)
 * - Partial holds: remaining_qty × (week_end_price - week_start_price)
 * - Stocks bought mid-week: quantity × (week_end_price - purchase_price)
 * - Stocks bought then sold same week: quantity × (sale_price - purchase_price)
 *
 * Returns dollar gain, percent gain, and whether user had any positions.
 */
function calculateUserScore(
  userId: string,
  snapshots: WeekSnapshot[],
  midWeekTrades: MidWeekTrade[]
): UserScore {
  let totalGain = 0;
  let totalStartValue = 0;

  // Build a map of week end prices by symbol (for looking up Friday close)
  const weekEndPrices = new Map<string, number>();
  for (const snap of snapshots) {
    if (snap.weekEndPrice !== null) {
      weekEndPrices.set(snap.symbol.toUpperCase(), snap.weekEndPrice);
    }
  }

  // Build a map of week start holdings by symbol
  // This represents what the user held at Monday open
  const weekStartHoldings = new Map<string, { quantity: number; price: number }>();
  for (const snap of snapshots.filter(s => s.weekStartPrice !== null)) {
    weekStartHoldings.set(snap.symbol.toUpperCase(), {
      quantity: snap.quantity,
      price: snap.weekStartPrice!,
    });
  }

  // Sort trades by time to process in order (FIFO for sells)
  const sortedTrades = [...midWeekTrades].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
  );

  // Track remaining quantities for week-start holdings (for partial sells)
  const remainingHoldings = new Map<string, number>();
  for (const [symbol, holding] of weekStartHoldings) {
    remainingHoldings.set(symbol, holding.quantity);
  }

  // Track mid-week buys that haven't been sold yet (for buy-then-sell same week)
  // Each entry: { quantity, price }
  const midWeekBuys = new Map<string, { quantity: number; price: number }[]>();

  // Process each trade in order
  for (const trade of sortedTrades) {
    const symbol = trade.symbol.toUpperCase();

    if (trade.action === 'sell') {
      let remainingToSell = trade.quantity;
      const salePrice = trade.price;

      // First, sell from week-start holdings (Monday open → Sale price)
      const weekStartQty = remainingHoldings.get(symbol) || 0;
      if (weekStartQty > 0 && remainingToSell > 0) {
        const sellFromStart = Math.min(weekStartQty, remainingToSell);
        const startPrice = weekStartHoldings.get(symbol)!.price;

        const gain = sellFromStart * (salePrice - startPrice);
        totalGain += gain;
        totalStartValue += sellFromStart * startPrice;

        console.log(`${symbol}: Sold ${sellFromStart} from week-start holdings. Monday: $${startPrice}, Sold: $${salePrice}, Gain: $${gain.toFixed(2)}`);

        remainingHoldings.set(symbol, weekStartQty - sellFromStart);
        remainingToSell -= sellFromStart;
      }

      // Then, sell from mid-week buys (FIFO: Purchase price → Sale price)
      if (remainingToSell > 0) {
        const buys = midWeekBuys.get(symbol) || [];
        while (remainingToSell > 0 && buys.length > 0) {
          const oldestBuy = buys[0];
          const sellFromBuy = Math.min(oldestBuy.quantity, remainingToSell);

          const gain = sellFromBuy * (salePrice - oldestBuy.price);
          totalGain += gain;
          totalStartValue += sellFromBuy * oldestBuy.price;

          console.log(`${symbol}: Sold ${sellFromBuy} from mid-week buy. Bought: $${oldestBuy.price}, Sold: $${salePrice}, Gain: $${gain.toFixed(2)}`);

          oldestBuy.quantity -= sellFromBuy;
          remainingToSell -= sellFromBuy;

          if (oldestBuy.quantity <= 0) {
            buys.shift(); // Remove exhausted buy lot
          }
        }
        midWeekBuys.set(symbol, buys);
      }
    } else if (trade.action === 'buy') {
      // Add to mid-week buys (will be processed at week end or if sold later)
      const buys = midWeekBuys.get(symbol) || [];
      buys.push({ quantity: trade.quantity, price: trade.price });
      midWeekBuys.set(symbol, buys);
      console.log(`${symbol}: Bought ${trade.quantity} mid-week at $${trade.price}`);
    }
  }

  // Process remaining week-start holdings (held all week: Monday open → Friday close)
  for (const [symbol, remaining] of remainingHoldings) {
    if (remaining <= 0) continue;

    const startPrice = weekStartHoldings.get(symbol)!.price;
    const endPrice = weekEndPrices.get(symbol);

    if (endPrice !== undefined) {
      const gain = remaining * (endPrice - startPrice);
      totalGain += gain;
      totalStartValue += remaining * startPrice;
      console.log(`${symbol}: Held ${remaining} all week. Monday: $${startPrice}, Friday: $${endPrice}, Gain: $${gain.toFixed(2)}`);
    }
  }

  // Process remaining mid-week buys (bought and held to Friday: Purchase price → Friday close)
  for (const [symbol, buys] of midWeekBuys) {
    const endPrice = weekEndPrices.get(symbol);
    if (endPrice === undefined) continue;

    for (const buy of buys) {
      if (buy.quantity <= 0) continue;

      const gain = buy.quantity * (endPrice - buy.price);
      totalGain += gain;
      totalStartValue += buy.quantity * buy.price;
      console.log(`${symbol}: Mid-week buy held to Friday. ${buy.quantity} shares @ $${buy.price} → $${endPrice}, Gain: $${gain.toFixed(2)}`);
    }
  }

  // Calculate percentage gain
  const percentGain = totalStartValue > 0
    ? (totalGain / totalStartValue) * 100
    : 0;

  // User has positions if they had week-start holdings OR any mid-week trades
  const hasPositions = weekStartHoldings.size > 0 || midWeekTrades.length > 0;

  console.log(`User ${userId} total: Gain=$${totalGain.toFixed(2)}, StartValue=$${totalStartValue.toFixed(2)}, Percent=${percentGain.toFixed(2)}%`);

  return { dollarGain: totalGain, percentGain, hasPositions };
}

// Legacy function for backward compatibility (when no week_end_price available)
function calculateWeeklyGainLegacy(
  userId: string,
  snapshots: WeekSnapshot[],
  prices: Map<string, number>
): number {
  let totalGain = 0;

  for (const snapshot of snapshots) {
    if (snapshot.weekStartPrice === null) continue;

    const currentPrice = prices.get(snapshot.symbol);
    if (currentPrice === undefined) {
      console.warn(`No current price for ${snapshot.symbol}, skipping`);
      continue;
    }

    const gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
    totalGain += gain;
  }

  return totalGain;
}

/**
 * Generate playoff bracket when regular season ends
 */
async function generatePlayoffs(
  supabase: any,
  leagueId: string,
  startWeek: number,
  playoffTeams: number
) {
  console.log(`Generating playoffs for league ${leagueId} with ${playoffTeams} teams`);

  try {
    // Get standings sorted by wins (with tiebreakers)
    const { data: standings } = await supabase
      .from('league_standings')
      .select('user_id, wins, losses, ties, points_for, points_against')
      .eq('league_id', leagueId)
      .order('wins', { ascending: false })
      .order('points_for', { ascending: false });

    if (!standings || standings.length < playoffTeams) {
      console.error('Not enough teams for playoffs');
      return;
    }

    // Get all regular season matchups for head-to-head tiebreaker
    const { data: allMatchups } = await supabase
      .from('matchups')
      .select('team1_user_id, team2_user_id, winner_user_id, team1_gain, is_playoff')
      .eq('league_id', leagueId)
      .eq('is_playoff', false);

    // Apply head-to-head tiebreaker for teams with same wins
    const seededTeams = applyTiebreakers(standings.slice(0, playoffTeams), allMatchups || []);

    // Get last regular season matchup to determine playoff start date
    const { data: lastMatchup } = await supabase
      .from('matchups')
      .select('week_end')
      .eq('league_id', leagueId)
      .eq('is_playoff', false)
      .order('week_end', { ascending: false })
      .limit(1)
      .single();

    const playoffStartDate = lastMatchup?.week_end
      ? new Date(lastMatchup.week_end)
      : new Date();

    // Generate bracket based on number of teams
    const bracketMatchups = generateBracket(seededTeams, playoffStartDate, startWeek, playoffTeams);

    // Insert playoff matchups
    for (const m of bracketMatchups) {
      const { error } = await supabase
        .from('matchups')
        .insert({
          league_id: leagueId,
          week_number: m.week,
          team1_user_id: m.team1,
          team2_user_id: m.team2,
          team1_seed: m.team1_seed,
          team2_seed: m.team2_seed,
          week_start: m.weekStart,
          week_end: m.weekEnd,
          is_playoff: true,
          playoff_round: m.playoff_round,
        });

      if (error) {
        console.error('Failed to insert playoff matchup:', error);
      }
    }

    console.log(`Created ${bracketMatchups.length} playoff matchups`);
  } catch (e) {
    console.error('Error generating playoffs:', e);
  }
}

/**
 * Apply head-to-head tiebreaker to standings
 */
function applyTiebreakers(standings: any[], matchups: any[]): any[] {
  // Group by wins
  const byWins = new Map<number, any[]>();
  for (const s of standings) {
    const wins = s.wins || 0;
    if (!byWins.has(wins)) byWins.set(wins, []);
    byWins.get(wins)!.push(s);
  }

  const result: any[] = [];
  let seed = 1;

  // Process each win group (sorted desc by wins)
  const sortedWins = Array.from(byWins.keys()).sort((a, b) => b - a);

  for (const wins of sortedWins) {
    const group = byWins.get(wins)!;

    if (group.length === 1) {
      result.push({ ...group[0], seed: seed++ });
    } else {
      // Apply tiebreakers within group
      group.sort((a, b) => {
        // Head-to-head
        const h2h = getHeadToHead(a.user_id, b.user_id, matchups);
        if (h2h.aWins !== h2h.bWins) {
          return h2h.bWins - h2h.aWins;
        }
        // Points for
        return (b.points_for || 0) - (a.points_for || 0);
      });

      for (const s of group) {
        result.push({ ...s, seed: seed++ });
      }
    }
  }

  return result;
}

/**
 * Get head-to-head record between two users
 */
function getHeadToHead(userId1: string, userId2: string, matchups: any[]) {
  let aWins = 0;
  let bWins = 0;

  for (const m of matchups) {
    if (m.is_playoff) continue;
    if (m.team1_gain === null) continue;

    const isMatch = (
      (m.team1_user_id === userId1 && m.team2_user_id === userId2) ||
      (m.team1_user_id === userId2 && m.team2_user_id === userId1)
    );

    if (isMatch) {
      if (m.winner_user_id === userId1) aWins++;
      else if (m.winner_user_id === userId2) bWins++;
    }
  }

  return { aWins, bWins };
}

/**
 * Generate bracket matchups
 */
function generateBracket(seededTeams: any[], startDate: Date, startWeek: number, numTeams: number) {
  const matchups: any[] = [];

  // Helper to get week timing
  function getWeekTiming(weekOffset: number) {
    const base = new Date(startDate);
    // Move to next Tuesday
    const dayOfWeek = base.getUTCDay();
    let daysUntilTuesday = (2 - dayOfWeek + 7) % 7;
    if (daysUntilTuesday === 0) daysUntilTuesday = 7;
    base.setUTCDate(base.getUTCDate() + daysUntilTuesday + (weekOffset * 7));
    base.setUTCHours(14, 30, 0, 0);

    const end = new Date(base);
    end.setUTCDate(end.getUTCDate() + 3);
    end.setUTCHours(21, 0, 0, 0);

    return { start: base, end };
  }

  if (numTeams === 2) {
    const timing = getWeekTiming(0);
    matchups.push({
      week: startWeek,
      team1: seededTeams[0].user_id,
      team2: seededTeams[1].user_id,
      team1_seed: 1,
      team2_seed: 2,
      weekStart: timing.start,
      weekEnd: timing.end,
      playoff_round: 'finals',
    });
  } else if (numTeams === 4) {
    // Semifinals
    const semiTiming = getWeekTiming(0);
    matchups.push({
      week: startWeek,
      team1: seededTeams[0].user_id,
      team2: seededTeams[3].user_id,
      team1_seed: 1,
      team2_seed: 4,
      weekStart: semiTiming.start,
      weekEnd: semiTiming.end,
      playoff_round: 'semi',
    });
    matchups.push({
      week: startWeek,
      team1: seededTeams[1].user_id,
      team2: seededTeams[2].user_id,
      team1_seed: 2,
      team2_seed: 3,
      weekStart: semiTiming.start,
      weekEnd: semiTiming.end,
      playoff_round: 'semi',
    });

    // Finals placeholder
    const finalsTiming = getWeekTiming(1);
    matchups.push({
      week: startWeek + 1,
      team1: null,
      team2: null,
      team1_seed: null,
      team2_seed: null,
      weekStart: finalsTiming.start,
      weekEnd: finalsTiming.end,
      playoff_round: 'finals',
    });
  } else if (numTeams === 8) {
    // Quarterfinals
    const quarterTiming = getWeekTiming(0);
    const quarterPairs = [[0, 7], [3, 4], [1, 6], [2, 5]];
    for (const [i1, i2] of quarterPairs) {
      matchups.push({
        week: startWeek,
        team1: seededTeams[i1].user_id,
        team2: seededTeams[i2].user_id,
        team1_seed: i1 + 1,
        team2_seed: i2 + 1,
        weekStart: quarterTiming.start,
        weekEnd: quarterTiming.end,
        playoff_round: 'quarter',
      });
    }

    // Semi placeholders
    const semiTiming = getWeekTiming(1);
    for (let i = 0; i < 2; i++) {
      matchups.push({
        week: startWeek + 1,
        team1: null,
        team2: null,
        team1_seed: null,
        team2_seed: null,
        weekStart: semiTiming.start,
        weekEnd: semiTiming.end,
        playoff_round: 'semi',
      });
    }

    // Finals placeholder
    const finalsTiming = getWeekTiming(2);
    matchups.push({
      week: startWeek + 2,
      team1: null,
      team2: null,
      team1_seed: null,
      team2_seed: null,
      weekStart: finalsTiming.start,
      weekEnd: finalsTiming.end,
      playoff_round: 'finals',
    });
  }

  return matchups;
}

/**
 * Advance playoff winner to next round
 */
async function advancePlayoffWinner(
  supabase: any,
  leagueId: string,
  matchup: any,
  winnerId: string
) {
  const round = matchup.playoff_round;
  const winnerSeed = matchup.winner_user_id === matchup.team1_user_id
    ? matchup.team1_seed
    : matchup.team2_seed;

  console.log(`Advancing ${winnerId} (seed ${winnerSeed}) from ${round}`);

  // Determine next round
  let nextRound: string | null = null;
  if (round === 'quarter') nextRound = 'semi';
  else if (round === 'semi') nextRound = 'finals';
  else return; // Finals has no next round

  // Find the next round matchup to update
  const { data: nextMatchups } = await supabase
    .from('matchups')
    .select('id, team1_user_id, team2_user_id, team1_seed, team2_seed')
    .eq('league_id', leagueId)
    .eq('is_playoff', true)
    .eq('playoff_round', nextRound)
    .or('team1_user_id.is.null,team2_user_id.is.null');

  if (!nextMatchups || nextMatchups.length === 0) {
    console.error('No next round matchup found');
    return;
  }

  // Find an empty slot
  for (const next of nextMatchups) {
    if (!next.team1_user_id) {
      await supabase
        .from('matchups')
        .update({ team1_user_id: winnerId, team1_seed: winnerSeed })
        .eq('id', next.id);
      console.log(`Set ${winnerId} as team1 in next round`);
      return;
    } else if (!next.team2_user_id) {
      await supabase
        .from('matchups')
        .update({ team2_user_id: winnerId, team2_seed: winnerSeed })
        .eq('id', next.id);
      console.log(`Set ${winnerId} as team2 in next round`);
      return;
    }
  }

  console.error('No empty slot found in next round');
}

/**
 * Complete season when playoffs finish - champion is finals winner
 */
async function completeSeasonFromPlayoffs(
  supabase: any,
  leagueId: string,
  championUserId: string,
  runnerUpUserId: string
) {
  console.log(`Completing season for league ${leagueId} - Champion: ${championUserId}, Runner-up: ${runnerUpUserId}`);

  try {
    // Call the database function to complete the season
    const { error } = await supabase.rpc('complete_league_season', {
      p_league_id: leagueId,
      p_champion_user_id: championUserId,
      p_runner_up_user_id: runnerUpUserId,
    });

    if (error) {
      console.error('Failed to complete season:', error);
    } else {
      console.log(`Season completed successfully for league ${leagueId}`);
    }
  } catch (e) {
    console.error('Error completing season:', e);
  }
}

/**
 * Complete season for non-playoff leagues - top 2 from standings
 */
async function completeSeasonFromStandings(
  supabase: any,
  leagueId: string
) {
  console.log(`Completing season from standings for league ${leagueId}`);

  try {
    // Get top 2 from standings
    const { data: standings } = await supabase
      .from('league_standings')
      .select('user_id, wins, points_for')
      .eq('league_id', leagueId)
      .order('wins', { ascending: false })
      .order('points_for', { ascending: false })
      .limit(2);

    if (!standings || standings.length < 2) {
      console.log('Not enough standings to determine champion');
      return;
    }

    const championUserId = standings[0].user_id;
    const runnerUpUserId = standings[1].user_id;

    // Call the database function to complete the season
    const { error } = await supabase.rpc('complete_league_season', {
      p_league_id: leagueId,
      p_champion_user_id: championUserId,
      p_runner_up_user_id: runnerUpUserId,
    });

    if (error) {
      console.error('Failed to complete season:', error);
    } else {
      console.log(`Season completed - Champion: ${championUserId}, Runner-up: ${runnerUpUserId}`);
    }
  } catch (e) {
    console.error('Error completing season from standings:', e);
  }
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

  // Update status to running
  await updateJobStatus(supabase, JOB_NAME, 'running', 1);

  try {
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
        leagues!inner(id, league_type, current_week, num_weeks, playoff_teams)
      `)
      .eq('leagues.league_type', 'matchup')
      .is('team1_gain', null)  // Results not yet calculated
      .not('team1_user_id', 'is', null) // Skip placeholder matchups (waiting for winners)
      .lt('week_end', now.toISOString());

    if (leagueIdFilter) {
      query = query.eq('league_id', leagueIdFilter);
    }

    const { data: pendingMatchups, error: matchupErr } = await query;

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

      // Get week number from matchups
      const weekNumber = leagueMatchups[0]?.week_number;

      // Get all user IDs for this batch (skip null for bye weeks)
      const userIds = new Set<string>();
      for (const m of leagueMatchups) {
        if (m.team1_user_id) userIds.add(m.team1_user_id);
        if (m.team2_user_id) userIds.add(m.team2_user_id);
      }

      // Fetch week snapshots for this league/week (including week_end_price)
      const { data: snapshotData } = await supabase
        .from('week_snapshots')
        .select('user_id, symbol, quantity, week_start_price, week_end_price')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      // Build snapshots map by user
      const userSnapshots = new Map<string, WeekSnapshot[]>();
      const snapshotSymbols = new Set<string>();
      const hasWeekEndPrices = snapshotData?.some(s => s.week_end_price != null) ?? false;

      if (snapshotData && snapshotData.length > 0) {
        for (const s of snapshotData) {
          if (!userSnapshots.has(s.user_id)) {
            userSnapshots.set(s.user_id, []);
          }
          userSnapshots.get(s.user_id)!.push({
            symbol: s.symbol,
            quantity: Number(s.quantity),
            weekStartPrice: s.week_start_price != null ? Number(s.week_start_price) : null,
            weekEndPrice: s.week_end_price != null ? Number(s.week_end_price) : null,
          });
          snapshotSymbols.add(s.symbol);
        }
        console.log(`Found ${snapshotData.length} week snapshots for week ${weekNumber}, hasWeekEndPrices: ${hasWeekEndPrices}`);
      } else {
        console.log(`No week snapshots found for week ${weekNumber}, using fallback calculation`);
      }

      // Fetch mid-week trades for this league (trades made during this week)
      // We need to get the matchup dates to filter trades
      const weekStart = leagueMatchups[0]?.week_start;
      const weekEnd = leagueMatchups[0]?.week_end;

      let midWeekTradesData: any[] = [];
      if (weekStart && weekEnd) {
        const { data: tradesDuringWeek } = await supabase
          .from('trades')
          .select('user_id, symbol, action, quantity, price, created_at')
          .eq('league_id', leagueId)
          .gte('created_at', weekStart)
          .lte('created_at', weekEnd);

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

      // Fetch drafts for this league (needed for fallback if no snapshots)
      const { data: drafts } = await supabase
        .from('drafts')
        .select('user_id, symbol, entry_price, quantity')
        .eq('league_id', leagueId);

      // Fetch trades for this league (needed for fallback if no snapshots)
      const { data: trades } = await supabase
        .from('trades')
        .select('user_id, symbol, action, quantity, price')
        .eq('league_id', leagueId);

      // Get all symbols (from snapshots or drafts/trades)
      const symbols = new Set<string>(snapshotSymbols);
      if (snapshotSymbols.size === 0) {
        for (const d of drafts || []) {
          if (d.symbol) symbols.add(d.symbol.toUpperCase());
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

      // Calculate scores for each user (using new scoring system if week_end_prices available)
      const userScores = new Map<string, UserScore>();
      for (const userId of userIds) {
        const snapshots = userSnapshots.get(userId) || [];
        const midWeekTrades = userMidWeekTrades.get(userId) || [];

        if (snapshots.length > 0 && hasWeekEndPrices) {
          // Use new scoring system with week_start_price, week_end_price, and mid-week trades
          const score = calculateUserScore(userId, snapshots, midWeekTrades);
          userScores.set(userId, score);
          console.log(`User ${userId}: Dollar gain: $${score.dollarGain.toFixed(2)}, Percent: ${score.percentGain.toFixed(2)}%`);
        } else if (snapshots.length > 0) {
          // Legacy: Use week snapshots with live prices (no week_end_price stored yet)
          const gain = calculateWeeklyGainLegacy(userId, snapshots, prices);
          userScores.set(userId, { dollarGain: gain, percentGain: 0, hasPositions: true });
        } else {
          // Fallback to portfolio calculation (cumulative from entry price)
          const portfolio = calculatePortfolio(userId, drafts || [], trades || [], prices);
          userScores.set(userId, {
            dollarGain: portfolio.gain,
            percentGain: portfolio.totalCost > 0 ? (portfolio.gain / portfolio.totalCost) * 100 : 0,
            hasPositions: portfolio.holdings.length > 0
          });
        }
      }

      // Process each matchup
      for (const matchup of leagueMatchups) {
        // Check for bye week (team2_user_id is null) - only in regular season
        const isByeWeek = !matchup.team2_user_id && !matchup.is_playoff;
        const isPlayoff = matchup.is_playoff === true;

        const team1Score = userScores.get(matchup.team1_user_id) ?? { dollarGain: 0, percentGain: 0, hasPositions: false };
        const team1Gain = team1Score.dollarGain;

        let team2Gain = 0;
        let team2Score: UserScore = { dollarGain: 0, percentGain: 0, hasPositions: false };
        let winnerId: string | null = null;
        let isTie = false;
        let team1Won = false;
        let team2Won = false;

        if (isByeWeek) {
          // Bye week: team1 gets automatic win
          winnerId = matchup.team1_user_id;
          team1Won = true;
          team2Gain = 0; // No opponent
          console.log(`Processing bye week for user ${matchup.team1_user_id}`);
        } else {
          // Normal matchup or playoff
          team2Score = userScores.get(matchup.team2_user_id) ?? { dollarGain: 0, percentGain: 0, hasPositions: false };
          team2Gain = team2Score.dollarGain;

          // Rule: Empty portfolio = automatic loss
          const team1Empty = !team1Score.hasPositions;
          const team2Empty = !team2Score.hasPositions;

          if (team1Empty && team2Empty) {
            // Both empty - true tie
            isTie = true;
            console.log(`Both teams have empty portfolios - tie`);
          } else if (team1Empty) {
            // Team 1 empty = automatic loss
            winnerId = matchup.team2_user_id;
            team2Won = true;
            console.log(`Team 1 has empty portfolio - automatic loss`);
          } else if (team2Empty) {
            // Team 2 empty = automatic loss
            winnerId = matchup.team1_user_id;
            team1Won = true;
            console.log(`Team 2 has empty portfolio - automatic loss`);
          } else {
            // Both have positions - compare dollar gains
            if (team1Gain > team2Gain) {
              winnerId = matchup.team1_user_id;
              team1Won = true;
            } else if (team2Gain > team1Gain) {
              winnerId = matchup.team2_user_id;
              team2Won = true;
            } else {
              // Dollar gains are tied - use percentage gain as tiebreaker
              const team1Pct = team1Score.percentGain;
              const team2Pct = team2Score.percentGain;

              if (team1Pct > team2Pct) {
                winnerId = matchup.team1_user_id;
                team1Won = true;
                console.log(`Dollar tie ($${team1Gain.toFixed(2)}), Team 1 wins on percent (${team1Pct.toFixed(2)}% vs ${team2Pct.toFixed(2)}%)`);
              } else if (team2Pct > team1Pct) {
                winnerId = matchup.team2_user_id;
                team2Won = true;
                console.log(`Dollar tie ($${team1Gain.toFixed(2)}), Team 2 wins on percent (${team2Pct.toFixed(2)}% vs ${team1Pct.toFixed(2)}%)`);
              } else {
                // True tie - both dollar and percent are the same
                if (isPlayoff) {
                  // In playoffs, higher seed (lower number) wins
                  const seed1 = matchup.team1_seed || 999;
                  const seed2 = matchup.team2_seed || 999;
                  if (seed1 < seed2) {
                    winnerId = matchup.team1_user_id;
                    team1Won = true;
                  } else {
                    winnerId = matchup.team2_user_id;
                    team2Won = true;
                  }
                  console.log(`Playoff double-tie, seed tiebreaker: seed ${seed1} vs ${seed2}, winner: ${winnerId}`);
                } else {
                  // Regular season - true tie (0.5 wins each)
                  isTie = true;
                  console.log(`True tie - both dollar ($${team1Gain.toFixed(2)}) and percent (${team1Pct.toFixed(2)}%) are equal`);
                }
              }
            }
          }
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

        // For playoff matchups, advance winner to next round
        if (isPlayoff && winnerId) {
          await advancePlayoffWinner(supabase, leagueId, matchup, winnerId);
        }

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
          // Calculate increments - ties only increment ties column, not wins/losses
          const winsIncrement = won ? 1 : 0;
          const lossesIncrement = lost ? 1 : 0;
          const tiesIncrement = tied ? 1 : 0;

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
          // Team 1 standings update
          // For bye weeks, points_against is 0 (no opponent)
          const stand1Err = await updateUserStandings(
            leagueId,
            matchup.team1_user_id,
            team1Won,
            team2Won,
            isTie,
            team1Gain,
            isByeWeek ? 0 : team2Gain
          );
          if (stand1Err) {
            console.error(`Failed to update standings for ${matchup.team1_user_id}:`, stand1Err);
          }

          // Team 2 standings update (skip for bye weeks)
          if (!isByeWeek) {
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

      // Check if all matchups for the current week are done, advance week.
      // Process each unique week sequentially (handles multi-week batches).
      const numWeeks = leagueMatchups[0]?.leagues?.num_weeks || 0;
      const playoffTeams = leagueMatchups[0]?.leagues?.playoff_teams || 4;
      const processedWeeks = [...new Set(leagueMatchups.map(m => m.week_number))].sort((a, b) => a - b);

      for (const week of processedWeeks) {
        // Re-read current_week from DB (may have changed from prior iteration)
        const { data: leagueData } = await supabase
          .from('leagues')
          .select('current_week, season_status')
          .eq('id', leagueId)
          .single();

        const currentWeek = leagueData?.current_week || 1;
        if (leagueData?.season_status === 'completed') break; // Season already done
        if (week !== currentWeek) continue; // Not the current week, skip

        // Check if all matchups for this week are processed
        const { data: remainingMatchups } = await supabase
          .from('matchups')
          .select('id')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek)
          .is('team1_gain', null);

        if (!remainingMatchups || remainingMatchups.length === 0) {
          const isPlayoffWeek = leagueMatchups.some(m => m.is_playoff && m.week_number === week);

          if (isPlayoffWeek) {
            // Check if this was the finals round
            const finalsMatchup = leagueMatchups.find(m => m.playoff_round === 'finals' && m.week_number === week);
            if (finalsMatchup) {
              // Finals completed — complete the season (do NOT advance current_week)
              const finalsWinner = results.find(r => r.matchupId === finalsMatchup.id)?.winner;
              if (finalsWinner) {
                const loserId = finalsMatchup.team1_user_id === finalsWinner
                  ? finalsMatchup.team2_user_id
                  : finalsMatchup.team1_user_id;
                await completeSeasonFromPlayoffs(supabase, leagueId, finalsWinner, loserId);
                console.log(`Season completed for league ${leagueId} - Champion: ${finalsWinner}`);
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
            // Last regular-season week just completed
            if (playoffTeams > 0) {
              await supabase.from('leagues')
                .update({ current_week: numWeeks + 1, season_status: 'playoffs' })
                .eq('id', leagueId);
              console.log(`League ${leagueId} transitioning to playoffs`);
              await generatePlayoffs(supabase, leagueId, numWeeks + 1, playoffTeams);
            } else {
              // No playoffs — complete season, do NOT advance past numWeeks
              console.log(`League ${leagueId} regular season complete (no playoffs)`);
              await completeSeasonFromStandings(supabase, leagueId);
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

    // Update status to success
    await updateJobStatus(supabase, JOB_NAME, 'success', 1);

    return json({
      message: 'Processing complete',
      processed: processedCount,
      results
    });

  } catch (e) {
    console.error('Unhandled error:', e);

    // Update status to failed
    await updateJobStatus(supabase, JOB_NAME, 'failed', 1, String(e));

    return json({ error: 'Unhandled error', message: String(e) }, 500);
  }
});
