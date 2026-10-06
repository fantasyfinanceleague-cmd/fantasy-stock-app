/**
 * bestScoredWeek (B5, Design Lead gate 2026-10-05): the best week is the
 * highest FINAL gain, ties to the earlier week, and the XL/standard
 * fixtures derive it from scored results -- never from the live score.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { bestScoredWeek } from '../lib/home/bestWeek.ts';
import { ROBERTO_HOLDINGS, ROBERTO_WEEKS, fixtureQty, fixtureScoredWeeks } from '../lib/home/homeFixtureData.ts';

Deno.test('bestScoredWeek: picks the highest gain', () => {
  assertEquals(bestScoredWeek([{ week: 1, gain: 41.3 }, { week: 2, gain: 58.75 }, { week: 3, gain: -96.4 }]), { week: 2, gain: 58.75 });
});

Deno.test('bestScoredWeek: ties go to the earlier week (get_season_result ORDER BY week_number asc)', () => {
  assertEquals(bestScoredWeek([{ week: 4, gain: 100 }, { week: 2, gain: 100 }]), { week: 2, gain: 100 });
});

Deno.test('bestScoredWeek: no scored weeks -> null, never a fabricated week', () => {
  assertEquals(bestScoredWeek([]), null);
});

Deno.test('bestScoredWeek: an all-negative season still names its least-bad week', () => {
  assertEquals(bestScoredWeek([{ week: 1, gain: -5 }, { week: 2, gain: -2 }]), { week: 2, gain: -2 });
});

Deno.test('fixtureScoredWeeks: week 6 is its FINAL (Friday) gain, and the best week is 6 at +$351.79', () => {
  const week6 = Math.round(ROBERTO_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.fri - h.mon), 0) * 100) / 100;
  assertEquals(week6, 351.79);
  assertEquals(fixtureScoredWeeks().length, ROBERTO_WEEKS.length + 1);
  assertEquals(bestScoredWeek(fixtureScoredWeeks()), { week: 6, gain: 351.79 });
});
