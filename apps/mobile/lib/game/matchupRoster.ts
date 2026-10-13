/**
 * matchupRoster (W4, the Matchup roster): which stock sits on which row. Pure, so
 * tests-deno/matchup-roster.test.ts pins every rule. Giorgio, 2026-10-12 (PRODUCT_RULES,
 * "Matchup roster row order"):
 *
 *  - "By uh, weak gain with the best going first."
 *  - Slotted leagues (category slots AND price tiers): grouped by slot in the league's slot
 *    order, the group acting as the position label; within a group, best first. Both
 *    managers share the slot structure, so the mirrored rows pair up group by group.
 *  - Unslotted leagues: one list per side, best first.
 *  - "it'll reorder it to show like who's been doing the best. So it doesn't update like
 *    live per se, but updates at the end of the day." So the ORDER reads the week gain AT
 *    THE LAST MARKET CLOSE (a held number), never the live one: a live quote moves the
 *    figures on the rows, never the rows. The close is read from settled daily bars only
 *    (`orderingClose`): no quote, no bar fetched before its close, one close for both
 *    sides — until a close is settled the previous one's order holds. Before the week's
 *    first settled close the order is the draft/slot order.
 *
 * Where a slot comes from: the server's own record (drafts.slot_id / trades.slot_id, the
 * event that opened the held position: the last BUY, else the draft pick, as
 * _shared/draft-validation.ts's userSlotOccupancy reads it). This file never decides
 * whether a price or category FITS a slot (tierContract.ts's rule: the server decides). A
 * position with no recorded slot (a pre-fix legacy buy) is not guessed into one: it goes
 * in a trailing group with no head, best first, so it is shown and never dropped.
 */
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from '../home/liveWeekScore';
import type { BarsBySymbol } from '../home/buildHomeViewModel';
import { etWallClockToUtcIso, type MarketCalendarSession } from '../time/marketWeek';
import { etDateParts } from '../time/etParts';
import { slotBandLabel } from '../money/tierContract';
import { CATEGORIES, type Category } from '../../components/sp/logic/gameNight';

/** An instant's ET calendar date (YYYY-MM-DD), through the validating etParts. */
export function etDateOf(iso: string | Date): string | null {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const p = etDateParts(d);
  if (!p) return null;
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

// ── The held order ───────────────────────────────────────────────────────────────

/** One stock on one side's roster. */
export interface RosterEntry {
  symbol: string;
  /** The draft/slot order: the pick number for a drafted stock; later buys after every
   * pick, in the order they were bought. The order before the week's first close, and
   * the tie-break after it. */
  seq: number;
  /** The week gain at the last market close; null = not held at that close (bought
   * since), which sorts after every held number. */
  closeGain: number | null;
  /** The league_draft_slots row the position fills; null = unslotted league or unrecorded. */
  slotId: string | null;
}

/** Best first by the gain at the last close; before the week's first close
 * (`hasClose` false) the draft/slot order. Ties and not-yet-closed stocks keep the
 * draft/slot order. Never reads a live number. */
export function orderSide(entries: readonly RosterEntry[], hasClose: boolean): RosterEntry[] {
  const bySeq = (a: RosterEntry, b: RosterEntry) => a.seq - b.seq || (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  if (!hasClose) return [...entries].sort(bySeq);
  return [...entries].sort((a, b) => {
    if (a.closeGain === null && b.closeGain === null) return bySeq(a, b);
    if (a.closeGain === null) return 1;
    if (b.closeGain === null) return -1;
    return b.closeGain - a.closeGain || bySeq(a, b);
  });
}

// ── Groups and rows ──────────────────────────────────────────────────────────────

/** A slot as the roster shows it: its place in the league's order and its head. */
export interface RosterSlot {
  id: string;
  index: number;
  label: string;
}

export interface RosterGroup {
  /** The GroupHead; null = no head (an unslotted league, or the unrecorded tail). */
  slot: RosterSlot | null;
  mine: RosterEntry[];
  theirs: RosterEntry[];
}

/** The roster's groups in display order. Slotted (`slots` non-empty): one group per slot
 * in slot order that either side fills, then the unrecorded tail if it has anyone.
 * Unslotted: one headless group. Within every group, `orderSide`. */
export function rosterGroups(input: {
  mine: readonly RosterEntry[];
  theirs: readonly RosterEntry[];
  slots: readonly RosterSlot[];
  hasClose: boolean;
}): RosterGroup[] {
  const { mine, theirs, slots, hasClose } = input;
  if (slots.length === 0) {
    return [{ slot: null, mine: orderSide(mine, hasClose), theirs: orderSide(theirs, hasClose) }];
  }
  const known = new Set(slots.map((s) => s.id));
  const groups: RosterGroup[] = [];
  for (const slot of [...slots].sort((a, b) => a.index - b.index)) {
    const m = mine.filter((e) => e.slotId === slot.id);
    const t = theirs.filter((e) => e.slotId === slot.id);
    if (m.length === 0 && t.length === 0) continue;
    groups.push({ slot, mine: orderSide(m, hasClose), theirs: orderSide(t, hasClose) });
  }
  const loose = (e: RosterEntry) => e.slotId === null || !known.has(e.slotId);
  const m = mine.filter(loose);
  const t = theirs.filter(loose);
  if (m.length > 0 || t.length > 0) groups.push({ slot: null, mine: orderSide(m, hasClose), theirs: orderSide(t, hasClose) });
  return groups;
}

/** A group's mirrored rows: yours left, theirs right, i-th against i-th (best vs best).
 * A side with fewer stocks leaves its half empty. */
export function pairRows(group: RosterGroup): { left: RosterEntry | null; right: RosterEntry | null }[] {
  const n = Math.max(group.mine.length, group.theirs.length);
  return Array.from({ length: n }, (_, i) => ({ left: group.mine[i] ?? null, right: group.theirs[i] ?? null }));
}

// ── The last close ───────────────────────────────────────────────────────────────

/** The week's trading sessions (Mon…Fri, the calendar's own), ascending. */
export function weekSessions(weekStartIso: string | null, weekEndIso: string | null, sessions: readonly MarketCalendarSession[]): MarketCalendarSession[] {
  if (!weekStartIso || !weekEndIso) return [];
  const from = etDateOf(weekStartIso);
  const to = etDateOf(weekEndIso);
  if (!from || !to) return [];
  return sessions.filter((s) => s.sessionDate >= from && s.sessionDate <= to).sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1));
}

/** The week's sessions that have CLOSED by `now`, latest first. Empty before the week's
 * first close (or with no calendar coverage — then the draft/slot order holds; never a
 * guessed close). */
export function closesBefore(now: Date, week: readonly MarketCalendarSession[]): { date: string; at: Date }[] {
  const out: { date: string; at: Date }[] = [];
  for (const s of week) {
    const iso = etWallClockToUtcIso(s.sessionDate, s.closeEt);
    if (!iso) continue;
    const at = new Date(iso);
    if (at.getTime() <= now.getTime()) out.push({ date: s.sessionDate, at });
  }
  return out.sort((x, y) => y.at.getTime() - x.at.getTime());
}

/** The week's last closed session, or null before the first close. */
export function lastWeekClose(now: Date, week: readonly MarketCalendarSession[]): { date: string; at: Date } | null {
  return closesBefore(now, week)[0] ?? null;
}

/** One stock's price AT a close: that day's daily bar, and only from bars fetched after the
 * close. Never a quote (the quote is the latest IEX trade, which prints after 4:00 PM), and
 * never a bar fetched before the close (Alpaca's 1Day bars, requested with no `end`, include
 * today's IN-PROGRESS bar, whose "close" is a mid-session price). */
export function barCloseAt(bars: BarsBySymbol, barsAt: Date, close: { date: string; at: Date }): (symbol: string) => number | null {
  const settled = barsAt.getTime() >= close.at.getTime();
  return (symbol: string) => {
    if (!settled) return null;
    const bar = (bars[symbol] ?? bars[symbol.toUpperCase()] ?? []).find((b) => b.date === close.date);
    return bar ? bar.close : null;
  };
}

/** Each stock's week gain at a close: the server's own accounting (liveWeekScore), the
 * trades up to that close only, each stock priced at its settled close bar
 * (`barCloseAt`). `complete` is false when any position held at that close has no
 * settled bar — that close can't order this side. */
export function gainsAtClose(input: {
  snapshots: readonly LiveSnapshot[];
  trades: readonly LiveTrade[];
  close: { date: string; at: Date };
  bars: BarsBySymbol;
  /** When the bars were fetched (raw.now: the fetch's own clock). */
  barsAt: Date;
}): { bySymbol: Record<string, number>; complete: boolean } {
  const { snapshots, trades, close, bars, barsAt } = input;
  const held = trades.filter((t) => t.createdAt.getTime() <= close.at.getTime());
  const r = liveWeekScore([...snapshots], held, barCloseAt(bars, barsAt, close));
  return { bySymbol: r.bySymbol, complete: r.unpriced.length === 0 };
}

/** The close that orders the roster, and each side's gains at it: the LATEST closed session
 * at which BOTH sides are completely priced from settled bars. A later close that isn't
 * settled yet (its bar not fetched since the close) leaves the previous close's order in
 * place; no close at all leaves the draft/slot order. Both rosters always read the SAME
 * close — never one side on Thursday's and the other on Wednesday's (CLAUDE.md: a set that
 * can be partially filled is checked per participant, never with "any row"). */
export function orderingClose(input: {
  closes: readonly { date: string; at: Date }[];
  sides: readonly { snapshots: readonly LiveSnapshot[]; trades: readonly LiveTrade[] }[];
  bars: BarsBySymbol;
  barsAt: Date;
}): { close: { date: string; at: Date }; gains: Record<string, number>[] } | null {
  for (const close of input.closes) {
    const per = input.sides.map((s) => gainsAtClose({ snapshots: s.snapshots, trades: s.trades, close, bars: input.bars, barsAt: input.barsAt }));
    if (per.every((p) => p.complete)) return { close, gains: per.map((p) => p.bySymbol) };
  }
  return null;
}

// ── Slot heads ───────────────────────────────────────────────────────────────────

export interface SlotRow {
  id: string;
  slot_index: number;
  slot_count: number;
  price_min: number | null;
  price_max: number | null;
  /** The category's slug (a `Category`), resolved from category_id; null = any category. */
  category: Category | null;
}

/** Slotted = at least one slot carries a filter (a price band or a category). A league
 * whose slots all accept anything is one flat list. */
export function isSlotted(slots: readonly SlotRow[]): boolean {
  return slots.some((s) => s.price_min != null || s.price_max != null || s.category != null);
}

/** The GroupHead: "Tech ×3", "$100–$200 ×2", "$100–$200 Tech", "Flex" (PRODUCT_RULES'
 * examples; Giorgio's short category names). " ×N" only when the slot holds more than one. */
export function slotGroupLabel(s: SlotRow): string {
  const band = s.price_min != null || s.price_max != null ? slotBandLabel(s.price_min, s.price_max) : null;
  const cat = s.category ? CATEGORIES[s.category].pill : null;
  const name = [band, cat].filter(Boolean).join(' ') || 'Flex';
  return s.slot_count > 1 ? `${name} ×${s.slot_count}` : name;
}

/** The player card's slot pill: a category slot shows its CategoryPill; a price tier its
 * band ("$100–$200"); a Flex slot nothing. */
export function cardSlotPill(s: SlotRow | null): { category: Category } | { slot: string } | null {
  if (!s) return null;
  if (s.category) return { category: s.category };
  if (s.price_min != null || s.price_max != null) return { slot: slotBandLabel(s.price_min, s.price_max) };
  return null;
}

// ── Which slot a held position fills ─────────────────────────────────────────────

export interface SlotEvent {
  user_id: string;
  symbol: string;
  slot_id: string | null;
  /** 'draft', or a trade's 'buy' (sells carry no slot and are not passed). */
  kind: 'draft' | 'buy';
  at: string;
}

/** The recorded slot of each symbol a user holds: the last BUY's slot_id, else the draft
 * pick's (the event that opened the position — userSlotOccupancy's rule). A buy with no
 * recorded slot stays null: it is NOT derived here. */
export function recordedSlots(userId: string, events: readonly SlotEvent[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const mine = events.filter((e) => e.user_id === userId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const bought = new Set<string>();
  for (const e of mine) {
    const sym = e.symbol.toUpperCase();
    if (e.kind === 'buy') {
      bought.add(sym);
      out[sym] = e.slot_id;
    } else if (!bought.has(sym)) {
      out[sym] = e.slot_id;
    }
  }
  return out;
}

