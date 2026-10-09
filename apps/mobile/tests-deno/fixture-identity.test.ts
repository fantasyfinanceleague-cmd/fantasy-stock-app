/**
 * One "me" across every DEV fixture (fix/fixture-identity, Design Lead's final
 * sweep 2026-10-08). The Home fixture and the game seam used the self id
 * 'roberto' while the shell fixture signs in as FIXTURE_USER_ID, and the game
 * screens find "me" by the auth user id. So under fixtures the Matchup tab drew
 * one side only ("(you)", one score, no opponent, no tug bar, no lineups), the
 * League tab never marked your row, and Home's Run it back counts card never
 * showed. Every fixture now names "me" with the shared constant, and the
 * screens keep identifying "me" exactly as production does (the auth user id),
 * so a fixture exercises the real path.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { FIXTURE_USER_ID } from '../lib/shell/fixtureIds.ts';
import { SEAM_ME, seamTableRows } from '../lib/game/seamTables.ts';
import { fixtureFor } from '../lib/game/seamFixtures.ts';
import { fixtureRoster } from '../lib/game/renewalFixture.ts';

Deno.test('the seam and the shell fixture share one "me"', () => {
  assertEquals(SEAM_ME, FIXTURE_USER_ID);
});

Deno.test('no source hard-codes a self id: the old fixture "me" is gone, and no myUserId is a literal', () => {
  for (const [path, src] of Object.entries(SOURCES)) {
    // 'roberto' was the fixture self id. The one remaining use is devFixture's list of
    // TAKEN USERNAMES for the sign-up capture (a display name, not a user id).
    const hits = src.split('\n').filter((l) => l.includes("'roberto'") && !l.includes('const FIXTURE_TAKEN = ['));
    assertEquals(hits, [], `${path} hard-codes the old fixture self id`);
    assert(!/myUserId\s*[:=]\s*['"]/.test(src), `${path}: myUserId is a string literal`);
  }
});

Deno.test('the game seam puts "me" in the week-6 game, the playoffs, the holdings and History', () => {
  const week = seamTableRows(true, 'matchups_week') as { team1_user_id: string; team2_user_id: string | null }[];
  assert(week.some((m) => m.team1_user_id === SEAM_ME && m.team2_user_id), 'my week-6 game has an opponent');
  const playoff = seamTableRows(true, 'matchups_playoff') as { team1_user_id: string; team2_user_id: string | null }[];
  assert(playoff.some((m) => m.team1_user_id === SEAM_ME || m.team2_user_id === SEAM_ME));
  const holdings = seamTableRows(true, 'week_snapshots') as { user_id: string }[];
  assert(holdings.some((h) => h.user_id === SEAM_ME), 'my week-6 holdings');
  const history = fixtureFor('get_league_history', {})!.data as { seasons?: { champion_user_id?: string }[] } | { champion_user_id?: string }[];
  assert(JSON.stringify(history).includes(SEAM_ME), 'History names me (Season 1 champion)');
});

Deno.test('Run it back: the commissioner is the fixture user; the caller\'s status comes from its role', () => {
  const asCommissioner = fixtureRoster('commissioner', new Date('2026-01-18T12:00:00Z')) as { people: { user_id: string; is_commissioner: boolean }[]; caller_status: string };
  assertEquals(asCommissioner.people.find((p) => p.is_commissioner)?.user_id, FIXTURE_USER_ID);
  assertEquals(asCommissioner.caller_status, 'in');
  assertEquals((fixtureRoster('in', new Date()) as { caller_status: string }).caller_status, 'in');
  assertEquals((fixtureRoster('new', new Date()) as { caller_status: string }).caller_status, 'new');
});

Deno.test('the Home fixture names "me" with the shared id (source guard: it imports React Native)', () => {
  const home = SOURCES['lib/home/useHomeLeague.ts'];
  assert(home.includes("import { FIXTURE_USER_ID } from '../shell/fixtureIds';"));
  assert(home.includes('myUserId: FIXTURE_USER_ID, draftStatus, leagueStartDate,')); // the fixture branch
  assert(home.includes('team1_user_id: FIXTURE_USER_ID')); // my games
  const preDraft = SOURCES['lib/home/usePreDraftData.ts'];
  assert(preDraft.includes('{ userId: FIXTURE_USER_ID, displayName: \'Roberto B.\', isBot: false }'));
  assert(preDraft.includes('orderRevealed: [FIXTURE_USER_ID, '));
});

Deno.test('production identifies "me" by the auth user id, so a fixture exercises the real path', () => {
  const home = SOURCES['lib/home/useHomeLeague.ts'];
  assert(home.includes('      myUserId: user.id,')); // the live branch
  const matchup = SOURCES['lib/game/useMatchup.ts'];
  assert(matchup.includes('myUserId: user.id,'));
  assert(matchup.includes('final: finalGains(raw.data, user.id),'));
  assert(SOURCES['lib/game/useAllMatchups.ts'].includes('myUserId: user.id,'));
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes("buildStandingsRows(st.standings, user?.id ?? '', st.previousRanks)"));
  assert(league.includes("buildSchedule({ myUserId: user?.id ?? ''"));
  const screen = SOURCES['app/(tabs)/matchup.tsx'];
  assert(screen.includes('mine: user.id,'));
  assert(screen.includes("myUserId={user?.id ?? ''}"));
});

// ── F2: the League tab's movement renders under the seam ─────────────────────

import { buildStandingsRows } from '../lib/game/standings.ts';
import { seamPreviousRanks } from '../lib/game/seamTables.ts';

Deno.test('F2: the through-week ranking has a seam fixture, so the arrows show up, down and held', () => {
  const prev = fixtureFor('league_standings_ranked', { p_league_id: 'fx-scudetto', p_through_week: 5 })!.data as { user_id: string; rank: number }[];
  assertEquals(prev, seamPreviousRanks());
  // The 1-arg call (no p_through_week) has no fixture: the seam never guesses it.
  assertEquals(fixtureFor('league_standings_ranked', { p_league_id: 'fx-scudetto' }), null);
  // Against the League tab's standings (the Home fixture's scored league): Paolo 1, you 2, Luca 3, Chiara 4, Marco 5, Gianluigi 6.
  const current = ['paolo', SEAM_ME, 'luca', 'chiara', 'marco', 'gianluigi'].map((user_id, i) => ({ user_id, rank: i + 1, wins: 0, losses: 0, ties: 0, points_for: 0, display_name: user_id, is_bot: false }));
  const rows = buildStandingsRows(current, SEAM_ME, new Map(prev.map((r) => [r.user_id, r.rank])));
  assertEquals(rows.map((r) => r.move), [1, -1, 1, -1, 0, 0]);
  const hook = SOURCES['lib/game/useLeagueStandings.ts'];
  assert(hook.includes("await seamRpc('league_standings_ranked', { p_league_id: leagueId, p_through_week: week - 1 })"));
  assert(!hook.includes("error: { message: 'seam' }")); // the old short-circuit
});

// ── F3: a scored Home fixture closes week 6 in the seam too ───────────────────

import { seamWeekClosed } from '../lib/game/seamTables.ts';
import { finalLineup } from '../lib/game/finalLineup.ts';
import { GIANLUIGI_HOLDINGS, ROBERTO_HOLDINGS, fixtureQty } from '../lib/home/homeFixtureData.ts';

/** The Home fixture's posted week-6 gain (useHomeLeague's week6Gains), recomputed here. */
const homeGain = (rows: typeof ROBERTO_HOLDINGS) => Math.round(rows.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0) * 100) / 100;

Deno.test('F3: the week is closed exactly in the Home fixtures that score week 6', () => {
  for (const f of ['scored', 'complete', 'complete_runner_up', 'playoff_live', 'playoff_bye', 'eliminated', 'missed_playoffs']) assertEquals(seamWeekClosed(f), true, f);
  for (const f of ['live_open', 'live_closed', 'scoring', 'pre_season', 'bye', undefined]) assertEquals(seamWeekClosed(f), false, String(f));
  // The same list as fixtureHomeLeague's own isScored (source guard on its regularSeasonComplete).
  const home = SOURCES['lib/home/useHomeLeague.ts'];
  assert(home.includes("const regularSeasonComplete = isPlayoffState || fixture === 'complete' || fixture === 'complete_runner_up';"));
  assert(home.includes("const isPlayoffState = isPlayoffLive || isPlayoffBye || isEliminated || isMissedPlayoffs;"));
  assert(home.includes("const isScored = fixture === 'scored' || regularSeasonComplete;"));
});

Deno.test('F3: closed, your game posts the Home fixture\'s gains, and the final lineups sum to them to the cent', () => {
  const games = seamTableRows(true, 'matchups_week', 'on_clock', { weekClosed: true }) as { team1_user_id: string; team1_gain: number; team2_gain: number; winner_user_id: string | null }[];
  const mine = games.find((g) => g.team1_user_id === SEAM_ME)!;
  assertEquals(mine.team1_gain, homeGain(ROBERTO_HOLDINGS));
  assertEquals(mine.team2_gain, homeGain(GIANLUIGI_HOLDINGS));
  assert(games.every((g) => g.team1_gain !== null && g.team2_gain !== null), 'All matchups shows Final for every game');
  const snaps = seamTableRows(true, 'week_snapshots', 'on_clock', { weekClosed: true }) as { user_id: string; symbol: string; quantity: number; week_start_price: number; week_end_price: number | null; entered_mid_week: boolean }[];
  for (const [user, gain] of [[SEAM_ME, mine.team1_gain], ['gianluigi', mine.team2_gain]] as const) {
    const res = finalLineup({ snapshots: snaps.filter((s) => s.user_id === user), trades: [], teamGain: gain });
    assertEquals(res.ok, true, `${user}'s final lineup is shown (sums to the posted gain)`);
  }
  // Open (live_open, the default): no closes, no gains.
  const open = seamTableRows(true, 'week_snapshots') as { week_end_price: number | null }[];
  assert(open.every((s) => s.week_end_price === null));
  assert((seamTableRows(true, 'matchups_week') as { team1_gain: number | null }[]).every((g) => g.team1_gain === null));
});
