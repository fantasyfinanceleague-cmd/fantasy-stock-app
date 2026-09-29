/**
 * Shared participant + holdings derivation for snapshot-week-start and
 * snapshot-week-end.
 *
 * Both jobs used to carry their own copy of the same `calculateHoldings` and the
 * same participant loop, and both copies carried the same two defects:
 *
 *   F1. BOTS NEVER GOT SNAPSHOTS. The participant loop skipped any id starting
 *       with `bot-`. No reason was ever recorded (it arrived with the first
 *       version of snapshot-week-start, a7ca0a9, and was copied into week-end),
 *       and nothing requires it: week_snapshots.user_id is TEXT with no FK, the
 *       jobs write as service role, and process-week-results already scores bots.
 *       The effect: week 1 scored via the fallback, but from week 2 every matchup
 *       against a bot was refused as unscoreable_participant_no_snapshot and
 *       stayed unscored forever.
 *
 *   F2. SKIP ROWS BECAME 1-SHARE HOLDINGS. `Number(draft.quantity || 1)` coerced
 *       the SKIP sentinel's quantity 0 to 1, and the symbol was never filtered,
 *       so a forfeited turn became an unpriceable 'SKIP' holding. With no price,
 *       the all-or-nothing writers (plan.ts buildPricedRows / close.ts
 *       buildCloseWork) aborted the WHOLE LEAGUE on every retry until they gave
 *       up — every participant in that league went unsnapshotted, not just the
 *       one who skipped. F1 without F2 would have made this worse: the SKIP
 *       sentinel exists mainly for bots that cannot afford a pick.
 *
 *   The same `|| 1` also coerced a NON-SKIP quantity-0 row to one share. It now
 *   counts as 0 (no holding) — deliberate, not a side effect of the refactor.
 *   Unreachable in practice: fillQuantity never yields 0 for a real pick.
 *
 * Netting is delegated to userNetHoldings in ./draft-validation.ts — the SAME
 * function draft/drop legality uses — so "what does this user hold" has one
 * definition across drafting, trading and snapshotting. It excludes SKIP by the
 * shared case-insensitive predicate, nets buys/sells, reads quantity as
 * `Number(q) || 0`, and drops sub-1e-9 residue.
 *
 * NULL QUANTITY: drafts.quantity is `numeric NOT NULL` (20260810000000) and the
 * draft path always writes fillQuantity (1, or notional/price) or 0 for SKIP, so
 * NULL is unreachable today. If it ever appears it counts as 0 — no holding —
 * consistent with the draft validator, which already treats such a row as
 * not owning the symbol (another player could draft it). Scoring a position the
 * validator says nobody owns would contradict it.
 *
 * Pure: no DB, no network, no Deno runtime APIs. See snapshot-holdings.test.ts.
 */

import { userNetHoldings, type PickRow, type TradeRow } from './draft-validation.ts';

export interface Holding {
  symbol: string;
  quantity: number;
}

/** The subset of a matchups row the participant set needs. */
export interface MatchupParticipantsRow {
  team1_user_id: string | null;
  team2_user_id: string | null;
}

/**
 * Every participant in a league-week's matchups, bots INCLUDED. A bye week has
 * team2_user_id NULL, so it contributes only team1.
 */
export function matchupParticipants(
  matchups: ReadonlyArray<MatchupParticipantsRow> | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const m of matchups ?? []) {
    if (m.team1_user_id) ids.add(String(m.team1_user_id));
    if (m.team2_user_id) ids.add(String(m.team2_user_id));
  }
  return ids;
}

/** Loose DB row shapes: PostgREST returns numeric columns as strings and may hand back NULLs. */
export interface DraftHoldingRow {
  user_id: string;
  symbol: string | null;
  quantity: number | string | null;
}
export interface TradeHoldingRow {
  user_id: string;
  symbol: string | null;
  action: string;
  quantity: number | string | null;
}

const hasSymbol = (r: { symbol: string | null }) =>
  typeof r.symbol === 'string' && r.symbol.trim() !== '';

/**
 * One participant's current net holdings (quantity > 0), sorted by symbol.
 * A participant whose only rows are SKIP — or who has sold everything — gets []
 * and is therefore LEGITIMATELY EMPTY: plan.ts classifyCoverage and close.ts
 * classifyCloseCoverage both treat an empty holder as expecting no rows, so they
 * never make the league-week read incomplete.
 */
export function snapshotHoldings(
  userId: string,
  drafts: ReadonlyArray<DraftHoldingRow>,
  trades: ReadonlyArray<TradeHoldingRow>,
): Holding[] {
  // userNetHoldings upper-cases every symbol, so a NULL symbol would throw; the
  // old copies skipped such rows and so do we. user_id is String()ed because
  // trades.user_id is UUID and drafts.user_id is TEXT.
  const picks: PickRow[] = drafts.filter(hasSymbol).map((d) => ({
    user_id: String(d.user_id),
    symbol: d.symbol as string,
    entry_price: 0, // not read by userNetHoldings
    quantity: Number(d.quantity),
    pick_number: 0, // not read by userNetHoldings
  }));
  const tradeRows: TradeRow[] = trades.filter(hasSymbol).map((t) => ({
    user_id: String(t.user_id),
    symbol: t.symbol as string,
    action: t.action,
    quantity: Number(t.quantity),
    price: 0, // not read by userNetHoldings
  }));

  return [...userNetHoldings(String(userId), picks, tradeRows)]
    .map(([symbol, quantity]) => ({ symbol, quantity }))
    .sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}
