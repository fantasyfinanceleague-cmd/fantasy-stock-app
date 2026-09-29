// Stockpile — pure digit-diff logic for <ScoreDigits> (Phase 2 foundation).
// Dependency-free, same reasoning as ./money.ts: importable directly from
// Deno tests, byte-identical to the web implementation.
//
// Pinned by the Orchestrator (2026-09-26, matching web): right-align the
// previous and next formatted strings, then mark the changed characters —
// so "9" -> "10" rolls only the newly-introduced leading digit as "new"
// (no previous character to roll from) and rolls "9" -> "0" in the last
// column, rather than naively diffing left-to-right.

export interface DigitDiffEntry {
  /** The character to display (from `next`). */
  char: string;
  /** The character that was in this column before, or null if this column
   * didn't exist in `prev` (e.g. a new leading digit). */
  prevChar: string | null;
  /** Whether this column's character actually changed — drives whether
   * <ScoreDigits> rolls that column or renders it statically. */
  changed: boolean;
}

const PAD = '\u0000';

/**
 * Right-aligns `prev` and `next`, then returns one entry per character of
 * `next`, each flagged with whether that column changed from `prev`.
 */
export function digitDiff(prev: string, next: string): DigitDiffEntry[] {
  const maxLen = Math.max(prev.length, next.length);
  const prevPadded = prev.padStart(maxLen, PAD);
  const nextPadded = next.padStart(maxLen, PAD);

  const entries: DigitDiffEntry[] = [];
  for (let i = 0; i < maxLen; i++) {
    const n = nextPadded[i];
    if (n === PAD) continue; // this column belongs only to the (longer) prev string
    const p = prevPadded[i] === PAD ? null : prevPadded[i];
    entries.push({ char: n, prevChar: p, changed: p !== n });
  }
  return entries;
}

/** Whether any column changed — gates the roll animation vs. first paint. */
export function hasDigitsChanged(prev: string, next: string): boolean {
  return prev !== next;
}
