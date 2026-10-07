/**
 * X-1 fix (Design Lead final check, 2026-10-07): pure fit-to-container
 * scale math for <RollingMoney>. Run: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { fitScale, FIT_MIN_SCALE } from '../components/sp/logic/fitScale.ts';
import rollingMoneySrc from '../components/home/RollingMoney.tsx' with { type: 'text' };

Deno.test('fitScale: content that already fits renders at 1, never upscaled', () => {
  assertEquals(fitScale(320, 200), 1);
  assertEquals(fitScale(320, 320), 1);
});

Deno.test('fitScale: content wider than its container shrinks by the exact ratio', () => {
  assertEquals(fitScale(240, 300), 0.8);
  assertEquals(fitScale(280, 350), 0.8);
});

Deno.test('fitScale: the ratio is floored at 0.7, never smaller, so it never reads as illegible', () => {
  assertEquals(fitScale(100, 1000), FIT_MIN_SCALE);
  assertEquals(fitScale(1, 1000), FIT_MIN_SCALE);
});

Deno.test('fitScale: unmeasured dimensions (null, before the first layout pass) render at 1', () => {
  assertEquals(fitScale(null, 300), 1);
  assertEquals(fitScale(300, null), 1);
  assertEquals(fitScale(null, null), 1);
});

Deno.test('fitScale: a zero or negative natural width never divides by zero', () => {
  assertEquals(fitScale(300, 0), 1);
  assertEquals(fitScale(300, -10), 1);
});

// The X-1 report itself: "$14,446,031.99" (14 characters) at the `display`
// variant's XL-capped size (fontSize 32 * maxScale 1.6 = 51.2px) clips its
// last digit in a card whose inner width is narrower than the row's natural
// width. These numbers are illustrative measured widths at that scale, not
// exact font metrics (Deno has no RN text layout) -- they exercise the same
// shape of failure the capture showed: a natural width that overflows a
// real card, needing a shrink that stays within the 0.7 floor.
Deno.test('fitScale: the X-1 case ($14,446,031.99 at XL) shrinks to fit without hitting the floor', () => {
  const containerWidth = 320; // a card's inner width at XL text, 17e
  const naturalWidth = 343; // the 14-character row's unscaled width at the capped XL size
  const scale = fitScale(containerWidth, naturalWidth);
  assertEquals(scale > FIT_MIN_SCALE && scale < 1, true, `expected a shrink within (0.7, 1), got ${scale}`);
  assertEquals(Math.round(scale * naturalWidth * 100) / 100 <= containerWidth, true, 'scaled width must fit the container');
});

Deno.test('fitScale: an even wider XL value (still realistic) can bottom out at the 0.7 floor and report it', () => {
  const containerWidth = 280; // a narrower card
  const naturalWidth = 420; // a longer value, e.g. $123,456,789.00 at the same XL size
  const scale = fitScale(containerWidth, naturalWidth);
  assertEquals(scale, FIT_MIN_SCALE);
  // Scaled, it is STILL wider than the container -- the floor prefers a
  // readable, slightly-overflowing row to an illegible one, never a clip.
  assertEquals(naturalWidth * scale > containerWidth, true);
});

Deno.test('wiring: RollingMoney measures its container and its natural row width, and scales with fitScale', () => {
  assertEquals(rollingMoneySrc.includes("from '@/components/sp/logic/fitScale'"), true);
  assertEquals(rollingMoneySrc.includes('fitScale('), true);
  // Two onLayout call sites: the outer container and the inner (natural) row.
  const onLayoutCount = (rollingMoneySrc.match(/onLayout=/g) ?? []).length;
  assertEquals(onLayoutCount >= 2, true);
  assertEquals(rollingMoneySrc.includes('transformOrigin'), true);
});
