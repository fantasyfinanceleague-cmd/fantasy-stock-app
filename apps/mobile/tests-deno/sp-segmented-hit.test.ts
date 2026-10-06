/**
 * The segmented control's hit area (§9B): each segment reaches 44 pt through a
 * vertical hitSlop = (44 - height)/2, the visual height stays, and an unmeasured
 * height gives no slop (never a guess). Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { segmentHitSlop, MIN_HIT_PT } from '../components/sp/logic/segmentedHit.ts';

Deno.test('a 34 pt segment reaches 44 pt with 5 pt of slop above and below', () => {
  assertEquals(segmentHitSlop(34), { top: 5, bottom: 5 });
  assertEquals(34 + 5 + 5, MIN_HIT_PT);
});

Deno.test('a 40 pt segment (Buy/Sell) reaches 44 pt with 2 pt of slop each side', () => {
  assertEquals(segmentHitSlop(40), { top: 2, bottom: 2 });
});

Deno.test('a segment already 44 pt or taller gets no slop', () => {
  assertEquals(segmentHitSlop(44), { top: 0, bottom: 0 });
  assertEquals(segmentHitSlop(52), { top: 0, bottom: 0 });
});

Deno.test('an unmeasured height gives no slop, never a guessed one', () => {
  assertEquals(segmentHitSlop(0), { top: 0, bottom: 0 });
});
