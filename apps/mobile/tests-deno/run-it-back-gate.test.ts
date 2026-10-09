/**
 * Run it back's kill switch (fix/fixture-identity, F4a). Its UI ships in 1.2.0 but its
 * backend (renew_league, get_renewal_roster: PR #94) releases later. Ungated, a real
 * commissioner with a finished season saw the Run it back card, pressed it, and hit
 * the not-yet-deployed RPC ("Not started"). Every entry point is now behind
 * EXPO_PUBLIC_RUN_IT_BACK=1, off by default.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { runItBackEnabled } from '../lib/game/renewal.ts';
import { SOURCES } from './sourceManifest.generated.ts';

Deno.test('the switch is on only for exactly "1"; unset is off', () => {
  assertEquals(runItBackEnabled('1'), true);
  for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) assertEquals(runItBackEnabled(v), false, String(v));
});

Deno.test('every Run it back entry point is behind the switch (Home and League)', () => {
  const home = SOURCES['app/(tabs)/index.tsx'];
  assert(home.includes('const RUN_IT_BACK_ON = runItBackEnabled(process.env.EXPO_PUBLIC_RUN_IT_BACK);'));
  assert(home.includes('{RUN_IT_BACK_ON && league?.commissioner_id === myUserId ? <RunItBackCard /> : null}'));
  assert(home.includes('{RUN_IT_BACK_ON && league?.successor_league_id && league.commissioner_id !== myUserId ? ('));
  assert(home.includes('{RUN_IT_BACK_ON && league.previous_league_id && league.commissioner_id === myUserId ? <RenewalCountsCard'));
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('const RUN_IT_BACK_ON = runItBackEnabled(process.env.EXPO_PUBLIC_RUN_IT_BACK);'));
  assert(league.includes('leagueScreenFor({ phase, isRenewal: RUN_IT_BACK_ON && !!activeLeague.previous_league_id })'));
  assert(league.includes('{RUN_IT_BACK_ON && phase && showRunItBackStrip({ phase,'));
  assert(league.includes('if (RUN_IT_BACK_ON && preDraft && activeLeagueId && activeLeague?.previous_league_id) {'));
  // Each component is mounted only from those gated spots.
  for (const name of ['<RunItBackCard', '<HomeRenewalAsk', '<RenewalCountsCard', '<RenewedPreDraft', '<LeagueRenewal ']) {
    const mounts = Object.entries(SOURCES).filter(([p, src]) => !p.startsWith('tests-deno') && src.includes(name)).map(([p]) => p);
    assert(mounts.every((p) => p === 'app/(tabs)/index.tsx' || p === 'app/(tabs)/league.tsx'), `${name} mounted in ${mounts.join(', ')}`);
  }
});
