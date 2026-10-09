/**
 * C-5 (Design Lead gate, U-33): no_price and invalid_price get a way to
 * retry, the same as calendar_unavailable already has. StockSheetBody.tsx
 * is a React Native component and isn't Deno-testable directly; this is a
 * source guard, the established pattern in this suite.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import stockSheetBodySrc from '../components/money/StockSheetBody.tsx' with { type: 'text' };

Deno.test('wiring: the no-price display offers Try again, wired to a fresh read', () => {
  assertEquals(stockSheetBodySrc.includes('onPress={data.refresh}'), true);
  assertEquals(stockSheetBodySrc.includes('{COPY.noPrice} '), true);
});

Deno.test("wiring: a no_price/invalid_price review refusal offers Try again, not just Edit", () => {
  assertEquals(stockSheetBodySrc.includes('open.error === COPY.noPrice || open.error === COPY.invalidPrice'), true);
  assertEquals(stockSheetBodySrc.includes('data.refresh(); void openReview(open.kind);'), true);
});
