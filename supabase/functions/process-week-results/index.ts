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

interface WeekSnapshot {
  symbol: string;
  quantity: number;
  weekStartPrice: number;
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

// Calculate weekly gain using week start snapshots
function calculateWeeklyGain(
  userId: string,
  snapshots: WeekSnapshot[],
  prices: Map<string, number>
): number {
  let totalGain = 0;

  for (const snapshot of snapshots) {
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
        team1_seed,
        team2_seed,
        week_end,
        is_playoff,
        playoff_round,
        leagues!inner(id, league_type, current_week, num_weeks, playoff_teams)
      `)
      .eq('leagues.league_type', 'matchup')
      .is('team1_gain', null)  // Results not yet calculated
      .not('team1_user_id', 'is', null) // Skip placeholder matchups (waiting for winners)
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

      // Get week number from matchups
      const weekNumber = leagueMatchups[0]?.week_number;

      // Get all user IDs for this batch (skip null for bye weeks)
      const userIds = new Set<string>();
      for (const m of leagueMatchups) {
        if (m.team1_user_id) userIds.add(m.team1_user_id);
        if (m.team2_user_id) userIds.add(m.team2_user_id);
      }

      // Fetch week snapshots for this league/week
      const { data: snapshotData } = await supabase
        .from('week_snapshots')
        .select('user_id, symbol, quantity, week_start_price')
        .eq('league_id', leagueId)
        .eq('week_number', weekNumber);

      // Build snapshots map by user
      const userSnapshots = new Map<string, WeekSnapshot[]>();
      const snapshotSymbols = new Set<string>();
      if (snapshotData && snapshotData.length > 0) {
        for (const s of snapshotData) {
          if (!userSnapshots.has(s.user_id)) {
            userSnapshots.set(s.user_id, []);
          }
          userSnapshots.get(s.user_id)!.push({
            symbol: s.symbol,
            quantity: Number(s.quantity),
            weekStartPrice: Number(s.week_start_price),
          });
          snapshotSymbols.add(s.symbol);
        }
        console.log(`Found ${snapshotData.length} week snapshots for week ${weekNumber}`);
      } else {
        console.log(`No week snapshots found for week ${weekNumber}, using fallback calculation`);
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

      // Calculate gains for each user (using snapshots if available, otherwise portfolio)
      const userGains = new Map<string, number>();
      for (const userId of userIds) {
        const snapshots = userSnapshots.get(userId);
        if (snapshots && snapshots.length > 0) {
          // Use week snapshots for gain calculation
          const gain = calculateWeeklyGain(userId, snapshots, prices);
          userGains.set(userId, gain);
        } else {
          // Fallback to portfolio calculation (cumulative from entry price)
          const portfolio = calculatePortfolio(userId, drafts || [], trades || [], prices);
          userGains.set(userId, portfolio.gain);
        }
      }

      // Process each matchup
      for (const matchup of leagueMatchups) {
        // Check for bye week (team2_user_id is null) - only in regular season
        const isByeWeek = !matchup.team2_user_id && !matchup.is_playoff;
        const isPlayoff = matchup.is_playoff === true;

        const team1Gain = userGains.get(matchup.team1_user_id) ?? 0;

        let team2Gain = 0;
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
          team2Gain = userGains.get(matchup.team2_user_id) ?? 0;

          // Determine winner (no ties in playoffs - use tiebreaker)
          if (team1Gain > team2Gain) {
            winnerId = matchup.team1_user_id;
            team1Won = true;
          } else if (team2Gain > team1Gain) {
            winnerId = matchup.team2_user_id;
            team2Won = true;
          } else {
            // Tie - in playoffs, higher seed wins
            if (isPlayoff) {
              // Higher seed (lower number) wins tiebreaker
              const seed1 = matchup.team1_seed || 999;
              const seed2 = matchup.team2_seed || 999;
              if (seed1 < seed2) {
                winnerId = matchup.team1_user_id;
                team1Won = true;
              } else {
                winnerId = matchup.team2_user_id;
                team2Won = true;
              }
              console.log(`Playoff tiebreaker: seed ${seed1} vs ${seed2}, winner: ${winnerId}`);
            } else {
              isTie = true;
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

      // Check if all matchups for the current week are done, advance week
      const currentWeek = leagueMatchups[0]?.leagues?.current_week || 1;
      const numWeeks = leagueMatchups[0]?.leagues?.num_weeks || 0;
      const playoffTeams = leagueMatchups[0]?.leagues?.playoff_teams || 4;
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

          // Check if regular season just ended and we need to generate playoffs
          if (currentWeek === numWeeks && playoffTeams > 0) {
            await generatePlayoffs(supabase, leagueId, numWeeks + 1, playoffTeams);
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
