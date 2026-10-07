/**
 * ScoreDigits (ThisWeekCard-overlap follow-up, 2026-10-07): the row's own
 * flexShrink bounds the ROW's box, but without each individual COLUMN also
 * being shrinkable, Yoga gives every column its natural/intrinsic width
 * regardless -- the row ends up correctly sized while its children overflow
 * past it unconstrained. Verified live on the 17e: two ScoreDigits rows
 * (ThisWeekCard's "You" / opponent scores) still overlapped at $1M+ even
 * after their containers were fixed to a real 50/50 split, until each
 * column itself got `flexShrink: 1`.
 * Run: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import scoreDigitsSrc from '../components/sp/game/ScoreDigits.tsx' with { type: 'text' };

Deno.test('wiring: each DigitColumn has flexShrink: 1, so a squeezed row actually squeezes its digits', () => {
  assertEquals(/column:\s*\{\s*flexShrink:\s*1\s*\}/.test(scoreDigitsSrc), true);
  assertEquals(scoreDigitsSrc.includes('styles.column'), true);
});
