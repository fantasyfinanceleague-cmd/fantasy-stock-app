// Stockpile — the Game Night primitives' pure logic (§9C "Components (the W3 primitives)",
// 2026-10-12, with the Design Lead's player-card order of the same day). No RN: each rule
// a component draws by is here, so tests-deno/game-night-primitives.test.ts pins it.
//
// Copy is the spec's own words (§9C and PRODUCT_RULES), nothing new; "Dead even" is the
// app's existing tie line (components/sp/game/Scoreboard.tsx).

import type { ThemeColors } from '../../../constants/tokens/color';
import { formatMoney } from './money';
import { ordinal } from '../../../lib/home/ordinal';

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

export type Acquisition =
  | { kind: 'drafted'; pick: number; date: string; price: number }
  | { kind: 'claimed'; date: string; price: number }
  | { kind: 'bought'; date: string; price: number };

/** "Drafted 2nd overall · Sep 29 · $290.10" / "Claimed off waivers · Oct 7 · $187.20" /
 * "Bought · Oct 2 · $214.80" (Giorgio's words). `date` is already formatted ("Sep 29"). */
export function acquisitionLine(a: Acquisition): string {
  const price = formatMoney(a.price);
  if (a.kind === 'drafted') return `Drafted ${ordinal(a.pick)} overall · ${a.date} · ${price}`;
  if (a.kind === 'claimed') return `Claimed off waivers · ${a.date} · ${price}`;
  return `Bought · ${a.date} · ${price}`;
}

/** The third key figure's label: "Since the draft", or "Since {date}" for a stock bought or
 * claimed later. ("Season gain" vs "Since the draft" is still Giorgio's call: `draftLabel`.) */
export function sinceLabel(a: Acquisition, draftLabel = 'Since the draft'): string {
  return a.kind === 'drafted' ? draftLabel : `Since ${a.date}`;
}

export type PlayerAction =
  | { kind: 'sell'; enabled: true }
  | { kind: 'sell'; enabled: false; note: string }
  | { kind: 'save'; saved: boolean };

/** The one action for the state (§9C, Giorgio's review): your stock → Sell while the market
 * is open, disabled with the reason while it's closed, and NEVER Save; a stock you don't own
 * → Save / Saved. `opens` is the next open, e.g. "Mon 9:30 ET". */
export function playerAction(owner: 'you' | 'other', marketOpen: boolean, saved: boolean, opens: string): PlayerAction {
  if (owner === 'other') return { kind: 'save', saved };
  return marketOpen ? { kind: 'sell', enabled: true } : { kind: 'sell', enabled: false, note: `Market's closed. Opens ${opens}.` };
}

export function actionLabel(a: PlayerAction): string {
  if (a.kind === 'sell') return 'Sell';
  return a.saved ? 'Saved' : 'Save';
}

/** "How you got it" / "How they got it". */
export function howTitle(owner: 'you' | 'other'): string {
  return owner === 'you' ? 'How you got it' : 'How they got it';
}
