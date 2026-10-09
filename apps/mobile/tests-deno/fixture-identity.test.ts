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
