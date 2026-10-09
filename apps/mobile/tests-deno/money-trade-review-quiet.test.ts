/**
 * C-1 (Design Lead gate, U-14's trade half): no foreground banner over an
 * open trade review. TradeReviewPanel.tsx is a React Native component (JSX,
 * Reanimated) and isn't Deno-testable directly, so this is a source guard on
 * its wiring, the same pattern foreground-quiet-lib.test.ts uses for
 * notifications.ts's handler.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import panelSrc from '../components/money/TradeReviewPanel.tsx' with { type: 'text' };

Deno.test("wiring: TradeReviewPanel sets 'trade_review' quiet on mount, clears it on unmount", () => {
  assertEquals(panelSrc.includes("setForegroundQuiet('trade_review', true)"), true);
  assertEquals(panelSrc.includes("setForegroundQuiet('trade_review', false)"), true);
  // The clear must be the effect's cleanup (covers Back, Done AND unmount in
  // one place, since the panel is conditionally mounted), not a one-shot.
  assertEquals(/return \(\) => setForegroundQuiet\('trade_review', false\)/.test(panelSrc), true);
});
