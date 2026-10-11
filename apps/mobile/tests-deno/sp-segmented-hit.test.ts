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

// ── The indicator's segment width follows the CURRENT option count ─────────────

import { segmentWidthFor } from '../components/sp/logic/segmentedHit.ts';
import { SOURCES as SEG_SOURCES } from './sourceManifest.generated.ts';

Deno.test('a segment is the inner width over the current count (3 → 4 options moves the indicator inside the track)', () => {
  assertEquals(segmentWidthFor(334, 2, 3), 110);
  assertEquals(segmentWidthFor(334, 2, 4), 82.5);
  // The 4th segment (index 3) of a 4-option track ends at the track's inner edge, never past it.
  assertEquals(3 * segmentWidthFor(334, 2, 4) + segmentWidthFor(334, 2, 4), 330);
  assertEquals(segmentWidthFor(0, 2, 3), 0); // not measured yet
  assertEquals(segmentWidthFor(334, 2, 0), 0);
  const src = SEG_SOURCES['components/sp/SegmentedControl.tsx'];
  assertEquals(src.includes('const segmentWidth = segmentWidthFor(trackWidth, TRACK_PADDING, options.length);'), true);
  assertEquals(src.includes('setSegmentWidth('), false); // never stored from the last layout
});
