// Drives TugBar's you-vs-opponent fill (DESIGN_DIRECTION.md §9 game
// components). Formula and clamp pinned by the Orchestrator, 2026-09-26,
// so mobile and web read identically: the floor of $1 keeps a near-zero
// matchup (or both teams flat) from producing a huge, noisy swing, and
// both-zero settles at dead centre rather than dividing by zero.
//
// p = 0.5 + 0.5 * (you - opponent) / max(|you| + |opponent|, 1), clamped to
// [0.08, 0.92] so both teams always keep a sliver of visible bar.

const FLOOR = 1;
const MIN_RATIO = 0.08;
const MAX_RATIO = 0.92;

/** Returns your team's fill ratio (0..1) of the tug bar. */
export function tugRatio(you: number, opponent: number): number {
  const denominator = Math.max(Math.abs(you) + Math.abs(opponent), FLOOR);
  const raw = 0.5 + (0.5 * (you - opponent)) / denominator;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, raw));
}
