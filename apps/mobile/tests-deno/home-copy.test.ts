/**
 * Tests for lib/home/homeCopy.ts's unpriced-symbol captions (Design Lead
 * ruling, 2026-09-29, code review finding I12): reuse plCoverage.ts's
 * `unpricedNote` wording rather than authoring new copy for the hero and
 * ThisWeekCard captions.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { heroUnpricedCaption, sideUnpricedCaption, seasonScrubLabel, heroAccessibilityLabel, heroWeekOrRoundLabel, standingsThroughWeek, preSeasonStartsLabel } from '../lib/home/homeCopy.ts';

Deno.test('heroUnpricedCaption: null when both lists are empty', () => {
  assertEquals(heroUnpricedCaption([], []), null);
});

Deno.test('heroUnpricedCaption: singular wording for exactly one symbol', () => {
  assertEquals(heroUnpricedCaption(['ZZZZ'], []), '1 holding counted at cost (no live price yet)');
});

Deno.test('heroUnpricedCaption: counts DISTINCT symbols across unpricedValue and unpricedToday, not the sum', () => {
  // ZZZZ appears in both lists (missing a live price affects both the
  // value and the today segment) -- it must count once, not twice.
  assertEquals(heroUnpricedCaption(['ZZZZ'], ['ZZZZ']), '1 holding counted at cost (no live price yet)');
  assertEquals(heroUnpricedCaption(['ZZZZ'], ['AAAA']), '2 holdings counted at cost (no live price yet)');
});

Deno.test('heroUnpricedCaption: case-insensitive de-duplication', () => {
  assertEquals(heroUnpricedCaption(['zzzz'], ['ZZZZ']), '1 holding counted at cost (no live price yet)');
});

Deno.test('sideUnpricedCaption: null when that side has nothing unpriced', () => {
  assertEquals(sideUnpricedCaption('You', []), null);
});

Deno.test('sideUnpricedCaption: prefixes the formatted note with the side\'s name', () => {
  assertEquals(sideUnpricedCaption('You', ['ZZZZ']), 'You: 1 holding counted at cost (no live price yet)');
  assertEquals(sideUnpricedCaption('Gianluigi B.', ['ZZZZ', 'AAAA']), 'Gianluigi B.: 2 holdings counted at cost (no live price yet)');
});

Deno.test('sideUnpricedCaption: de-duplicates case-insensitively, same as the hero caption', () => {
  assertEquals(sideUnpricedCaption('You', ['zzzz', 'ZZZZ']), 'You: 1 holding counted at cost (no live price yet)');
});

// ── Season chart scrub label (Orchestrator ruling, 2026-09-30) ─────────────

Deno.test('seasonScrubLabel: a weekly point reads "Week N" with that WEEK\'S OWN delta, never the cumulative', () => {
  const point = { date: '2026-08-14', week: 2, gain: 100.09, kind: 'weekly' as const };
  const label = seasonScrubLabel(point, 41.34); // previous point (week 1) was 41.34
  assertEquals(label.primary, 'Week 2');
  assertEquals(label.money, '+$58.75'); // 100.09 - 41.34, not 100.09
});

Deno.test('seasonScrubLabel: the Week-1-open anchor (no previous point) reads a $0.00 delta', () => {
  const point = { date: '2026-08-03', week: 1, gain: 0, kind: 'weekly' as const };
  const label = seasonScrubLabel(point, null);
  assertEquals(label.primary, 'Week 1');
  assertEquals(label.money, '$0.00');
});

Deno.test('seasonScrubLabel: a daily point shows a FORMATTED date (never the raw ISO string) and the cumulative gain', () => {
  const point = { date: '2026-09-22', week: 6, gain: 118.2, kind: 'daily' as const };
  const label = seasonScrubLabel(point, 50);
  assertEquals(label.primary, 'Tue, Sep 22');
  assertEquals(label.money, '+$118.20'); // cumulative, unlike a weekly point's delta
});

// ── Hero VoiceOver label (Design Lead ruling, 2026-09-29, Blocking 2) ──────

Deno.test('heroAccessibilityLabel: joins value, gain, today and the caption into ONE sentence-by-sentence label', () => {
  const label = heroAccessibilityLabel('$12,343.59', '+$343.59', '+2.86%', '+$121.26', '1 holding counted at cost (no live price yet)');
  assertEquals(
    label,
    'Your team, $12,343.59. +$343.59, +2.86% season gain. +$121.26 today. 1 holding counted at cost (no live price yet)',
  );
});

Deno.test('heroAccessibilityLabel: omits the today sentence entirely when today is null (non-trading day)', () => {
  const label = heroAccessibilityLabel('$12,343.59', '+$343.59', '+2.86%', null, null);
  assertEquals(label, 'Your team, $12,343.59. +$343.59, +2.86% season gain.');
});

// ── Hero meta row's week/round segment (Design Lead ruling, 2026-09-30) ────

Deno.test('heroWeekOrRoundLabel: pre_season always reads "Week 1 of M"', () => {
  assertEquals(heroWeekOrRoundLabel({ kind: 'pre_season', seasonStartsAt: null, numWeeks: 14 }), 'Week 1 of 14');
});

Deno.test('heroWeekOrRoundLabel: a regular-season bye reads "Week N of M"', () => {
  assertEquals(heroWeekOrRoundLabel({ kind: 'bye', week: 7, nextStart: null, numWeeks: 14 }), 'Week 7 of 14');
});

Deno.test('heroWeekOrRoundLabel: a regular-season live week reads "Week N of M"', () => {
  assertEquals(
    heroWeekOrRoundLabel({ kind: 'live_open', week: 6, isPlayoff: false, round: null, weekEnd: '2026-09-25T20:00:00.000Z', numWeeks: 14 }),
    'Week 6 of 14',
  );
});

Deno.test('heroWeekOrRoundLabel: a PLAYOFF live week reads the round name, never "Week N of M"', () => {
  assertEquals(
    heroWeekOrRoundLabel({ kind: 'live_open', week: 15, isPlayoff: true, round: 'Semifinals', weekEnd: '2026-12-18T20:00:00.000Z', numWeeks: 14 }),
    'Semifinals',
  );
});

Deno.test('heroWeekOrRoundLabel: playoff_bye and eliminated read the round name', () => {
  assertEquals(heroWeekOrRoundLabel({ kind: 'playoff_bye', week: 16, round: 'Semifinals', numWeeks: 14 }), 'Semifinals');
  assertEquals(heroWeekOrRoundLabel({ kind: 'eliminated', round: 'Wild Card', numWeeks: 14 }), 'Wild Card');
});

Deno.test('heroWeekOrRoundLabel: missed_playoffs and complete drop the segment entirely (null)', () => {
  assertEquals(heroWeekOrRoundLabel({ kind: 'missed_playoffs', numWeeks: 14 }), null);
  assertEquals(heroWeekOrRoundLabel({ kind: 'complete', numWeeks: 14 }), null);
});

// ── standingsThroughWeek (Design Lead ruling, 2026-09-30, B2) ──────────────

Deno.test('standingsThroughWeek: a regular-season live week reads "week - 1"', () => {
  assertEquals(standingsThroughWeek({ kind: 'live_open', week: 6, isPlayoff: false, round: null, weekEnd: '2026-09-25T20:00:00.000Z', numWeeks: 14 }), 5);
});

Deno.test('standingsThroughWeek: a regular-season scored/bye week also reads "week - 1"', () => {
  assertEquals(standingsThroughWeek({ kind: 'scored', week: 4, won: true, isPlayoff: false, round: null, nextStart: null, numWeeks: 14 }), 3);
  assertEquals(standingsThroughWeek({ kind: 'bye', week: 3, nextStart: null, numWeeks: 14 }), 2);
});

Deno.test('standingsThroughWeek: any playoff-family state reads the full numWeeks, never a playoff week number minus one', () => {
  assertEquals(standingsThroughWeek({ kind: 'playoff_bye', week: 16, round: 'Semifinals', numWeeks: 14 }), 14);
  assertEquals(standingsThroughWeek({ kind: 'eliminated', round: 'Wild Card', numWeeks: 14 }), 14);
  assertEquals(standingsThroughWeek({ kind: 'missed_playoffs', numWeeks: 14 }), 14);
  assertEquals(standingsThroughWeek({ kind: 'playoff_pending', week: 16, round: 'Final', previousRound: 'Semifinals', numWeeks: 14 }), 14);
  // A live/scored playoff week reads numWeeks too, never "week - 1" (which
  // would read "Through Week 15" for a week-16 row -- Design Lead's exact
  // regression, capture 13).
  assertEquals(standingsThroughWeek({ kind: 'live_open', week: 16, isPlayoff: true, round: 'Final', weekEnd: '2026-12-25T21:00:00.000Z', numWeeks: 14 }), 14);
});

Deno.test('standingsThroughWeek: never negative (a bogus week 0 clamps to 0, not -1)', () => {
  assertEquals(standingsThroughWeek({ kind: 'bye', week: 0, nextStart: null, numWeeks: 14 }), 0);
});

// ── preSeasonStartsLabel (Design Lead ruling, 2026-09-30, B3) ──────────────

Deno.test('preSeasonStartsLabel: formats a real Monday-open instant as "Season starts Mon H:MM AM/PM ET"', () => {
  assertEquals(preSeasonStartsLabel('2026-08-03T13:30:00.000Z'), 'Season starts Mon 9:30 AM ET');
});

Deno.test('preSeasonStartsLabel: a holiday-shifted Tuesday start reads Tuesday, never a hardcoded Monday', () => {
  assertEquals(preSeasonStartsLabel('2026-09-08T13:30:00.000Z'), 'Season starts Tue 9:30 AM ET');
});

Deno.test('preSeasonStartsLabel: null/invalid falls back to "Season starts soon", never "Invalid Date"', () => {
  assertEquals(preSeasonStartsLabel(null), 'Season starts soon');
  assertEquals(preSeasonStartsLabel('not-a-date'), 'Season starts soon');
});
