/**
 * A calm Home (decided A, 2026-10-12; B′ for the playoffs): the season chart's W/L
 * marks on its axis (lib/home/weekMarks), the range as text tabs, and the chart's
 * end dot in the playoffs.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  weekMarks, regularWeekSlots, layoutWeekMarks, marksCollide, regularMarkResults, resultFromGains, seasonChartA11yLabel,
  rangeTabLook, rangeTabHitSlop, marksShownFor, chartLiveEnd, glyphWidth, pipFor, RANGE_TABS, MIN_HIT, BYE_MIN_SLOT, MARK_MAX_FONT_SCALE,
  PIP_SIZE, PIP_RING_STROKE, rangeTabsPullUp, TAB_TEXT_UNDER_MARKS, rangeTabsSlackBelow, RANGE_PILL_TAB, NO_PULL_GAP_1X, NO_PULL_GAP_CAP, noPullGap, RANGE_TAB_MAX_FONT_SCALE,
  type WeekMarkInput,
} from '../lib/home/weekMarks.ts';
import { buildSeasonGainSeries, type SeasonWeekInput } from '../lib/home/seasonGainSeries.ts';
import { buildChartGeometry } from '../lib/chart/chartGeometry.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// W4 gate capture pass (both phones, the README's F1 row): the dates' lowest pixel (a
// descender) -> the tabs' highest pixel, row-wise, in points, with the tabs NOT pulled up;
// Large text, and XL (accessibility-extra-large), where every row above the tabs is at its
// 1.3x cap. (XL measured 5.0pt with the 23pt pull then in place: 5.0 + 23 = 28.0.)
const MEASURED_NO_PULL_1X = 28.7;
const MEASURED_NO_PULL_CAP = 28.0;

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

// ── Dense seasons: shapes, never colour alone (Design Lead, 2026-10-12; §9B) ───

const allW = (n: number) => Array.from({ length: n }, (_, i) => W(i + 1, 'W' as const));

Deno.test('the switch point: letters while they fit side by side (23 W at 350pt), shapes from the next week on', () => {
  for (const [n, expectLetters] of [[23, true], [24, false]] as const) {
    const { series, geo } = season(n, 350);
    const marks = weekMarks(geo.points, series.weekStartIdx, allW(n), 350);
    assertEquals(marks.every((m) => m.glyph === 'W'), expectLetters, `${n} weeks`);
    assertEquals(marks.every((m) => m.glyph === 'pipDot'), !expectLetters, `${n} weeks`);
    assertEquals(marksCollide(marks, 350), false);
  }
  // The rule is the row's width, so capped text switches sooner (18 fit at 1.3x, 19 don't).
  for (const [n, expectLetters] of [[18, true], [19, false]] as const) {
    const { series, geo } = season(n, 350);
    assertEquals(weekMarks(geo.points, series.weekStartIdx, allW(n), 350, 1.3).every((m) => m.glyph === 'W'), expectLetters, `${n} at 1.3x`);
  }
});

Deno.test('each dense-season shape: W a filled gain dot, L a hollow loss ring, T a filled text2 dot, a bye a text2 dash; 5pt each', () => {
  assertEquals([pipFor('W'), pipFor('L'), pipFor('T'), pipFor('Bye'), pipFor('–'), pipFor('live')], ['pipDot', 'pipRing', 'pipDot', 'pipDash', 'pipDash', 'live']);
  const kinds = ['W', 'L', 'T', 'BYE'] as const;
  const results = [...Array.from({ length: 39 }, (_, i) => W(i + 1, kinds[i % 4])), W(40, 'LIVE')];
  const { series, geo } = season(39, 350, { liveDays: 2 });
  const marks = weekMarks(geo.points, series.weekStartIdx, results, 350, 1.3);
  assertEquals(marks.slice(0, 4).map((m) => [m.glyph, m.tone, m.w]), [
    ['pipDot', 'gain', 5], ['pipRing', 'loss', 5], ['pipDot', 'text2', 5], ['pipDash', 'text2', 5],
  ]);
  // A bye's dash is never green or red; the live week keeps its 6pt live dot.
  assert(marks.filter((m) => m.glyph === 'pipDash').every((m) => m.tone === 'text2'));
  assertEquals([marks[39].glyph, marks[39].w], ['live', 6]);
  assertEquals(marksCollide(marks, 350), false);
  // The scrub and a11y labels still name each week (they read the results, not the shapes).
  assert(seasonChartA11yLabel(10, results).startsWith('Season gain: +$10.00. Weeks: W, L, T, bye, W'));
});

Deno.test('the shapes are drawn as shapes: a 1.5pt ring for a loss, a short dash for a bye (source guard)', () => {
  assertEquals([PIP_SIZE, PIP_RING_STROKE], [5, 1.5]);
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes("if (m.glyph === 'pipRing') return { width: m.w, height: m.w, borderRadius: m.w / 2, borderWidth: PIP_RING_STROKE, borderColor: color };"));
  assert(chart.includes("if (m.glyph === 'pipDash') return { width: m.w, height: 2, borderRadius: 1, backgroundColor: color };"));
  assert(chart.includes('<View style={shapeStyle(m, toneColor(m.tone))} />'));
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
    // No letter is reduced to a shape; the byes read "–" (their slots are under 26pt).
    assert(marks.every((m) => !m.glyph.startsWith('pip')), `a shape at ${scale}x`);
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
  // W4: Home's chart is the gn <Chart>: the static dot + halo when not live, LiveDot when live.
  assert(SOURCES['components/home/SeasonChart.tsx'].includes('live={live}'));
  const chart = SOURCES['components/sp/gn/Chart.tsx'];
  assert(chart.includes('{endVisible && !live ? ('));
  assert(chart.includes('{endVisible && live ? ('));
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

Deno.test("the scrub underlines the scrubbed week's mark (2pt accent); the label names the date (§9C)", () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  // The gn Chart reports the scrubbed index; Home turns it into the week whose mark it underlines.
  assert(chart.includes('onScrubIndex={(i) => setScrubbedWeek(i != null ? points[i]?.week ?? null : null)}'));
  assert(chart.includes("backgroundColor: scrubbedWeek === m.week ? colors.accent : 'transparent'"));
  assert(/markUnderline:\s*\{\s*height: 2,/.test(chart));
  assert(SOURCES['components/sp/gn/Chart.tsx'].includes('useChartScrub(width > 0 ? geometry : null, reduced, onScrubIndex)'));
  // §9C Scrub: "the scrub label names the point's date or day" — "Oct 6 · +$41.26".
  assert(SOURCES['components/sp/gn/Chart.tsx'].includes('`${pointName(axis, scrubbed.t)} · ${formatValue(scrubbed.value)}`'));
  assert(chart.includes("formatValue={(v) => formatMoney(v, { sign: 'always' })}"));
});

Deno.test('the season axis: dated, first point → last point (today), two labels, under the marks', () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(chart.includes("return { kind: 'dated', start, end, maxLabels: 2 };"));
  assert(chart.includes('underPlacement="beforeAxis"'));
  assert(chart.includes('line = points.map((p) => ({ t: dayOffset(start, day(p.date)), value: p.gain }))'));
});

Deno.test('the plot is 108pt on Home (marks and dates add below, ~142 in all, the board\'s Line); marks only in the Season window', () => {
  const chart = SOURCES['components/home/SeasonChart.tsx'];
  assert(SOURCES['lib/home/calmHome.ts'].includes('export const HOME_CHART_HEIGHT = 108;'));
  const block = SOURCES['components/home/HomeSeason.tsx'];
  assert(block.includes('height={HOME_CHART_HEIGHT}'));
  // Edge to edge (§9C Chart): the line bleeds past the 20pt gutter.
  assert(block.includes('bleed={space[6]}'));
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
  // W4: Home's tabs are the Game Night RangePills ("tabs"): each option a 44 × 44 box of its own.
  const block = SOURCES['components/home/HomeSeason.tsx'];
  assert(block.includes('<RangePills options={RANGE_OPTIONS} value={window} onChange={setWindow} variant="tabs" />'));
  const pills = SOURCES['components/sp/gn/RangePills.tsx'];
  assert(/option:\s*\{\s*minHeight: 44,/.test(pills));
  assert(/tab:\s*\{\s*minWidth: 44,/.test(pills));
  assert(pills.includes('accessibilityRole="tab"'));
  assert(pills.includes('accessibilityState={{ selected }}'));
  assert(!block.includes('SegmentedControl'));
});

// ── F1 (Design Lead gate, 2026-10-12): the range tabs belong to the chart ──────

Deno.test('F1: the tab labels sit 8pt (±2) under the date labels; the 24pt block gap sits under the tabs', () => {
  assertEquals(TAB_TEXT_UNDER_MARKS, 8);
  // The constants are the README's F1 measurements (the dates' lowest pixel -> the tabs'
  // highest, no pull), at Large and at XL.
  assertEquals([NO_PULL_GAP_1X, NO_PULL_GAP_CAP], [MEASURED_NO_PULL_1X, MEASURED_NO_PULL_CAP]);
  assertEquals([noPullGap(1), noPullGap(1.3)], [MEASURED_NO_PULL_1X, MEASURED_NO_PULL_CAP]);
  // The flat part is derived: every row above the tabs caps at the same 1.3x, so nothing
  // above them changes size past it.
  const chart = SOURCES['components/sp/gn/Chart.tsx'];
  assert(chart.includes('export const AXIS_MAX_SCALE = 1.3;'));
  assertEquals([MARK_MAX_FONT_SCALE, RANGE_TAB_MAX_FONT_SCALE], [1.3, 1.3]);
  assert(SOURCES['components/sp/gn/RangePills.tsx'].includes('const LABEL_MAX_SCALE = 1.3;'));
  for (const [scale, gap] of [[1, MEASURED_NO_PULL_1X], [1.3, MEASURED_NO_PULL_CAP], [2.35, MEASURED_NO_PULL_CAP]] as const) {
    const after = gap - rangeTabsPullUp(scale);
    assert(Math.abs(after - TAB_TEXT_UNDER_MARKS) <= 2, `${scale}x: ${after}pt`);
  }
  // Every row above the tabs caps at 1.3x (marks, dates, tabs), so the pull is flat above it.
  assertEquals(rangeTabsPullUp(1.3), rangeTabsPullUp(2.35));
  assertEquals(rangeTabsPullUp(3.12), rangeTabsPullUp(1.3));
  // Wiring: the row is pulled up by exactly that, and draws after the chart (on top of its strip).
  const block = SOURCES['components/home/HomeSeason.tsx'];
  assert(block.includes('<View style={{ marginTop: -rangeTabsPullUp(fontScale), marginBottom: -rangeTabsSlackBelow(fontScale) }}>'));
  assert(block.indexOf('<SeasonChart') < block.indexOf('marginTop: -rangeTabsPullUp(fontScale)'));
  // The block gap stays on the wrapper (24pt), never on the tabs.
  assert(SOURCES['app/(tabs)/index.tsx'].includes("style={{ gap: space[7] }}"));
});

Deno.test('F1: the tabs keep their 44pt boxes, and the strip under the underline is taken back from the block gap', () => {
  // RangePills: 4pt above the label, the 2 + 2pt underline under it, centred in a 44pt box.
  const pills = SOURCES['components/sp/gn/RangePills.tsx'];
  assert(/tab:\s*\{\s*minWidth: 44,\s*paddingTop: space\[2\],/.test(pills));
  assert(/underline:\s*\{\s*marginTop: space\[1\],/.test(pills));
  assertEquals(RANGE_PILL_TAB, { minHeight: 44, padTop: 4, under: 4, labelLine: 18 });
  // Standard text: 44 − (4 + 18 + 4) = 18, so 9 below; at the 1.3x cap 44 − 31.4 = 12.6, so 6.
  assertEquals([rangeTabsSlackBelow(1), rangeTabsSlackBelow(1.3), rangeTabsSlackBelow(3)], [9, 6, 6]);
});
