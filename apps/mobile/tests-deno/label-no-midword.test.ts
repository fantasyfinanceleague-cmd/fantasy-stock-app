/**
 * No word in a LABEL ever breaks mid-letter (Design Lead ruling, 2026-10-19). League settings at XXXL broke
 * "Commissioner" into "Commis / sioner" (the interactive row: label, value, chevron on one line, the label column
 * squeezed), lost "Draft time" altogether, and split the invite code ("SCUD / 26") beside Share.
 *
 * The rule here is a layout rule: a label never shrinks below its own width, and whatever does not fit beside it
 * (a value, a chevron, a switch, a button) wraps to the next line instead.
 *
 * Flex layout cannot run under Deno, so the pin is a small model of how Yoga lays out a row, whose PARAMETERS are
 * read from the real style blocks (a label's flexGrow / flexShrink / flexBasis, whether the row wraps, the gap): change
 * the source and the model changes with it. Real label strings are run through it at every Dynamic Type scale and a
 * range of card widths; a label word may only break when it is wider than the whole row (nothing a row can do).
 * A negative control runs the OLD row (label flex: 1, no wrap) and proves the model reproduces the bug.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { space } from '../constants/tokens/space.ts';
import { COMMISSIONER_ROW } from '../lib/game/leaveLeague.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// ---------------------------------------------------------------------------------------------------------------
// Style blocks, read from the source
// ---------------------------------------------------------------------------------------------------------------

type Style = Record<string, string>;

/** `name: { a: 1, b: 'x' }` (one line or several), at style level. Comments stripped. */
function styleBlock(file: string, name: string): Style {
  const src = SOURCES[file];
  assert(src, `no source for ${file}`);
  const m = new RegExp(`(?:^|\\n)\\s*${name}: \\{([^}]*)\\}`).exec(src);
  assert(m, `${file}: no style block ${name}`);
  const body = m[1].replace(/\/\/[^\n]*/g, '');
  const out: Style = {};
  for (const part of body.split(/[,\n]/)) {
    const kv = /^\s*(\w+):\s*(.+?)\s*$/.exec(part);
    if (kv) out[kv[1]] = kv[2].replace(/^'|'$/g, '');
  }
  return out;
}

const num = (v: string | undefined, d = 0) => {
  if (v === undefined) return d;
  const sp = /^space\[(\d+)\]$/.exec(v);
  if (sp) return (space as unknown as Record<number, number>)[Number(sp[1])];
  const n = Number(v);
  return Number.isNaN(n) ? d : n;
};

// ---------------------------------------------------------------------------------------------------------------
// Text and layout models
// ---------------------------------------------------------------------------------------------------------------

/** iOS Dynamic Type scales, Large to AX5 (XXXL in the app's tests). */
const SCALES = [1, 1.12, 1.23, 1.35, 1.64, 1.95, 2.35, 2.76, 3.12];
/** Calibrated on a 17e at XXXL: "Commissioner" (semibold callout, 12 glyphs) measured 311pt wide at scale 3.12. */
const GLYPH = 311 / 12 / 3.12;
const textW = (s: string, scale: number) => s.length * GLYPH * scale;
/** Break opportunities in a label: a space, or just after a hyphen. A piece wider than its line breaks mid-letter. */
const pieces = (label: string) => label.split(/\s+|(?<=-)/).filter(Boolean);

interface Item {
  name: string;
  /** Width at max-content (a Text measured with no limit), or a fixed width. */
  mc: number;
  fixed?: boolean;
  grow: number;
  shrink: number;
  /** flex: 1 (basis 0) rather than auto. */
  basisZero?: boolean;
}
interface RowModel {
  wrap: boolean;
  gap: number;
  /** [alignItems, flexWrap] etc. are not modelled: only what decides a width. */
}

/** The width each item ends up with (Yoga: an auto basis is measured at most the container wide). */
function layoutRow(items: Item[], container: number, row: RowModel): Record<string, number> {
  const basis = (it: Item) => (it.basisZero ? 0 : it.fixed ? it.mc : Math.min(it.mc, container));
  const lines: Item[][] = [];
  if (!row.wrap) lines.push(items);
  else {
    let line: Item[] = [];
    let used = 0;
    for (const it of items) {
      const add = (line.length ? row.gap : 0) + basis(it);
      if (line.length && used + add > container) { lines.push(line); line = []; used = 0; }
      used += (line.length ? row.gap : 0) + basis(it);
      line.push(it);
    }
    if (line.length) lines.push(line);
  }
  const out: Record<string, number> = {};
  for (const line of lines) {
    const gaps = row.gap * (line.length - 1);
    const total = line.reduce((n, it) => n + basis(it), 0) + gaps;
    const free = container - total;
    if (free >= 0) {
      const g = line.reduce((n, it) => n + it.grow, 0);
      for (const it of line) out[it.name] = basis(it) + (g > 0 ? (free * it.grow) / g : 0);
    } else {
      const f = line.reduce((n, it) => n + it.shrink * basis(it), 0);
      for (const it of line) out[it.name] = Math.max(0, basis(it) + (f > 0 ? (free * it.shrink * basis(it)) / f : 0));
    }
  }
  return out;
}

/** Pieces of `label` that cannot sit on a line of `width` (they break mid-letter, or the label is gone). */
function brokenPieces(label: string, width: number, scale: number): string[] {
  return pieces(label).filter((p) => textW(p, scale) > width + 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// The rows, with their parameters read from the source
// ---------------------------------------------------------------------------------------------------------------

const SETUP = 'components/game/SetupRows.tsx';
const SETTINGS = 'app/league-settings.tsx';
const TRADE = 'components/money/TradeReviewPanel.tsx';
const RENEWAL = 'components/game/RenewalReview.tsx';
const ROSTER = 'components/game/RenewalRoster.tsx';

const CHEVRON = 24;
const SWITCH = 51;
const SHARE_BTN = (scale: number) => Math.min(textW('Share', scale), 90) + 32;

/** A label item from a style block: `flex: 1` is basis 0 / grow 1 / shrink 1; otherwise the longhands (RN: shrink 0). */
function labelItem(s: Style, mc: number): Item {
  if (s.flex !== undefined) return { name: 'label', mc, grow: num(s.flex), shrink: 1, basisZero: true };
  return { name: 'label', mc, grow: num(s.flexGrow), shrink: num(s.flexShrink, 0), basisZero: s.flexBasis === '0' };
}

type RowSpec = { name: string; file: string; row: string; extraRow?: string; label: string; trailing: (scale: number) => Item[] };

/** Row layouts that put a label beside something. `row` styles are merged (later wins), as `[a, b]` styles are. */
const ROWS: RowSpec[] = [
  { name: 'SettingRow (value + chevron)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap',
    trailing: (sc) => [{ name: 'value', mc: textW('You', sc), grow: 0, shrink: 1 }, { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'SettingRow (chevron only)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap',
    trailing: () => [{ name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'SettingRow (a long value)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap',
    trailing: (sc) => [{ name: 'value', mc: textW('Sat, Oct 3 · 7:00 PM ET', sc), grow: 0, shrink: 1 }, { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'SwitchRow', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap',
    trailing: () => [{ name: 'switch', mc: SWITCH, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'InviteRow (Share)', file: SETTINGS, row: 'inviteRow', label: 'inviteTexts',
    trailing: (sc) => [{ name: 'share', mc: SHARE_BTN(sc), fixed: true, grow: 0, shrink: 0 }] },
  { name: 'Trade review row', file: TRADE, row: 'row', label: 'rowLabel',
    trailing: (sc) => [{ name: 'value', mc: textW('$3,538,500.00', sc), fixed: true, grow: 0, shrink: 0 }] },
];

const LABELS = [
  COMMISSIONER_ROW, 'Draft time', 'League settings', 'Invite code', 'Playoff teams', 'Category', 'Stakes', 'Duration',
  'Allow non-draftable stocks (full universe)', 'Estimated total',
];
/** Card inner widths: a 375pt phone to a 430pt phone, less the screen gutter and the card padding. */
const CONTAINERS = [280, 300, 315, 330, 350, 370];

function labelWidth(spec: RowSpec, label: string, container: number, scale: number): number {
  const rowStyle = { ...styleBlock(spec.file, spec.row), ...(spec.extraRow ? styleBlock(spec.file, spec.extraRow) : {}) };
  const model: RowModel = { wrap: rowStyle.flexWrap === 'wrap', gap: num(rowStyle.columnGap ?? rowStyle.gap) };
  const mc = pieces(label).reduce((n, p) => n + textW(p, scale), 0) + (pieces(label).length - 1) * GLYPH * scale * 0.35;
  const items = [labelItem(styleBlock(spec.file, spec.label), mc), ...spec.trailing(scale)];
  return layoutRow(items, container, model).label;
}

Deno.test('every row that holds a label keeps each word whole, at every Dynamic Type scale and card width', () => {
  for (const spec of ROWS) {
    for (const label of LABELS) {
      for (const scale of SCALES) {
        for (const container of CONTAINERS) {
          const w = labelWidth(spec, label, container, scale);
          // A piece wider than the WHOLE row cannot be helped by any layout (only a font cap could); everything else must hold.
          const unavoidable = (p: string) => textW(p, scale) > container;
          const bad = brokenPieces(label, w, scale).filter((p) => !unavoidable(p));
          assertEquals(bad, [], `${spec.name}: "${label}" at x${scale}, card ${container}pt gets ${Math.round(w)}pt: ${bad.join(' / ')}`);
        }
      }
    }
  }
});

Deno.test('the reported break: "Commissioner" at XXXL on a 17e card (330pt) stays whole', () => {
  const spec = ROWS[0];
  assert(textW(COMMISSIONER_ROW, 3.12) < 330, 'the word itself fits a 17e card at XXXL (calibration)');
  assertEquals(brokenPieces(COMMISSIONER_ROW, labelWidth(spec, COMMISSIONER_ROW, 330, 3.12), 3.12), []);
});

Deno.test('negative control: the OLD interactive row (label flex: 1, no wrap) breaks the same word, and drops "Draft time"', () => {
  const old: RowModel = { wrap: false, gap: space[3] };
  const sc = 3.12;
  const commissioner = layoutRow(
    [{ name: 'label', mc: textW(COMMISSIONER_ROW, sc), grow: 1, shrink: 1, basisZero: true },
      { name: 'value', mc: textW('You', sc), grow: 0, shrink: 1 }, { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }],
    330, old,
  ).label;
  assert(brokenPieces(COMMISSIONER_ROW, commissioner, sc).length > 0, `the old row left "Commissioner" ${Math.round(commissioner)}pt`);
  const draftTime = layoutRow(
    [{ name: 'label', mc: textW('Draft time', sc), grow: 1, shrink: 1, basisZero: true },
      { name: 'value', mc: textW('Sat, Oct 3 · 7:00 PM ET', sc), grow: 0, shrink: 1 }, { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }],
    330, old,
  ).label;
  assert(draftTime < 20, `the old row left "Draft time" ${Math.round(draftTime)}pt (gone)`);
  // the model also sees the cure: the same row, wrapping, label not shrinking
  assertEquals(brokenPieces(COMMISSIONER_ROW, labelWidth(ROWS[0], COMMISSIONER_ROW, 330, sc), sc), []);
});

Deno.test('the model fails when a row stops protecting its label (so the pass above means something)', () => {
  // shrink: a label that CAN shrink, in a row that does not wrap, loses its words
  const sc = 3.12;
  const w = layoutRow(
    [{ name: 'label', mc: textW(COMMISSIONER_ROW, sc), grow: 1, shrink: 1 }, { name: 'value', mc: textW('You', sc), grow: 0, shrink: 1 },
      { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }],
    330, { wrap: false, gap: 12 },
  ).label;
  assert(brokenPieces(COMMISSIONER_ROW, w, sc).length > 0);
  // wrap alone, with a label that does not shrink and a value that does: the value moves instead
  const ok = layoutRow(
    [{ name: 'label', mc: textW(COMMISSIONER_ROW, sc), grow: 1, shrink: 0 }, { name: 'value', mc: textW('You', sc), grow: 0, shrink: 1 },
      { name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }],
    330, { wrap: true, gap: 12 },
  ).label;
  assertEquals(brokenPieces(COMMISSIONER_ROW, ok, sc), []);
});

// ---------------------------------------------------------------------------------------------------------------
// The source: each row wears the layout the model assumes
// ---------------------------------------------------------------------------------------------------------------

Deno.test('SettingRow and SwitchRow: every row wraps, the label never shrinks, the control rides to the right edge of its line', () => {
  const src = SOURCES[SETUP];
  const wrap = styleBlock(SETUP, 'settingRowWrap');
  assertEquals(wrap.flexWrap, 'wrap');
  const label = styleBlock(SETUP, 'growWrap');
  assertEquals([label.flexGrow, label.flexShrink, label.flexBasis], ['1', '0', 'auto']);
  assertEquals(styleBlock(SETUP, 'trailing').marginLeft, 'auto');
  // SettingRow and SwitchRow both use them, for every row (a row with a chevron too): never the old flex: 1 label
  assert(src.includes('styles.settingRow, styles.settingRowWrap, disabled && styles.dim'));
  assertEquals(src.split('<View style={styles.growWrap}>').length - 1, 2, 'SettingRow and SwitchRow both use the wrapping label');
  assertEquals(src.split('<View style={styles.trailing}>').length - 1, 2, 'the chevron and the switch both ride with the value');
  assertEquals(src.split('styles.settingRow, styles.settingRowWrap').length - 1, 2);
  assert(!src.includes('wraps ?'), 'no pressable/static split any more');
});

Deno.test('InviteRow: the code is a wrapping row; Share drops under the code instead of squeezing it', () => {
  const row = styleBlock(SETTINGS, 'inviteRow');
  assertEquals(row.flexWrap, 'wrap');
  assertEquals(row.alignContent, 'center');
  const texts = styleBlock(SETTINGS, 'inviteTexts');
  assertEquals([texts.flexGrow, texts.flexShrink, texts.flexBasis], ['1', '0', 'auto']);
  assertEquals(styleBlock(SETTINGS, 'inviteShare').marginLeft, 'auto');
  const src = SOURCES[SETTINGS];
  assert(src.includes('<View style={styles.inviteTexts}>'));
  assert(src.includes('<View style={styles.inviteShare}>'));
});

Deno.test('Trade review rows, the Renewal stepper row and the draft rows wrap, and the review label never shrinks', () => {
  const row = styleBlock(TRADE, 'row');
  assertEquals(row.flexWrap, 'wrap');
  const label = styleBlock(TRADE, 'rowLabel');
  assertEquals([label.flexGrow, label.flexShrink, label.flexBasis], ['1', '0', 'auto']);
  assert(label.flex === undefined, 'the review label is no longer flex: 1');
  assertEquals(styleBlock(RENEWAL, 'stepRow').flexWrap, 'wrap');
  assertEquals(styleBlock(ROSTER, 'draftRow').flexWrap, 'wrap');
  // the rows that already wrapped keep doing so
  assertEquals(styleBlock(RENEWAL, 'row').flexWrap, 'wrap');
});

Deno.test('a wrapping row that centres a single line: alignContent center (the Large pixel diff: text sat ~1pt high without it)', () => {
  assertEquals(styleBlock(SETUP, 'settingRowWrap').alignContent, 'center');
  assertEquals(styleBlock(SETTINGS, 'inviteRow').alignContent, 'center');
  assertEquals(styleBlock(TRADE, 'row').alignContent, 'center');
  assertEquals(styleBlock(RENEWAL, 'stepRow').alignContent, 'center');
  assertEquals(styleBlock(ROSTER, 'draftRow').alignContent, 'center');
});

Deno.test('the rows that stay as they were: the Steppers stack from the accessibility scale; Join rows keep a label that never shrinks', () => {
  // game/Stepper.tsx stacks its box under the label at FULL_WIDTH_FONT_SCALE (the W4 "Manager / s" fix)
  assert(SOURCES['components/game/Stepper.tsx'].includes('const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;'));
  // app/join-league.tsx: the preview rows stack at that scale too; below it the label is a Text with the default flexShrink 0
  assert(SOURCES['app/join-league.tsx'].includes('const stackRows = fontScale >= FULL_WIDTH_FONT_SCALE;'));
  assert(!/rowLabel/.test(SOURCES['app/join-league.tsx']), 'the join rows give the label no shrinking style');
});
