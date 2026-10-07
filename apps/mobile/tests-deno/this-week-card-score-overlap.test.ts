/**
 * ThisWeekCard's scoreboard row (Design Lead final check follow-up,
 * 2026-10-07): at $1M+ gains, "You" and the opponent's ScoreDigits
 * overlapped mid-row. NOT the X-1 component (RollingMoney) -- ThisWeekCard
 * uses ScoreDigits (components/sp/game/ScoreDigits.tsx), which already
 * shrinks its own digits via `adjustsFontSizeToFit`, but only once Yoga
 * gives it a real, constrained width. `scoreCell: { flex: 1 }` alone
 * doesn't constrain it: a flex item's minimum width defaults to its
 * content's intrinsic size, not 0, so `flex: 1` never actually capped
 * either side and they grew into each other.
 * Run: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import thisWeekCardSrc from '../components/home/ThisWeekCard.tsx' with { type: 'text' };

Deno.test('wiring: scoreCell has minWidth: 0, so flex: 1 actually constrains each side', () => {
  assertEquals(/scoreCell:\s*\{[^}]*minWidth:\s*0/.test(thisWeekCardSrc), true);
});

Deno.test('wiring: the opponent\'s score cell hugs its own (right) edge, not the shared middle', () => {
  assertEquals(thisWeekCardSrc.includes('scoreCellRight'), true);
  assertEquals(/scoreCellRight:\s*\{[^}]*alignItems:\s*'flex-end'/.test(thisWeekCardSrc), true);
  // Applied to BOTH the real scores and the loading skeleton, so the
  // skeleton doesn't jump sides once real data lands.
  const rightCellUses = (thisWeekCardSrc.match(/styles\.scoreCell, styles\.scoreCellRight/g) ?? []).length;
  assertEquals(rightCellUses >= 2, true);
});
