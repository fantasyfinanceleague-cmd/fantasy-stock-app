/**
 * UX final sweep S-4 (P1, the H5 class): ScoreDigits keeps its previous text across a
 * re-render (prevTextRef), and nothing keyed the Matchup scoreboard by league, so a
 * league switch rolled league A's score into league B's. The Matchup body (scoreboard,
 * tug, lineups) and All matchups are now keyed by the active league id, as Home
 * is (HomeLeagueTransition key={activeLeagueId}).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the Matchup body and All matchups remount per league (source guard)', () => {
  const screen = SOURCES['app/(tabs)/matchup.tsx'];
  assert(screen.includes("<MatchupBody key={activeLeagueId ?? 'none'} status={m.status}"));
  assert(screen.includes("<AllMatchupsList key={activeLeagueId ?? 'none'} state={all}"));
  // The scoreboard lives inside the keyed body, never above it.
  const body = screen.slice(screen.indexOf('function MatchupBody('));
  assert(body.includes('<Scoreboard you={{ name: youName, gain: mine }}'));
  assert(!screen.slice(0, screen.indexOf('function AllMatchupsList(')).includes('<Scoreboard'));
  // Why: ScoreDigits remembers the previous text, so only a remount resets it.
  assert(SOURCES['components/sp/game/ScoreDigits.tsx'].includes('prevTextRef'));
  // Home does the same.
  assert(SOURCES['app/(tabs)/index.tsx'].includes("<HomeLeagueTransition key={activeLeagueId ?? 'none'}"));
});
