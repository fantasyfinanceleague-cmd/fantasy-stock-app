/**
 * Giorgio, 2026-10-12: the Mon–Fri race chart sat blank for a whole day, and the
 * Matchup page should be a fantasy-football matchup (your stocks as a roster, head
 * to head) with no other added elements. The race is removed, not hidden: no
 * WeekRace in the screen, no race chart import, and no race data in the view model.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('Matchup renders no WeekRace and imports no race chart (source guard)', () => {
  const screen = SOURCES['app/(tabs)/matchup.tsx'];
  assert(!screen.includes('<WeekRace'));
  assert(!/import[^;]*\b(WeekRace|raceLayout|raceCoords|weekRacePoints)\b/.test(screen));
  assert(!/['"]@\/(components\/game\/WeekRace|lib\/game\/(raceLayout|weekRace))['"]/.test(screen));
  // What stays: the scoreboard and both lineups.
  assert(screen.includes('<MatchScoreboard'));
  assert(screen.includes('<Lineup title={youName} rows={live.me.lineup} />'));
});

Deno.test('the race chart, its layout, and its points are gone from the app (source guard)', () => {
  for (const path of ['components/game/WeekRace.tsx', 'lib/game/raceLayout.ts', 'lib/game/weekRace.ts']) {
    assertEquals(SOURCES[path], undefined, path);
  }
  const vm = SOURCES['lib/game/buildMatchupViewModel.ts'];
  assert(!/\brace\b/.test(vm));
});
