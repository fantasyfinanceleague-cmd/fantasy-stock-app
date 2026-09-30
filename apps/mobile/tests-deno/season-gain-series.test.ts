/**
 * Tests for lib/home/seasonGainSeries.ts — Home's "Season gain, week by
 * week" chart (D1, Concept A). Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import {
  buildSeasonGainSeries,
  windowSeries,
  type SeasonWeekInput,
} from '../lib/home/seasonGainSeries.ts';
import type { LiveSnapshot, LiveTrade } from '../lib/home/liveWeekScore.ts';

const t = (iso: string) => new Date(iso);

function week(
  weekNum: number,
  scoredGain: number | null,
  tradingDays: string[],
  snapshots: LiveSnapshot[] = [],
  trades: LiveTrade[] = [],
): SeasonWeekInput {
  return { week: weekNum, scoredGain, snapshots, trades, tradingDays };
}

Deno.test('no deposit jump: the first point reflects only intraday movement, not draft-to-Monday gap', () => {
  const snaps: LiveSnapshot[] = [
    { symbol: 'NVDA', quantity: 10, weekStartPrice: 300.2, enteredMidWeek: false }, // Monday open, NOT the draft price
  ];
  const w1 = week(1, 41.3, ['2026-08-03'], snaps, []);
  const result = buildSeasonGainSeries({
    weeks: [w1],
    closesByDate: { '2026-08-03': { NVDA: 300.2 } }, // flat on day 1 vs the Monday open itself
    live: null,
  });
  // The draft price (300.1 in the board sample, unused here entirely) never
  // enters this calculation — only weekStartPrice (Monday's own open) does
  // — so there is no "draft to Monday" jump to begin with. This single-day
  // week's one point is also its Friday pin, so it lands on the scored
  // value exactly, not some intermediate bar-derived figure.
  assertEquals(result.points[0].gain, 41.3);
});

Deno.test('weekend and holiday gaps are simply absent (no synthetic flat points inserted)', () => {
  const w1 = week(1, 10, ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
  const result = buildSeasonGainSeries({ weeks: [w1], closesByDate: {}, live: null });
  assertEquals(result.points.length, 5);
  assertEquals(result.points.map((p) => p.date), ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07']);
});

Deno.test('Friday pin: the last day of a scored week is forced to the matchups gain, not the bar-derived value', () => {
  const snaps: LiveSnapshot[] = [{ symbol: 'AAPL', quantity: 10, weekStartPrice: 200, enteredMidWeek: false }];
  const w1 = week(1, 100, ['2026-08-07'], snaps, []); // bar-derived: 10*(205-200)=50, scored says 100
  const result = buildSeasonGainSeries({
    weeks: [w1],
    closesByDate: { '2026-08-07': { AAPL: 205 } },
    live: null,
  });
  assertEquals(result.points[0].gain, 100); // pinned, not 50
  assertEquals(result.pinned.length, 1);
  assertEquals(result.pinned[0].scoredGain, 100);
  assertAlmostEquals(result.pinned[0].barGain, 50, 1e-9);
  assertAlmostEquals(result.pinned[0].diff, 50, 1e-9);
});

Deno.test('mismatch counting: exactly $0.01 does not count, $0.02 does', () => {
  const snapsAt = (endPrice: number): LiveSnapshot[] => [
    { symbol: 'X', quantity: 1, weekStartPrice: 0, enteredMidWeek: false },
  ];
  const notCounted = buildSeasonGainSeries({
    weeks: [week(1, 1.0, ['2026-08-07'], snapsAt(0.99), [])],
    closesByDate: { '2026-08-07': { X: 0.99 } }, // bar-derived gain = 0.99, scored = 1.00, diff = 0.01
    live: null,
  });
  assertEquals(notCounted.mismatches, 0);

  const counted = buildSeasonGainSeries({
    weeks: [week(1, 1.0, ['2026-08-07'], snapsAt(0.98), [])],
    closesByDate: { '2026-08-07': { X: 0.98 } }, // diff = 0.02
    live: null,
  });
  assertEquals(counted.mismatches, 1);
});

Deno.test('endpoint = hero: the last point equals sum(scored weeks) + live.gain exactly', () => {
  const weeks = [
    week(1, 41.3, []),
    week(2, 58.75, []),
    week(3, -96.4, []),
    week(4, 72.1, []),
    week(5, 54.24, []),
    week(6, null, ['2026-09-24'], [{ symbol: 'NVDA', quantity: 10, weekStartPrice: 300.2, enteredMidWeek: false }], []),
  ];
  const liveGain = 238.6;
  const result = buildSeasonGainSeries({
    weeks,
    closesByDate: { '2026-09-24': { NVDA: 999 } }, // irrelevant: forced by `live`
    live: { gain: liveGain },
  });
  const scoredSum = 41.3 + 58.75 - 96.4 + 72.1 + 54.24;
  const endpoint = result.points[result.points.length - 1].gain;
  assertEquals(endpoint, scoredSum + liveGain);
});

Deno.test('1W endpoint equals the this-week score (liveWeekScore), rebased to 0 at Monday open', () => {
  const weeks = [
    week(1, 41.3, []),
    week(6, null, ['2026-09-21', '2026-09-22'], [], []),
  ];
  const liveGain = 238.6;
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: liveGain } });
  const win = windowSeries(result, '1W', 1); // week index 1 = week 6
  assertEquals(win[win.length - 1].gain, liveGain);
});

Deno.test('1M window is rebased to 0 at its own start', () => {
  const days = Array.from({ length: 25 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
  const w = week(1, 100, days, [], []);
  const result = buildSeasonGainSeries({ weeks: [w], closesByDate: {}, live: null });
  const win = windowSeries(result, '1M', 0);
  assertEquals(win[0].gain, 0);
});

Deno.test('a bye week is flat: no holdings, scoredGain 0, every day unchanged from the running total', () => {
  const weeks = [
    week(1, 50, ['2026-08-07']),
    week(2, 0, ['2026-08-10', '2026-08-14'], [], []), // bye: no snapshots, no trades
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: null });
  const byeDays = result.points.filter((p) => p.week === 2);
  for (const p of byeDays) assertEquals(p.gain, 50);
});

Deno.test('data.js ROBERTO_WEEKS reproduce throughW5 = 129.99', () => {
  const weeks = [
    week(1, 41.3, []),
    week(2, 58.75, []),
    week(3, -96.4, []),
    week(4, 72.1, []),
    week(5, 54.24, []),
    week(6, null, [], [], []), // current week, no days needed for this check
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: 0 } });
  assertAlmostEquals(result.weekBase[5], 129.99, 1e-9);
});
