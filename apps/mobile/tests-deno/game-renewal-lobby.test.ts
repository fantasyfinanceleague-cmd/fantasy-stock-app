/**
 * A renewed league reaches the normal pre-draft lobby (queue, Start the draft,
 * League settings) once the renewal is reconciled and the season is set
 * (3c-2). Before that, everyone stays on the Run it back flow.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { renewalReadyForLobby } from '../lib/game/renewalLobby.ts';

const full = (replies_pending: boolean) => ({ status: 'ok' as const, full_list: true as const, replies_pending });
const DATE = '2027-01-23T00:00:00Z';

Deno.test('reconciled and scheduled: the lobby', () => {
  assertEquals(renewalReadyForLobby({ roster: full(false), draftDate: DATE }), true);
});

Deno.test('replies still pending: the renewal flow, even with a date', () => {
  assertEquals(renewalReadyForLobby({ roster: full(true), draftDate: DATE }), false);
});

Deno.test('everyone replied but not scheduled yet (no date): the renewal flow (the review)', () => {
  assertEquals(renewalReadyForLobby({ roster: full(false), draftDate: null }), false);
  assertEquals(renewalReadyForLobby({ roster: full(false), draftDate: undefined }), false);
  assertEquals(renewalReadyForLobby({ roster: full(false), draftDate: '' }), false);
});

Deno.test('a pending invitee (no full list) keeps the ask', () => {
  assertEquals(renewalReadyForLobby({ roster: { status: 'ok', full_list: false }, draftDate: DATE }), false);
});

Deno.test('not visible, or the roster not read yet / failed: never the lobby', () => {
  assertEquals(renewalReadyForLobby({ roster: { status: 'not_visible' }, draftDate: DATE }), false);
  assertEquals(renewalReadyForLobby({ roster: null, draftDate: DATE }), false);
});
