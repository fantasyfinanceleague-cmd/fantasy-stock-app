/**
 * Account deletion (W4): the DEV capture knobs' pure half (lib/game/seamAccountDeletion.ts). They only ever stand in for
 * a server in a dev build with the capture seam on; these pin that they change nothing when off and that the takeover
 * code they raise is one the real parser accepts.
 *
 *   cd apps/mobile/tests-deno && deno test account-deletion-capture-knobs.test.ts
 */
import { assert, assertEquals, assertStrictEquals } from 'jsr:@std/assert';
import { FIXTURE_TAKEOVER_CODE, parseTakeoverFixture, seatify, takeoverFixtureFor, takeoverInviteFixture } from '../lib/game/seamAccountDeletion.ts';
import { normalizeTakeoverCode } from '../lib/invite/takeoverLink.ts';
import { isDeletedSeatName } from '../lib/account/deletedSeat.ts';

Deno.test('seatify: off returns the very same value; on replaces only the seat\'s names, deep', () => {
  const v = { a: ['Gianluigi B.', 'Paolo M.'], n: { display_name: 'Gianluigi Buonarroti', x: 3 } };
  assertStrictEquals(seatify(v, false), v);
  const out = seatify(v, true);
  assertEquals(out, { a: ['Former manager', 'Paolo M.'], n: { display_name: 'Former manager', x: 3 } });
  assert(isDeletedSeatName(out.a[0]));
  assertEquals(v.a[0], 'Gianluigi B.'); // the input is not mutated
});

Deno.test('the fixture takeover code is a code the real parser accepts', () => {
  assertEquals(normalizeTakeoverCode(FIXTURE_TAKEOVER_CODE), FIXTURE_TAKEOVER_CODE);
  assertEquals(takeoverInviteFixture().data, { code: FIXTURE_TAKEOVER_CODE });
});

Deno.test('takeoverFixtureFor: only takeover actions of join-league, only with a knob', () => {
  assertEquals(takeoverFixtureFor({ action: 'takeover_preview' }, null), null);
  assertEquals(takeoverFixtureFor({ action: 'join' }, 'found'), null);
  assertEquals(takeoverFixtureFor({ action: 'takeover_preview' }, 'taken')?.data, { ok: false, reason: 'taken' });
  assert(takeoverFixtureFor({ action: 'takeover_preview' }, 'unknown')?.error);
  assertEquals(parseTakeoverFixture('rate_limited_moment'), 'rate_limited_moment');
  assertEquals(parseTakeoverFixture('nope'), null);
});
