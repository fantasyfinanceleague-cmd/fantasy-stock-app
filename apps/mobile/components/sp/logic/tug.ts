// Stockpile — pure tug-of-war logic for <TugBar> (Phase 2 foundation).
// Dependency-free, same reasoning as ./money.ts.
//
// Formula pinned by the Orchestrator (2026-09-26, matching web):
//   p = 0.5 + 0.5 * (you - opp) / max(|you| + |opp|, 1)
// clamped to [0.08, 0.92]; both zero -> exactly 0.5. The floor of 1 (dollar)
// keeps the ratio well-defined and not oversensitive right after Monday open,
// when both dollar gains are near zero and a $0.01 gain would otherwise swing
// the bar almost the full width.

import { formatMoney } from './money';

const MIN_RATIO = 0.08;
const MAX_RATIO = 0.92;
const DENOM_FLOOR = 1;

export type Leader = 'you' | 'opponent' | 'tie';

/** Fraction of the bar (0..1) that belongs to "you". 0.5 is dead even. */
export function tugRatio(you: number, opponent: number): number {
  if (you === 0 && opponent === 0) return 0.5;
  const denom = Math.max(Math.abs(you) + Math.abs(opponent), DENOM_FLOOR);
  const raw = 0.5 + (0.5 * (you - opponent)) / denom;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));
}

export function leaderOf(you: number, opponent: number): Leader {
  if (you > opponent) return 'you';
  if (opponent > you) return 'opponent';
  return 'tie';
}

/**
 * Whether the LEADER identity changed between two snapshots — this, not any
 * ratio delta, is what triggers <TugBar>'s `spring.lively` overshoot (§4:
 * "lead change -> overshoot + chyron"). A tie counts as a distinct leader
 * state, so a lead narrowing to a tie is still a change worth calling out.
 */
export function hasLeadChanged(
  prevYou: number,
  prevOpponent: number,
  nextYou: number,
  nextOpponent: number
): boolean {
  return leaderOf(prevYou, prevOpponent) !== leaderOf(nextYou, nextOpponent);
}

/**
 * `<TugBar>`'s accessibility label. Dollars only, NEVER a percentage — the
 * bar's own ratio is a layout fraction (clamped to [0.08, 0.92] for visual
 * legibility), not a probability, and reading it out as one would imply a win
 * probability, which is ruled out product-wide (Design Lead, 2026-09-26; see
 * also §7 ask 8 — "drop win probability from the landing mock unless a model
 * is built"). Mirrors <Scoreboard>'s lead-line verb agreement: "you" is
 * always second person ("You lead by..."), the opponent's real name is third
 * person ("{name} leads by...").
 */
export function tugAccessibilityLabel(you: number, opponent: number, opponentName: string): string {
  const leader = leaderOf(you, opponent);
  if (leader === 'tie') return 'Tied';
  const gap = formatMoney(Math.abs(you - opponent));
  return leader === 'you' ? `You lead by ${gap}` : `${opponentName} leads by ${gap}`;
}
