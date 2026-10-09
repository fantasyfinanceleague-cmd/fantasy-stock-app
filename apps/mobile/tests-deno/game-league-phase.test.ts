/**
 * League tab routing (3c): the screen for each phase, the Run it back strip, and the
 * season's segments. The board's own leagues (the shell fixture) must each route to
 * the screen the board draws for their phase. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { leagueScreenFor, showRunItBackStrip, seasonSegments } from '../lib/game/leaguePhase.ts';

Deno.test('each phase routes to its screen: the lobby, the renewal, the draft room, the season', () => {
  assertEquals(leagueScreenFor({ phase: 'pre_draft', isRenewal: false }), 'lobby');
  assertEquals(leagueScreenFor({ phase: 'pre_draft', isRenewal: true }), 'renewal');
  assertEquals(leagueScreenFor({ phase: 'drafting', isRenewal: false }), 'draft_room');
  assertEquals(leagueScreenFor({ phase: 'pre_season', isRenewal: false }), 'season');
  assertEquals(leagueScreenFor({ phase: 'regular', isRenewal: false }), 'season');
  assertEquals(leagueScreenFor({ phase: 'playoffs', isRenewal: false }), 'season');
  assertEquals(leagueScreenFor({ phase: 'completed', isRenewal: false }), 'season');
});

Deno.test('the Run it back strip: only a finished season, to its commissioner, until it has a successor', () => {
  assertEquals(showRunItBackStrip({ phase: 'completed', isCommissioner: true, hasSuccessor: false }), true);
  assertEquals(showRunItBackStrip({ phase: 'completed', isCommissioner: false, hasSuccessor: false }), false);
  assertEquals(showRunItBackStrip({ phase: 'completed', isCommissioner: true, hasSuccessor: true }), false);
  assertEquals(showRunItBackStrip({ phase: 'regular', isCommissioner: true, hasSuccessor: false }), false);
});

Deno.test('the Playoffs segment shows only in the playoffs or over, with a bracket; History is always there', () => {
  assertEquals(seasonSegments({ phase: 'regular', playoffTeams: 4 }), ['standings', 'schedule', 'history']);
  assertEquals(seasonSegments({ phase: 'playoffs', playoffTeams: 4 }), ['standings', 'schedule', 'playoffs', 'history']);
  assertEquals(seasonSegments({ phase: 'completed', playoffTeams: 4 }), ['standings', 'schedule', 'playoffs', 'history']);
  assertEquals(seasonSegments({ phase: 'completed', playoffTeams: 0 }), ['standings', 'schedule', 'history']);
});

Deno.test('the board\'s own leagues route to the screens the board draws (the shell fixture phases)', () => {
  // Mirrors the phases of the shell fixture's leagues (lib/shell/devFixture.ts): the
  // drafting league, Serie A (pre-draft), Stock Scudetto (regular), Summer Cup (completed).
  const boardPhases: [string, string][] = [['drafting', 'draft_room'], ['pre_draft', 'lobby'], ['regular', 'season'], ['completed', 'season']];
  for (const [phase, screen] of boardPhases) {
    assertEquals(leagueScreenFor({ phase: phase as never, isRenewal: false }), screen, phase);
  }
});
