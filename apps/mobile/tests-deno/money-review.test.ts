/**
 * Hermetic tests for lib/money/reviewMachine.ts (3e, Design Lead ruling (b)):
 * the review screen is the confirmation; the swipe-dismiss guard applies only
 * during submit; refusals and market_closed swap the button state instantly.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { canDismiss, canSubmit, initialReview, reviewReducer } from '../lib/money/reviewMachine.ts';
import { decideTradeGate, type MarketStatusRow } from '../lib/money/tradeGate.ts';
import { COPY } from '../lib/money/moneyCopy.ts';
import { refusalCopy } from '../lib/money/refusals.ts';

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

Deno.test('a dropped network during submit is "unconfirmed", and there is no blind retry', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  s = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'network' } });
  assertEquals(s.kind, 'unconfirmed');
  // The trade may already be recorded: no submit, and no retry, from this state.
  assertEquals(canSubmit(s), false);
  assertEquals(reviewReducer(s, { type: 'RETRY' }), s);
  assertEquals(reviewReducer(s, { type: 'SUBMIT' }), s);
});

Deno.test('unconfirmed copy points to the history and never invites a retry', () => {
  assertEquals(COPY.unconfirmed, "We couldn't confirm the trade. Check your history before trying again.");
});

Deno.test('proceeds_unavailable goes back to the picker; no_proceeds is terminal', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  const a = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'proceeds_unavailable' } });
  assertEquals(a, { kind: 'refused', reason: 'proceeds_unavailable', retryable: false, backTo: 'picker' });
  const b = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'no_proceeds' } });
  assertEquals(b, { kind: 'refused', reason: 'no_proceeds', retryable: false, terminal: true });
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

// trade_conflict: "the league changed while placing this trade" (HTTP 200, retryable).
// It is a refusal, not an unconfirmed submit: the trade was NOT recorded, so a retry is safe.
Deno.test('trade_conflict is a refusal the user can retry, not an unconfirmed trade', () => {
  let s = reviewReducer(initialReview, { type: 'SUBMIT' });
  s = reviewReducer(s, { type: 'OUTCOME', outcome: { kind: 'refused', reason: 'trade_conflict' } });
  assertEquals(s, { kind: 'refused', reason: 'trade_conflict', retryable: true });
  assertEquals(canSubmit(s), false);
  // Try again re-fetches; the review can submit only once fresh numbers have arrived.
  s = reviewReducer(s, { type: 'RETRY' });
  assertEquals(s.kind, 'refreshing');
  assertEquals(canSubmit(s), false);
  s = reviewReducer(s, { type: 'REFRESHED' });
  assertEquals(s.kind, 'ready');
});

Deno.test('an ordinary refusal is not retryable: RETRY does nothing', () => {
  const s = reviewReducer(reviewReducer(initialReview, { type: 'SUBMIT' }), {
    type: 'OUTCOME', outcome: { kind: 'refused', reason: 'symbol_owned' },
  });
  assertEquals(s, { kind: 'refused', reason: 'symbol_owned', retryable: false });
  assertEquals(reviewReducer(s, { type: 'RETRY' }), s);
});

Deno.test('trade_conflict copy is the approved text, with no raw code and no em dash', () => {
  assertEquals(refusalCopy('trade_conflict', {}).message, "Nothing was traded: your league changed while this trade was going through. Try again.");
  assertEquals(refusalCopy('trade_conflict', {}).message.includes('—'), false);
  assertEquals(refusalCopy('trade_conflict', {}).retryable, true);
  assertEquals(refusalCopy('symbol_owned', {}).retryable, undefined);
});

// Rule 9 / §9B (UX audit P1): the only state that locks dismissal is an in-flight submit.
// Every other state, including the outcomes the player must read, stays dismissible.
Deno.test('canDismiss is false only while submitting, for every review state', () => {
  const states: import('../lib/money/reviewMachine.ts').ReviewState[] = [
    { kind: 'ready' },
    { kind: 'submitting' },
    { kind: 'done', trade: {} },
    { kind: 'refused', reason: 'symbol_owned', retryable: false },
    { kind: 'refreshing' },
    { kind: 'closed', opensLabel: null },
    { kind: 'unavailable' },
    { kind: 'unconfirmed' },
  ];
  for (const s of states) {
    assertEquals(canDismiss(s), s.kind !== 'submitting', `kind=${s.kind}`);
  }
});
