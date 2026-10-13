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
import { gainsAtClose, pairRows, rosterGroups, slotGroupLabel, type RosterEntry, type SlotRow } from './matchupRoster';
import { stockWeek } from './playerCardModel';

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

/** Before the week's first close (`close` null) the draft/slot order; after it, best first
 * by the gain at that close. */
export function buildRosterView(input: {
  me: RosterSideInput;
  opp: RosterSideInput;
  activity: readonly LedgerActivityRow[] | null;
  names: Readonly<Record<string, string>>;
  /** The league's slots (empty = unslotted) and each user's recorded slot per symbol. */
  slots: readonly SlotRow[];
  slotOf: Readonly<Record<string, Readonly<Record<string, string | null>>>>;
  close: { date: string; at: Date } | null;
  bars: BarsBySymbol;
  todayEt: string;
  quote: (symbol: string) => number | null;
  /** The price a row's percent is measured at: live, or the week's close when final. */
  rowPrice: (symbol: string) => number | null;
}): RosterViewGroup[] {
  const { me, opp, activity, names, slots, slotOf, close, bars, todayEt, quote, rowPrice } = input;

  const entries = (side: RosterSideInput): RosterEntry[] => {
    const gains = close ? gainsAtClose({ snapshots: side.snapshots, trades: side.trades, close, bars, todayEt, quote }) : {};
    const seqs = seqOf(side.userId, activity);
    return side.lineup.map((row, i) => {
      const sym = row.symbol.toUpperCase();
      return {
        symbol: sym,
        // No ledger yet: the lineup's own order stands in for the draft order.
        seq: seqs.get(sym) ?? 1e15 + i,
        closeGain: close ? gains[sym] ?? null : null,
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
      weekPct: stockWeek(e.symbol, side.snapshots, side.trades, rowPrice(e.symbol)).pct,
    };
  };
  const mineCell = cell(me, cents(me));
  const theirCell = cell(opp, cents(opp));

  const slotById = new Map(slots.map((s) => [s.id, s]));
  const groups = rosterGroups({
    mine: entries(me),
    theirs: entries(opp),
    slots: slots.map((s) => ({ id: s.id, index: s.slot_index, label: slotGroupLabel(s) })),
    hasClose: close !== null,
  });
  return groups.map((g) => ({
    label: g.slot ? slotGroupLabel(slotById.get(g.slot.id)!) : null,
    rows: pairRows(g).map((r) => ({ left: mineCell(r.left), right: theirCell(r.right) })),
  }));
}

