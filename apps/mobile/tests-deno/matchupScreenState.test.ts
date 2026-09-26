/**
 * Hermetic unit tests for lib/matchupScreenState.ts. No RN, no Deno runtime
 * APIs — run:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Kept outside apps/mobile's own tsconfig/eslint scope (tsconfig.json
 * excludes tests-deno/**) since `jsr:` specifiers are Deno-only.
 *
 * Covers the "zero-league Duration League" bug: the Matchup tab used to gate
 * on `activeLeague?.league_type === 'matchup'` alone, so a user with NO
 * leagues (activeLeague === null) fell into the SAME branch as a user in a
 * genuine duration league, and saw "Duration League ... Check the
 * Leaderboard for standings" (a tab that doesn't exist). It also means a
 * user WITH leagues could see that screen flash during the LeagueContext's
 * initial fetch, before `activeLeague` is populated. getMatchupScreenState
 * separates all three states explicitly.
 */
import { assertEquals } from 'jsr:@std/assert';
import { getMatchupScreenState } from '../lib/matchupScreenState.ts';

Deno.test('zero leagues, done loading -> no-league (the bug)', () => {
  const state = getMatchupScreenState({
    leaguesLoading: false,
    leagueCount: 0,
    activeLeague: null,
  });
  assertEquals(state, 'no-league');
});

Deno.test('zero leagues, still loading -> leagues-loading, not no-league or duration', () => {
  const state = getMatchupScreenState({
    leaguesLoading: true,
    leagueCount: 0,
    activeLeague: null,
  });
  assertEquals(state, 'leagues-loading');
});

Deno.test('has leagues but activeLeague not yet selected -> leagues-loading (cold-start flash fix)', () => {
  const state = getMatchupScreenState({
    leaguesLoading: false,
    leagueCount: 2,
    activeLeague: null,
  });
  assertEquals(state, 'leagues-loading');
});

Deno.test('active league is a matchup league -> matchup', () => {
  const state = getMatchupScreenState({
    leaguesLoading: false,
    leagueCount: 1,
    activeLeague: { league_type: 'matchup' },
  });
  assertEquals(state, 'matchup');
});

Deno.test('active league is a duration league -> duration', () => {
  const state = getMatchupScreenState({
    leaguesLoading: false,
    leagueCount: 1,
    activeLeague: { league_type: 'duration' },
  });
  assertEquals(state, 'duration');
});

Deno.test('active league with missing league_type -> duration (existing fallback, unchanged)', () => {
  const state = getMatchupScreenState({
    leaguesLoading: false,
    leagueCount: 1,
    activeLeague: {},
  });
  assertEquals(state, 'duration');
});

Deno.test('activeLeague set takes priority over stale loading flag', () => {
  // Defensive: if a caller ever passes leaguesLoading: true alongside an
  // already-resolved activeLeague, the real league should still win rather
  // than getting stuck on a loading screen forever.
  const state = getMatchupScreenState({
    leaguesLoading: true,
    leagueCount: 1,
    activeLeague: { league_type: 'matchup' },
  });
  assertEquals(state, 'matchup');
});
