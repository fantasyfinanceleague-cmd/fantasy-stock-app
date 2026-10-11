/**
 * UX final sweep S-6 (P1, rule 9): the Matchup tab rendered NOTHING while loading (the
 * body and All matchups), and All matchups' load failure was a bare line with no retry.
 * Loading now shows the shape of what's coming (MatchupSkeleton, AllMatchupsSkeleton,
 * in the Home skeleton pattern); a failed All matchups load says "This week's matchups
 * didn't load" with Try again (LoadFailure), which re-runs the read.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { COPY } from '../lib/game/gameCopy.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the copy', () => {
  assertEquals(COPY.allMatchupsLoadFailed, "This week's matchups didn't load");
});

Deno.test('Matchup never renders blank while loading; All matchups fails with Try again (source guards)', () => {
  const screen = SOURCES['app/(tabs)/matchup.tsx'];
  assert(screen.includes("if (status === 'loading' || !derived || !user) return <MatchupSkeleton />;"));
  assert(screen.includes("if (state.status === 'loading' || state.status === 'idle') return <AllMatchupsSkeleton />;"));
  assert(screen.includes('<LoadFailure title={COPY.allMatchupsLoadFailed} message={MONEY_COPY.loadRetryMessage} onRetry={state.retry} />'));
  assert(!screen.includes("Couldn't load this week's matchups."));
  assert(!screen.includes('honest empty while loading'));
  // The retry re-runs the read: a new attempt is part of the effect's dependencies.
  const hook = SOURCES['lib/game/useAllMatchups.ts'];
  assert(hook.includes('}, [enabled, leagueId, week, user?.id, namesKey, attempt]);'));
  assert(hook.includes('return { ...state, retry: () => setAttempt((a) => a + 1) };'));
  // The skeletons follow the Home pattern: one accessible "Loading" element, busy.
  const sk = SOURCES['components/game/LoadingSkeletons.tsx'];
  for (const name of ['MatchupSkeleton', 'AllMatchupsSkeleton']) {
    const body = sk.slice(sk.indexOf(`export function ${name}()`));
    assert(body.slice(0, 200).includes('accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}'), name);
  }
});
