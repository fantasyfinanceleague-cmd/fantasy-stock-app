/**
 * tradeGate: the U2 client trade gate (docs/audits/2026-09-30-week-window-audit.md).
 * Reads market_session_status(), which the server computes from
 * market_calendar, so holidays and half days come from the calendar, never a
 * hard-coded list. FAILS CLOSED: no row, an unparseable bound or an 'unknown'
 * status is "unavailable", never open.
 *
 * The close boundary is EXCLUSIVE (now < close), matching record-trade's own
 * gate (the SQL status function is inclusive; the difference is one instant).
 * A stale row (open but outside its window, or closed past its next open) is
 * reported as stale so the host refetches once; it never opens the gate.
 */
export interface MarketStatusRow {
  status: string | null;
  session_open_at: string | null;
  session_close_at: string | null;
  next_open_at: string | null;
}

export type TradeGate =
  | { open: true; closeAt: Date }
  | { open: false; reason: 'closed'; stale: boolean; nextOpenAt: Date | null }
  | { open: false; reason: 'unavailable' };

const UNAVAILABLE: TradeGate = { open: false, reason: 'unavailable' };

function parseInstant(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function decideTradeGate(now: Date, row: MarketStatusRow | null | undefined): TradeGate {
  if (!row) return UNAVAILABLE;
  if (row.status === 'open') {
    const openAt = parseInstant(row.session_open_at);
    const closeAt = parseInstant(row.session_close_at);
    if (!openAt || !closeAt) return UNAVAILABLE;
    if (now >= openAt && now < closeAt) return { open: true, closeAt };
    return { open: false, reason: 'closed', stale: true, nextOpenAt: null };
  }
  if (row.status === 'closed') {
    const nextOpenAt = parseInstant(row.next_open_at);
    return { open: false, reason: 'closed', stale: nextOpenAt !== null && now >= nextOpenAt, nextOpenAt };
  }
  return UNAVAILABLE;
}
