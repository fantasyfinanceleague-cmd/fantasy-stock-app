// Stockpile — the chart's X axis (§9C "The X axis", Design Lead ruling 2026-10-12, on
// Giorgio's "a real X axis with dates" / this-week charts "Mon…Fri"). Pure: no RN, so the
// tick picker is tested in tests-deno/chart-axis.test.ts.
//
// Two kinds of axis:
//   - WEEK: the whole trading week, Mon open → Fri close. The domain is [0, 5] in trading
//     days (Mon open = 0, Mon close = 1, …, Fri close = 5). Labels Mon · Tue · Wed · Thu ·
//     Fri sit under each day's slot, even on Thursday: the line stops at now and the days
//     to come stay empty.
//   - DATED: from the range's start to NOW, no future slots. The domain is [0, days], in
//     calendar days from `start`. 3–5 labels evenly spaced in time, the first at the start
//     and the last at now, "MMM d" (or "MMM" with `months`, for 1Y).
// The first label is left-aligned to its point and the last right-aligned, so neither leaves
// the plot; labels never overlap — interior labels are dropped first.
//
// Dates are ISO calendar days ('YYYY-MM-DD', the trading day in ET as the data already
// carries it) — never a Date in the device's zone, and no Intl (Hermes' formatToParts gaps).

export type AxisSpec =
  | { kind: 'week' }
  | { kind: 'dated'; start: string; end: string; months?: boolean; maxLabels?: number };

export type LabelAlign = 'left' | 'center' | 'right';

export interface AxisLabel {
  text: string;
  /** The anchor in plot pixels (the point the label belongs to). */
  x: number;
  align: LabelAlign;
  /** The label box's left edge after alignment and clamping into the plot. */
  left: number;
  width: number;
}

export const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
export const WEEK_DOMAIN: readonly [number, number] = [0, 5];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Minimum clear space between two labels' boxes. */
export const LABEL_GAP = 8;
/** §9C: 6pt between the plot's lowest point and the labels. */
export const AXIS_GAP = 6;
/** caption: 12/16 Medium. */
export const AXIS_FONT_SIZE = 12;
export const AXIS_LINE_HEIGHT = 16;

/** A conservative width estimate for an Archivo Medium caption, by glyph class (Archivo is
 * wide: M and W ≈ 0.95em, other capitals ≈ 0.75em, figures ≈ 0.65em, lower case ≈ 0.62em,
 * a space ≈ 0.3em). It decides which labels fit; over-estimating only drops one sooner.
 * The Chart positions labels by their aligned edge, so the estimate never clips the text. */
export function estimateLabelWidth(text: string, fontScale = 1): number {
  let em = 0;
  for (const ch of text) {
    if (ch === ' ') em += 0.3;
    else if (/[MWmw&]/.test(ch)) em += 0.95;
    else if (/[A-Z]/.test(ch)) em += 0.75;
    else if (/[0-9]/.test(ch)) em += 0.65;
    else em += 0.62;
  }
  return Math.ceil(em * AXIS_FONT_SIZE * fontScale);
}

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

function isoOf(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from `start` to `iso` (the DATED domain unit). */
export function dayOffset(start: string, iso: string): number {
  return dayNumber(iso) - dayNumber(start);
}

/** "Oct 9" (or "Oct" with `months`). */
export function formatAxisDate(iso: string, months = false): string {
  const [, m, d] = iso.split('-').map(Number);
  return months ? MONTHS[m - 1] : `${MONTHS[m - 1]} ${d}`;
}

/** The domain an axis spans, in its own units. */
export function axisDomain(spec: AxisSpec): [number, number] {
  if (spec.kind === 'week') return [WEEK_DOMAIN[0], WEEK_DOMAIN[1]];
  return [0, Math.max(0, dayOffset(spec.start, spec.end))];
}

/** What a point at domain position `t` is called — the scrub label and VoiceOver.
 * Week: the trading day it falls in (a close at t = 3 is Wednesday's, not Thursday's). */
export function pointName(spec: AxisSpec, t: number): string {
  if (spec.kind === 'week') {
    const i = Math.min(4, Math.max(0, Math.ceil(t) - 1));
    return WEEK_DAYS[t <= 0 ? 0 : i];
  }
  return formatAxisDate(isoOf(dayNumber(spec.start) + Math.round(t)));
}

/** The range the chart covers, for its VoiceOver label: "from Mon to Thu", "from Sep 29 to Oct 9".
 * `lastT` is the last real point (week: where the line stops); omitted, the whole range. */
export function axisRangeLabel(spec: AxisSpec, lastT?: number): string {
  if (spec.kind === 'week') {
    const end = lastT === undefined ? 'Fri' : pointName(spec, lastT);
    return end === 'Mon' ? 'Mon' : `from Mon to ${end}`;
  }
  const a = formatAxisDate(spec.start);
  const b = formatAxisDate(spec.end);
  return a === b ? a : `from ${a} to ${b}`;
}

interface Candidate {
  text: string;
  t: number;
  align: LabelAlign;
}

function place(c: Candidate, toX: (t: number) => number, plotWidth: number, measure: (s: string) => number): AxisLabel {
  const x = toX(c.t);
  const width = measure(c.text);
  let left = c.align === 'left' ? x : c.align === 'right' ? x - width : x - width / 2;
  left = Math.min(Math.max(0, left), Math.max(0, plotWidth - width));
  return { text: c.text, x, align: c.align, left, width };
}

/** No two boxes closer than LABEL_GAP (they're in x order). */
export function labelsOverlap(labels: AxisLabel[]): boolean {
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].left < labels[i - 1].left + labels[i - 1].width + LABEL_GAP) return true;
  }
  return false;
}

/** Candidate label sets, most labels first; the first that doesn't overlap wins. */
function candidateSets(spec: AxisSpec): Candidate[][] {
  if (spec.kind === 'week') {
    const all = WEEK_DAYS.map((text, i) => ({ text, t: i + 0.5, align: 'center' as LabelAlign }));
    // Interior first: Mon·Wed·Fri, then Mon·Fri, then Fri alone (where the week ends).
    return [all, [all[0], all[2], all[4]], [all[0], all[4]], [all[4]]];
  }
  const span = Math.max(0, dayOffset(spec.start, spec.end));
  const fmt = (t: number) => formatAxisDate(isoOf(dayNumber(spec.start) + Math.round(t)), spec.months);
  if (span === 0) return [[{ text: fmt(0), t: 0, align: 'left' }]];
  const sets: Candidate[][] = [];
  const most = Math.min(5, Math.max(2, spec.maxLabels ?? 5));
  for (let n = most; n >= 2; n--) {
    const set: Candidate[] = [];
    for (let k = 0; k < n; k++) {
      const t = (span * k) / (n - 1);
      set.push({ text: fmt(t), t, align: k === 0 ? 'left' : k === n - 1 ? 'right' : 'center' });
    }
    // Neighbours that round to the same text say nothing new: fewer labels. (Only
    // neighbours: 1Y's "Oct … Oct" are a year apart.)
    if (set.every((c, k) => k === 0 || c.text !== set[k - 1].text)) sets.push(set);
  }
  sets.push([{ text: fmt(span), t: span, align: 'right' }]);
  return sets;
}

/**
 * The labels to draw for `spec` across a plot `plotWidth` wide, where `toX` maps a domain
 * position to plot pixels. Tries the fullest set first and drops interior labels until
 * nothing overlaps; the last resort is one label (the week's Fri, or "now").
 */
export function layoutAxis(
  spec: AxisSpec,
  plotWidth: number,
  toX: (t: number) => number,
  measure: (s: string) => number = (s) => estimateLabelWidth(s),
): AxisLabel[] {
  const sets = candidateSets(spec);
  for (const set of sets) {
    const placed = set.map((c) => place(c, toX, plotWidth, measure));
    if (!labelsOverlap(placed)) return placed;
  }
  const last = sets[sets.length - 1];
  return last.map((c) => place(c, toX, plotWidth, measure));
}
