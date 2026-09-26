// Drives ScoreDigits' per-digit roll: "only on change, never on first
// paint" (DESIGN_DIRECTION.md §4). Right-aligns `prev` under `next`
// (money/scores grow leading digits, not trailing ones — "$99" -> "$100"
// adds a digit on the LEFT) and reports, for every character position in
// `next`, whether it differs from its aligned counterpart in `prev`. A
// `next` position with no counterpart (the string grew) counts as changed.

/** One boolean per character of `next`, true where it differs from the
 * right-aligned character of `prev` at that position (or has none). */
export function digitDiff(prev: string, next: string): boolean[] {
  const offset = next.length - prev.length;
  const result: boolean[] = new Array(next.length);
  for (let i = 0; i < next.length; i++) {
    const prevIndex = i - offset;
    const prevChar = prevIndex >= 0 && prevIndex < prev.length ? prev[prevIndex] : undefined;
    result[i] = prevChar !== next[i];
  }
  return result;
}
