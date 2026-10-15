/**
 * The "Email confirmed" chip's words (constants/confirmEmailCopy.ts, approved 2026-10-14). The
 * constant keeps its leading "✓" (Giorgio's string, verbatim); the screen draws the check as an
 * icon (§9B), so the shown label drops the glyph and the spoken one is plain sentence case.
 * Pure, so tests-deno pins it.
 */
export function confirmedChipLabel(copy: string): { shown: string; spoken: string } {
  const shown = copy.replace(/^[✓✔]\s*/u, '').trim();
  const lower = shown.toLowerCase();
  return { shown, spoken: lower.charAt(0).toUpperCase() + lower.slice(1) };
}
