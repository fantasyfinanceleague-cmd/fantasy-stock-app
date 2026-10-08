/**
 * draftBoard (3c, key screen 4): the snake order. Round 1 runs forward through
 * the managers, round 2 reverses, and so on. `managerAtPick` gives the manager
 * for a 1-based overall pick; `boardRows` lays the picks into rounds for the
 * board, with each filled pick's symbol and source, and the pick on the clock.
 * Each COLUMN is a manager (a seat in `order`), so the numbers run left to right
 * in odd rounds and right to left in even ones (key screen 4, "Order reverses
 * each round"), and `boardHeader` puts each manager's initials over their column
 * (G-1, rule 7: you can find your own column and picks).
 */

/** The manager holding overall pick `pick` (1-based) in a snake over `order`. */
export function managerAtPick(pick: number, order: string[]): string {
  const m = order.length;
  const round = Math.floor((pick - 1) / m); // 0-based
  const idx = (pick - 1) % m;
  const seat = round % 2 === 0 ? idx : m - 1 - idx;
  return order[seat];
}

export interface BoardCell {
  pick: number;
  round: number;
  manager: string;
  symbol: string | null;
  source: string | null;
  onClock: boolean;
}

/** One row per round, each row `order.length` cells long, cell i = seat i's pick
 * that round. `picks` maps a pick number to the symbol and source made there;
 * `onClockPick` is the pick now due. */
export function boardRows(
  order: string[],
  rounds: number,
  picks: Map<number, { symbol: string; source: string }>,
  onClockPick: number,
): BoardCell[][] {
  const m = order.length;
  const rows: BoardCell[][] = [];
  for (let r = 0; r < rounds; r++) {
    const row: BoardCell[] = [];
    for (let i = 0; i < m; i++) {
      // Seat i's pick in round r: forward in odd rounds, reversed in even ones.
      const pick = r % 2 === 0 ? r * m + i + 1 : r * m + (m - i);
      const made = picks.get(pick) ?? null;
      row.push({
        pick,
        round: r + 1,
        manager: order[i],
        symbol: made ? made.symbol : null,
        source: made ? made.source : null,
        onClock: pick === onClockPick,
      });
    }
    rows.push(row);
  }
  return rows;
}

/** "RB" from "Roberto B.", "PM" from "Paolo M."; one word: its first letter. */
export function managerInitials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

export interface BoardHeaderCell {
  manager: string;
  initials: string;
  you: boolean;
}

/** The board's header row: each seat's initials over its column, and which is yours. */
export function boardHeader(order: readonly string[], names: Record<string, { name: string } | undefined>, me: string): BoardHeaderCell[] {
  return order.map((manager) => ({ manager, initials: managerInitials(names[manager]?.name), you: manager === me }));
}

export interface DraftPickRow {
  pick_number: number;
  symbol: string;
  pick_source: string;
  /** The price the pick was drafted at (budget-cap leagues read it); absent in old fixtures. */
  entry_price?: number | string | null;
}

/** The picks keyed by overall pick number. A legacy SKIP row is kept (the board
 * lays it out as a plain row with a dash), but it never fills a cell's symbol. */
export function indexPicks(rows: DraftPickRow[]): Map<number, { symbol: string; source: string; price: number | null }> {
  const map = new Map<number, { symbol: string; source: string; price: number | null }>();
  for (const r of rows) {
    const p = r.entry_price == null ? null : Number(r.entry_price);
    map.set(r.pick_number, { symbol: r.symbol, source: r.pick_source, price: p !== null && Number.isFinite(p) ? p : null });
  }
  return map;
}
