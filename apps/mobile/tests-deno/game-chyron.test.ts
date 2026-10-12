/**
 * 3c chyron inputs. The chyron's day move is the live price against the last
 * close before today, or null.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { dayMovePct } from '../lib/game/leadChange.ts';

Deno.test('dayMovePct: live price against the last close before today, in percent', () => {
  const bars = { NVDA: [{ date: '2026-09-29', close: 100 }, { date: '2026-09-30', close: 110 }] };
  // Today is 2026-10-01; the last close before it is 110. Live 113.2 is +2.9%.
  assertEquals(dayMovePct(bars, () => 113.2, 'NVDA', '2026-10-01'), Math.round(((113.2 - 110) / 110) * 1000) / 10);
});

Deno.test('dayMovePct: no live price or no earlier close means no percentage, never zero', () => {
  const bars = { NVDA: [{ date: '2026-09-30', close: 110 }] };
  assertEquals(dayMovePct(bars, () => null, 'NVDA', '2026-10-01'), null);
  assertEquals(dayMovePct({}, () => 113, 'NVDA', '2026-10-01'), null);
});

