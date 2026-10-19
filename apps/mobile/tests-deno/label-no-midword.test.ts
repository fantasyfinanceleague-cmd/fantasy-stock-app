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
import { LABEL_COLLAPSED_PT, labelBreaksMidWord, labelCollapsed } from '../lib/game/labelBreaks.ts';
import { BEST_WEEK_TILE_TITLE, PLAYOFFS_TILE_TITLE, REGULAR_SEASON_TILE_TITLE, SEASON_GAIN_TILE_TITLE } from '../lib/home/homeCopy.ts';
import { COPY } from '../lib/money/moneyCopy.ts';
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

type RowSpec = {
  name: string; file: string; row: string; extraRow?: string; label: string; trailing: (scale: number) => Item[];
  /** The row's text stops growing here (maxFontSizeMultiplier). */ cap?: () => number;
  /** This row's own labels (default: the settings rows'). */ labels?: string[];
  /** 'reactive': the row lays out as it always did (`row` + `unstacked`) until its label breaks mid-word or collapses, then stacks
   * (`row` + `extraRow`, `label`). Default: always the stacked layout. */
  unstackedLabel?: string; unstackedRow?: string;
};

/** Row layouts that put a label beside something. `row` styles are merged (later wins), as `[a, b]` styles are. */
const ROWS: RowSpec[] = [
  { name: 'SettingRow (value + chevron)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap', unstackedLabel: 'grow',
    trailing: (sc) => [{ name: 'value+chevron', mc: textW('You', sc) + space[3] + CHEVRON, grow: 0, shrink: 1 }] },
  { name: 'SettingRow (chevron only)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap', unstackedLabel: 'grow',
    trailing: () => [{ name: 'chevron', mc: CHEVRON, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'SettingRow (a long value)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap', unstackedLabel: 'grow',
    trailing: (sc) => [{ name: 'value+chevron', mc: textW('Sat, Oct 3 · 7:00 PM ET', sc) + space[3] + CHEVRON, grow: 0, shrink: 1 }] },
  { name: 'SettingRow (static, no help line: always stacked)', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap',
    trailing: (sc) => [{ name: 'value', mc: textW('The commissioner', sc), grow: 0, shrink: 1 }] },
  { name: 'SwitchRow', file: SETUP, row: 'settingRow', extraRow: 'settingRowWrap', label: 'growWrap', unstackedLabel: 'grow',
    trailing: () => [{ name: 'switch', mc: SWITCH, fixed: true, grow: 0, shrink: 0 }] },
  { name: 'InviteRow (Share)', file: SETTINGS, row: 'inviteRow', label: 'inviteTexts',
    trailing: (sc) => [{ name: 'share', mc: SHARE_BTN(sc), fixed: true, grow: 0, shrink: 0 }] },
  // The review's rows (text capped at REVIEW_TEXT_MAX_SCALE): the value never shrinks, so beside the sale row's
  // "12.5 NVDA · all you hold" the old label was left a few pt wide at the cap. Real labels and the longest real value.
  { name: 'Trade review row (capped text)', file: TRADE, row: 'row', label: 'rowLabel', cap: () => Number(/REVIEW_TEXT_MAX_SCALE = ([\d.]+)/.exec(SOURCES[TRADE])![1]),
    labels: ['Sell', 'Buy', 'Price', COPY.backToBudget, COPY.budgetLeftAfter, COPY.youGet, COPY.paidFrom, COPY.leftInSlot],
    trailing: (sc) => [{ name: 'value', mc: textW(`12.5 NVDA · ${COPY.allYouHold}`, sc), fixed: true, grow: 0, shrink: 0 }] },
];

const LABELS = [
  COMMISSIONER_ROW, 'Draft time', 'League settings', 'Invite code', 'Playoff teams', 'Category', 'Stakes', 'Duration',
  'Allow non-draftable stocks (full universe)', 'Estimated total',
];
/** Card inner widths: a 375pt phone to a 430pt phone, less the screen gutter and the card padding. */
const CONTAINERS = [280, 300, 315, 330, 350, 370];

function layoutLabel(spec: RowSpec, label: string, container: number, scale: number, stacked: boolean): number {
  const base = styleBlock(spec.file, spec.row);
  const rowStyle = stacked ? { ...base, ...(spec.extraRow ? styleBlock(spec.file, spec.extraRow) : {}) } : base;
  const model: RowModel = { wrap: rowStyle.flexWrap === 'wrap', gap: num(rowStyle.columnGap ?? rowStyle.gap) };
  const mc = pieces(label).reduce((n, p) => n + textW(p, scale), 0) + (pieces(label).length - 1) * GLYPH * scale * 0.35;
  const items = [labelItem(styleBlock(spec.file, stacked || !spec.unstackedLabel ? spec.label : spec.unstackedLabel), mc), ...spec.trailing(scale)];
  return layoutRow(items, container, model).label;
}

/** The label's width once the row has settled: a reactive row starts as it always did and stacks the moment its label
 * breaks inside a word or collapses (labelBreaksMidWord / labelCollapsed on the real device); the others are always stacked. */
function labelWidth(spec: RowSpec, label: string, container: number, scaleIn: number): number {
  const scale = spec.cap ? Math.min(scaleIn, spec.cap()) : scaleIn;
  if (!spec.unstackedLabel) return layoutLabel(spec, label, container, scale, true);
  const first = layoutLabel(spec, label, container, scale, false);
  const broke = brokenPieces(label, first, scale).length > 0 || labelCollapsed(first);
  return broke ? layoutLabel(spec, label, container, scale, true) : first;
}

Deno.test('every row that holds a label keeps each word whole, at every Dynamic Type scale and card width', () => {
  for (const spec of ROWS) {
    for (const label of spec.labels ?? LABELS) {
      for (const scale of SCALES) {
        for (const container of CONTAINERS) {
          const w = labelWidth(spec, label, container, scale);
          const eff = spec.cap ? Math.min(scale, spec.cap()) : scale;
          // A piece wider than the WHOLE row cannot be helped by any layout (only a font cap could); everything else must hold.
          const unavoidable = (p: string) => textW(p, eff) > container;
          const bad = brokenPieces(label, w, eff).filter((p) => !unavoidable(p));
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

Deno.test('negative control: the OLD trade review row (label flex: 1, no wrap) breaks "Sell" at the text cap', () => {
  const cap = 1.6;
  const w = layoutRow(
    [{ name: 'label', mc: textW('Sell', cap), grow: 1, shrink: 1, basisZero: true }, { name: 'value', mc: textW(`12.5 NVDA · ${COPY.allYouHold}`, cap), fixed: true, grow: 0, shrink: 0 }],
    330, { wrap: false, gap: space[5] },
  ).label;
  assert(brokenPieces('Sell', w, cap).length > 0, `the old review row left "Sell" ${Math.round(w)}pt`);
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

Deno.test('SettingRow and SwitchRow: the stacked layout (wrap, a label that never shrinks) applies once the label breaks; a static row without a help line is always stacked', () => {
  const src = SOURCES[SETUP];
  const wrap = styleBlock(SETUP, 'settingRowWrap');
  assertEquals(wrap.flexWrap, 'wrap');
  const label = styleBlock(SETUP, 'growWrap');
  assertEquals([label.flexGrow, label.flexShrink, label.flexBasis], ['1', '0', 'auto']);
  // the layout before it breaks is the one the rows always had: a flex: 1 label, no wrap
  const old = styleBlock(SETUP, 'grow');
  assertEquals(old.flex, '1');
  assert(styleBlock(SETUP, 'settingRow').flexWrap === undefined, 'the unstacked row does not wrap');
  assertEquals(styleBlock(SETUP, 'trailing').marginLeft, 'auto');
  // a value and its chevron are ONE wrap item: the chevron is never left alone on a line
  const pair = styleBlock(SETUP, 'valueWithChevron');
  assertEquals([pair.flexDirection, pair.flexShrink], ['row', '1']);
  assert(src.includes('<View style={styles.valueWithChevron}>'));
  // the switch: unstacked, the Switch sits directly in the row (as it always did); stacked, it rides in `trailing`
  assert(src.includes('{broke ? <View style={styles.trailing}>{sw}</View> : sw}'));
  assert(src.includes('{onPress ? stack ? <View style={styles.trailing}>{chevron}</View> : chevron : null}'));
  assert(src.includes('<View style={broke ? styles.growWrap : styles.grow} onLayout={onLayout}>'));
  assert(src.includes('const { broke, onTextLayout, onLayout } = useLabelBreaks();'));
  // SettingRow: always stacked when static without a help line; otherwise only once the label breaks
  assert(src.includes('const stack = (!onPress && !sub) || broke;'));
  assert(src.includes('<View style={stack ? styles.growWrap : styles.grow} onLayout={onPress || sub ? onLabelBox : undefined}>'));
  assert(src.includes('<RowKey maxScale={maxScale} onTextLayout={onPress || sub ? onLabelLayout : undefined}>'));
  // the detection: the label's broken lines, or a collapsed label column; reset when the text size changes
  assert(src.includes('if (labelBreaksMidWord(e.nativeEvent.lines)) setBrokeAt(fontScale);'));
  assert(src.includes('if (labelCollapsed(e.nativeEvent.layout.width)) setBrokeAt(fontScale);'));
  assert(src.includes('broke: brokeAt === fontScale'));
});

Deno.test('labelBreaksMidWord / labelCollapsed: the device lines for a squeezed and a stacked "Commissioner"', () => {
  // read off a 17e at XXXL (Metro log): the interactive row, squeezed, then stacked
  assertEquals(labelBreaksMidWord([{ text: 'Commis' }, { text: 'sioner' }]), true);
  assertEquals(labelBreaksMidWord([{ text: 'Commissioner' }]), false);
  // iOS keeps the trailing space of a line that broke between words, and the hyphen of one that broke after it
  assertEquals(labelBreaksMidWord([{ text: 'Draft ' }, { text: 'time' }]), false);
  assertEquals(labelBreaksMidWord([{ text: 'Allow non-' }, { text: 'draftable ' }, { text: 'stocks (full ' }, { text: 'universe)' }]), false);
  assertEquals(labelBreaksMidWord([{ text: 'Seaso' }, { text: 'n gain' }]), true);
  assertEquals(labelBreaksMidWord([]), false);
  assertEquals(labelBreaksMidWord([{ text: 'Name' }]), false);
  // a label squeezed to nothing has no lines to break: its column's width says so
  assert(labelCollapsed(0));
  assert(labelCollapsed(LABEL_COLLAPSED_PT - 0.5));
  assert(!labelCollapsed(LABEL_COLLAPSED_PT));
  assert(!labelCollapsed(96));
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

// ---------------------------------------------------------------------------------------------------------------
// The season-complete tiles (Home): a two-across grid whose captions broke at XXXL ("Seaso / n gain")
// ---------------------------------------------------------------------------------------------------------------

const TILES = 'components/home/SeasonCompleteCard.tsx';
/** A caption glyph, calibrated on a 17e at XXXL: "Seaso" (5 glyphs) measured 120pt at scale 3.12. */
const CAPTION_GLYPH = 120 / 5 / 3.12;
const STACK_AT = Number(/FULL_WIDTH_FONT_SCALE = ([\d.]+)/.exec(SOURCES['components/sp/Button.tsx'])![1]);

/** Home's card is the screen less its gutters (350pt on a 390pt phone) and pads 20pt inside; the inset panel is the rest
 * (measured 310pt on a 17e). */
const CARD_PAD = 20;
/** The width one tile gets in the inset panel: two across (basis max(minWidth, 40%)) until `stacked`, then one per row. */
function tileWidth(card: number, stacked: boolean): number {
  const container = card - 2 * CARD_PAD;
  const grid = styleBlock(TILES, 'tilesGrid');
  const tile = styleBlock(TILES, 'tile');
  const pad = num(grid.padding);
  const gap = num(grid.gap);
  const inner = container - 2 * pad;
  const basisPct = (v: string | undefined) => (v && v.endsWith('%') ? (Number(v.slice(0, -1)) / 100) * inner : num(v));
  const base = Math.max(basisPct(tile.flexBasis), num(tile.minWidth));
  const eff = stacked ? Math.max(basisPct(styleBlock(TILES, 'tileStacked').flexBasis), num(tile.minWidth)) : base;
  const perLine = Math.max(1, Math.floor((inner + gap) / (eff + gap)));
  return perLine === 1 ? inner : (inner - gap * (perLine - 1)) / perLine;
}

Deno.test('the season-complete tiles: two across until the accessibility scale, then one per row; no caption word breaks', () => {
  const captions = [SEASON_GAIN_TILE_TITLE, BEST_WEEK_TILE_TITLE, REGULAR_SEASON_TILE_TITLE, PLAYOFFS_TILE_TITLE];
  for (const scale of SCALES) {
    for (const container of [335, 350, 390]) {
      const w = tileWidth(container, scale >= STACK_AT);
      for (const c of captions) {
        const bad = pieces(c).filter((p) => p.length * CAPTION_GLYPH * scale > w && p.length * CAPTION_GLYPH * scale <= container - 2 * CARD_PAD - 24);
        assertEquals(bad, [], `"${c}" at x${scale}, card ${container}pt: tile ${Math.round(w)}pt breaks ${bad.join(' / ')}`);
      }
    }
  }
  // the reported break, reproduced: at XXXL on a 17e card (350pt), two across, "Season" is wider than its half
  assert(pieces(SEASON_GAIN_TILE_TITLE)[0].length * CAPTION_GLYPH * 3.12 > tileWidth(350, false), 'the old two-across tile breaks "Season"');
  assert(pieces(SEASON_GAIN_TILE_TITLE)[0].length * CAPTION_GLYPH * 3.12 <= tileWidth(350, true), 'one per row fits it');
});

Deno.test('SeasonCompleteCard: the tiles stack from FULL_WIDTH_FONT_SCALE (all four use the stacking style)', () => {
  const src = SOURCES[TILES];
  assert(src.includes('const { fontScale } = useWindowDimensions();'));
  assert(src.includes('fontScale >= FULL_WIDTH_FONT_SCALE ? [styles.tile, styles.tileStacked] : styles.tile'));
  assertEquals(styleBlock(TILES, 'tileStacked').flexBasis, '100%');
  assertEquals(src.split('<View style={tileStyle}>').length - 1, 4, 'all four tiles');
  assert(!src.includes('<View style={styles.tile}>'), 'no tile skips the stacking style');
});
