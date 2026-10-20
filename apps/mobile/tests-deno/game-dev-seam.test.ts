/**
 * The capture seam is inert outside dev (3c): it is on only when the build is a dev
 * build AND the flag is exactly '1'. Anything else (a production build, a dev build
 * without the flag, or a flag with another value) leaves the real calls in place.
 * Run: `deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { createFailOnce, parseFailOnce, seamActive } from '../lib/game/devSeamGate.ts';

Deno.test('the seam is on only in a dev build with the flag set to 1', () => {
  assertEquals(seamActive(true, '1'), true);
});

Deno.test('a production build never turns the seam on, even with the flag', () => {
  assertEquals(seamActive(false, '1'), false);
});

Deno.test('a dev build without the flag, or with any other flag value, is inert', () => {
  assertEquals(seamActive(true, undefined), false);
  assertEquals(seamActive(true, ''), false);
  assertEquals(seamActive(true, 'true'), false);
  assertEquals(seamActive(true, '0'), false);
});

import { pickLeagueFixture } from '../lib/game/devSeamGate.ts';

Deno.test('the league context fixture is the shell fixture when one is set, the board\'s leagues only under the seam, and none otherwise', () => {
  assertEquals(pickLeagueFixture('drafting', false, 'leagues'), 'drafting');
  assertEquals(pickLeagueFixture(null, true, 'leagues'), 'leagues');
  assertEquals(pickLeagueFixture(null, false, 'leagues'), null);
});

// ---------------------------------------------------------------------------------------------------------------
// EXPO_PUBLIC_CAPTURE_FAIL_ONCE: a named seam read fails on its first call and answers after (tap-through P3)
// ---------------------------------------------------------------------------------------------------------------

Deno.test('fail-once: the named read fails ONCE (its first call), then answers; every other read is untouched', () => {
  const failsOnce = createFailOnce(true, 'get_league_history');
  assertEquals(failsOnce('get_league_history'), true, 'the first call fails');
  assertEquals(failsOnce('get_league_history'), false, 'the retry answers');
  assertEquals(failsOnce('get_league_history'), false, 'and every call after');
  assertEquals(failsOnce('get_home_league'), false, 'a read that is not named never fails');
});

Deno.test('fail-once: several keys, each once; spaces and junk are ignored', () => {
  const failsOnce = createFailOnce(true, ' matchups_week , week_snapshots,,not a key!,get_renewal_roster ');
  assertEquals([...parseFailOnce(true, ' matchups_week , week_snapshots,,not a key!,get_renewal_roster ').keys()].sort(), ['get_renewal_roster', 'matchups_week', 'week_snapshots']);
  for (const k of ['matchups_week', 'week_snapshots', 'get_renewal_roster']) {
    assertEquals(failsOnce(k), true, `${k}: first call`);
    assertEquals(failsOnce(k), false, `${k}: second call`);
  }
  assertEquals(failsOnce('not a key!'), false);
});

Deno.test('fail-once: key*n fails the first n calls (a read another screen makes first, as Home does for the renewal roster)', () => {
  const failsOnce = createFailOnce(true, 'get_renewal_roster*2,matchups_week');
  assertEquals([failsOnce('get_renewal_roster'), failsOnce('get_renewal_roster'), failsOnce('get_renewal_roster')], [true, true, false]);
  assertEquals([failsOnce('matchups_week'), failsOnce('matchups_week')], [true, false], 'no count means once');
  assertEquals(parseFailOnce(true, 'a*9,b*0,c*10,d*x').get('a'), 9);
  assertEquals([...parseFailOnce(true, 'a*9,b*0,c*10,d*x').keys()], ['a'], 'a count is 1 to 9; anything else is not a key');
  // the count never turns a gated-off knob on
  assertEquals(createFailOnce(false, 'get_renewal_roster*9')('get_renewal_roster'), false);
});

Deno.test('fail-once: production can never read it. With the seam off, no read ever fails, whatever the variable holds', () => {
  // seamActive(isDev, flag) is the seam: a production build is never dev, and a dev build needs GAME_SEAM=1
  const production = seamActive(false, '1');
  const devNoFlag = seamActive(true, undefined);
  for (const on of [production, devNoFlag, seamActive(true, 'true')]) {
    assertEquals(on, false);
    const failsOnce = createFailOnce(on, 'get_league_history,matchups_week,get_renewal_roster,get_portfolio_ledger');
    for (const k of ['get_league_history', 'matchups_week', 'get_renewal_roster', 'get_portfolio_ledger']) {
      assertEquals(failsOnce(k), false, `${k} never fails with the seam off`);
    }
  }
  assertEquals(parseFailOnce(false, 'get_league_history').size, 0);
  assertEquals(parseFailOnce(true, undefined).size, 0);
  assertEquals(parseFailOnce(true, '').size, 0);
});

Deno.test('fail-once: the variable is read in ONE place, built from SEAM_ON, and every use goes through it', () => {
  // only devSeam.ts reads the variable, and only through createFailOnce(SEAM_ON, ...)
  const readers = Object.entries(SOURCES).filter(([f, src]) => /^(app|components|lib)\//.test(f) && src.includes('process.env.EXPO_PUBLIC_CAPTURE_FAIL_ONCE')).map(([f]) => f);
  assertEquals(readers, ['lib/game/devSeam.ts'], 'nothing but the seam module reads process.env for it');
  assert(SOURCES['lib/game/devSeam.ts'].includes('createFailOnce(SEAM_ON, process.env.EXPO_PUBLIC_CAPTURE_FAIL_ONCE)'));
  // the seam's read chokepoints and the ledger read consult it, inside their SEAM_ON branches
  const calls = SOURCES['lib/game/seamCalls.ts'];
  assert(calls.includes("if (SEAM_ON) {\n    if (captureFailsOnce(name)) return { data: null, error: FAIL_ONCE_ERROR"), 'seamRpc, inside the seam branch');
  assert(calls.includes('if (SEAM_ON && captureFailsOnce(name)) return { data: null, error: FAIL_ONCE_ERROR, count: null };'), 'seamTable, seam only');
  const renewal = SOURCES['lib/game/useRenewalRoster.ts'];
  assert(renewal.includes("if (captureFailsOnce('get_renewal_roster')) {\n          if (!cancelled) setState({ status: 'error', roster: null });"), 'the fixture renewal roster read (Home reads it first: use *2)');
  const roster = SOURCES['lib/game/useRosterData.ts'];
  assert(roster.includes("if (captureFailsOnce('league_draft_slots')) throw new Error("), 'the roster slots read, inside its seam branch');
  assert(roster.includes("useState(() => SEAM_ON && captureFailsOnce('get_portfolio_ledger'))"), 'the roster ledger state, seam only');
  assert(roster.includes('setSeamLedgerFails(false);'), 'Try again clears it');
  assert(roster.includes("ledgerStatus: me ? (seamLedgerFails ? 'error' : 'ready') : 'loading',"));
  assert(SOURCES['lib/money/usePortfolioLedger.ts'].includes("CAPTURE_FAIL || captureFailsOnce('get_portfolio_ledger') ? null :"), 'the ledger read, inside the seam branch');
});
