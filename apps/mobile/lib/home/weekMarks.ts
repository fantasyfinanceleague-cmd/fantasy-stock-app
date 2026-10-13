/**
 * weekMarks: the W/L marks on the season chart's axis (a calmer Home, decided A,
 * 2026-10-12; build spec "Axis W/L marks replace the week chips"). Pure, so the
 * placement and the no-overlap rule are tested under Deno (tests-deno/home-week-marks).
 *
 * One mark per week, centred under the week's span on the chart's x axis. A week's
 * span is the stretch of TIME it covers: from the previous week's last point (the
 * Week-1-open anchor for week 1) to its own last point. The series has one point per
 * past week (its Friday) and one per day of the live week, so "start index to the
 * next week's start" would sit every mark under the FOLLOWING week; the span is read
 * from the last points instead.
 *
 * Glyphs: "W" (gain), "L" (loss), "T" (text2); a bye is "Bye" (text2), or "–" when
 * its slot is too narrow for the word, and is never green or red (Giorgio,
 * 2026-09-29). The live week (market open) is a 6pt `live` dot. A week with no
 * result yet (market closed, scoring) has no mark.
 *
 * Regular season only (B′, Design Lead, 2026-10-12): the line ends at the regular
 * season (R3: playoff gains never count toward season gain), so the axis does too. No
 * playoff slots, letters or hairline; playoff results live in League › Playoffs.
 */

import { formatSignedCurrency } from '../weekStatus';

export type WeekMarkResult = 'W' | 'L' | 'T' | 'BYE' | 'LIVE';

export interface WeekMarkInput {
  week: number;
  /** null: no result yet (the current week while closed or scoring): an empty slot. */
  result: WeekMarkResult | null;
}

/** `pipDot`/`pipRing`/`pipDash`: the dense-season shapes (W a filled gain dot, L a hollow
 * loss ring, T a filled text2 dot, a bye a short text2 dash), never colour alone (§9B). */
export type WeekMarkGlyph = 'W' | 'L' | 'T' | 'Bye' | '–' | 'live' | 'pipDot' | 'pipRing' | 'pipDash';
export type WeekMarkTone = 'gain' | 'loss' | 'text2' | 'live';

export interface WeekMark {
  week: number;
  /** Centre x of the mark, in chart pixels. */
  x: number;
  /** Rendered width estimate (pixels), at the font scale it was laid out for. */
  w: number;
  glyph: WeekMarkGlyph;
  tone: WeekMarkTone;
}

export interface WeekSlot {
  start: number;
  end: number;
}

/** The marks' type: caption 12pt, ExtraBold (800), never scaled past 1.3. */
export const MARK_FONT_SIZE = 12;
export const MARK_MAX_FONT_SCALE = 1.3;
/** A bye reads "Bye" only in a slot at least this wide (spec: 26pt), else "–". */
export const BYE_MIN_SLOT = 26;
/** The live week's dot. */
export const LIVE_MARK_SIZE = 6;
/** When the marks can't all fit across the chart side by side as text, every week becomes
 * a 5pt shape (only past ~23 weeks at 350pt, beyond any season the spec draws), so marks
 * still never overlap. The shape, not just its colour, carries the result (Design Lead,
 * 2026-10-12, DESIGN_DIRECTION §9B): see pipFor. */
export const PIP_SIZE = 5;
/** The loss ring's stroke. */
export const PIP_RING_STROKE = 1.5;
/** The least air between two marks. */
export const MARK_GAP = 2;

/** Advance widths at 12pt Archivo ExtraBold (rounded up, so the fit is conservative). */
const GLYPH_WIDTH_12: Record<'W' | 'L' | 'T' | 'Bye' | '–', number> = { W: 13, L: 8, T: 8, Bye: 22, '–': 7 };

export function glyphWidth(glyph: WeekMarkGlyph, fontScale = 1): number {
  if (glyph === 'live') return LIVE_MARK_SIZE;
  if (glyph === 'pipDot' || glyph === 'pipRing' || glyph === 'pipDash') return PIP_SIZE;
  return GLYPH_WIDTH_12[glyph] * Math.min(Math.max(fontScale, 1), MARK_MAX_FONT_SCALE);
}

/**
 * Each week's slot on the axis, from the chart points' x positions and the series'
 * `weekStartIdx` (parallel to the weeks). Week k runs from the previous week's last
 * point to its own last point; week 1 starts at the anchor (point 0).
 */
export function regularWeekSlots(xs: number[], weekStartIdx: number[]): WeekSlot[] {
  const slots: WeekSlot[] = [];
  const last = xs.length - 1;
  for (let k = 0; k < weekStartIdx.length; k++) {
    const lastIdx = k + 1 < weekStartIdx.length ? weekStartIdx[k + 1] - 1 : last;
    const startIdx = k === 0 ? 0 : weekStartIdx[k] - 1;
    if (lastIdx < 0 || startIdx < 0 || lastIdx > last) continue;
    slots.push({ start: xs[startIdx], end: xs[lastIdx] });
  }
  return slots;
}

function pick(result: WeekMarkResult, slotWidth: number, fontScale: number): { glyph: WeekMarkGlyph; tone: WeekMarkTone } {
  if (result === 'LIVE') return { glyph: 'live', tone: 'live' };
  if (result === 'BYE') {
    // A bye is never coloured. The word needs its own width (scaled) plus air.
    const byeFits = slotWidth >= Math.max(BYE_MIN_SLOT, glyphWidth('Bye', fontScale) + MARK_GAP);
    return { glyph: byeFits ? 'Bye' : '–', tone: 'text2' };
  }
  const tone: WeekMarkTone = result === 'W' ? 'gain' : result === 'L' ? 'loss' : 'text2';
  return { glyph: result, tone };
}

/** The dense-season shape for a text mark: W and T filled dots (gain, text2), L a hollow
 * loss ring, a bye a short dash (text2, never green or red). The live dot is unchanged. */
export function pipFor(glyph: WeekMarkGlyph): WeekMarkGlyph {
  if (glyph === 'W' || glyph === 'T') return 'pipDot';
  if (glyph === 'L') return 'pipRing';
  if (glyph === 'Bye' || glyph === '–') return 'pipDash';
  return glyph;
}

/** The width the marks need side by side, with MARK_GAP between them. */
export function rowWidth(marks: { w: number }[]): number {
  return marks.reduce((sum, m) => sum + m.w, 0) + MARK_GAP * Math.max(0, marks.length - 1);
}

/**
 * The marks for the Season window: `slots[i]` is `weeks[i]`'s span. Marks never overlap and never leave [0, width]: each
 * sits at its slot's centre, then a left-to-right pass pushes a mark right of its
 * neighbour and a right-to-left pass pulls the tail back inside the width.
 */
export function layoutWeekMarks(weeks: WeekMarkInput[], slots: WeekSlot[], width: number, fontScale = 1): WeekMark[] {
  const marks: WeekMark[] = [];
  for (let i = 0; i < weeks.length && i < slots.length; i++) {
    const wk = weeks[i];
    const slot = slots[i];
    if (wk.result === null) continue;
    const { glyph, tone } = pick(wk.result, slot.end - slot.start, fontScale);
    // The live week's dot sits under the line's END DOT (its slot's end: the last point),
    // not mid-slot (Design Lead, W4 gate, 2026-10-13); every other mark is centred.
    const x = wk.result === 'LIVE' ? slot.end : (slot.start + slot.end) / 2;
    marks.push({ week: wk.week, x, w: glyphWidth(glyph, fontScale), glyph, tone });
  }
  // Too many marks for the width as text: every week a 5pt shape, never an overlap.
  if (rowWidth(marks) > width) {
    for (const m of marks) {
      m.glyph = pipFor(m.glyph);
      m.w = glyphWidth(m.glyph, fontScale);
    }
  }
  // Inside the chart's own edges — except the live dot, which follows the end dot past the
  // gutter (the line runs edge to edge; the end dot keeps its halo on screen).
  const pinned = (m: WeekMark) => m.glyph === 'live';
  for (const m of marks) if (!pinned(m)) m.x = Math.min(Math.max(m.x, m.w / 2), width - m.w / 2);
  // No overlaps: push right, then pull back from the right edge. The live dot never moves;
  // its neighbours make room for it.
  for (let i = 1; i < marks.length; i++) {
    if (pinned(marks[i])) continue;
    const min = marks[i - 1].x + marks[i - 1].w / 2 + MARK_GAP + marks[i].w / 2;
    if (marks[i].x < min) marks[i].x = min;
  }
  for (let i = marks.length - 1; i >= 0; i--) {
    if (pinned(marks[i])) continue;
    const max = i === marks.length - 1 ? width - marks[i].w / 2 : marks[i + 1].x - marks[i + 1].w / 2 - MARK_GAP - marks[i].w / 2;
    if (marks[i].x > max) marks[i].x = max;
  }
  return marks;
}

/** The spec's entry point: the week marks from the chart's own points. */
export function weekMarks(
  points: { x: number }[],
  weekStartIdx: number[],
  results: WeekMarkInput[],
  width: number,
  fontScale = 1,
): WeekMark[] {
  return layoutWeekMarks(results, regularWeekSlots(points.map((p) => p.x), weekStartIdx), width, fontScale);
}

/** Do any two marks overlap (or touch closer than MARK_GAP), or leave [0, width] (the live dot
 * excepted)? For the tests. */
export function marksCollide(marks: WeekMark[], width: number): boolean {
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    // The live dot may pass the gutter (it sits under the end dot); nothing else may.
    if (m.glyph !== 'live' && (m.x - m.w / 2 < -0.001 || m.x + m.w / 2 > width + 0.001)) return true;
    if (i > 0) {
      const p = marks[i - 1];
      if (p.x + p.w / 2 + MARK_GAP > m.x - m.w / 2 + 0.001) return true;
    }
  }
  return false;
}

/**
 * The results the axis shows, one per week on the chart, in order. `weeklyResults` is
 * the view model's (past regular weeks, plus a current bye). The current week adds
 * the live dot while the market is open, or its letter once scored; closed or scoring
 * leaves its slot empty. A playoff week is never on the chart (B′), so in the playoffs
 * every mark is a regular week's result and there is no live dot.
 */
export function regularMarkResults(args: {
  chartWeeks: number[];
  weeklyResults: { week: number; result: 'W' | 'L' | 'T' | 'BYE' }[];
  currentWeek: number;
  isLive: boolean;
  /** The current week's posted result, when it is a scored regular week. */
  currentScored: 'W' | 'L' | 'T' | null;
}): WeekMarkInput[] {
  const byWeek = new Map(args.weeklyResults.map((r) => [r.week, r.result]));
  return args.chartWeeks.map((week) => {
    const known = byWeek.get(week);
    if (known) return { week, result: known };
    if (week === args.currentWeek) {
      if (args.currentScored) return { week, result: args.currentScored };
      if (args.isLive) return { week, result: 'LIVE' as const };
    }
    return { week, result: null };
  });
}

/** W/L/T from two posted gains (dollars decide; equal is a tie). */
export function resultFromGains(mine: number, theirs: number): 'W' | 'L' | 'T' {
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
}

/**
 * The chart's VoiceOver label: "Season gain: +$343.59. Weeks: W, W, L, W, W, Week 6
 * live." A bye reads "bye". In the playoffs there is no "live" entry (no live mark).
 */
export function seasonChartA11yLabel(seasonGain: number, weeks: WeekMarkInput[]): string {
  const head = `Season gain: ${formatSignedCurrency(seasonGain)}.`;
  const parts = weeks
    .filter((w) => w.result !== null)
    .map((w) => (w.result === 'LIVE' ? `Week ${w.week} live` : w.result === 'BYE' ? 'bye' : w.result!));
  return parts.length ? `${head} Weeks: ${parts.join(', ')}.` : head;
}

// ── Range tabs (1W · 1M · Season as text, under the chart) ─────────────────

export type RangeValue = '1W' | '1M' | 'Season';
export const RANGE_TABS: { label: string; value: RangeValue }[] = [
  { label: '1W', value: '1W' },
  { label: '1M', value: '1M' },
  { label: 'Season', value: 'Season' },
];
/** The least hit area for a tab, each side (§ tap targets). */
export const MIN_HIT = 44;
/** The tabs' text cap, as the segmented labels (GS-3). */
export const RANGE_TAB_MAX_FONT_SCALE = 1.3;
export const RANGE_TAB_UNDERLINE = 2;

/** Selected: `text`, weight 800, a 2pt `text` underline. Others: `text2`, weight 600. */
export function rangeTabLook(selected: boolean): { fontWeight: '800' | '600'; color: 'text' | 'text2'; underline: boolean } {
  return selected ? { fontWeight: '800', color: 'text', underline: true } : { fontWeight: '600', color: 'text2', underline: false };
}

/** Vertical hitSlop that grows a tab's box to MIN_HIT tall (never negative). Each tab's
 * width is at least MIN_HIT on its own (minWidth), so neighbours never share a hit area. */
export function rangeTabHitSlop(contentHeight: number): { top: number; bottom: number } {
  const extra = Math.max(0, Math.ceil((MIN_HIT - contentHeight) / 2));
  return { top: extra, bottom: extra };
}

/**
 * The season line's live end (the pulsing dot): only while the market is open in a
 * REGULAR week (B′). In the playoffs season gain is frozen at its regular-season total,
 * so the line's end is the static end dot.
 */
export function chartLiveEnd(marketOpen: boolean, isPlayoff: boolean): boolean {
  return marketOpen && !isPlayoff;
}

/** The visible space from the marks' glyphs down to the tab labels' glyphs (Design Lead
 * gate F1, 2026-10-12): the tabs belong to the chart, 8pt under it, while the 24pt block
 * gap sits between their underline and the next card. */
export const TAB_TEXT_UNDER_MARKS = 8;
/**
 * Game Night (W4): Home's tabs are RangePills "tabs", whose every option is a 44pt box
 * (§9B) with 4pt above the label and the 2 + 2pt underline under it, the content centred
 * in what's left. The box's empty strip under the underline would add to the 24pt block
 * gap, so HomeSeason takes it back with a negative bottom margin; the gap stays measured
 * from the underline, as before. Callout is 18pt tall, capped at 1.3x for the tabs.
 */
export const RANGE_PILL_TAB = { minHeight: MIN_HIT, padTop: 4, under: 2 + RANGE_TAB_UNDERLINE, labelLine: 18 } as const;
export function rangeTabsSlackBelow(fontScale: number): number {
  const s = Math.min(Math.max(fontScale, 1), RANGE_TAB_MAX_FONT_SCALE);
  const content = RANGE_PILL_TAB.padTop + RANGE_PILL_TAB.labelLine * s + RANGE_PILL_TAB.under;
  return Math.max(0, Math.round((RANGE_PILL_TAB.minHeight - content) / 2));
}

/** How far the tabs row is pulled up over the chart's bottom edge so the labels sit
 * TAB_TEXT_UNDER_MARKS under the glyphs above them: the 8pt layout gap is between BOXES,
 * and the boxes carry empty space of their own (the strip under the axis glyphs, the
 * label's leading, the RangePills box above the label). Game Night (W4): the two end dates
 * sit under the marks, so the tabs measure from the DATES (their lowest pixel is a
 * descender, the "p" of "Sep").
 *
 * The gap with NO pull is MEASURED from device pixels, row-wise, on both phones (W4 gate
 * capture pass, README F1 row): 28.7pt at Large (fontScale 1) and 28.0pt at XL. It is
 * linear between 1x and 1.3x and FLAT above, and that part is derived, not measured: every
 * row above the tabs (the marks, the dates, the tab labels) caps at 1.3x
 * (MARK_MAX_FONT_SCALE, the Chart's AXIS_MAX_SCALE, RANGE_TAB_MAX_FONT_SCALE; a test pins
 * the three equal), so no row changes size past it. XL, XXL, XXXL all sit at the cap. */
export const NO_PULL_GAP_1X = 28.7;
export const NO_PULL_GAP_CAP = 28.0;

export function noPullGap(fontScale: number): number {
  const c = Math.min(Math.max(fontScale, 1), RANGE_TAB_MAX_FONT_SCALE);
  return NO_PULL_GAP_1X + ((c - 1) / (RANGE_TAB_MAX_FONT_SCALE - 1)) * (NO_PULL_GAP_CAP - NO_PULL_GAP_1X);
}

export function rangeTabsPullUp(fontScale: number): number {
  return Math.round(noPullGap(fontScale) - TAB_TEXT_UNDER_MARKS);
}

/** The axis marks show in the Season window only (the one with week ticks). */
export function marksShownFor(range: RangeValue): boolean {
  return range === 'Season';
}
