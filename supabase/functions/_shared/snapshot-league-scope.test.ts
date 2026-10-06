/**
 * Tests for ./snapshot-league-scope.ts — the scope the snapshot jobs may act
 * on. Regression for the 2026-10-05 failure: a FINISHED league (season_status
 * 'completed', January current_week, before market_calendar coverage) was
 * refused 'no_coverage' on every run and the job reported 'failed'.
 *
 * Hermetic: no DB, no network. Run with
 *   deno test supabase/functions/_shared/snapshot-league-scope.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import { isInSeasonLeague, type LeagueScopeRow } from './snapshot-league-scope.ts';

const league = (over: Partial<LeagueScopeRow> = {}): LeagueScopeRow => ({
  season_status: 'active',
  draft_status: 'completed',
  current_week: 5,
  ...over,
});

Deno.test('scope: an active, drafted, current league is in season', () => {
  assertEquals(isInSeasonLeague(league()), true);
});

Deno.test('scope: a playoffs league is in season (playoff weeks are snapshotted)', () => {
  assertEquals(isInSeasonLeague(league({ season_status: 'playoffs' })), true);
});

Deno.test('scope: a COMPLETED league is excluded — the 2026-10-05 failure case', () => {
  assertEquals(isInSeasonLeague(league({ season_status: 'completed' })), false);
});

Deno.test('scope: an undrafted league is excluded', () => {
  assertEquals(isInSeasonLeague(league({ draft_status: 'in_progress' })), false);
  assertEquals(isInSeasonLeague(league({ draft_status: 'not_started' })), false);
});

Deno.test('scope: a NULL season_status fails closed', () => {
  assertEquals(isInSeasonLeague(league({ season_status: null })), false);
});

Deno.test('scope: a league with no current_week is excluded', () => {
  assertEquals(isInSeasonLeague(league({ current_week: null })), false);
});
