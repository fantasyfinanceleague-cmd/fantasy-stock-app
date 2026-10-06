/**
 * The review's presentation per state (3e, Design Lead rulings): refusals and
 * blockers are warn-tint with no icon; only trade_conflict and a 503 offer Try
 * again; an unconfirmed trade offers no retry; the button names the action.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { reviewPresentation } from '../lib/money/reviewPresentation.ts';
import type { ReviewState } from '../lib/money/reviewMachine.ts';

const REVIEW = { buttonLabel: 'Sell JPM' };
const CTX = { title: 'Sold JPM', symbol: 'JPM' };
const p = (s: ReviewState) => reviewPresentation(s, REVIEW, CTX);

Deno.test('ready: the button names the action and is live', () => {
  assertEquals(p({ kind: 'ready' }).button, { label: 'Sell JPM', enabled: true, progress: false });
});

Deno.test('submitting: the button is disabled, shows progress, and names the work in flight (NEW copy)', () => {
  assertEquals(p({ kind: 'submitting' }).button, { label: 'Selling…', enabled: false, progress: true });
  const buy = reviewPresentation({ kind: 'submitting' }, { buttonLabel: 'Buy SHOP', buttonRole: 'buy' }, { title: 'Bought SHOP', symbol: 'SHOP' });
  assertEquals(buy.button, { label: 'Buying…', enabled: false, progress: true });
});

Deno.test('done: the title, and no button', () => {
  const r = p({ kind: 'done', trade: {} });
  assertEquals(r.message, 'Sold JPM');
  assertEquals(r.button, null);
  assertEquals(r.footer, 'done');
});

Deno.test('a refusal is warn-tint with no icon; trade_conflict offers Try again', () => {
  const r = p({ kind: 'refused', reason: 'trade_conflict', retryable: true });
  assertEquals(r.messageTone, 'warn');
  assertEquals(r.footer, 'try_again');
  assertEquals(r.button, null);
  assert(r.message!.startsWith('Nothing was traded:'));
});

Deno.test('an ordinary refusal is warn-tint, offers no retry, and names its next step', () => {
  const r = p({ kind: 'refused', reason: 'symbol_owned', retryable: false });
  assertEquals(r.messageTone, 'warn');
  assertEquals(r.footer, 'pick_stock');
});

Deno.test('proceeds_unavailable sends the user back to the picker', () => {
  assertEquals(p({ kind: 'refused', reason: 'proceeds_unavailable', retryable: false, backTo: 'picker' }).footer, 'back_to_picker');
});

Deno.test('closed: the open time, the button disabled, the numbers kept by the caller', () => {
  const r = p({ kind: 'closed', opensLabel: 'Mon 9:30 AM ET' });
  assertEquals(r.message, 'Trading opens Mon 9:30 AM ET.');
  assertEquals(r.messageTone, 'warn');
  assertEquals(r.button, { label: 'Sell JPM', enabled: false, progress: false });
});

Deno.test('closed with no known open time: the plain closed line, never a guessed time', () => {
  assertEquals(p({ kind: 'closed', opensLabel: null }).message, 'Trading is closed right now.');
});

Deno.test('unavailable (503): not a failed trade, Try again offered', () => {
  const r = p({ kind: 'unavailable' });
  assertEquals(r.message, 'Trading hours unavailable. Try again shortly.');
  assertEquals(r.footer, 'try_again');
});

Deno.test('unconfirmed: the history copy, and NO retry', () => {
  const r = p({ kind: 'unconfirmed' });
  assertEquals(r.message, "We couldn't confirm the trade. Check your history before trying again.");
  assertEquals(r.footer, null);
  assertEquals(r.button, null);
});

Deno.test('refreshing: the button is disabled while fresh numbers load', () => {
  assertEquals(p({ kind: 'refreshing' }).button, { label: 'Sell JPM', enabled: false, progress: true });
});

Deno.test('no state shows "Confirm" or "OK" as a button label', () => {
  for (const s of [{ kind: 'ready' }, { kind: 'submitting' }, { kind: 'refreshing' }] as ReviewState[]) {
    const label = p(s).button!.label;
    assert(!/confirm|^ok$/i.test(label), label);
  }
});

Deno.test('a tier refusal names the price and the open slot, warn-tint, no retry', () => {
  const r = p({
    kind: 'refused', reason: 'no_eligible_slot', retryable: false,
    tier: { price: 211.42, openSlots: [{ slot_id: 's1', slot_index: 0, slot_count: 1, price_min: 100, price_max: 200, category_id: null }] },
  });
  assertEquals(r.message, 'JPM is $211.42. Your open slot takes stocks priced $100 to $200.');
  assertEquals(r.messageTone, 'warn');
  assertEquals(r.footer, 'sell_first');
});

// Rule 8 (UX audit P1): a proceeds refusal names the next step: "Pick another sale" (NEW copy).
Deno.test('proceeds_unavailable: the refused review offers back_to_picker, not a dead end', () => {
  const r = reviewPresentation(
    { kind: 'refused', reason: 'proceeds_unavailable', backTo: 'picker', retryable: false },
    { buttonLabel: 'Buy SHOP', buttonRole: 'buy' },
    { title: 'Bought SHOP', symbol: 'SHOP' },
  );
  assertEquals(r.footer, 'back_to_picker');
  assertEquals(r.button, null);
});

// Rule 8 (UX audit P1): every refusal names a next step. The button is the way out;
// the refusal is the only place the player will read the rule.
const REFUSED = (reason: string, retryable = false) =>
  reviewPresentation({ kind: 'refused', reason, retryable }, { buttonLabel: 'Buy SHOP', buttonRole: 'buy' }, { title: 'Bought SHOP', symbol: 'SHOP' });

Deno.test('symbol_owned: the owner is named, and the next step is Pick another stock', () => {
  const r = reviewPresentation(
    { kind: 'refused', reason: 'symbol_owned', retryable: false },
    { buttonLabel: 'Buy SHOP', buttonRole: 'buy' },
    { title: 'Bought SHOP', symbol: 'SHOP', ownerName: 'Ticker Tina' },
  );
  assertEquals(r.message, 'Owned by Ticker Tina');
  assertEquals(r.footer, 'pick_stock');
});

Deno.test('symbol_owned without a name falls back to another manager', () => {
  assertEquals(REFUSED('symbol_owned').message, 'Owned by another manager');
});

Deno.test('over_budget and not_draftable: Pick another stock', () => {
  assertEquals(REFUSED('over_budget').footer, 'pick_stock');
  assertEquals(REFUSED('not_draftable').footer, 'pick_stock');
});

Deno.test('roster_full and no_eligible_slot: Sell a holding first', () => {
  assertEquals(REFUSED('roster_full').footer, 'sell_first');
  assertEquals(REFUSED('no_eligible_slot').footer, 'sell_first');
});

Deno.test('no_price and invalid_price: a retryable Try again, like calendar_unavailable', () => {
  assertEquals(REFUSED('no_price', true).footer, 'try_again');
  assertEquals(REFUSED('invalid_price', true).footer, 'try_again');
});

Deno.test('not_authenticated: the session ended, and the next step is Sign in', () => {
  const r = REFUSED('not_authenticated');
  assertEquals(r.message, 'Your session ended. Sign in again.');
  assertEquals(r.footer, 'sign_in');
});
