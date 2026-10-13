/**
 * matchupRosterView (W4): the Matchup roster as the screen draws it — groups (a GroupHead
 * label or none) of mirrored rows (your half left, theirs right), each half a stock's
 * ticker, company and week. Pure; the ORDER comes from matchupRoster.ts (the gain at the
 * last close, never the live one), the NUMBERS on the rows from the lineup (live, or the
 * posted week's own rows when final), so the rows still sum to the score.
 */
import type { LineupRow } from './lineupLedger';
import type { LiveSnapshot, LiveTrade } from '../home/liveWeekScore';
import type { BarsBySymbol } from '../home/buildHomeViewModel';
import type { LedgerActivityRow } from '../money/portfolioLedger';
import { orderingClose, pairRows, rosterGroups, slotGroupLabel, type RosterEntry, type SlotRow } from './matchupRoster';
import { stockBasis, weekPctOf } from './playerCardModel';

export interface RosterSideInput {
  userId: string;
  /** The rows the score is made of (whole cents, summing to the score). */
  lineup: readonly LineupRow[];
  snapshots: readonly LiveSnapshot[];
  trades: readonly LiveTrade[];
}

export interface RosterCell {
  symbol: string;
  company: string;
  weekGain: number;
  weekPct: number;
}

export interface RosterView {
  groups: RosterViewGroup[];
  /** The close the rows are ordered by (YYYY-MM-DD), or null before any settled close. */
  orderedBy: string | null;
}

export interface RosterViewGroup {
  /** The GroupHead ("Tech ×3"); null = no head. */
  label: string | null;
  rows: { left: RosterCell | null; right: RosterCell | null }[];
}

/** The draft/slot order of a user's stocks: a drafted stock by its pick number; a stock
 * bought later after every pick, in the order bought (the opening event's time). */
export function seqOf(userId: string, activity: readonly LedgerActivityRow[] | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!activity) return out;
  const rows = activity
    .filter((r) => r.user_id === userId && r.action === 'buy')
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : 0));
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    const seq = r.kind === 'draft' && r.pick_number != null ? r.pick_number : 1e13 + Date.parse(r.occurred_at) / 1000;
    // The opening event is the LAST buy, else the pick: a later buy replaces the pick's place.
    const prev = out.get(sym);
    if (prev === undefined || r.kind === 'trade') out.set(sym, seq);
  }
  return out;
}

/** Best first by the gain at the latest SETTLED close (`orderingClose`: settled bars only,
 * one close for both sides); before one exists, the draft/slot order. */
export function buildRosterView(input: {
  me: RosterSideInput;
  /** null = a bye week: your stocks alone, ordered the same way (#call-mx-bye, B). */
  opp: RosterSideInput | null;
  activity: readonly LedgerActivityRow[] | null;
  names: Readonly<Record<string, string>>;
  /** The league's slots (empty = unslotted) and each user's recorded slot per symbol. */
  slots: readonly SlotRow[];
  slotOf: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  /** The week's closed sessions, latest first (matchupRoster.closesBefore). */
  closes: readonly { date: string; at: Date }[];
  bars: BarsBySymbol;
  /** When `bars` was fetched: a bar counts for a close only if fetched after it. */
  barsAt: Date;
}): RosterView {
  const { me, opp, activity, names, slots, slotOf, closes, bars, barsAt } = input;
  const ordering = orderingClose({ closes, sides: opp ? [me, opp] : [me], bars, barsAt });

  const entries = (side: RosterSideInput, gains: Record<string, number> | null): RosterEntry[] => {
    const seqs = seqOf(side.userId, activity);
    return side.lineup.map((row, i) => {
      const sym = row.symbol.toUpperCase();
      return {
        symbol: sym,
        // No ledger yet: the lineup's own order stands in for the draft order.
        seq: seqs.get(sym) ?? 1e15 + i,
        closeGain: gains ? gains[sym] ?? null : null,
        slotId: slotOf[side.userId]?.[sym] ?? null,
      };
    });
  };

  const cents = (side: RosterSideInput) => new Map(side.lineup.map((r) => [r.symbol.toUpperCase(), r.cents]));
  const cell = (side: RosterSideInput, centsBy: Map<string, number>) => (e: RosterEntry | null): RosterCell | null => {
    if (!e) return null;
    return {
      symbol: e.symbol,
      company: names[e.symbol] ?? '',
      weekGain: (centsBy.get(e.symbol) ?? 0) / 100,
      // The row's own gain over the stock's week basis: agrees with the scored number.
      weekPct: weekPctOf((centsBy.get(e.symbol) ?? 0) / 100, stockBasis(e.symbol, side.snapshots, side.trades)),
    };
  };
  const mineCell = cell(me, cents(me));
  const theirCell = opp ? cell(opp, cents(opp)) : () => null;

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const groups = rosterGroups({
    mine: entries(me, ordering?.gains[0] ?? null),
    theirs: opp ? entries(opp, ordering?.gains[1] ?? null) : [],
    slots: slots.map((s) => ({ id: s.id, index: s.slot_index, label: slotGroupLabel(s) })),
    hasClose: ordering !== null,
  });
  return {
    groups: groups.map((g) => ({
      label: g.slot ? slotGroupLabel(slotById.get(g.slot.id)!) : null,
      rows: pairRows(g).map((r) => ({ left: mineCell(r.left), right: theirCell(r.right) })),
    })),
    // The close the order is CURRENTLY using (null: the draft/slot order — no label).
    orderedBy: ordering?.close.date ?? null,
  };
}

/** A final week whose per-stock rows don't reconcile (#call-mx-withheld, B): who held what,
 * without figures — each side's week stocks in DRAFT order (pick, then later buys in the
 * order bought), one flat list, the halves carrying no numbers. */
export function buildWithheldView(input: {
  me: { userId: string; symbols: readonly string[] };
  opp: { userId: string; symbols: readonly string[] };
  activity: readonly LedgerActivityRow[] | null;
  names: Readonly<Record<string, string>>;
}): RosterViewGroup {
  const side = (s: { userId: string; symbols: readonly string[] }) => {
    const seqs = seqOf(s.userId, input.activity);
    const uniq = [...new Set(s.symbols.map((x) => x.toUpperCase()))];
    return uniq
      .map((sym, i) => ({ sym, seq: seqs.get(sym) ?? 1e15 + i }))
      .sort((a, b) => a.seq - b.seq || (a.sym < b.sym ? -1 : 1))
      .map(({ sym }) => ({ symbol: sym, company: input.names[sym] ?? '', weekGain: 0, weekPct: 0 }));
  };
  const mine = side(input.me);
  const theirs = side(input.opp);
  const n = Math.max(mine.length, theirs.length);
  return { label: null, rows: Array.from({ length: n }, (_, i) => ({ left: mine[i] ?? null, right: theirs[i] ?? null })) };
}

/** Giorgio's approved copy (#call-mx-order, B): the small line over the rows naming the close
 * the order uses — "Ordered by Wednesday's close". */
export function orderLabel(closeDateIso: string): string {
  const [y, m, d] = closeDateIso.split('-').map(Number);
  const day = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `Ordered by ${day}'s close`;
}

/** Giorgio's approved copy (#call-mx-withheld, B). */
export const WITHHELD_LINE = "Stock-by-stock results aren't available for this week.";

/** Giorgio's approved copy (#call-mx-bye, B): the opponent's half in a bye week. */
export const BYE_HALF = 'Bye week';

