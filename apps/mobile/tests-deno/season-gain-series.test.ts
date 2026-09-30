/**
 * Tests for lib/home/seasonGainSeries.ts — Home's "Season gain, week by
 * week" chart (D1, Concept A). Run: `cd apps/mobile/tests-deno && deno test .`
 *
 * NO COSMETIC RAMP (Orchestrator ruling, 2026-09-30): a past, scored week
 * is exactly one real point; only the live week gets per-day granularity.
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import {
  buildSeasonGainSeries,
  windowSeries,
  type SeasonWeekInput,
} from '../lib/home/seasonGainSeries.ts';
import type { LiveSnapshot, LiveTrade } from '../lib/home/liveWeekScore.ts';

function pastWeek(weekNum: number, scoredGain: number, weekStart: string, weekEnd: string): SeasonWeekInput {
  return { week: weekNum, scoredGain, weekStart, weekEnd, snapshots: [], trades: [] as LiveTrade[], tradingDays: [] };
}

function liveWeek(
  weekNum: number,
  weekStart: string,
  weekEnd: string,
  tradingDays: string[],
  snapshots: LiveSnapshot[] = [],
  trades: LiveTrade[] = [],
): SeasonWeekInput {
  return { week: weekNum, scoredGain: null, weekStart, weekEnd, snapshots, trades, tradingDays };
}

Deno.test('the series opens with a real Week-1 0-point, before anything has happened', () => {
  const result = buildSeasonGainSeries({
    weeks: [pastWeek(1, 41.3, '2026-08-03', '2026-08-07')],
    closesByDate: {},
    live: null,
  });
  assertEquals(result.points[0], { date: '2026-08-03', week: 1, gain: 0, kind: 'weekly', dayIndex: 0 });
});

Deno.test('a past, scored week is exactly ONE point — no per-day ramp, no synthetic interpolation', () => {
  const result = buildSeasonGainSeries({
    weeks: [pastWeek(1, 100, '2026-08-03', '2026-08-07')],
    closesByDate: {},
    live: null,
  });
  // The opening 0-point, plus this week's own one Friday point. Nothing else.
  assertEquals(result.points.length, 2);
  assertEquals(result.points[1], { date: '2026-08-07', week: 1, gain: 100, kind: 'weekly', dayIndex: 4 });
});

Deno.test('several past weeks each contribute exactly one point, cumulative, at their own weekEnd', () => {
  const weeks = [
    pastWeek(1, 41.3, '2026-08-03', '2026-08-07'),
    pastWeek(2, 58.75, '2026-08-10', '2026-08-14'),
    pastWeek(3, -96.4, '2026-08-17', '2026-08-21'),
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: null });
  assertEquals(result.points.map((p) => p.kind), ['weekly', 'weekly', 'weekly', 'weekly']); // anchor + 3 weeks
  assertAlmostEquals(result.points[1].gain, 41.3, 1e-9);
  assertAlmostEquals(result.points[2].gain, 41.3 + 58.75, 1e-9);
  assertAlmostEquals(result.points[3].gain, 41.3 + 58.75 - 96.4, 1e-9);
  assertEquals(result.points.map((p) => p.date), ['2026-08-03', '2026-08-07', '2026-08-14', '2026-08-21']);
});

Deno.test('a bye week (scoredGain 0) is flat: its one point equals the running total unchanged', () => {
  const weeks = [
    pastWeek(1, 50, '2026-08-03', '2026-08-07'),
    pastWeek(2, 0, '2026-08-10', '2026-08-14'), // bye
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: null });
  const week2Point = result.points.find((p) => p.week === 2)!;
  assertEquals(week2Point.gain, 50);
});

Deno.test('the live week gets real per-day points, tagged "daily", never collapsed to one', () => {
  const snaps: LiveSnapshot[] = [{ symbol: 'NVDA', quantity: 10, weekStartPrice: 300.2, enteredMidWeek: false }];
  const weeks = [liveWeek(1, '2026-08-03', '2026-08-07', ['2026-08-03', '2026-08-04'], snaps, [])];
  const result = buildSeasonGainSeries({
    weeks,
    closesByDate: { '2026-08-03': { NVDA: 305 }, '2026-08-04': { NVDA: 310 } },
    live: { gain: 79.8 },
  });
  // Anchor (weekly) + 2 daily points for the live week.
  assertEquals(result.points.map((p) => p.kind), ['weekly', 'daily', 'daily']);
  assertAlmostEquals(result.points[1].gain, 10 * (305 - 300.2), 1e-9);
  assertEquals(result.points[2].gain, 79.8); // pinned to live.gain, the caller's own number
});

Deno.test('endpoint = hero: the last point equals sum(scored weeks) + live.gain exactly', () => {
  const weeks = [
    pastWeek(1, 41.3, '2026-08-03', '2026-08-07'),
    pastWeek(2, 58.75, '2026-08-10', '2026-08-14'),
    pastWeek(3, -96.4, '2026-08-17', '2026-08-21'),
    pastWeek(4, 72.1, '2026-08-24', '2026-08-28'),
    pastWeek(5, 54.24, '2026-08-31', '2026-09-04'),
    liveWeek(6, '2026-09-21', '2026-09-25', ['2026-09-24'], [{ symbol: 'NVDA', quantity: 10, weekStartPrice: 300.2, enteredMidWeek: false }], []),
  ];
  const liveGain = 238.6;
  const result = buildSeasonGainSeries({
    weeks,
    closesByDate: { '2026-09-24': { NVDA: 999 } }, // irrelevant: the last day is forced by `live`
    live: { gain: liveGain },
  });
  const scoredSum = 41.3 + 58.75 - 96.4 + 72.1 + 54.24;
  const endpoint = result.points[result.points.length - 1].gain;
  assertEquals(endpoint, scoredSum + liveGain);
});

Deno.test('1W endpoint equals the this-week score (liveWeekScore), rebased to 0 at Monday open', () => {
  const weeks = [
    pastWeek(1, 41.3, '2026-08-03', '2026-08-07'),
    liveWeek(6, '2026-09-21', '2026-09-25', ['2026-09-21', '2026-09-22'], [], []),
  ];
  const liveGain = 238.6;
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: liveGain } });
  const win = windowSeries(result, '1W', 1); // week index 1 = week 6
  assertEquals(win[win.length - 1].gain, liveGain);
});

Deno.test('1M window is cut by CALENDAR DATE, not point count — a point count no longer equals a day count', () => {
  // 5 past weeks plus a live week, with explicit, unambiguous ascending
  // dates so the 30-day cutoff is easy to reason about exactly.
  const explicit: SeasonWeekInput[] = [
    pastWeek(1, 10, '2026-07-06', '2026-07-06'),
    pastWeek(2, 10, '2026-07-13', '2026-07-13'),
    pastWeek(3, 10, '2026-07-20', '2026-07-20'),
    pastWeek(4, 10, '2026-07-27', '2026-07-27'),
    pastWeek(5, 10, '2026-08-03', '2026-08-03'),
    liveWeek(6, '2026-08-31', '2026-09-04', ['2026-09-01', '2026-09-02']),
  ];
  const result = buildSeasonGainSeries({ weeks: explicit, closesByDate: {}, live: { gain: 5 } });
  const win = windowSeries(result, '1M', 5);
  // The last point is 2026-09-02; a 30-day cutoff excludes everything at
  // or before 2026-07-27 (more than 30 days earlier) and keeps
  // 2026-08-03 onward.
  assertEquals(win.every((p) => p.date >= '2026-08-03'), true);
  assertEquals(win.some((p) => p.date === '2026-07-06'), false);
});

Deno.test('1M window is rebased to 0 at its own first (real) point', () => {
  const weeks = [
    pastWeek(1, 100, '2026-08-03', '2026-08-07'),
    liveWeek(2, '2026-08-10', '2026-08-14', ['2026-08-10', '2026-08-11']),
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: 20 } });
  const win = windowSeries(result, '1M', 1);
  assertEquals(win[0].gain, 0);
});

Deno.test('data.js ROBERTO_WEEKS reproduce throughW5 = 129.99', () => {
  const weeks = [
    pastWeek(1, 41.3, '2026-08-03', '2026-08-07'),
    pastWeek(2, 58.75, '2026-08-10', '2026-08-14'),
    pastWeek(3, -96.4, '2026-08-17', '2026-08-21'),
    pastWeek(4, 72.1, '2026-08-24', '2026-08-28'),
    pastWeek(5, 54.24, '2026-08-31', '2026-09-04'),
    liveWeek(6, '2026-09-21', '2026-09-25', []),
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: 0 } });
  assertAlmostEquals(result.weekBase[5], 129.99, 1e-9);
});

// ── Time-proportional x-axis (Design Lead ruling, 2026-09-30) ──────────────

Deno.test('dayIndex: past-week points are 5 day-units apart; live-week days are 1 unit apart', () => {
  const weeks = [
    pastWeek(1, 41.3, '2026-08-03', '2026-08-07'),
    pastWeek(2, 58.75, '2026-08-10', '2026-08-14'),
    pastWeek(3, -96.4, '2026-08-17', '2026-08-21'),
    pastWeek(4, 72.1, '2026-08-24', '2026-08-28'),
    pastWeek(5, 54.24, '2026-08-31', '2026-09-04'),
    liveWeek(6, '2026-09-21', '2026-09-25', ['2026-09-21', '2026-09-22', '2026-09-23']), // Mon/Tue/Wed
  ];
  const result = buildSeasonGainSeries({ weeks, closesByDate: {}, live: { gain: 10 } });
  // Anchor (week 1 open) + 5 past-week Fridays + 3 live days = 9 points.
  assertEquals(result.points.length, 9);
  // Anchor at day 0 (week 1's Monday); week 1's own Friday at day 4 (a
  // 4-unit gap WITHIN week 1, Mon->Fri); each subsequent past week's
  // Friday exactly 5 day-units after the previous week's Friday.
  const pastWeekDayIndexes = result.points.slice(0, 6).map((p) => p.dayIndex);
  assertEquals(pastWeekDayIndexes, [0, 4, 9, 14, 19, 24]);
  const fridayIndexes = pastWeekDayIndexes.slice(1); // exclude the anchor
  for (let i = 1; i < fridayIndexes.length; i++) {
    assertEquals(fridayIndexes[i] - fridayIndexes[i - 1], 5);
  }
  // The live week (array index 5) starts its day slots at 5*5=25: Monday
  // (offset 0) -> 25, Tuesday (offset 1) -> 26, Wednesday (offset 2) -> 27.
  const liveDayIndexes = result.points.slice(6).map((p) => p.dayIndex);
  assertEquals(liveDayIndexes, [25, 26, 27]);
  assertEquals(liveDayIndexes[1] - liveDayIndexes[0], 1);
  assertEquals(liveDayIndexes[2] - liveDayIndexes[1], 1);
});
