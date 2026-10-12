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
  // A calm Home (2026-10-12): season over has ONE primary, picked by seasonOverPrimary,
  // which returns none with the switch off (home-calm.test.ts pins that).
  assert(home.includes('runItBackOn: RUN_IT_BACK_ON,'));
  assert(home.includes("{primary === 'run_it_back' ? <RunItBackCard /> : null}"));
  assert(home.includes("{primary === 'renewal_ask' && league?.successor_league_id ? ("));
  assert(home.includes('return RUN_IT_BACK_ON && league.previous_league_id && league.commissioner_id === myUserId\n      ? <RenewedPreDraftHome'));
  // The counts card mounts only inside RenewedPreDraftHome, which mounts only from that gated return.
  assert(home.split('<RenewedPreDraftHome').length === 2, 'RenewedPreDraftHome mounted once');
  assert(home.split('<RenewalCountsCard').length === 2, 'RenewalCountsCard mounted once');
  assert(home.indexOf('<RenewalCountsCard') > home.indexOf('function RenewedPreDraftHome('));
  assert(home.indexOf('<RenewalCountsCard') < home.indexOf('function HomeBody('));
  const league = SOURCES['app/(tabs)/league.tsx'];
  assert(league.includes('const RUN_IT_BACK_ON = runItBackEnabled(process.env.EXPO_PUBLIC_RUN_IT_BACK);'));
  assert(league.includes('leagueScreenFor({ phase, isRenewal: RUN_IT_BACK_ON && !!activeLeague.previous_league_id })'));
  assert(league.includes('{RUN_IT_BACK_ON && phase && showRunItBackStrip({ phase,'));
  assert(league.includes('if (RUN_IT_BACK_ON && preDraft && activeLeagueId && activeLeague?.previous_league_id) {'));
  // Board frame 1 / GS-14: the member's ask on a finished league's League tab.
  assert(league.includes('{RUN_IT_BACK_ON && phase && activeLeague?.successor_league_id && showsLeagueRenewalAsk({ phase, isCommissioner, hasSuccessor: true }) ? ('));
  // Each component is mounted only from those gated spots.
  for (const name of ['<RunItBackCard', '<HomeRenewalAsk', '<RenewalCountsCard', '<RenewedPreDraft', '<LeagueRenewal ']) {
    const mounts = Object.entries(SOURCES).filter(([p, src]) => !p.startsWith('tests-deno') && src.includes(name)).map(([p]) => p);
    assert(mounts.every((p) => p === 'app/(tabs)/index.tsx' || p === 'app/(tabs)/league.tsx'), `${name} mounted in ${mounts.join(', ')}`);
  }
});

import { waitingOnSentence } from '../lib/game/renewal.ts';

Deno.test('"Waiting on …" never doubles the period after an initial (capture pass: "Andrea P..")', () => {
  assertEquals(waitingOnSentence(['Andrea P.']), 'Waiting on Andrea P.');
  assertEquals(waitingOnSentence(['Marta C.', 'Andrea P.']), 'Waiting on Marta C., Andrea P.');
  assertEquals(waitingOnSentence(['Andrea']), 'Waiting on Andrea.');
  for (const p of ['components/game/RenewalRoster.tsx', 'components/home/RenewalCountsCard.tsx']) {
    assert(SOURCES[p].includes('waitingOnSentence(waiting)'), p);
    assert(!SOURCES[p].includes("Waiting on ${waiting.join(', ')}"), p);
  }
});
