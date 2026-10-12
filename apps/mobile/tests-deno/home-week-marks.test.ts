/**
 * A calm Home (decided A, 2026-10-12; B′ for the playoffs): the season chart's W/L
 * marks on its axis (lib/home/weekMarks), the range as text tabs, and the chart's
 * end dot in the playoffs.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  weekMarks, regularWeekSlots, layoutWeekMarks, marksCollide, regularMarkResults, resultFromGains, seasonChartA11yLabel,
  rangeTabLook, rangeTabHitSlop, marksShownFor, chartLiveEnd, glyphWidth, RANGE_TABS, MIN_HIT, BYE_MIN_SLOT, MARK_MAX_FONT_SCALE,
  type WeekMarkInput,
} from '../lib/home/weekMarks.ts';
import { buildSeasonGainSeries, type SeasonWeekInput } from '../lib/home/seasonGainSeries.ts';
import { buildChartGeometry } from '../lib/chart/chartGeometry.ts';
import { SOURCES } from './sourceManifest.generated.ts';

/** A built season of `n` scored weeks (plus an optional live week), laid out on a `width` chart the way SeasonChart does. */
function season(n: number, width: number, opts: { liveDays?: number } = {}) {
  const weeks: SeasonWeekInput[] = [];
  for (let w = 1; w <= n; w++) {
    const mon = new Date(Date.UTC(2026, 6, 6 + (w - 1) * 7));
    const fri = new Date(mon.getTime() + 4 * 86_400_000);
    weeks.push({ week: w, weekStart: mon.toISOString(), weekEnd: fri.toISOString(), scoredGain: w % 3 === 0 ? -20 : 40, snapshots: [], trades: [], tradingDays: [] });
  }
  if (opts.liveDays) {
    const w = n + 1;
    const mon = new Date(Date.UTC(2026, 6, 6 + (w - 1) * 7));
    const days = Array.from({ length: opts.liveDays }, (_, i) => new Date(mon.getTime() + i * 86_400_000).toISOString().slice(0, 10));
    weeks.push({ week: w, weekStart: mon.toISOString(), weekEnd: new Date(mon.getTime() + 4 * 86_400_000).toISOString(), scoredGain: null, snapshots: [], trades: [], tradingDays: days });
  }
  const series = buildSeasonGainSeries({ weeks, closesByDate: {}, live: opts.liveDays ? { gain: 12 } : null });
  const geo = buildChartGeometry(series.points.map((p) => p.gain), width, 124, { padBottom: 26 }, series.points.map((p) => p.dayIndex));
  return { series, geo };
}

const W = (week: number, result: WeekMarkInput['result']): WeekMarkInput => ({ week, result });

// ── Placement ──────────────────────────────────────────────────────────────

Deno.test("each week's slot is the time it covers: previous week's last point to its own", () => {
  const { series, geo } = season(3, 300);
  const xs = geo.points.map((p) => p.x);
  const slots = regularWeekSlots(xs, series.weekStartIdx);
  assertEquals(slots.length, 3);
  // Week 1: the anchor (Week 1's open, x=0) to Week 1's Friday.
  assertEquals(slots[0].start, 0);
  assertEquals(slots[0].end, xs[1]);
  // Week 2: Week 1's Friday to Week 2's Friday; week 3 ends at the last point.
  assertEquals(slots[1], { start: xs[1], end: xs[2] });
  assertEquals(slots[2], { start: xs[2], end: xs[3] });
  assertEquals(slots[2].end, 300);
});

Deno.test('a mark is centred under its week, and every mark sits inside the chart', () => {
  const { series, geo } = season(5, 350);
  const marks = weekMarks(geo.points, series.weekStartIdx, [W(1, 'W'), W(2, 'W'), W(3, 'L'), W(4, 'W'), W(5, 'W')], 350);
  const slots = regularWeekSlots(geo.points.map((p) => p.x), series.weekStartIdx);
  for (let i = 0; i < 5; i++) assertEquals(marks[i].x, (slots[i].start + slots[i].end) / 2);
  assertEquals(marksCollide(marks, 350), false);
});

// ── Glyphs and colours ─────────────────────────────────────────────────────

Deno.test('W in gain, L in loss, T in text2; a bye is "Bye" in text2, never coloured', () => {
  const { series, geo } = season(4, 350);
  const marks = weekMarks(geo.points, series.weekStartIdx, [W(1, 'W'), W(2, 'L'), W(3, 'T'), W(4, 'BYE')], 350);
  assertEquals(marks.map((m) => [m.glyph, m.tone]), [['W', 'gain'], ['L', 'loss'], ['T', 'text2'], ['Bye', 'text2']]);
});

Deno.test('a bye whose slot is under 26pt reads "–" (still text2), never "Bye"', () => {
  const narrow = layoutWeekMarks([W(1, 'BYE')], [{ start: 0, end: BYE_MIN_SLOT - 1 }], 350);
  assertEquals([narrow[0].glyph, narrow[0].tone], ['–', 'text2']);
  const wide = layoutWeekMarks([W(1, 'BYE')], [{ start: 0, end: BYE_MIN_SLOT + 4 }], 350);
  assertEquals(wide[0].glyph, 'Bye');
  // At the 1.3x cap the word needs more than 26pt: it drops to "–" rather than overlap.
  const capped = layoutWeekMarks([W(1, 'BYE')], [{ start: 0, end: BYE_MIN_SLOT + 1 }], 350, 2);
  assertEquals(capped[0].glyph, '–');
});

Deno.test('the live week (market open) is a 6pt live dot; a closed or scoring week has no mark', () => {
  const { series, geo } = season(5, 350, { liveDays: 3 });
  const marks = weekMarks(geo.points, series.weekStartIdx, [W(1, 'W'), W(2, 'W'), W(3, 'L'), W(4, 'W'), W(5, 'W'), W(6, 'LIVE')], 350);
  const live = marks[marks.length - 1];
  assertEquals([live.glyph, live.tone, live.w], ['live', 'live', 6]);
  const closed = weekMarks(geo.points, series.weekStartIdx, [W(1, 'W'), W(2, 'W'), W(3, 'L'), W(4, 'W'), W(5, 'W'), W(6, null)], 350);
  assertEquals(closed.length, 5);
});

Deno.test('past what the width can hold side by side, letters become pips in their colours, still never overlapping', () => {
  const { series, geo } = season(40, 350);
  const results = Array.from({ length: 40 }, (_, i) => W(i + 1, i % 2 ? 'L' : 'W'));
  const marks = weekMarks(geo.points, series.weekStartIdx, results, 350, 1.3);
  assert(marks.every((m) => m.glyph === 'pip'));
  assertEquals(marks.slice(0, 2).map((m) => m.tone), ['gain', 'loss']);
  assertEquals(marksCollide(marks, 350), false);
});

Deno.test('the mark font never scales past 1.3x', () => {
  assertEquals(MARK_MAX_FONT_SCALE, 1.3);
  assertEquals(glyphWidth('W', 3), glyphWidth('W', 1.3));
  assertEquals(glyphWidth('live', 3), 6);
});

// ── No overlaps ────────────────────────────────────────────────────────────

Deno.test('18 regular weeks at 350pt: letters only, never overlapping, at standard and capped text', () => {
  const results = Array.from({ length: 18 }, (_, i) => W(i + 1, (['W', 'L', 'T', 'BYE'] as const)[i % 4]));
  const { series, geo } = season(18, 350);
  for (const scale of [1, 1.3, 3]) {
    const marks = weekMarks(geo.points, series.weekStartIdx, results, 350, scale);
    assertEquals(marks.length, 18);
    assertEquals(marksCollide(marks, 350), false, `collide at ${scale}x`);
    // No letter is reduced to a pip; the byes read "–" (their slots are under 26pt).
    assert(marks.every((m) => m.glyph !== 'pip'), `a pip at ${scale}x`);
    assert(marks.filter((_, i) => i % 4 === 3).every((m) => m.glyph === '–'));
  }
});

Deno.test('18 regular weeks + a live Monday at 350pt: the live dot never collides with the week before', () => {
  const results = [...Array.from({ length: 17 }, (_, i) => W(i + 1, 'W' as const)), W(18, 'LIVE')];
  const { series, geo } = season(17, 350, { liveDays: 1 });
  for (const scale of [1, 1.3]) assertEquals(marksCollide(weekMarks(geo.points, series.weekStartIdx, results, 350, scale), 350), false);
});

Deno.test('a short season reads "Bye" in full, and still nothing overlaps (6 weeks, 320pt)', () => {
  const { series, geo } = season(6, 320);
  const marks = weekMarks(geo.points, series.weekStartIdx, [W(1, 'W'), W(2, 'BYE'), W(3, 'L'), W(4, 'T'), W(5, 'W'), W(6, 'W')], 320, 1.3);
  assertEquals(marks[1].glyph, 'Bye');
  assertEquals(marksCollide(marks, 320), false);
});

// ── Which results the axis shows ───────────────────────────────────────────

Deno.test('the axis results: past weeks, a current bye, the live dot while open, a scored current week its letter', () => {
  const weeklyResults = [{ week: 1, result: 'W' as const }, { week: 2, result: 'L' as const }];
  const base = { chartWeeks: [1, 2, 3], weeklyResults, currentWeek: 3 };
  assertEquals(regularMarkResults({ ...base, isLive: true, currentScored: null }).map((r) => r.result), ['W', 'L', 'LIVE']);
  assertEquals(regularMarkResults({ ...base, isLive: false, currentScored: null }).map((r) => r.result), ['W', 'L', null]);
  assertEquals(regularMarkResults({ ...base, isLive: false, currentScored: 'T' }).map((r) => r.result), ['W', 'L', 'T']);
  // A current bye is already in weeklyResults (S7): it reads as a bye, not live.
  const bye = regularMarkResults({ ...base, weeklyResults: [...weeklyResults, { week: 3, result: 'BYE' }], isLive: true, currentScored: null });
  assertEquals(bye.map((r) => r.result), ['W', 'L', 'BYE']);
  assertEquals([resultFromGains(5, 3), resultFromGains(3, 5), resultFromGains(4, 4)], ['W', 'L', 'T']);
});

// ── B′: the playoffs (Design Lead ruling during the build, 2026-10-12) ─────

Deno.test('B′: in the playoffs the axis is the regular season only, with no live mark', () => {
  // playoff_live: weeks 1–6 on the chart (R3), the Wild card (week 7) live.
  const weeklyResults = [1, 2, 3, 4, 5, 6].map((week) => ({ week, result: (week === 3 ? 'L' : 'W') as 'W' | 'L' }));
  const results = regularMarkResults({ chartWeeks: [1, 2, 3, 4, 5, 6], weeklyResults, currentWeek: 7, isLive: chartLiveEnd(true, true), currentScored: null });
  assertEquals(results.map((r) => r.result), ['W', 'W', 'L', 'W', 'W', 'W']);
  assert(!results.some((r) => r.result === 'LIVE'));
  assertEquals(seasonChartA11yLabel(481.78, results), 'Season gain: +$481.78. Weeks: W, W, L, W, W, W.');
});

Deno.test("B′: the line's end is the static dot in the playoffs; it pulses only while a regular week is open", () => {
  assertEquals(chartLiveEnd(true, false), true);
  assertEquals(chartLiveEnd(true, true), false);
  assertEquals(chartLiveEnd(false, false), false);
  // Wiring: HomeSeason feeds the chart from chartLiveEnd; the chart draws the static
  // Circle when not live and the pulsing LiveDot only when live; Home passes isPlayoff.
  const block = SOURCES['components/home/HomeSeason.tsx'];
  assert(block.includes('const live = chartLiveEnd(marketOpen, isPlayoff);'));
  assert(block.includes('live={live}'));
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes('{endpoint && !scrubPoint && !live ? ('));
  assert(chart.includes('{endpoint && !scrubPoint && live ? ('));
  assert(SOURCES['app/(tabs)/index.tsx'].includes("isPlayoff={'isPlayoff' in phase && !!phase.isPlayoff}"));
});

// ── Accessibility ──────────────────────────────────────────────────────────

Deno.test('the chart label lists the results (the spec\'s own example); a bye reads "bye"', () => {
  const weeks = [W(1, 'W'), W(2, 'W'), W(3, 'L'), W(4, 'W'), W(5, 'W'), W(6, 'LIVE')];
  assertEquals(seasonChartA11yLabel(343.59, weeks), 'Season gain: +$343.59. Weeks: W, W, L, W, W, Week 6 live.');
  assertEquals(seasonChartA11yLabel(-12, [W(1, 'L'), W(2, 'BYE'), W(3, null)]), 'Season gain: -$12.00. Weeks: L, bye.');
  assertEquals(seasonChartA11yLabel(0, []), 'Season gain: $0.00.');
});

// ── Scrub, height, wiring ──────────────────────────────────────────────────

Deno.test("the scrub underlines the scrubbed week's mark (2pt accent), and the label is unchanged", () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes('const scrubbedWeek = scrubValue ? scrubValue.week : null;'));
  assert(chart.includes('{scrubbedWeek === m.week ? <View style={[styles.markUnderline, {'));
  assert(chart.includes('backgroundColor: colors.accent'));
  assert(/markUnderline:\s*\{\s*height: 2,/.test(chart));
  assert(chart.includes('seasonScrubLabel(scrubValue, scrubIndex > 0 ? points[scrubIndex - 1].gain : null)'));
});

Deno.test('the chart is 124pt on Home (the axis row inside it), 148 by default; marks only in the Season window', () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes('const DEFAULT_HEIGHT = 148;'));
  assert(chart.includes('height: HEIGHT = DEFAULT_HEIGHT'));
  assert(SOURCES['lib/home/calmHome.ts'].includes('export const HOME_CHART_HEIGHT = 124;'));
  const block = SOURCES['components/home/HomeSeason.tsx'];
  assert(block.includes('height={HOME_CHART_HEIGHT}'));
  assert(block.includes('markResults={marksShownFor(window) ? results : undefined}'));
  assertEquals([marksShownFor('Season'), marksShownFor('1W'), marksShownFor('1M')], [true, false, false]);
  // The marks follow Dynamic Type, capped at 1.3x, ExtraBold.
  assert(chart.includes('maxFontSizeMultiplier={MARK_MAX_FONT_SCALE}'));
  assert(/markText:\s*\{\s*fontWeight: '800',/.test(chart));
});

// ── Range tabs ─────────────────────────────────────────────────────────────

Deno.test('range tabs: 1W · 1M · Season; selected is text, 800, underlined; others text2, 600', () => {
  assertEquals(RANGE_TABS.map((t) => t.label), ['1W', '1M', 'Season']);
  assertEquals(rangeTabLook(true), { fontWeight: '800', color: 'text', underline: true });
  assertEquals(rangeTabLook(false), { fontWeight: '600', color: 'text2', underline: false });
});

Deno.test('range tabs: every hit area is at least 44 × 44, and neighbours never share one', () => {
  for (const h of [18 + 4, 23.4 + 4, 60]) {
    const slop = rangeTabHitSlop(h);
    assert(h + slop.top + slop.bottom >= MIN_HIT, `height ${h}`);
    assert(slop.top >= 0 && slop.bottom >= 0);
  }
  const block = SOURCES['components/home/HomeSeason.tsx'];
  // Width from the tab's own box (minWidth), never a horizontal hitSlop that would overlap the next tab.
  assert(/tab:\s*\{\s*minWidth: MIN_HIT,/.test(block));
  assert(block.includes('hitSlop={hitSlop}'));
  assert(block.includes('accessibilityRole="tab"'));
  assert(block.includes('accessibilityState={{ selected }}'));
  assert(!block.includes('SegmentedControl'));
});
