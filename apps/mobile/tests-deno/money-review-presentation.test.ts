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
const DONE = { title: 'Sold JPM' };
const p = (s: ReviewState) => reviewPresentation(s, REVIEW, DONE);

Deno.test('ready: the button names the action and is live', () => {
  assertEquals(p({ kind: 'ready' }).button, { label: 'Sell JPM', enabled: true, progress: false });
});

Deno.test('submitting: the button is disabled and shows progress, never a second submit', () => {
  assertEquals(p({ kind: 'submitting' }).button, { label: 'Sell JPM', enabled: false, progress: true });
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

Deno.test('an ordinary refusal is warn-tint and offers no retry', () => {
  const r = p({ kind: 'refused', reason: 'symbol_owned', retryable: false });
  assertEquals(r.messageTone, 'warn');
  assertEquals(r.footer, null);
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
