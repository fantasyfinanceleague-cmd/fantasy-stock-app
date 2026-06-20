/**
 * Season Simulation Test Runner
 *
 * Automated testing of the complete league season lifecycle:
 * draft → regular season → playoffs → season completion
 *
 * Tests multiple league configurations with deterministic mock data.
 *
 * Usage:
 *   node scripts/simulation-test-runner.mjs
 *
 * Reads SUPABASE_SERVICE_ROLE_KEY from .env at repo root (or from environment).
 * Each edge function call is scoped to the test league via the league_id
 * parameter, so real leagues are never affected.
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load .env from repo root (lightweight, no dotenv dependency)
const envPath = path.resolve(new URL('.', import.meta.url).pathname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

// ─── Configuration ──────────────────────────────────────────────────────────

const SUPABASE_URL = 'https://haiaaifjcclsvmkfqgmd.supabase.co';

// Phase 2b-2: process-week-results now authenticates via an `apikey` header
// validated against SB_SECRET_KEY_CRON (the cron secret key), NOT the legacy
// service_role bearer token. The harness must therefore send the CRON key for
// the edge-function call. (The service_role key is still used for the data-plane
// seed/teardown via createClient — that migrates in Phase 3.) Never hardcode.
const CRON_KEY = process.env.SB_SECRET_KEY_CRON;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/process-week-results`;

const STOCK_POOL = [
  'AAPL', 'MSFT', 'GOOG', 'AMZN', 'TSLA', 'NVDA', 'META', 'NFLX',
  'DIS', 'AMD', 'INTC', 'PYPL', 'UBER', 'SQ', 'SHOP', 'CRM',
  'ABNB', 'SNAP', 'PINS', 'ROKU', 'COIN', 'RBLX', 'PLTR', 'SOFI',
  'DKNG', 'DASH', 'ZM', 'DOCU', 'CRWD', 'NET', 'SE', 'MELI',
  'TTD', 'BILL', 'MNDY', 'HUBS', 'DDOG', 'SNOW', 'MDB', 'ZS',
  'OKTA', 'TWLO', 'FIVN', 'GTLB', 'CFLT', 'PATH', 'HOOD', 'AFRM',
  'UPST', 'TOST', 'GLBE', 'CWAN', 'PCOR', 'IOT', 'CELH', 'DUOL',
  'AXON', 'ONON', 'BIRK', 'CART', 'ARM', 'PANW', 'WDAY', 'NOW',
  'TEAM', 'ADBE', 'ORCL', 'COP', 'LLY', 'UNH', 'JNJ', 'PG',
  'KO', 'PEP', 'MCD', 'WMT', 'TGT', 'COST', 'HD', 'LOW',
  'BA', 'CAT', 'DE', 'GE', 'HON', 'MMM', 'UPS', 'FDX',
  'V', 'MA', 'AXP', 'GS', 'JPM', 'BAC', 'WFC', 'C',
];

const TEST_CONFIGS = [
  // ── Playoff bracket sizes ──────────────────────────────────────────────
  { name: '4T-3W-2P',   numTeams: 4,  numWeeks: 3,  playoffTeams: 2, numRounds: 3 },  // 2-team playoffs (finals only)
  { name: '4T-3W-4P',   numTeams: 4,  numWeeks: 3,  playoffTeams: 4, numRounds: 3 },  // 4-team playoffs (semi+finals)
  { name: '8T-7W-8P',   numTeams: 8,  numWeeks: 7,  playoffTeams: 8, numRounds: 3 },  // 8-team playoffs (quarter+semi+finals)

  // ── Odd team counts (bye weeks) ────────────────────────────────────────
  { name: '5T-5W-4P',   numTeams: 5,  numWeeks: 5,  playoffTeams: 4, numRounds: 3 },  // smallest odd
  { name: '7T-7W-4P',   numTeams: 7,  numWeeks: 7,  playoffTeams: 4, numRounds: 3 },  // mid odd
  { name: '9T-9W-8P',   numTeams: 9,  numWeeks: 9,  playoffTeams: 8, numRounds: 3 },  // odd with 8-team playoffs

  // ── Standard even team counts ──────────────────────────────────────────
  { name: '6T-5W-4P',   numTeams: 6,  numWeeks: 5,  playoffTeams: 4, numRounds: 3 },
  { name: '8T-7W-4P',   numTeams: 8,  numWeeks: 7,  playoffTeams: 4, numRounds: 3 },
  { name: '10T-9W-8P',  numTeams: 10, numWeeks: 9,  playoffTeams: 8, numRounds: 3 },

  // ── Larger leagues (near max) ──────────────────────────────────────────
  { name: '12T-11W-8P', numTeams: 12, numWeeks: 11, playoffTeams: 8, numRounds: 3 },
  { name: '14T-13W-8P', numTeams: 14, numWeeks: 13, playoffTeams: 8, numRounds: 3 },
  { name: '16T-15W-8P', numTeams: 16, numWeeks: 15, playoffTeams: 8, numRounds: 3 },  // max league size

  // ── 2-team playoffs with larger leagues ────────────────────────────────
  { name: '6T-5W-2P',   numTeams: 6,  numWeeks: 5,  playoffTeams: 2, numRounds: 3 },
  { name: '10T-9W-2P',  numTeams: 10, numWeeks: 9,  playoffTeams: 2, numRounds: 3 },

  // ── Extra weeks (more than minimum round-robin) ────────────────────────
  { name: '6T-8W-4P',   numTeams: 6,  numWeeks: 8,  playoffTeams: 4, numRounds: 3 },  // 3 extra weeks
  { name: '4T-6W-2P',   numTeams: 4,  numWeeks: 6,  playoffTeams: 2, numRounds: 3 },  // double minimum

  // ── Different draft sizes (numRounds) ──────────────────────────────────
  { name: '6T-5W-4P-6R', numTeams: 6,  numWeeks: 5,  playoffTeams: 4, numRounds: 6 },  // 6 stocks per team
  { name: '4T-3W-4P-10R', numTeams: 4, numWeeks: 3,  playoffTeams: 4, numRounds: 10 }, // 10 stocks per team
];

// ─── ID Generators ──────────────────────────────────────────────────────────

function generateLeagueId(testIndex) {
  const hex = testIndex.toString(16).padStart(12, '0');
  return `11111111-0000-4000-a000-${hex}`;
}

function generateSeasonId(testIndex) {
  const hex = testIndex.toString(16).padStart(12, '0');
  return `22222222-0000-4000-a000-${hex}`;
}

function generateUserIds(testIndex, numTeams) {
  return Array.from({ length: numTeams }, (_, i) => `sim-t${testIndex}-user-${i}`);
}

function generateInviteCode(testIndex) {
  return `SIMTS${testIndex.toString().padStart(3, '0')}`;
}

// ─── Logger ─────────────────────────────────────────────────────────────────

class Logger {
  constructor() {
    this.buffer = [];
  }

  _log(msg) {
    console.log(msg);
    this.buffer.push(msg);
  }

  info(msg)    { this._log(`    ${msg}`); }
  success(msg) { this._log(`  PASS  ${msg}`); }
  fail(msg)    { this._log(`  FAIL  ${msg}`); }
  error(msg)   { this._log(`  ERR   ${msg}`); }

  section(msg) {
    this._log('');
    this._log('='.repeat(64));
    this._log(`  ${msg}`);
    this._log('='.repeat(64));
  }

  writeToFile() {
    const dir = 'logs';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${dir}/simulation-test-${ts}.log`;
    fs.writeFileSync(filename, this.buffer.join('\n') + '\n');
    this._log(`\nLog written to ${filename}`);
  }
}

// ─── Round-Robin Schedule (Circle Method) ───────────────────────────────────

function generateRoundRobinSchedule(userIds, numWeeks, baseDate) {
  const teams = [...userIds];
  if (teams.length % 2 !== 0) teams.push(null); // bye placeholder

  const n = teams.length;
  const roundsNeeded = n - 1;
  const schedule = [];

  for (let round = 0; round < numWeeks; round++) {
    const effectiveRound = round % roundsNeeded;

    // Build rotation: fix teams[0], rotate the rest
    const rotated = teams.slice(1);
    for (let r = 0; r < effectiveRound; r++) {
      rotated.unshift(rotated.pop()); // rotate right
    }
    const roundTeams = [teams[0], ...rotated];

    // Week timing (all in the past)
    const weekStart = new Date(baseDate);
    weekStart.setUTCDate(weekStart.getUTCDate() + round * 7 + 2); // Tuesday
    weekStart.setUTCHours(14, 30, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 3); // Friday
    weekEnd.setUTCHours(21, 0, 0, 0);

    // Pair: [0] vs [n-1], [1] vs [n-2], etc.
    for (let i = 0; i < n / 2; i++) {
      let t1 = roundTeams[i];
      let t2 = roundTeams[n - 1 - i];

      // Ensure bye (null) is always team2 so edge function picks it up
      if (t1 === null) [t1, t2] = [t2, t1];
      if (t1 === null) continue;

      schedule.push({
        weekNumber: round + 1,
        team1UserId: t1,
        team2UserId: t2,
        weekStart: weekStart.toISOString(),
        weekEnd: weekEnd.toISOString(),
      });
    }
  }

  return schedule;
}

// ─── Stock Assignment ───────────────────────────────────────────────────────

function assignStocks(userIds, numRounds) {
  const teamStocks = new Map();
  let idx = 0;

  for (const userId of userIds) {
    const stocks = [];
    for (let r = 0; r < numRounds; r++) {
      stocks.push(STOCK_POOL[idx % STOCK_POOL.length]);
      idx++;
    }
    teamStocks.set(userId, stocks);
  }

  return teamStocks;
}

// ─── Mock Price Generation ──────────────────────────────────────────────────

/**
 * Generate deterministic gains: team at index 0 = strongest, index N-1 = weakest.
 * Gain = (numTeams - index) * 10
 * e.g. 4 teams: $40, $30, $20, $10
 */
function generateGainsMap(userIds) {
  const gainsMap = new Map();
  for (let i = 0; i < userIds.length; i++) {
    gainsMap.set(userIds[i], (userIds.length - i) * 10);
  }
  return gainsMap;
}

// ─── Expected Standings Calculation ─────────────────────────────────────────

/**
 * Since all regular season weeks are processed in one edge function call,
 * ALL matchups get scored using week 1's snapshots. Every user has the
 * same gain in every matchup. This function computes expected W/L.
 */
function calculateExpectedStandings(schedule, gainsMap) {
  const standings = new Map();
  for (const [userId] of gainsMap) {
    standings.set(userId, { wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 });
  }

  for (const matchup of schedule) {
    const { team1UserId, team2UserId } = matchup;
    const s1 = standings.get(team1UserId);
    const gain1 = gainsMap.get(team1UserId);

    if (team2UserId === null) {
      // Bye week = automatic win
      s1.wins += 1;
      s1.pointsFor += gain1;
      continue;
    }

    const s2 = standings.get(team2UserId);
    const gain2 = gainsMap.get(team2UserId);

    s1.pointsFor += gain1;
    s1.pointsAgainst += gain2;
    s2.pointsFor += gain2;
    s2.pointsAgainst += gain1;

    if (gain1 > gain2) {
      s1.wins += 1;
      s2.losses += 1;
    } else if (gain2 > gain1) {
      s2.wins += 1;
      s1.losses += 1;
    } else {
      s1.ties += 1;
      s2.ties += 1;
    }
  }

  return standings;
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

async function cleanup(supabase, lgId) {
  // FK-safe deletion order
  await supabase.from('trades').delete().eq('league_id', lgId);
  await supabase.from('matchups').delete().eq('league_id', lgId);
  await supabase.from('week_snapshots').delete().eq('league_id', lgId);
  await supabase.from('drafts').delete().eq('league_id', lgId);
  await supabase.from('league_standings').delete().eq('league_id', lgId);
  await supabase.from('leagues').update({ current_season_id: null }).eq('id', lgId);
  await supabase.from('league_seasons').delete().eq('league_id', lgId);
  await supabase.from('league_members').delete().eq('league_id', lgId);
  await supabase.from('leagues').delete().eq('id', lgId);
}

// ─── Seeding ────────────────────────────────────────────────────────────────

async function seedLeague(supabase, config, testIndex) {
  const lgId = generateLeagueId(testIndex);
  const snId = generateSeasonId(testIndex);
  const userIds = generateUserIds(testIndex, config.numTeams);
  const inviteCode = generateInviteCode(testIndex);
  const teamStocks = assignStocks(userIds, config.numRounds);
  const gainsMap = generateGainsMap(userIds);

  // Base date: well in the past
  const baseDate = new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() - (config.numWeeks + 15) * 7);

  // Cleanup any leftover data from a previous failed run
  await cleanup(supabase, lgId);

  // 1. League
  const { error: e1 } = await supabase.from('leagues').insert({
    id: lgId,
    name: `__SIM_TEST_${config.name}__`,
    commissioner_id: userIds[0],
    invite_code: inviteCode,
    num_participants: config.numTeams,
    num_rounds: config.numRounds,
    num_weeks: config.numWeeks,
    playoff_teams: config.playoffTeams,
    league_type: 'matchup',
    budget_mode: 'no-budget',
    budget_amount: 100000,
    draft_status: 'completed',
    current_week: 1,
    season_status: 'active',
    draft_date: baseDate.toISOString(),
    duration_days: 30,
  });
  if (e1) throw new Error(`Insert league: ${e1.message}`);

  // 2. Members
  const members = userIds.map((uid, i) => ({
    league_id: lgId,
    user_id: uid,
    role: i === 0 ? 'commissioner' : 'member',
  }));
  const { error: e2 } = await supabase.from('league_members').insert(members);
  if (e2) throw new Error(`Insert members: ${e2.message}`);

  // 3. Season
  const { error: e3 } = await supabase.from('league_seasons').insert({
    id: snId,
    league_id: lgId,
    season_number: 1,
  });
  if (e3) throw new Error(`Insert season: ${e3.message}`);

  // 4. Link season to league
  const { error: e4 } = await supabase
    .from('leagues')
    .update({ current_season_id: snId })
    .eq('id', lgId);
  if (e4) throw new Error(`Update current_season_id: ${e4.message}`);

  // 5. Standings (all zeros)
  const standingsRows = userIds.map(uid => ({
    league_id: lgId,
    user_id: uid,
    wins: 0, losses: 0, ties: 0,
    points_for: 0, points_against: 0,
  }));
  const { error: e5 } = await supabase.from('league_standings').insert(standingsRows);
  if (e5) throw new Error(`Insert standings: ${e5.message}`);

  // 6. Draft picks (snake order)
  const drafts = [];
  let pickNum = 1;
  for (let round = 1; round <= config.numRounds; round++) {
    const order = round % 2 === 1 ? userIds : [...userIds].reverse();
    for (const uid of order) {
      const stocks = teamStocks.get(uid);
      drafts.push({
        league_id: lgId,
        user_id: uid,
        symbol: stocks[round - 1],
        entry_price: 100,
        quantity: 1,
        round,
        pick_number: pickNum++,
      });
    }
  }
  const { error: e6 } = await supabase.from('drafts').insert(drafts);
  if (e6) throw new Error(`Insert drafts: ${e6.message}`);

  // 7. Matchups (round-robin, all dates in the past)
  const schedule = generateRoundRobinSchedule(userIds, config.numWeeks, baseDate);
  const matchupRows = schedule.map(m => ({
    league_id: lgId,
    week_number: m.weekNumber,
    team1_user_id: m.team1UserId,
    team2_user_id: m.team2UserId,
    week_start: m.weekStart,
    week_end: m.weekEnd,
    is_playoff: false,
  }));
  const { error: e7 } = await supabase.from('matchups').insert(matchupRows);
  if (e7) throw new Error(`Insert matchups: ${e7.message}`);

  // 8. Week snapshots for ALL weeks (identical mock prices each week).
  //    The edge function loads snapshots for leagueMatchups[0].week_number,
  //    and without ORDER BY the first matchup could be from any week.
  //    Creating snapshots for every week ensures deterministic scoring.
  const snapshots = [];
  for (let week = 1; week <= config.numWeeks; week++) {
    for (const uid of userIds) {
      const stocks = teamStocks.get(uid);
      const gain = gainsMap.get(uid);
      const gainPerStock = gain / stocks.length;

      for (const symbol of stocks) {
        snapshots.push({
          league_id: lgId,
          user_id: uid,
          week_number: week,
          symbol,
          quantity: 1,
          week_start_price: 100,
          week_end_price: 100 + gainPerStock,
        });
      }
    }
  }
  // Insert in batches (Supabase has row limits on single inserts)
  const BATCH_SIZE = 500;
  for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
    const batch = snapshots.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('week_snapshots').insert(batch);
    if (error) throw new Error(`Insert snapshots batch ${i}: ${error.message}`);
  }

  // Expected standings
  const expectedStandings = calculateExpectedStandings(schedule, gainsMap);

  return { lgId, snId, userIds, teamStocks, gainsMap, expectedStandings, schedule };
}

// ─── Edge Function ──────────────────────────────────────────────────────────

// Note: the `serviceRoleKey` param is retained for call-site compatibility but is
// no longer used for the function call's auth — process-week-results validates the
// `apikey` header against the cron key (see CRON_KEY above).
async function callEdgeFunction(_serviceRoleKey, leagueId) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'apikey': CRON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ league_id: leagueId }),
  });
  return response.json();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Playoff Processing ────────────────────────────────────────────────────

function getPlayoffRounds(playoffTeams) {
  if (playoffTeams === 2) return ['finals'];
  if (playoffTeams === 4) return ['semi', 'finals'];
  if (playoffTeams === 8) return ['quarter', 'semi', 'finals'];
  return [];
}

/**
 * Inject mock week_snapshots for a playoff round.
 * Higher-ranked team (lower user index) gets $50 gain, weaker gets $20.
 */
async function injectPlayoffSnapshots(supabase, lgId, weekNumber, matchups, teamStocks, userRankMap) {
  const snapshots = [];

  for (const m of matchups) {
    const t1 = m.team1_user_id;
    const t2 = m.team2_user_id;
    if (!t1 || !t2) continue;

    const rank1 = userRankMap.get(t1) ?? 999;
    const rank2 = userRankMap.get(t2) ?? 999;

    const t1Gain = rank1 < rank2 ? 50 : 20;
    const t2Gain = rank1 < rank2 ? 20 : 50;

    const stocks1 = teamStocks.get(t1) || [];
    const stocks2 = teamStocks.get(t2) || [];

    for (const symbol of stocks1) {
      snapshots.push({
        league_id: lgId,
        user_id: t1,
        week_number: weekNumber,
        symbol,
        quantity: 1,
        week_start_price: 100,
        week_end_price: 100 + t1Gain / stocks1.length,
      });
    }

    for (const symbol of stocks2) {
      snapshots.push({
        league_id: lgId,
        user_id: t2,
        week_number: weekNumber,
        symbol,
        quantity: 1,
        week_start_price: 100,
        week_end_price: 100 + t2Gain / stocks2.length,
      });
    }
  }

  if (snapshots.length > 0) {
    const { error } = await supabase.from('week_snapshots').insert(snapshots);
    if (error) throw new Error(`Insert playoff snapshots week ${weekNumber}: ${error.message}`);
  }
}

/**
 * Ensure all playoff matchup dates are in the past so the edge function picks them up.
 */
async function ensurePlayoffDatesInPast(supabase, lgId) {
  const now = new Date().toISOString();
  const pastEnd = new Date(Date.now() - 3600_000).toISOString();
  const pastStart = new Date(Date.now() - 7 * 86400_000).toISOString();

  const { data: futureMatchups } = await supabase
    .from('matchups')
    .select('id, week_end')
    .eq('league_id', lgId)
    .eq('is_playoff', true)
    .gt('week_end', now);

  if (futureMatchups && futureMatchups.length > 0) {
    for (const m of futureMatchups) {
      await supabase
        .from('matchups')
        .update({ week_start: pastStart, week_end: pastEnd })
        .eq('id', m.id);
    }
  }
}

/**
 * Process each playoff round: inject snapshots → call edge function → verify.
 */
async function processPlayoffs(supabase, lgId, config, serviceRoleKey, teamStocks, userRankMap, logger) {
  const rounds = getPlayoffRounds(config.playoffTeams);

  for (const round of rounds) {
    // Wait for DB consistency after previous round
    await sleep(2000);

    // Ensure dates are in the past before querying
    await ensurePlayoffDatesInPast(supabase, lgId);

    // Query matchups for this round with both teams populated
    const { data: roundMatchups } = await supabase
      .from('matchups')
      .select('id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed, week_end')
      .eq('league_id', lgId)
      .eq('is_playoff', true)
      .eq('playoff_round', round)
      .not('team1_user_id', 'is', null)
      .not('team2_user_id', 'is', null);

    if (!roundMatchups || roundMatchups.length === 0) {
      logger.error(`No populated matchups for ${round} round — skipping`);
      continue;
    }

    const weekNumber = roundMatchups[0].week_number;
    logger.info(`${round}: ${roundMatchups.length} matchup(s), week ${weekNumber}`);

    // Inject mock snapshots
    await injectPlayoffSnapshots(supabase, lgId, weekNumber, roundMatchups, teamStocks, userRankMap);

    // Call edge function
    await sleep(2000);
    const result = await callEdgeFunction(serviceRoleKey, lgId);
    const processed = result.processed || 0;
    logger.info(`${round}: edge function processed ${processed} matchup(s)`);

    // Retry once if nothing was processed
    if (processed === 0) {
      logger.info(`${round}: retrying after 3s...`);
      await sleep(3000);
      const retry = await callEdgeFunction(serviceRoleKey, lgId);
      logger.info(`${round}: retry processed ${retry.processed || 0} matchup(s)`);
    }

    // Log individual results
    if (result.results) {
      for (const r of result.results) {
        if (r.isPlayoff) {
          const g1 = r.team1Gain != null ? `$${r.team1Gain.toFixed(2)}` : '?';
          const g2 = r.team2Gain != null ? `$${r.team2Gain.toFixed(2)}` : '?';
          logger.info(`  ${r.playoffRound}: ${r.team1} (${g1}) vs ${r.team2} (${g2}) -> ${r.winner}`);
        }
      }
    }
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

async function validate(supabase, lgId, config, userIds, expectedStandings, logger) {
  const failures = [];

  // 1. League status
  const { data: league } = await supabase
    .from('leagues')
    .select('season_status, current_week')
    .eq('id', lgId)
    .single();

  if (!league) {
    return { passed: false, failures: ['League not found'] };
  }

  if (league.season_status !== 'completed') {
    failures.push(`season_status: expected 'completed', got '${league.season_status}'`);
  }

  // 2. Season record
  const { data: season } = await supabase
    .from('league_seasons')
    .select('champion_user_id, runner_up_user_id, completed_at, final_standings')
    .eq('league_id', lgId)
    .single();

  if (!season) {
    return { passed: false, failures: ['Season record not found'] };
  }

  if (!season.champion_user_id) failures.push('champion_user_id is null');
  if (!season.runner_up_user_id) failures.push('runner_up_user_id is null');
  if (!season.completed_at) failures.push('completed_at is null');
  if (!season.final_standings) failures.push('final_standings is null');

  // Expected champion = user index 0 (highest gain → most wins → seed 1)
  if (season.champion_user_id !== userIds[0]) {
    failures.push(`champion: expected '${userIds[0]}', got '${season.champion_user_id}'`);
  }

  // Runner-up should not be null or the same as champion
  if (season.runner_up_user_id === season.champion_user_id) {
    failures.push('runner_up equals champion');
  }

  // 3. Regular season matchups — all should have results
  const { data: regMatchups } = await supabase
    .from('matchups')
    .select('week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie')
    .eq('league_id', lgId)
    .eq('is_playoff', false)
    .order('week_number');

  for (const m of regMatchups || []) {
    if (m.team1_gain === null) {
      failures.push(`Week ${m.week_number}: team1_gain is null`);
    }
    if (m.team2_user_id === null) {
      // Bye week
      if (m.winner_user_id !== m.team1_user_id) {
        failures.push(`Week ${m.week_number} bye: winner should be ${m.team1_user_id}`);
      }
      if (m.team2_gain !== null) {
        failures.push(`Week ${m.week_number} bye: team2_gain should be null`);
      }
    } else {
      if (m.team2_gain === null) {
        failures.push(`Week ${m.week_number}: team2_gain is null (not a bye)`);
      }
      if (!m.winner_user_id && m.is_tie !== true) {
        failures.push(`Week ${m.week_number}: no winner and not a tie`);
      }
    }
  }

  // 4. Standings integrity
  const { data: standings } = await supabase
    .from('league_standings')
    .select('user_id, wins, losses, ties, points_for, points_against')
    .eq('league_id', lgId);

  if (!standings || standings.length !== config.numTeams) {
    failures.push(`Expected ${config.numTeams} standings rows, got ${standings?.length || 0}`);
  }

  for (const s of standings || []) {
    const w = Number(s.wins);
    const l = Number(s.losses);
    const t = Number(s.ties);
    const total = w + l + t;

    if (total !== config.numWeeks) {
      failures.push(`${s.user_id}: W${w}+L${l}+T${t}=${total}, expected ${config.numWeeks}`);
    }

    // Compare to expected
    const exp = expectedStandings.get(s.user_id);
    if (exp) {
      if (w !== exp.wins) {
        failures.push(`${s.user_id}: expected ${exp.wins} wins, got ${w}`);
      }
      if (l !== exp.losses) {
        failures.push(`${s.user_id}: expected ${exp.losses} losses, got ${l}`);
      }
    }
  }

  // Even teams: total wins == total losses
  if (config.numTeams % 2 === 0 && standings) {
    const totalW = standings.reduce((sum, s) => sum + Number(s.wins), 0);
    const totalL = standings.reduce((sum, s) => sum + Number(s.losses), 0);
    if (totalW !== totalL) {
      failures.push(`Even teams: total wins (${totalW}) != total losses (${totalL})`);
    }
  }

  // 5. Playoff matchups — all populated ones should have results
  const { data: playoffMatchups } = await supabase
    .from('matchups')
    .select('week_number, playoff_round, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id')
    .eq('league_id', lgId)
    .eq('is_playoff', true)
    .order('week_number');

  for (const m of playoffMatchups || []) {
    if (m.team1_user_id && m.team2_user_id && m.team1_gain === null) {
      failures.push(`Playoff ${m.playoff_round} week ${m.week_number}: missing results`);
    }
  }

  // 6. Finals: winner should match champion
  const finals = (playoffMatchups || []).find(m => m.playoff_round === 'finals');
  if (finals) {
    if (finals.winner_user_id !== season.champion_user_id) {
      failures.push(`Finals winner (${finals.winner_user_id}) != champion (${season.champion_user_id})`);
    }
    const finalsLoser = finals.team1_user_id === finals.winner_user_id
      ? finals.team2_user_id
      : finals.team1_user_id;
    if (finalsLoser !== season.runner_up_user_id) {
      failures.push(`Finals loser (${finalsLoser}) != runner_up (${season.runner_up_user_id})`);
    }
  } else {
    failures.push('No finals matchup found');
  }

  // Log validation results
  if (failures.length === 0) {
    logger.success('All checks passed');
  } else {
    for (const f of failures) {
      logger.fail(f);
    }
  }

  return { passed: failures.length === 0, failures };
}

// ─── Single Test Run ────────────────────────────────────────────────────────

async function runTest(supabase, config, testIndex, logger, serviceRoleKey) {
  const lgId = generateLeagueId(testIndex);

  try {
    // ── Seed ──
    logger.info(`Seeding: ${config.numTeams} teams, ${config.numWeeks} weeks, ${config.playoffTeams} playoff teams, ${config.numRounds} rounds...`);
    const { userIds, teamStocks, gainsMap, expectedStandings, schedule } =
      await seedLeague(supabase, config, testIndex);
    logger.info(`Seeded: ${userIds.length} users, ${schedule.length} matchups`);

    // Build rank map for playoff snapshot injection
    const userRankMap = new Map();
    for (let i = 0; i < userIds.length; i++) {
      userRankMap.set(userIds[i], i);
    }

    // ── Regular Season ──
    logger.info('Processing regular season...');
    const regResult = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(3000);
    logger.info(`Regular season: processed ${regResult.processed || 0} matchup(s)`);

    // Log standings
    const { data: postStandings } = await supabase
      .from('league_standings')
      .select('user_id, wins, losses, ties, points_for')
      .eq('league_id', lgId)
      .order('wins', { ascending: false })
      .order('points_for', { ascending: false });

    if (postStandings) {
      logger.info('Standings:');
      for (const s of postStandings) {
        logger.info(`  ${s.user_id}: ${Number(s.wins)}-${Number(s.losses)}-${Number(s.ties)} (PF: ${Number(s.points_for).toFixed(0)})`);
      }
    }

    // Verify transition to playoffs
    const { data: leaguePost } = await supabase
      .from('leagues')
      .select('season_status, current_week')
      .eq('id', lgId)
      .single();

    logger.info(`Status: ${leaguePost?.season_status}, week: ${leaguePost?.current_week}`);

    if (leaguePost?.season_status !== 'playoffs') {
      throw new Error(`Expected 'playoffs' after regular season, got '${leaguePost?.season_status}'`);
    }

    // ── Playoffs ──
    logger.info('Processing playoffs...');
    await processPlayoffs(supabase, lgId, config, serviceRoleKey, teamStocks, userRankMap, logger);

    // ── Validate ──
    logger.info('Validating...');
    const result = await validate(supabase, lgId, config, userIds, expectedStandings, logger);

    // ── Cleanup ──
    await cleanup(supabase, lgId);
    logger.info('Cleaned up');

    return result;

  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    return { passed: false, failures: [err.message] };
  }
}

// ─── Negative / Edge Case Tests ──────────────────────────────────────────────

const NEGATIVE_TEST_OFFSET = 100;

/**
 * IDEMPOTENT: Processing a fully-completed league again should be a no-op.
 * Runs the entire lifecycle (regular season + playoffs), then calls the edge
 * function one more time to verify nothing gets re-processed.
 * Validates the `team1_gain IS NULL` filter prevents re-scoring.
 */
async function runNegativeTest_Idempotent(supabase, serviceRoleKey, logger) {
  const testIndex = NEGATIVE_TEST_OFFSET;
  const config = { name: 'IDEMPOTENT', numTeams: 4, numWeeks: 3, playoffTeams: 2, numRounds: 3 };
  const lgId = generateLeagueId(testIndex);
  const failures = [];

  try {
    const { userIds, teamStocks } = await seedLeague(supabase, config, testIndex);
    logger.info('Seeded league');

    // Build rank map for playoff snapshot injection
    const userRankMap = new Map();
    for (let i = 0; i < userIds.length; i++) {
      userRankMap.set(userIds[i], i);
    }

    // Process regular season
    const regResult = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(3000);
    logger.info(`Regular season: processed ${regResult.processed || 0} matchup(s)`);

    if ((regResult.processed || 0) === 0) {
      failures.push('Regular season processed 0 matchups (expected > 0)');
    }

    // Process playoffs (full lifecycle)
    await processPlayoffs(supabase, lgId, config, serviceRoleKey, teamStocks, userRankMap, logger);
    await sleep(2000);

    // Verify season is completed
    const { data: league } = await supabase
      .from('leagues')
      .select('season_status')
      .eq('id', lgId)
      .single();
    logger.info(`Season status: ${league?.season_status}`);

    if (league?.season_status !== 'completed') {
      failures.push(`Expected season_status 'completed', got '${league?.season_status}'`);
    }

    // Snapshot ALL matchup results (regular + playoff)
    const { data: matchupsBefore } = await supabase
      .from('matchups')
      .select('id, team1_gain, team2_gain, winner_user_id')
      .eq('league_id', lgId)
      .order('id');

    // Call edge function again — should be a complete no-op
    const retryResult = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(2000);
    const retryProcessed = retryResult.processed || 0;
    logger.info(`Retry call: processed ${retryProcessed} matchup(s)`);

    if (retryProcessed !== 0) {
      failures.push(`Retry call processed ${retryProcessed} matchups (expected 0)`);
    }

    // Verify data unchanged
    const { data: matchupsAfter } = await supabase
      .from('matchups')
      .select('id, team1_gain, team2_gain, winner_user_id')
      .eq('league_id', lgId)
      .order('id');

    if (matchupsBefore && matchupsAfter) {
      for (let i = 0; i < matchupsBefore.length; i++) {
        const m1 = matchupsBefore[i];
        const m2 = matchupsAfter[i];
        if (Number(m1.team1_gain) !== Number(m2.team1_gain) ||
            Number(m1.team2_gain) !== Number(m2.team2_gain) ||
            m1.winner_user_id !== m2.winner_user_id) {
          failures.push(`Matchup ${m1.id}: data changed between calls`);
        }
      }
    }

    await cleanup(supabase, lgId);
    logger.info('Cleaned up');

    if (failures.length === 0) {
      logger.success('All checks passed');
    } else {
      for (const f of failures) logger.fail(f);
    }
    return { passed: failures.length === 0, failures };
  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    return { passed: false, failures: [err.message] };
  }
}

/**
 * FUTURE-DATES: Matchups with future week_end should not be processed.
 * Validates the `week_end < now` filter.
 */
async function runNegativeTest_FutureDates(supabase, serviceRoleKey, logger) {
  const testIndex = NEGATIVE_TEST_OFFSET + 1;
  const config = { name: 'FUTURE-DATES', numTeams: 4, numWeeks: 3, playoffTeams: 2, numRounds: 3 };
  const lgId = generateLeagueId(testIndex);
  const failures = [];

  try {
    await seedLeague(supabase, config, testIndex);
    logger.info('Seeded league');

    // Override all matchup dates to the future
    const futureStart = new Date(Date.now() + 7 * 86400_000).toISOString();
    const futureEnd = new Date(Date.now() + 14 * 86400_000).toISOString();
    const { error: updateErr } = await supabase
      .from('matchups')
      .update({ week_start: futureStart, week_end: futureEnd })
      .eq('league_id', lgId);
    if (updateErr) throw new Error(`Update dates: ${updateErr.message}`);
    logger.info('Set all matchup dates to future');

    // Call edge function
    const result = await callEdgeFunction(serviceRoleKey, lgId);
    const processed = result.processed || 0;
    logger.info(`Processed: ${processed} matchup(s)`);

    if (processed !== 0) {
      failures.push(`Processed ${processed} matchups with future dates (expected 0)`);
    }

    // Verify no matchups were scored
    const { data: scoredMatchups } = await supabase
      .from('matchups')
      .select('id')
      .eq('league_id', lgId)
      .not('team1_gain', 'is', null);

    if (scoredMatchups && scoredMatchups.length > 0) {
      failures.push(`${scoredMatchups.length} matchup(s) were scored despite future dates`);
    }

    await cleanup(supabase, lgId);
    logger.info('Cleaned up');

    if (failures.length === 0) {
      logger.success('All checks passed');
    } else {
      for (const f of failures) logger.fail(f);
    }
    return { passed: failures.length === 0, failures };
  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    return { passed: false, failures: [err.message] };
  }
}

/**
 * EMPTY-PORTFOLIO: A team with no holdings should auto-lose every matchup.
 * Tests the `hasPositions = false → automatic loss` code path.
 *
 * Deletes snapshots + drafts for user 0 (the "strongest" user), proving that
 * even a top-seeded team loses when their portfolio is empty.
 */
async function runNegativeTest_EmptyPortfolio(supabase, serviceRoleKey, logger) {
  const testIndex = NEGATIVE_TEST_OFFSET + 2;
  const config = { name: 'EMPTY-PORTFOLIO', numTeams: 4, numWeeks: 3, playoffTeams: 2, numRounds: 3 };
  const lgId = generateLeagueId(testIndex);
  const failures = [];

  try {
    const { userIds } = await seedLeague(supabase, config, testIndex);
    const emptyUser = userIds[0]; // Strongest user becomes empty
    logger.info(`Seeded league, emptying portfolio for ${emptyUser}`);

    // Delete all snapshots and drafts for user 0
    await supabase.from('week_snapshots').delete().eq('league_id', lgId).eq('user_id', emptyUser);
    await supabase.from('drafts').delete().eq('league_id', lgId).eq('user_id', emptyUser);

    // Process regular season
    const result = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(3000);
    logger.info(`Processed: ${result.processed || 0} matchup(s)`);

    // Verify user 0 lost all matchups
    const { data: matchups } = await supabase
      .from('matchups')
      .select('week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id')
      .eq('league_id', lgId)
      .eq('is_playoff', false);

    for (const m of matchups || []) {
      const isTeam1 = m.team1_user_id === emptyUser;
      const isTeam2 = m.team2_user_id === emptyUser;
      if (!isTeam1 && !isTeam2) continue;

      // Empty user's gain should be 0
      const emptyGain = isTeam1 ? Number(m.team1_gain) : Number(m.team2_gain);
      if (emptyGain !== 0) {
        failures.push(`Week ${m.week_number}: empty user gain = ${emptyGain} (expected 0)`);
      }

      // Opponent should have won
      if (m.winner_user_id === emptyUser) {
        failures.push(`Week ${m.week_number}: empty user won (should have auto-lost)`);
      }
      if (!m.winner_user_id) {
        failures.push(`Week ${m.week_number}: no winner in matchup with empty user`);
      }
    }

    // Verify standings: user 0 = 0W-3L, user 1 = 3W-0L, user 2 = 2W-1L, user 3 = 1W-2L
    const expectedRecords = {
      [userIds[0]]: { wins: 0, losses: 3 },
      [userIds[1]]: { wins: 3, losses: 0 },
      [userIds[2]]: { wins: 2, losses: 1 },
      [userIds[3]]: { wins: 1, losses: 2 },
    };

    const { data: standings } = await supabase
      .from('league_standings')
      .select('user_id, wins, losses, ties')
      .eq('league_id', lgId);

    for (const s of standings || []) {
      const exp = expectedRecords[s.user_id];
      if (!exp) continue;
      if (Number(s.wins) !== exp.wins) {
        failures.push(`${s.user_id}: expected ${exp.wins} wins, got ${s.wins}`);
      }
      if (Number(s.losses) !== exp.losses) {
        failures.push(`${s.user_id}: expected ${exp.losses} losses, got ${s.losses}`);
      }
    }

    // Log standings for visibility
    logger.info('Standings:');
    for (const s of standings || []) {
      logger.info(`  ${s.user_id}: ${Number(s.wins)}-${Number(s.losses)}-${Number(s.ties)}`);
    }

    await cleanup(supabase, lgId);
    logger.info('Cleaned up');

    if (failures.length === 0) {
      logger.success('All checks passed');
    } else {
      for (const f of failures) logger.fail(f);
    }
    return { passed: failures.length === 0, failures };
  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    return { passed: false, failures: [err.message] };
  }
}

/**
 * TIED-GAINS: Equal gains should produce ties in regular season, and the
 * playoff seed tiebreaker should pick the higher seed when gains are identical.
 */
async function runNegativeTest_TiedGains(supabase, serviceRoleKey, logger) {
  const testIndex = NEGATIVE_TEST_OFFSET + 3;
  const config = { name: 'TIED-GAINS', numTeams: 4, numWeeks: 3, playoffTeams: 2, numRounds: 3 };
  const lgId = generateLeagueId(testIndex);
  const failures = [];

  try {
    const { userIds, teamStocks } = await seedLeague(supabase, config, testIndex);
    logger.info('Seeded league');

    // Override all snapshots so every user gets the same $30 gain
    // Each user has numRounds (3) stocks, so $10 gain per stock → week_end_price = 110
    const { error: updateErr } = await supabase
      .from('week_snapshots')
      .update({ week_start_price: 100, week_end_price: 110 })
      .eq('league_id', lgId);
    if (updateErr) throw new Error(`Update snapshots: ${updateErr.message}`);
    logger.info('Set all snapshots to identical gains ($30 per team)');

    // Process regular season
    const result = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(3000);
    logger.info(`Processed: ${result.processed || 0} matchup(s)`);

    // Verify all matchups are ties
    const { data: matchups } = await supabase
      .from('matchups')
      .select('week_number, team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id, is_tie')
      .eq('league_id', lgId)
      .eq('is_playoff', false);

    for (const m of matchups || []) {
      if (m.team2_user_id === null) continue; // skip byes
      if (m.is_tie !== true) {
        failures.push(`Week ${m.week_number}: expected tie, got winner ${m.winner_user_id}`);
      }
      if (Number(m.team1_gain) !== Number(m.team2_gain)) {
        failures.push(`Week ${m.week_number}: gains not equal (${m.team1_gain} vs ${m.team2_gain})`);
      }
    }

    // Verify standings: all teams should have 0W-0L-3T
    const { data: standings } = await supabase
      .from('league_standings')
      .select('user_id, wins, losses, ties')
      .eq('league_id', lgId);

    for (const s of standings || []) {
      if (Number(s.wins) !== 0) failures.push(`${s.user_id}: expected 0 wins, got ${s.wins}`);
      if (Number(s.losses) !== 0) failures.push(`${s.user_id}: expected 0 losses, got ${s.losses}`);
      if (Number(s.ties) !== config.numWeeks) failures.push(`${s.user_id}: expected ${config.numWeeks} ties, got ${s.ties}`);
    }

    logger.info('Standings:');
    for (const s of standings || []) {
      logger.info(`  ${s.user_id}: ${Number(s.wins)}-${Number(s.losses)}-${Number(s.ties)}`);
    }

    // Verify season transitioned to playoffs
    const { data: league } = await supabase
      .from('leagues')
      .select('season_status')
      .eq('id', lgId)
      .single();

    if (league?.season_status !== 'playoffs') {
      failures.push(`Expected 'playoffs' status, got '${league?.season_status}'`);
    }

    // ── Playoff seed tiebreaker ──
    // With 2-team playoffs, there's a single finals matchup.
    // Inject identical gains so the seed tiebreaker must decide the winner.
    logger.info('Testing playoff seed tiebreaker...');
    await ensurePlayoffDatesInPast(supabase, lgId);
    await sleep(2000);

    const { data: playoffMatchups } = await supabase
      .from('matchups')
      .select('id, week_number, team1_user_id, team2_user_id, team1_seed, team2_seed, playoff_round')
      .eq('league_id', lgId)
      .eq('is_playoff', true)
      .not('team1_user_id', 'is', null)
      .not('team2_user_id', 'is', null);

    if (!playoffMatchups || playoffMatchups.length === 0) {
      failures.push('No playoff matchups found');
    } else {
      // Inject snapshots with identical gains for both teams
      const playoffSnapshots = [];
      for (const m of playoffMatchups) {
        for (const userId of [m.team1_user_id, m.team2_user_id]) {
          const stocks = teamStocks.get(userId) || [];
          for (const symbol of stocks) {
            playoffSnapshots.push({
              league_id: lgId,
              user_id: userId,
              week_number: m.week_number,
              symbol,
              quantity: 1,
              week_start_price: 100,
              week_end_price: 110, // Same $10/stock → $30 total for each team
            });
          }
        }
      }
      if (playoffSnapshots.length > 0) {
        const { error } = await supabase.from('week_snapshots').insert(playoffSnapshots);
        if (error) throw new Error(`Insert playoff snapshots: ${error.message}`);
      }

      // Process playoffs
      await sleep(2000);
      const playoffResult = await callEdgeFunction(serviceRoleKey, lgId);
      await sleep(3000);
      logger.info(`Playoff: processed ${playoffResult.processed || 0} matchup(s)`);

      // Verify finals: higher seed should win
      const { data: finalsMatchup } = await supabase
        .from('matchups')
        .select('team1_user_id, team2_user_id, team1_seed, team2_seed, winner_user_id, team1_gain, team2_gain')
        .eq('league_id', lgId)
        .eq('is_playoff', true)
        .eq('playoff_round', 'finals')
        .single();

      if (finalsMatchup) {
        const higherSeedUser = (finalsMatchup.team1_seed || 999) < (finalsMatchup.team2_seed || 999)
          ? finalsMatchup.team1_user_id
          : finalsMatchup.team2_user_id;

        logger.info(`Finals: seed ${finalsMatchup.team1_seed} (${finalsMatchup.team1_user_id}) vs seed ${finalsMatchup.team2_seed} (${finalsMatchup.team2_user_id})`);
        logger.info(`  Gains: $${Number(finalsMatchup.team1_gain).toFixed(2)} vs $${Number(finalsMatchup.team2_gain).toFixed(2)}`);
        logger.info(`  Winner: ${finalsMatchup.winner_user_id} (expected higher seed: ${higherSeedUser})`);

        if (finalsMatchup.winner_user_id !== higherSeedUser) {
          failures.push(`Playoff tiebreaker: expected higher seed (${higherSeedUser}) to win, got ${finalsMatchup.winner_user_id}`);
        }
        if (Number(finalsMatchup.team1_gain) !== Number(finalsMatchup.team2_gain)) {
          failures.push(`Playoff gains should be equal for tiebreaker test (${finalsMatchup.team1_gain} vs ${finalsMatchup.team2_gain})`);
        }
      } else {
        failures.push('No finals matchup found');
      }
    }

    await cleanup(supabase, lgId);
    logger.info('Cleaned up');

    if (failures.length === 0) {
      logger.success('All checks passed');
    } else {
      for (const f of failures) logger.fail(f);
    }
    return { passed: failures.length === 0, failures };
  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    return { passed: false, failures: [err.message] };
  }
}

/**
 * MID-WEEK-TRADES: Verify FIFO scoring with mid-week buys, sells, and partial holds.
 *
 * Uses real auth users (trades table has FK to auth.users).
 *
 * Team 1 scenarios:
 *   AAPL — Partial sell: hold 10 from Monday@$100, sell 6@$110, hold 4 to Friday@$120 → $140
 *   MSFT — Buy-then-sell same week: buy 5@$150 Wed, sell 5@$160 Thu → $50
 *   GOOG — Mid-week buy held to Friday: buy 10@$50 Tue, hold to Friday@$55 → $50
 *   Team 1 total: $240
 *
 * Team 2 (baseline hold):
 *   TSLA/NVDA/META — 5 shares each, $100→$108 → $40 each → $120 total
 */
async function runNegativeTest_MidWeekTrades(supabase, serviceRoleKey, logger) {
  const testIndex = NEGATIVE_TEST_OFFSET + 4;
  const lgId = generateLeagueId(testIndex);
  const snId = generateSeasonId(testIndex);
  const inviteCode = generateInviteCode(testIndex);
  const failures = [];
  const authUserIds = [];

  try {
    // ── Create real auth users (2 active + 2 dummy to meet 4-team minimum) ──
    const users = [];
    for (let i = 0; i < 4; i++) {
      const { data, error } = await supabase.auth.admin.createUser({
        email: `sim-trade-test-${testIndex}-${i}@test.local`,
        email_confirm: true,
      });
      if (error) throw new Error(`Create auth user ${i}: ${error.message}`);
      users.push(data.user);
      authUserIds.push(data.user.id);
    }
    const userIds = users.map(u => u.id);
    logger.info(`Created ${users.length} auth users`);

    // ── Matchup week timing (in the past) ──
    const baseDate = new Date();
    baseDate.setUTCDate(baseDate.getUTCDate() - 21);
    const weekStart = new Date(baseDate);
    weekStart.setUTCHours(14, 30, 0, 0); // Tuesday 14:30 UTC
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 3);
    weekEnd.setUTCHours(21, 0, 0, 0); // Friday 21:00 UTC

    // Trade timestamps within the week
    const tuesdayAfternoon = new Date(weekStart.getTime() + 2 * 3600_000);     // Tue 16:30
    const wednesdayMorning = new Date(weekStart.getTime() + 20 * 3600_000);    // Wed 10:30
    const thursdayMorning  = new Date(weekStart.getTime() + 44 * 3600_000);    // Thu 10:30

    // ── Cleanup any leftover data ──
    await cleanup(supabase, lgId);
    for (const uid of authUserIds) {
      // Clean orphaned trades from previous failed runs
      await supabase.from('trades').delete().eq('user_id', uid);
    }

    // ── Seed league ──
    const { error: e1 } = await supabase.from('leagues').insert({
      id: lgId,
      name: `__SIM_TEST_MID-WEEK-TRADES__`,
      commissioner_id: userIds[0],
      invite_code: inviteCode,
      num_participants: 4,
      num_rounds: 3,
      num_weeks: 1,
      playoff_teams: 2,
      league_type: 'matchup',
      budget_mode: 'no-budget',
      budget_amount: 100000,
      draft_status: 'completed',
      current_week: 1,
      season_status: 'active',
      draft_date: baseDate.toISOString(),
      duration_days: 30,
    });
    if (e1) throw new Error(`Insert league: ${e1.message}`);

    const { error: e2 } = await supabase.from('league_members').insert(
      userIds.map((uid, i) => ({ league_id: lgId, user_id: uid, role: i === 0 ? 'commissioner' : 'member' }))
    );
    if (e2) throw new Error(`Insert members: ${e2.message}`);

    const { error: e3 } = await supabase.from('league_seasons').insert({
      id: snId, league_id: lgId, season_number: 1,
    });
    if (e3) throw new Error(`Insert season: ${e3.message}`);

    await supabase.from('leagues').update({ current_season_id: snId }).eq('id', lgId);

    const { error: e5 } = await supabase.from('league_standings').insert(
      userIds.map(uid => ({ league_id: lgId, user_id: uid, wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0 }))
    );
    if (e5) throw new Error(`Insert standings: ${e5.message}`);

    // ── Matchup ──
    const { error: e6 } = await supabase.from('matchups').insert({
      league_id: lgId,
      week_number: 1,
      team1_user_id: userIds[0],
      team2_user_id: userIds[1],
      week_start: weekStart.toISOString(),
      week_end: weekEnd.toISOString(),
      is_playoff: false,
    });
    if (e6) throw new Error(`Insert matchup: ${e6.message}`);

    // ── Drafts (for fallback path completeness) ──
    const draftPicks = [
      { league_id: lgId, user_id: userIds[0], symbol: 'AAPL', entry_price: 100, quantity: 10, round: 1, pick_number: 1 },
      { league_id: lgId, user_id: userIds[0], symbol: 'MSFT', entry_price: 150, quantity: 0,  round: 2, pick_number: 4 },
      { league_id: lgId, user_id: userIds[0], symbol: 'GOOG', entry_price: 50,  quantity: 0,  round: 3, pick_number: 5 },
      { league_id: lgId, user_id: userIds[1], symbol: 'TSLA', entry_price: 100, quantity: 5,  round: 1, pick_number: 2 },
      { league_id: lgId, user_id: userIds[1], symbol: 'NVDA', entry_price: 100, quantity: 5,  round: 2, pick_number: 3 },
      { league_id: lgId, user_id: userIds[1], symbol: 'META', entry_price: 100, quantity: 5,  round: 3, pick_number: 6 },
    ];
    const { error: e7 } = await supabase.from('drafts').insert(draftPicks);
    if (e7) throw new Error(`Insert drafts: ${e7.message}`);

    // ── Week snapshots ──
    // Team 1: AAPL held from Monday; MSFT/GOOG are mid-week buys (qty=0, price=endPrice so hold gain=0)
    // Team 2: TSLA/NVDA/META all held from Monday
    const snapshots = [
      // Team 1
      { league_id: lgId, user_id: userIds[0], week_number: 1, symbol: 'AAPL', quantity: 10, week_start_price: 100, week_end_price: 120 },
      { league_id: lgId, user_id: userIds[0], week_number: 1, symbol: 'MSFT', quantity: 0,  week_start_price: 160, week_end_price: 160 },
      { league_id: lgId, user_id: userIds[0], week_number: 1, symbol: 'GOOG', quantity: 0,  week_start_price: 55,  week_end_price: 55  },
      // Team 2
      { league_id: lgId, user_id: userIds[1], week_number: 1, symbol: 'TSLA', quantity: 5,  week_start_price: 100, week_end_price: 108 },
      { league_id: lgId, user_id: userIds[1], week_number: 1, symbol: 'NVDA', quantity: 5,  week_start_price: 100, week_end_price: 108 },
      { league_id: lgId, user_id: userIds[1], week_number: 1, symbol: 'META', quantity: 5,  week_start_price: 100, week_end_price: 108 },
    ];
    const { error: e8 } = await supabase.from('week_snapshots').insert(snapshots);
    if (e8) throw new Error(`Insert snapshots: ${e8.message}`);

    // ── Mid-week trades for Team 1 ──
    const trades = [
      // GOOG: buy 10 @ $50 on Tuesday (held to Friday)
      { league_id: lgId, user_id: userIds[0], symbol: 'GOOG', action: 'buy',  quantity: 10, price: 50,  total_value: 500,  created_at: tuesdayAfternoon.toISOString() },
      // MSFT: buy 5 @ $150 on Wednesday
      { league_id: lgId, user_id: userIds[0], symbol: 'MSFT', action: 'buy',  quantity: 5,  price: 150, total_value: 750,  created_at: wednesdayMorning.toISOString() },
      // AAPL: sell 6 @ $110 on Wednesday (partial sell of Monday holding)
      { league_id: lgId, user_id: userIds[0], symbol: 'AAPL', action: 'sell', quantity: 6,  price: 110, total_value: 660,  created_at: wednesdayMorning.toISOString() },
      // MSFT: sell 5 @ $160 on Thursday (sell mid-week buy)
      { league_id: lgId, user_id: userIds[0], symbol: 'MSFT', action: 'sell', quantity: 5,  price: 160, total_value: 800,  created_at: thursdayMorning.toISOString() },
    ];
    const { error: e9 } = await supabase.from('trades').insert(trades);
    if (e9) throw new Error(`Insert trades: ${e9.message}`);
    logger.info('Seeded league with mid-week trades');

    // ── Call edge function ──
    const result = await callEdgeFunction(serviceRoleKey, lgId);
    await sleep(3000);
    logger.info(`Processed: ${result.processed || 0} matchup(s)`);

    // ── Validate gains ──
    const { data: matchup } = await supabase
      .from('matchups')
      .select('team1_user_id, team2_user_id, team1_gain, team2_gain, winner_user_id')
      .eq('league_id', lgId)
      .eq('is_playoff', false)
      .single();

    if (!matchup) {
      failures.push('Matchup not found');
    } else {
      const isUser1Team1 = matchup.team1_user_id === userIds[0];
      const user1Gain = Number(isUser1Team1 ? matchup.team1_gain : matchup.team2_gain);
      const user2Gain = Number(isUser1Team1 ? matchup.team2_gain : matchup.team1_gain);

      logger.info(`Team 1 (trades): $${user1Gain.toFixed(2)} (expected $240.00)`);
      logger.info(`Team 2 (holds):  $${user2Gain.toFixed(2)} (expected $120.00)`);
      logger.info(`Winner: ${matchup.winner_user_id}`);

      // AAPL: 6×($110-$100) + 4×($120-$100) = $60 + $80 = $140
      // MSFT: 5×($160-$150) = $50
      // GOOG: 10×($55-$50) = $50
      // Total: $240
      if (Math.abs(user1Gain - 240) > 0.01) {
        failures.push(`Team 1 gain: expected $240.00, got $${user1Gain.toFixed(2)}`);
      }

      // TSLA+NVDA+META: 3 × 5×($108-$100) = $120
      if (Math.abs(user2Gain - 120) > 0.01) {
        failures.push(`Team 2 gain: expected $120.00, got $${user2Gain.toFixed(2)}`);
      }

      if (matchup.winner_user_id !== userIds[0]) {
        failures.push(`Winner: expected ${userIds[0]}, got ${matchup.winner_user_id}`);
      }
    }

    // ── Cleanup ──
    await cleanup(supabase, lgId);
    for (const uid of authUserIds) {
      await supabase.auth.admin.deleteUser(uid);
    }
    logger.info('Cleaned up (including auth users)');

    if (failures.length === 0) {
      logger.success('All checks passed');
    } else {
      for (const f of failures) logger.fail(f);
    }
    return { passed: failures.length === 0, failures };
  } catch (err) {
    logger.error(`Exception: ${err.message}`);
    try { await cleanup(supabase, lgId); } catch {}
    for (const uid of authUserIds) {
      try { await supabase.auth.admin.deleteUser(uid); } catch {}
    }
    return { passed: false, failures: [err.message] };
  }
}

const NEGATIVE_TESTS = [
  { name: 'IDEMPOTENT',      fn: runNegativeTest_Idempotent,      description: 'Double-processing should be a no-op' },
  { name: 'FUTURE-DATES',    fn: runNegativeTest_FutureDates,     description: 'Future matchups should not be processed' },
  { name: 'EMPTY-PORTFOLIO', fn: runNegativeTest_EmptyPortfolio,  description: 'Empty portfolio should auto-lose' },
  { name: 'TIED-GAINS',      fn: runNegativeTest_TiedGains,       description: 'Equal gains → ties + seed tiebreaker' },
  { name: 'MID-WEEK-TRADES', fn: runNegativeTest_MidWeekTrades,   description: 'FIFO scoring with mid-week buys/sells' },
];

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SERVICE_ROLE_KEY) {
    console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not set (used for data-plane seed/teardown)');
    console.error('Usage: export SUPABASE_SERVICE_ROLE_KEY="..." SB_SECRET_KEY_CRON="..." && node scripts/simulation-test-runner.mjs');
    process.exit(1);
  }
  // Phase 2b-2: the edge-function call needs the cron apikey (see CRON_KEY).
  if (!CRON_KEY) {
    console.error('ERROR: SB_SECRET_KEY_CRON not set (required to authenticate the process-week-results call)');
    console.error('Usage: export SUPABASE_SERVICE_ROLE_KEY="..." SB_SECRET_KEY_CRON="..." && node scripts/simulation-test-runner.mjs');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const logger = new Logger();

  const totalTests = TEST_CONFIGS.length + NEGATIVE_TESTS.length;

  logger.section('SEASON SIMULATION TEST RUNNER');
  logger.info(`Configs: ${TEST_CONFIGS.length} positive + ${NEGATIVE_TESTS.length} negative = ${totalTests} total`);
  logger.info(`Time: ${new Date().toISOString()}`);

  const results = [];

  // ── Positive (happy-path) tests ──
  for (let i = 0; i < TEST_CONFIGS.length; i++) {
    const config = TEST_CONFIGS[i];
    logger.section(`Test ${i + 1}/${totalTests}: ${config.name}`);

    const result = await runTest(supabase, config, i, logger, SERVICE_ROLE_KEY);
    results.push({ name: config.name, ...result });

    if (result.passed) {
      logger.success(`${config.name} PASSED`);
    } else {
      logger.fail(`${config.name} FAILED (${result.failures.length} issue(s))`);
    }
  }

  // ── Negative / edge case tests ──
  for (let i = 0; i < NEGATIVE_TESTS.length; i++) {
    const test = NEGATIVE_TESTS[i];
    const testNum = TEST_CONFIGS.length + i + 1;
    logger.section(`Test ${testNum}/${totalTests}: NEG:${test.name} — ${test.description}`);

    const result = await test.fn(supabase, SERVICE_ROLE_KEY, logger);
    results.push({ name: `NEG:${test.name}`, ...result });

    if (result.passed) {
      logger.success(`NEG:${test.name} PASSED`);
    } else {
      logger.fail(`NEG:${test.name} FAILED (${result.failures.length} issue(s))`);
    }
  }

  // ── Summary ──
  logger.section('SUMMARY');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  logger.info(`Passed: ${passed}/${results.length}`);
  logger.info(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    logger.info('');
    logger.info('Failures:');
    for (const r of results.filter(r => !r.passed)) {
      logger.info(`  ${r.name}:`);
      for (const f of r.failures) {
        logger.info(`    - ${f}`);
      }
    }
  }

  logger.writeToFile();
  process.exit(failed > 0 ? 1 : 0);
}

main();
