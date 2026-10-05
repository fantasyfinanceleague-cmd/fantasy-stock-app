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
