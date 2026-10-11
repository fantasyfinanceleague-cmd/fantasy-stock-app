/**
 * Giorgio, 2026-10-09: "i can only sell what i have... cant sell what you
 * dont own." A stock you don't hold must offer NO Sell path at all -- not a
 * disabled one -- from the stock sheet. stockSheetModel.ts already computed
 * `sell.enabled = held && sellReason === null` correctly; the bug was purely
 * in StockSheetBody.tsx, which still let the Buy | Sell SegmentedControl
 * select 'sell' on an unheld stock (showing a disabled button with a
 * "not held" reason instead of removing the option entirely). This is a
 * source guard, the established pattern for RN components in this suite.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import stockSheetBodySrc from '../components/money/StockSheetBody.tsx' with { type: 'text' };

Deno.test('wiring: `selected` ignores `choice` entirely when not held, not just defaulting to buy', () => {
  assertEquals(stockSheetBodySrc.includes("const held = data.facts.held != null;"), true);
  assertEquals(stockSheetBodySrc.includes("const selected = held ? (choice ?? model.selected) : 'buy';"), true);
});

Deno.test('wiring: the Buy | Sell SegmentedControl is gated on `held`, not rendered unconditionally', () => {
  // The control sits inside a `{held ? ( ... ) : null}` guard right before
  // its own JSX -- confirm the gate wraps the SegmentedControl, not some
  // unrelated held-conditional elsewhere in the file.
  const controlIndex = stockSheetBodySrc.indexOf('<SegmentedControl');
  const gateIndex = stockSheetBodySrc.lastIndexOf('{held ? (', controlIndex);
  assertEquals(controlIndex > 0, true, 'SegmentedControl must still exist');
  assertEquals(gateIndex > 0 && gateIndex < controlIndex, true, 'the `held` gate must immediately precede the SegmentedControl');
  // Nothing non-whitespace/comment sits between the gate and the control.
  const between = stockSheetBodySrc.slice(gateIndex + '{held ? ('.length, controlIndex);
  assertEquals(/^\s*$/.test(between), true, `expected only whitespace between the gate and the control, got: ${JSON.stringify(between)}`);
});

Deno.test('wiring: openReview\'s only user-triggered call site passes `selected`, which is \'buy\' when not held', () => {
  // The Review button is the sole UI-triggered entry point into a sell
  // (openReview('buy', id) elsewhere is the SalePicker flow, always 'buy';
  // the retry button reuses `open.kind`, whatever a prior openReview call
  // already set -- neither can introduce a NEW sell intent on their own).
  assertEquals(stockSheetBodySrc.includes('onPress={() => openReview(selected)}'), true);
  const sellCallSites = (stockSheetBodySrc.match(/openReview\('sell'/g) ?? []).length;
  assertEquals(sellCallSites, 0, 'no call site should hardcode a sell kind -- it must only ever flow through `selected`');
});
