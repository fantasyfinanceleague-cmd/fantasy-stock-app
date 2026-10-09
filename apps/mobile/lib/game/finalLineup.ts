/**
 * finalLineup (3c): a posted matchup's per-stock rows. It is the server's own
 * accounting (liveWeekScore, the same port Home and Matchup use) with the
 * FRIDAY CLOSE as the price (week_snapshots.week_end_price). The rows are
 * shown only when they sum to the recorded team gain to the cent. A stock
 * with no close, or any disagreement, hides the lineup and reports the gap:
 * a mismatched number is never shown.
 */
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from '../home/liveWeekScore';
import { lineupRows, scoreCents, type LineupRow } from './lineupLedger';

export interface FinalSnapshot {
  symbol: string;
  quantity: number;
  week_start_price: number;
  week_end_price: number | null;
  entered_mid_week: boolean;
}

export interface FinalLineupResult {
  ok: boolean;
  /** Present only when ok: the rows sum to the recorded gain to the cent. */
  rows: LineupRow[] | null;
  /** The computed gain (dollars), for the mismatch log. */
  gain: number;
  /** recorded - computed, in dollars, when the rows disagree; null otherwise. */
  mismatchDollars: number | null;
}

export function finalLineup(input: { snapshots: FinalSnapshot[]; trades: LiveTrade[]; teamGain: number }): FinalLineupResult {
  // A stock with no Friday close cannot be priced honestly: the whole lineup is withheld.
  const missingClose = input.snapshots.some((s) => s.week_end_price === null);
  const closes = new Map<string, number>();
  for (const s of input.snapshots) if (s.week_end_price !== null) closes.set(s.symbol.toUpperCase(), s.week_end_price);

  const snaps: LiveSnapshot[] = input.snapshots.map((s) => ({
    symbol: s.symbol,
    quantity: s.quantity,
    weekStartPrice: s.week_start_price,
    enteredMidWeek: s.entered_mid_week,
  }));
  const live = liveWeekScore(snaps, input.trades, (sym) => closes.get(sym.toUpperCase()) ?? null);
  const gain = live.gain;

  if (missingClose || live.unpriced.length > 0 || scoreCents(gain) !== scoreCents(input.teamGain)) {
    return {
      ok: false,
      rows: null,
      gain,
      mismatchDollars: missingClose || live.unpriced.length > 0 ? null : input.teamGain - gain,
    };
  }
  return { ok: true, rows: lineupRows(live.bySymbol, gain), gain, mismatchDollars: null };
}
