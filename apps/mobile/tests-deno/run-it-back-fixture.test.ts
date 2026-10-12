/**
 * Run it back under fixtures (fix/fixture-identity, F4b). The flow beyond the card was
 * unreachable: no fixture league had a predecessor, EXPO_PUBLIC_RENEWAL_FIXTURE was
 * dead (every caller passed null), and the card's renewal landed on a league the
 * fixture didn't list, so it fell back to Stock Scudetto. Now a separate shell mode,
 * leagues-renewal, adds Summer Cup's Season 2 (the default league list is unchanged),
 * EXPO_PUBLIC_RENEWAL_FIXTURE picks who you are, and a seam renewal lists Season 2.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { FIXTURE_LEAGUE_ID, fixtureRoster, parseRenewalCaller, renewalShellFacts, type RenewalCaller } from '../lib/game/renewalFixture.ts';
import { screenFor } from '../lib/game/renewal.ts';
import { renewalReadyForLobby } from '../lib/game/renewalLobby.ts';
import { FIXTURE_USER_ID } from '../lib/shell/fixtureIds.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const NOW = new Date('2026-01-18T12:00:00Z');

Deno.test('EXPO_PUBLIC_RENEWAL_FIXTURE: every caller, and nothing else', () => {
  for (const c of ['commissioner', 'commissioner-ready', 'in', 'in-set', 'new', 'pending', 'out', 'removed', 'stranger']) assertEquals(parseRenewalCaller(c), c);
  for (const c of [undefined, '', 'admin', 'Commissioner']) assertEquals(parseRenewalCaller(c), null, String(c));
});

Deno.test('each caller reaches its own screen, with "me" always the fixture user', () => {
  const screen = (c: RenewalCaller) => screenFor(fixtureRoster(c, NOW) as Parameters<typeof screenFor>[0]);
  assertEquals(screen('commissioner'), 'reconcile');
  assertEquals(screen('commissioner-ready'), 'reconcile');
  assertEquals(screen('in'), 'member_list');
  assertEquals(screen('new'), 'member_list');
  assertEquals(screen('pending'), 'ask');
  assertEquals(screen('out'), 'ask'); // GS-14: out by choice keeps the ask
  assertEquals(screen('removed'), 'none'); // removed by the commissioner: no card
  assertEquals(screen('in-set'), 'member_list'); // in, the draft set: the list without Change
  assertEquals(screen('stranger'), 'none');
  type Full = { people: { user_id: string; is_commissioner: boolean; group: string }[]; caller_status: string; replies_pending: boolean; is_commissioner: boolean };
  const asCommissioner = fixtureRoster('commissioner', NOW) as Full;
  assertEquals(asCommissioner.people.find((p) => p.is_commissioner)!.user_id, FIXTURE_USER_ID);
  assertEquals(asCommissioner.replies_pending, true); // Andrea hasn't answered: the reconcile list
  const ready = fixtureRoster('commissioner-ready', NOW) as Full;
  assertEquals(ready.replies_pending, false); // everyone answered: the review (set Season 2) shows
  assertEquals(renewalReadyForLobby({ roster: ready as never, draftDate: null }), false); // no draft time yet: still the renewal screens
  const asMember = fixtureRoster('in', NOW) as Full;
  assertEquals(asMember.is_commissioner, false);
  assertEquals(asMember.caller_status, 'in');
  assertEquals(asMember.people.find((p) => p.is_commissioner)!.user_id, 'paolo');
  assertEquals(asMember.people.find((p) => p.user_id === FIXTURE_USER_ID)!.group, 'in');
  assertEquals((fixtureRoster('new', NOW) as Full).caller_status, 'new');
});

Deno.test('leagues-renewal lists Summer Cup\'s Season 2 (a renewed pre-draft league); leagues does not until a renewal', () => {
  assertEquals(renewalShellFacts('leagues', false, null), { renewed: false, commissionerId: FIXTURE_USER_ID }); // the default list: unchanged
  assertEquals(renewalShellFacts('leagues-renewal', false, null), { renewed: true, commissionerId: FIXTURE_USER_ID });
  assertEquals(renewalShellFacts('leagues-renewal', false, 'commissioner-ready').commissionerId, FIXTURE_USER_ID);
  for (const c of ['in', 'new', 'pending', 'out', 'stranger'] as const) assertEquals(renewalShellFacts('leagues-renewal', false, c).commissionerId, 'paolo', c);
  // The card's renewal (seam renew_league) lists Season 2 in leagues, so it lands there.
  assertEquals(renewalShellFacts('leagues', true, null).renewed, true);
  assertEquals(renewalShellFacts('leagues-member', true, null).renewed, false);
  assertEquals(renewalShellFacts('drafting', true, null).renewed, false);
  // devFixture builds Season 2 from those facts (source guard: it imports React Native types).
  const shell = SOURCES['lib/shell/devFixture.ts'];
  assert(shell.includes("const { renewed, commissionerId: renewalCommissioner } = renewalShellFacts(fixture, fixtureRenewed, renewalCaller);"));
  assert(shell.includes("previous_league_id: 'fx-summer', commissioner_id: renewalCommissioner,"));
  assert(shell.includes("...(renewed ? { successor_league_id: RENEWAL_LEAGUE_ID, commissioner_id: renewalCommissioner } : {}),"));
  assert(shell.includes("seasonLabel: 'Season 2', seasonPhase: 'pre_draft' as const"));
  assert(shell.includes("'leagues-member', 'leagues-renewal'];"));
  assert(SOURCES['lib/game/seamCalls.ts'].includes("if (f && name === 'renew_league') markFixtureRenewed();"));
  // renew_league answers with the same league id the fixture lists.
  assert(SOURCES['lib/game/seamFixtures.ts'].includes("const SUCCESSOR = 'fixture-season-2';"));
  assertEquals(FIXTURE_LEAGUE_ID, 'fixture-season-2');
});

Deno.test('the renewal hooks pass the fixture caller (DEV-only), never a hard-coded null', () => {
  const hook = SOURCES['lib/game/useRenewalRoster.ts'];
  assert(hook.includes('export const RENEWAL_FIXTURE_CALLER: RenewalCaller | null = __DEV__ ? parseRenewalCaller(process.env.EXPO_PUBLIC_RENEWAL_FIXTURE) : null;'));
  assert(hook.includes('if (fixtureCaller) {'));
  assert(SOURCES['app/(tabs)/league.tsx'].includes('useRenewalRoster(leagueId, RENEWAL_FIXTURE_CALLER, rosterKey)'));
  assert(SOURCES['components/game/LeagueRenewal.tsx'].includes('useRenewalRoster(successorId, RENEWAL_FIXTURE_CALLER, retry)'));
  // GS-11: Home reads the roster once (RenewedPreDraftHome) and shares it with the counts card and PreDraftCard.
  assert(SOURCES['app/(tabs)/index.tsx'].includes('useRenewalRoster(successorId, RENEWAL_FIXTURE_CALLER, readKey)'));
  assert(!SOURCES['components/home/RenewalCountsCard.tsx'].includes('useRenewalRoster('));
  assert(SOURCES['components/game/HomeRenewalAsk.tsx'].includes('isCommissioner ? null : RENEWAL_FIXTURE_CALLER'));
  for (const [path, src] of Object.entries(SOURCES)) assert(!/useRenewalRoster\([^)]*,\s*null\s*,/.test(src), `${path} passes a null caller`);
});
