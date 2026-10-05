/**
 * Structural guard for the 2026-10-05 snapshot failure (see
 * _shared/snapshot-league-scope.ts). The predicate is unit-tested in
 * _shared/snapshot-league-scope.test.ts; neither handler imports a test. This
 * reads both index.ts files as TEXT and checks that:
 *   1. each handler's leagues query filters season_status to IN_SEASON_STATUSES
 *      and draft_status to SNAPSHOT_DRAFT_STATUS;
 *   2. each handler re-checks scope in code via isInSeasonLeague;
 *   3. the no-leagues early return writes a terminal 'success' status first
 *      (success-signals #6: no 'running' row stranded);
 *   4. the removed pre-calendar skip has not crept back in.
 * Reads files only; keeping it under supabase/tests/ keeps
 * `deno test supabase/functions/` hermetic. Run with:
 *   deno test --allow-read supabase/tests/snapshot_league_scope_wiring.test.ts
 */
import { assert, assertFalse } from 'jsr:@std/assert';

const FILES = [
  new URL('../functions/snapshot-week-start/index.ts', import.meta.url),
  new URL('../functions/snapshot-week-end/index.ts', import.meta.url),
];

for (const file of FILES) {
  const name = file.pathname.split('/').slice(-2)[0];
  Deno.test(`${name}: leagues query is scoped to in-season, drafted leagues`, async () => {
    const src = await Deno.readTextFile(file);
    assert(src.includes(".in('season_status', [...IN_SEASON_STATUSES])"),
      `${name}: leagues query does not filter season_status to IN_SEASON_STATUSES`);
    assert(src.includes(".eq('draft_status', SNAPSHOT_DRAFT_STATUS)"),
      `${name}: leagues query does not filter draft_status to SNAPSHOT_DRAFT_STATUS`);
    assert(src.includes('.filter((l: any) => isInSeasonLeague(l))'),
      `${name}: scope is not re-checked in code (isInSeasonLeague)`);
  });

  Deno.test(`${name}: no-leagues early return writes a terminal status`, async () => {
    const src = await Deno.readTextFile(file);
    assert(
      /No active matchup leagues found'\);\s*\n\s*(\/\/[^\n]*\n\s*)*await updateJobStatus\(supabase, JOB_NAME, 'success'/.test(src),
      `${name}: the no-leagues return does not write 'success' first (stranded 'running')`,
    );
  });

  Deno.test(`${name}: the pre-calendar skip has not been reintroduced`, async () => {
    const src = await Deno.readTextFile(file);
    assertFalse(src.includes('decideRefusedWindow'), `${name}: pre-calendar skip is back`);
    assertFalse(src.includes('isPreCalendarWeek'), `${name}: pre-calendar skip is back`);
  });
}
