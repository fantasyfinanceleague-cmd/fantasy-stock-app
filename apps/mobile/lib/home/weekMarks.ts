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

export type WeekMarkGlyph = 'W' | 'L' | 'T' | 'Bye' | '–' | 'live' | 'pip';
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
/** When the letters can't all fit across the chart side by side, every letter becomes a
 * 4pt pip in its own colour (only past ~23 weeks at 350pt, beyond any season the spec
 * draws), so marks still never overlap. */
export const PIP_SIZE = 4;
/** The least air between two marks. */
export const MARK_GAP = 2;

/** Advance widths at 12pt Archivo ExtraBold (rounded up, so the fit is conservative). */
const GLYPH_WIDTH_12: Record<'W' | 'L' | 'T' | 'Bye' | '–', number> = { W: 13, L: 8, T: 8, Bye: 22, '–': 7 };

export function glyphWidth(glyph: WeekMarkGlyph, fontScale = 1): number {
  if (glyph === 'live') return LIVE_MARK_SIZE;
  if (glyph === 'pip') return PIP_SIZE;
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

function rowWidth(marks: WeekMark[]): number {
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
    marks.push({ week: wk.week, x: (slot.start + slot.end) / 2, w: glyphWidth(glyph, fontScale), glyph, tone });
  }
  // Too many letters for the width: pips, never an overlap.
  if (rowWidth(marks) > width) {
    for (const m of marks) {
      if (m.glyph === 'W' || m.glyph === 'L' || m.glyph === 'T') {
        m.glyph = 'pip';
        m.w = PIP_SIZE;
      }
    }
  }
  // Inside the chart's own edges.
  for (const m of marks) m.x = Math.min(Math.max(m.x, m.w / 2), width - m.w / 2);
  // No overlaps: push right, then pull back from the right edge.
  for (let i = 1; i < marks.length; i++) {
    const min = marks[i - 1].x + marks[i - 1].w / 2 + MARK_GAP + marks[i].w / 2;
    if (marks[i].x < min) marks[i].x = min;
  }
  for (let i = marks.length - 1; i >= 0; i--) {
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

/** Do any two marks overlap (or touch closer than MARK_GAP), or leave [0, width]? For the tests. */
export function marksCollide(marks: WeekMark[], width: number): boolean {
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    if (m.x - m.w / 2 < -0.001 || m.x + m.w / 2 > width + 0.001) return true;
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

/** The axis marks show in the Season window only (the one with week ticks). */
export function marksShownFor(range: RangeValue): boolean {
  return range === 'Season';
}
