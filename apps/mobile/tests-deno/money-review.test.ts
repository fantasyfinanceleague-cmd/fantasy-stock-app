/**
 * Hermetic tests for lib/money/reviewMachine.ts (3e, Design Lead ruling (b)):
 * the review screen is the confirmation; the swipe-dismiss guard applies only
 * during submit; refusals and market_closed swap the button state instantly.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { canDismiss, canSubmit, initialReview, reviewReducer } from '../lib/money/reviewMachine.ts';
import { decideTradeGate, type MarketStatusRow } from '../lib/money/tradeGate.ts';

Deno.test('ready: the button is live and the review can be dismissed', () => {
  assertEquals(canSubmit(initialReview), true);
  assertEquals(canDismiss(initialReview), true);
});

Deno.test('submitting: the button is disabled and dismissing is guarded', () => {
  const s = reviewReducer(initialReview, { type: 'SUBMIT' });
  assertEquals(s.kind, 'submitting');
  assertEquals(canSubmit(s), false);
  assertEquals(canDismiss(s), false);
});

Deno.test('a double tap while submitting is ignored (one trade, not two)', () => {
  const once = reviewReducer(initialReview, { type: 'SUBMIT' });
  assertEquals(reviewReducer(once, { type: 'SUBMIT' }), once);
});

Deno.test('ok: the trade is done', () => {
  const s = reviewReducer(reviewReducer(initialReview, { type: 'SUBMIT' }), {
    type: 'OUTCOME', outcome: { kind: 'ok', trade: { id: 't1' } },
  });
  assertEquals(s.kind, 'done');
});

Deno.test('market_closed from the server: closed instantly, with the open time, button disabled', () => {
  const s = reviewReducer(reviewReducer(initialReview, { type: 'SUBMIT' }), {
    type: 'OUTCOME', outcome: { kind: 'refused', reason: 'market_closed', nextOpenAt: '2026-10-05T13:30:00Z' },
  });
  assertEquals(s, { kind: 'closed', opensLabel: 'Mon 9:30 AM ET' });
  assertEquals(canSubmit(s), false);
});

Deno.test('calendar unavailable (503): not a failed trade, the review stays open and can retry', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  s = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'unavailable' } });
  assertEquals(s.kind, 'unavailable');
  assertEquals(canDismiss(s), true);
  s = reviewReducer(s, { type: 'RETRY' });
  assertEquals(s.kind, 'ready');
});

Deno.test('a dropped network during submit is "unconfirmed", never a plain failure', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  s = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'network' } });
  assertEquals(s.kind, 'unconfirmed');
  assertEquals(canSubmit(s), true);
});

Deno.test('proceeds_unavailable goes back to the picker; no_proceeds is terminal', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  const a = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'proceeds_unavailable' } });
  assertEquals(a, { kind: 'refused', reason: 'proceeds_unavailable', backTo: 'picker' });
  const b = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'no_proceeds' } });
  assertEquals(b, { kind: 'refused', reason: 'no_proceeds', terminal: true });
});

Deno.test('the race: the clock crosses 4:00 PM ET while the review is open; the client closes it at once', () => {
  const row: MarketStatusRow = {
    status: 'open', session_open_at: '2026-10-05T13:30:00Z', session_close_at: '2026-10-05T20:00:00Z', next_open_at: null,
  };
  let s = initialReview;
  const before = decideTradeGate(new Date('2026-10-05T19:59:59Z'), row);
  assertEquals(before.open, true);
  const after = decideTradeGate(new Date('2026-10-05T20:00:00Z'), row);
  assertEquals(after.open, false);
  s = reviewReducer(s, { type: 'GATE_CLOSED', opensLabel: 'Mon 9:30 AM ET' });
  assertEquals(s.kind, 'closed');
  assertEquals(reviewReducer(s, { type: 'SUBMIT' }), s); // a closed review can't submit
});

Deno.test('the half-day race: a 1:00 PM close on 2026-11-27 closes an open review', () => {
  const row: MarketStatusRow = {
    status: 'open', session_open_at: '2026-11-27T14:30:00Z', session_close_at: '2026-11-27T18:00:00Z', next_open_at: null,
  };
  assertEquals(decideTradeGate(new Date('2026-11-27T17:59:00Z'), row).open, true);
  assertEquals(decideTradeGate(new Date('2026-11-27T18:00:00Z'), row).open, false);
});

Deno.test('the server refusal wins a race: a submit that loses to the close shows closed, not done', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  s = reviewReducer(s, { type: 'GATE_CLOSED', opensLabel: 'Mon 9:30 AM ET' });
  s = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'market_closed', nextOpenAt: null } });
  assertEquals(s.kind, 'closed');
  assert(s.kind !== 'done');
});
