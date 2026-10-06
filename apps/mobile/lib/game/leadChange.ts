/**
 * leadChange: the G2 lead-change trigger and the chyron's "mover" (3c).
 * A flip fires at most once per 30 s; a tie or a first read never fires.
 * The mover is the stock whose dollar contribution moved the most since the
 * last poll (a brand-new position moves from zero).
 */

export type Leader = 'me' | 'opp' | 'tie';

export const LEAD_CHANGE_COOLDOWN_MS = 30_000;

export function leaderOf(myGain: number, oppGain: number): Leader {
  if (myGain > oppGain) return 'me';
  if (oppGain > myGain) return 'opp';
  return 'tie';
}

export function detectLeadChange(
  prev: Leader | null,
  next: Leader,
  nowMs: number,
  lastFiredAtMs: number | null,
): boolean {
  if (prev === null || prev === 'tie' || next === 'tie' || prev === next) return false;
  if (lastFiredAtMs !== null && nowMs - lastFiredAtMs < LEAD_CHANGE_COOLDOWN_MS) return false;
  return true;
}

export function pickMover(prev: Record<string, number>, next: Record<string, number>): string | null {
  let best: string | null = null;
  let bestAbs = 0;
  for (const symbol of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    const delta = (next[symbol] ?? 0) - (prev[symbol] ?? 0);
    if (Math.abs(delta) > bestAbs) {
      best = symbol;
      bestAbs = Math.abs(delta);
    }
  }
  return best;
}

/**
 * The stock's move today, in percent, for the chyron ("NVDA +2.9% puts …").
 * Live price against the last close STRICTLY before today (the same
 * prevClose rule as Home's todayChange). Null when either is missing: no
 * percentage is better than an invented one.
 */
export function dayMovePct(
  bars: Record<string, { date: string; close: number }[]>,
  quote: (symbol: string) => number | null,
  symbol: string,
  todayIso: string,
): number | null {
  const live = quote(symbol);
  if (live === null) return null;
  const earlier = (bars[symbol] ?? []).filter((b) => b.date < todayIso);
  const prev = earlier[earlier.length - 1];
  if (!prev || prev.close === 0) return null;
  return Math.round(((live - prev.close) / prev.close) * 1000) / 10;
}
