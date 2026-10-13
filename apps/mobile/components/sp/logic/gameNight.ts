// Stockpile — the Game Night primitives' pure logic (§9C "Components (the W3 primitives)",
// 2026-10-12, with the Design Lead's player-card order of the same day). No RN: each rule
// a component draws by is here, so tests-deno/game-night-primitives.test.ts pins it.
//
// Copy is the spec's own words (§9C and PRODUCT_RULES), nothing new; "Dead even" is the
// app's existing tie line (components/sp/game/Scoreboard.tsx).

import type { ThemeColors } from '../../../constants/tokens/color';
import { formatMoney, formatPercent } from './money';
import { ordinal } from '../../../lib/home/ordinal';
import { COPY as MONEY_COPY } from '../../../lib/money/moneyCopy';
import { estimateLabelWidth } from './chartAxis';

// ── Scoreboard (Matchup) ─────────────────────────────────────────────────────────

export type Side = 'you' | 'opp';

export interface ScoreSide {
  name: string;
  gain: number;
}

export interface ScoreboardModel {
  /** Who leads — said by the totals and the line only. The SHADED half is always yours
   * (Giorgio, 2026-10-12: your side is shaded, win or lose), never the leader's. */
  leader: Side | null;
  /** The one line under the card: "{name} leads by {margin}" (or "won by"). */
  line: string;
}

export function scoreboardModel(you: ScoreSide, opp: ScoreSide, final: boolean): ScoreboardModel {
  if (you.gain === opp.gain) return { leader: null, line: 'Dead even' };
  const leader: Side = you.gain > opp.gain ? 'you' : 'opp';
  const name = leader === 'you' ? you.name : opp.name;
  const margin = formatMoney(Math.abs(you.gain - opp.gain));
  return { leader, line: `${name} ${final ? 'won by' : 'leads by'} ${margin}` };
}

// ── RosterRow (Matchup) ──────────────────────────────────────────────────────────

/** What a roster half draws, in order: the stock's name, and its week number unless the half
 * carries no figures (a withheld final — #call-mx-withheld, B: who held what, never a number).
 * Stacked (large text): the name over the number. Side by side: the number faces the centre. */
export type RosterPart = 'name' | 'num';
export function rosterHalfParts(opts: { figures?: boolean; stacked: boolean; mirror: boolean }): RosterPart[] {
  if (opts.figures === false) return ['name'];
  if (opts.stacked) return ['name', 'num'];
  return opts.mirror ? ['num', 'name'] : ['name', 'num'];
}

/** VoiceOver's label for a roster half: whose it is first, then the stock and — unless the half
 * carries no figures — its week ("Yours, NVDA …" / "Gianluigi B., NKE …"). */
export function rosterHalfLabel(whose: string, half: { ticker: string; company: string; weekGain: number; weekPct: number; figures?: boolean }): string {
  if (half.figures === false) return `${whose}, ${half.ticker}, ${half.company}`;
  return `${whose}, ${half.ticker}, ${half.company}, ${formatMoney(half.weekGain, { sign: 'always' })} this week, ${formatPercent(half.weekPct, { sign: 'always' })}`;
}

/** Giorgio, 2026-10-12: YOUR side is shaded in your colour, win or lose — on the Scoreboard
 * and on every roster row. No per-row winner lighting; who leads lives in the totals and the
 * "leads by" line. Your side is the left half. */
export const SHADED_SIDE = 'left' as const;

export type Tone = 'gain' | 'loss' | 'zero';
export function toneOf(n: number): Tone {
  return n > 0 ? 'gain' : n < 0 ? 'loss' : 'zero';
}

// ── Categories (DraftTile, CategoryPill) ─────────────────────────────────────────

/** The 11 real categories (supabase/seed/categories.json slugs). */
export type Category =
  | 'tech' | 'finance' | 'health' | 'energy' | 'transport' | 'retail'
  | 'food' | 'media' | 'industrials' | 'realestate' | 'misc';

export interface CategoryInfo {
  /** The short pill name (Giorgio, 2026-10-12). */
  pill: string;
  /** The 3-letter draft-tile code. */
  code: string;
  /** Its colour token (§9C v3.1's 11 `cat*`; Misc is the neutral `catMisc`). */
  color: keyof ThemeColors;
}

/** Giorgio's names and codes and §9C v3.1's colours (2026-10-12). Data only: a new
 * category or colour is a row here, not code. */
export const CATEGORIES: Record<Category, CategoryInfo> = {
  tech: { pill: 'Tech', code: 'TEC', color: 'catTech' },
  finance: { pill: 'Finance', code: 'FIN', color: 'catFinance' },
  health: { pill: 'Health', code: 'HLT', color: 'catHealth' },
  energy: { pill: 'Energy', code: 'NRG', color: 'catEnergy' },
  transport: { pill: 'Autos', code: 'AUT', color: 'catTransport' },
  retail: { pill: 'Retail', code: 'RTL', color: 'catRetail' },
  food: { pill: 'Food', code: 'F&B', color: 'catFood' },
  media: { pill: 'Media', code: 'MED', color: 'catMedia' },
  industrials: { pill: 'Industry', code: 'IND', color: 'catIndustrials' },
  realestate: { pill: 'Property', code: 'PRP', color: 'catRealEstate' },
  misc: { pill: 'Misc', code: 'MSC', color: 'catMisc' },
};

/** §9C: the category line's height at the bottom of a draft tile. */
export const SECTOR_LINE = 3;
/** §9C: the on-the-clock cell's ring. */
export const CLOCK_RING = 2;

export type DraftTileState = 'picked' | 'empty' | 'onClock';

export interface DraftTileLook {
  fill: string;
  /** The 3pt category line at the bottom; null = none. A tile is NEVER filled with its
   * category (Giorgio, 2026-10-12: "with that line at the bottom … without it being like a
   * carbon copy of Sleeper"). */
  line: string | null;
  ring: string | null;
  labelInk: string;
  tickerInk: string;
}

/** VoiceOver's label for a draft tile. Whose pick it is comes first on yours ("Yours, pick
 * 11, AAPL, Tech"), as RosterRow's "Yours, NVDA …" (W3); an auto-pick says so, since the tile
 * has no room for the old "Auto" tag (the pick log keeps the source in words). */
export function draftTileLabel(t: {
  pick: number;
  state: DraftTileState;
  /** What VoiceOver says for the ticker ("No pick" for a legacy SKIP row's dash). */
  spoken?: string;
  category?: Category | null;
  clock?: string;
  yours?: boolean;
  auto?: boolean;
}): string {
  const lead = t.yours ? 'Yours, pick' : 'Pick';
  if (t.state === 'onClock') return `${lead} ${t.pick}, on the clock${t.clock ? `, ${t.clock}` : ''}`;
  if (t.state === 'empty') return `${lead} ${t.pick}, open`;
  return [`${lead} ${t.pick}`, t.spoken ?? '', t.category ? CATEGORIES[t.category].pill : '', t.auto ? 'auto-picked' : '']
    .filter(Boolean)
    .join(', ');
}

export function draftTileLook(state: DraftTileState, category: Category | null, c: ThemeColors): DraftTileLook {
  if (state === 'onClock') {
    return { fill: c.clockCell, line: null, ring: c.clockCellLive, labelInk: c.clockCellLive, tickerInk: c.onClockCell };
  }
  if (state === 'empty') return { fill: c.sunken, line: null, ring: null, labelInk: c.text2, tickerInk: c.text2 };
  return { fill: c.surface, line: category ? c[CATEGORIES[category].color] : null, ring: null, labelInk: c.text2, tickerInk: c.text };
}

export interface PillLook {
  fill: string;
  ink: string;
}

/** A category pill (§9C v3.1): the `cat*` fill with `onCat` ink. */
export function categoryPillLook(category: Category, c: ThemeColors): PillLook {
  return { fill: c[CATEGORIES[category].color], ink: c.onCat };
}

// ── ManagerRow (Standings) ───────────────────────────────────────────────────────

export interface Movement {
  dir: 'up' | 'down' | 'none';
  /** The number beside the drawn chevron; '–' when unchanged. */
  text: string;
  a11y: string;
}

export function movement(delta: number | null | undefined): Movement {
  if (!delta) return { dir: 'none', text: '–', a11y: 'no change' };
  const n = Math.abs(delta);
  return delta > 0 ? { dir: 'up', text: String(n), a11y: `up ${n}` } : { dir: 'down', text: String(n), a11y: `down ${n}` };
}

/** §9C: your row's ring. */
export const YOU_RING = 1.5;

/** Home's Standings excerpt stacks (name over the numbers) from this Dynamic Type scale up:
 * at XL (2.35) a one-line row left the name a single letter (W4 gate capture). */
export const EXCERPT_STACK_SCALE = 1.5;
export function excerptStacks(fontScale: number): boolean {
  return fontScale >= EXCERPT_STACK_SCALE;
}

// ── RangePills ───────────────────────────────────────────────────────────────────

export type RangeVariant = 'tabs' | 'pills';

export interface RangeLook {
  fill: string | null;
  ink: string;
  underline: string | null;
}

/** Home: text tabs with a 2pt `accent` underline on the selected one. Money screens:
 * filled `accent` pills with `onAccent` ink. */
export function rangeLook(variant: RangeVariant, selected: boolean, c: ThemeColors): RangeLook {
  if (variant === 'pills') return selected ? { fill: c.accent, ink: c.onAccent, underline: null } : { fill: null, ink: c.text2, underline: null };
  return selected ? { fill: null, ink: c.text, underline: c.accent } : { fill: null, ink: c.text2, underline: null };
}

/** The `tabs` variant's labels: callout 13pt, up to ExtraBold when selected, capped at 1.3x. */
export const TAB_LABEL_SIZE = 13;
export const TAB_LABEL_MAX_SCALE = 1.3;
/** Each tab's box: the widest label + 16, never under 44 (Design Lead, W4 gate,
 * 2026-10-13: equal boxes, labels centred, so the labels sit evenly apart). */
export const TAB_LABEL_PAD = 16;
export const TAB_MIN = 44;

/** A label's width at the tab face: the axis estimate (12pt Medium) scaled to 13pt, plus
 * 8% for the selected ExtraBold. Over-estimating only widens every box alike. */
export function tabLabelWidth(label: string, fontScale = 1): number {
  const s = Math.min(Math.max(fontScale, 1), TAB_LABEL_MAX_SCALE);
  return Math.ceil(estimateLabelWidth(label, s) * (TAB_LABEL_SIZE / 12) * 1.08);
}

/** One width for every tab in the row. */
export function rangeTabWidth(labels: readonly string[], fontScale = 1): number {
  const widest = Math.max(0, ...labels.map((l) => tabLabelWidth(l, fontScale)));
  return Math.max(TAB_MIN, widest + TAB_LABEL_PAD);
}

// ── Chip ─────────────────────────────────────────────────────────────────────────

export type ChipKind = 'live' | 'final' | 'default';

export interface ChipLook {
  fill: string;
  ink: string;
  dot: string | null;
}

/** §9C: the live chip is `accentTint` + `liveText` with the dot drawn; FINAL is `inset` + `text`. */
export function chipLook(kind: ChipKind, c: ThemeColors): ChipLook {
  if (kind === 'live') return { fill: c.accentTint, ink: c.liveText, dot: c.live };
  return { fill: c.inset, ink: c.text, dot: null };
}

// ── PlayerCard ───────────────────────────────────────────────────────────────────

/** A non-breaking space. */
export const NBSP = '\u00a0';

export type Acquisition =
  | { kind: 'drafted'; pick: number; date: string; price: number }
  | { kind: 'claimed'; date: string; price: number }
  | { kind: 'bought'; date: string; price: number };

/** "Drafted 2nd overall · Sep 29 · $290.10" / "Claimed off waivers · Oct 7 · $187.20" /
 * "Bought · Oct 2 · $214.80" (Giorgio's words). `date` is already formatted ("Sep 29"). */
export function acquisitionLine(a: Acquisition): string {
  const price = formatMoney(a.price);
  // A wrapped line (XL) breaks only AFTER a "·": the space before each dot is non-breaking,
  // so a dot stays with the segment it ends, and a date ("Aug\u00a031") never splits. Never
  // a line starting "· $281.50" (the W4 delta gate).
  const date = a.date.replace(/ /g, NBSP);
  const dot = `${NBSP}· `;
  if (a.kind === 'drafted') return `Drafted ${ordinal(a.pick)} overall${dot}${date}${dot}${price}`;
  if (a.kind === 'claimed') return `Claimed off waivers${dot}${date}${dot}${price}`;
  return `Bought${dot}${date}${dot}${price}`;
}


/** The third key figure's label: "Since the draft" (Giorgio, 2026-10-12), or "Since {date}"
 * for a stock bought or claimed later. */
export function sinceLabel(a: Acquisition): string {
  return a.kind === 'drafted' ? 'Since the draft' : `Since ${a.date}`;
}

export type PlayerAction =
  | { kind: 'sell'; enabled: true }
  | { kind: 'sell'; enabled: false; note: string }
  | { kind: 'save'; saved: boolean };

/** The one action for the state (§9C, Giorgio's review): your stock → Sell while the market
 * is open, disabled with the reason while it's closed, and NEVER Save; a stock you don't own
 * → Save / Saved. `opens` is the next open, e.g. "Mon 9:30 AM ET" (marketOpensLabel); when
 * the next open isn't known the reason is the app's own "Trading is closed right now." */
export function playerAction(owner: 'you' | 'other', marketOpen: boolean, saved: boolean, opens: string | null): PlayerAction {
  if (owner === 'other') return { kind: 'save', saved };
  if (marketOpen) return { kind: 'sell', enabled: true };
  return { kind: 'sell', enabled: false, note: opens ? `Market's closed. Opens ${opens}.` : MONEY_COPY.marketClosedNow };
}

export function actionLabel(a: PlayerAction): string {
  if (a.kind === 'sell') return 'Sell';
  return a.saved ? 'Saved' : 'Save';
}

/** "How you got it" / "How they got it". */
export function howTitle(owner: 'you' | 'other'): string {
  return owner === 'you' ? 'How you got it' : 'How they got it';
}

export interface PlayerCardOwnerInfo {
  name: string;
  avatarUri?: string | null;
}

/** Whose stock, and the one action that goes with it — typed so no button can render
 * without its handler (the W3 gate, 2026-10-12):
 *  - yours, held: Sell, and `onSell` is required (never Save);
 *  - yours, sold this week (still on this week's roster): no action at all;
 *  - theirs: Save / Saved through `save` — a REQUIRED key: pass `null` where the app has
 *    no watchlist to save to, and Save is not drawn (never a dead star). */
export type PlayerCardOwnership =
  | { owner: 'you'; onSell: () => void; sold?: never }
  | { owner: 'you'; sold: true; onSell?: never }
  | { owner: PlayerCardOwnerInfo; save: { saved: boolean; onToggle: () => void } | null };

export interface CardActionView {
  label: string;
  onPress: (() => void) | undefined;
  disabled: boolean;
  /** The reason beside a disabled button; never null when `disabled`. */
  note: string | null;
  /** The drawn star before Save (outline) / Saved (filled); null for Sell. */
  star: 'star' | 'starFilled' | null;
  saved: boolean | null;
}

/** The card's one action, from the ownership union: Sell (disabled with its reason while the
 * market is closed), Save / Saved, or nothing. */
export function cardAction(p: PlayerCardOwnership & { marketOpen: boolean; opens: string | null }): CardActionView | null {
  if (p.owner === 'you') {
    if (p.sold) return null;
    const a = playerAction('you', p.marketOpen, false, p.opens);
    if (a.kind !== 'sell') return null;
    return a.enabled
      ? { label: actionLabel(a), onPress: p.onSell, disabled: false, note: null, star: null, saved: null }
      : { label: actionLabel(a), onPress: undefined, disabled: true, note: a.note, star: null, saved: null };
  }
  if (!p.save) return null;
  const a = playerAction('other', p.marketOpen, p.save.saved, p.opens);
  if (a.kind !== 'save') return null;
  // Saved = the same star filled, the label "Saved"; nothing else changes (no accent fill).
  return { label: actionLabel(a), onPress: p.save.onToggle, disabled: false, note: null, star: a.saved ? 'starFilled' : 'star', saved: a.saved };
}

// ── Scoreboard names (the W4 gate, 2026-10-12) ───────────────────────────────────

/** A name never wraps ("Gianluigi" / "B." is never acceptable): one line, shrinking to this
 * at most; past it the avatar stacks over the name and the name gets the half's width. */
export const NAME_MIN_SCALE = 0.75;
/** The compact (All matchups) name is 13pt: its floor keeps it at 11pt (13 × 0.85 = 11.05). */
export const NAME_MIN_SCALE_COMPACT = 0.85;

/** A conservative width for a bold Archivo name at `fontPt` (Archivo is wide: M/W ≈ 0.95em,
 * other capitals ≈ 0.75em, lower case ≈ 0.6em, a space ≈ 0.28em, "." ≈ 0.3em). Over-estimating
 * only stacks sooner. */
export function estimateNameWidth(name: string, fontPt: number): number {
  let em = 0;
  for (const ch of name) {
    if (ch === ' ') em += 0.28;
    else if (ch === '.' || ch === ',' || ch === "'") em += 0.3;
    else if (/[MWmw]/.test(ch)) em += 0.95;
    else if (/[A-Z]/.test(ch)) em += 0.75;
    else if (/[il]/.test(ch)) em += 0.3;
    else em += 0.6;
  }
  return em * fontPt;
}

/** Beside the avatar, or stacked under it: beside while the name fits on one line at no
 * less than NAME_MIN_SCALE of its size. */
export function nameBesideAvatar(name: string, availablePt: number, fontPt: number, minScale = NAME_MIN_SCALE): boolean {
  return availablePt > 0 && estimateNameWidth(name, fontPt) * minScale <= availablePt;
}

/** Stacked Scoreboard names (XL): the name's Dynamic Type cap, so the name is never larger
 * than the total under it. The total's fitted size is estimated conservatively — its natural
 * width at `totalPt` (figures ≈ 0.72em, measured on the 17e: a seven-figure total drew at
 * 16.2pt where this predicts 16.2pt) shrunk to `innerWidth` with NO floor, because iOS's
 * adjustsFontSizeToFit goes below minimumFontScale when the text still doesn't fit. The name
 * may grow to that size, at most 1.3× and at least 1× (never below its own base size). */
export function stackedNameCap(opts: { totalText: string; totalPt: number; innerWidth: number; namePt: number }): number {
  const { totalText, totalPt, innerWidth, namePt } = opts;
  let em = 0;
  for (const ch of totalText) em += ch === ',' || ch === '.' ? 0.3 : 0.72;
  const natural = em * totalPt;
  const fitted = natural > 0 && innerWidth > 0 ? totalPt * Math.min(1, innerWidth / natural) : totalPt;
  return Math.max(1, Math.min(1.3, fitted / namePt));
}

/** The Scoreboard name's Dynamic Type cap: 1.6× beside the avatar; stacked (XL), never larger
 * than the total under it (stackedNameCap), at most 1.3×. */
export function scoreboardNameCap(opts: { stacked: boolean; totalText: string; totalPt: number; innerWidth: number; namePt: number }): number {
  if (!opts.stacked) return 1.6;
  return Math.min(1.3, stackedNameCap(opts));
}
