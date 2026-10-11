/**
 * The one-time Final reveal (G3) never animated on a device (capture pass, 2026-10-08):
 * FinalBanner takes its start pose from `play` when it MOUNTS, but useRevealOnce decided
 * `play` later (after an AsyncStorage read), so the banner mounted already shown and
 * then "rose" from 1 to 1. `play` also stayed true across a league switch. The banner
 * now mounts only once the reveal is decided for the CURRENT league-week.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the banner mounts only after the reveal is decided, per league-week (source guards)', () => {
  const hook = SOURCES['lib/game/useRevealOnce.ts'];
  assert(hook.includes('export interface RevealState {'));
  assert(hook.includes("const key = leagueId && week !== null && isFinal ? revealKey(leagueId, week) : null;"));
  assert(hook.includes('setState({ key, play });'));
  assert(hook.includes('return { decided: key !== null && state.key === key, play: key !== null && state.key === key && state.play };'));
  assert(!hook.includes('setPlay(true)'));
  const screen = SOURCES['app/(tabs)/matchup.tsx'];
  assert(screen.includes('{isFinal && final && reveal.decided ? ('));
  assert(screen.includes('play={reveal.play}'));
  // Why: the banner's start pose is read once, on mount.
  assert(SOURCES['components/game/FinalBanner.tsx'].includes('const progress = useSharedValue(play && !reduced ? 0 : 1);'));
});
