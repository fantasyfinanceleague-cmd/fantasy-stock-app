/**
 * Tests for lib/home/todayChange.ts — Home hero's "+$Z today" segment.
 * Per-position rule (Orchestrator ruling, 2026-09-29):
 *   held since before today: qty * (price - prevClose)
 *   bought today:            qty * (price - buyPrice)
 *   sold today:               proceeds - qty * prevClose
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { todayChange, type TodayPosition } from '../lib/home/todayChange.ts';
import type { LiveTrade } from '../lib/home/liveWeekScore.ts';

const t = (iso: string) => new Date(iso);

Deno.test('held since before today: qty * (price - prevClose)', () => {
  const positions: TodayPosition[] = [{ symbol: 'NVDA', quantityBeforeToday: 10 }];
  const result = todayChange(positions, [], () => 313.05, () => 306.68, true);
  assertAlmostEquals(result.total!, 10 * (313.05 - 306.68), 1e-9);
  assertEquals(result.unpriced, []);
});

Deno.test('bought today: qty * (price - buyPrice)', () => {
  const buy: LiveTrade = { symbol: 'SHOP', action: 'buy', quantity: 5, price: 100, createdAt: t('2026-09-24T10:00:00Z') };
  const result = todayChange([], [buy], () => 104.2, () => null, true);
  assertAlmostEquals(result.total!, 5 * (104.2 - 100), 1e-9);
});

Deno.test('sold today: proceeds - qty * prevClose', () => {
  const positions: TodayPosition[] = [{ symbol: 'TSLA', quantityBeforeToday: 10 }];
  const sell: LiveTrade = { symbol: 'TSLA', action: 'sell', quantity: 10, price: 250, createdAt: t('2026-09-24T11:00:00Z') };
  const result = todayChange(positions, [sell], () => 248, () => 249.66, true);
  assertAlmostEquals(result.total!, 10 * 250 - 10 * 249.66, 1e-9);
});

Deno.test('a slot sold then rebought the same day', () => {
  const positions: TodayPosition[] = [{ symbol: 'V', quantityBeforeToday: 10 }];
  const sell: LiveTrade = { symbol: 'V', action: 'sell', quantity: 10, price: 285.04, createdAt: t('2026-09-24T10:00:00Z') };
  const buy: LiveTrade = { symbol: 'V', action: 'buy', quantity: 8, price: 284.0, createdAt: t('2026-09-24T11:00:00Z') };
  const result = todayChange(positions, [sell, buy], () => 286.1, () => 284.2, true);
  const soldPortion = 10 * 285.04 - 10 * 284.2;
  const rebuyPortion = 8 * (286.1 - 284.0);
  assertAlmostEquals(result.total!, soldPortion + rebuyPortion, 1e-9);
});

Deno.test('C2 (code review, 2026-09-29): when NOTHING could be priced, total is null, not a fabricated 0', () => {
  const positions: TodayPosition[] = [{ symbol: 'ZZZZ', quantityBeforeToday: 5 }];
  const result = todayChange(positions, [], () => 50, () => null, true);
  assertEquals(result.unpriced, ['ZZZZ']);
  assertEquals(result.total, null);
});

Deno.test('C2: a mix of one unpriced and one priced position keeps total as the real partial number, not null', () => {
  const positions: TodayPosition[] = [
    { symbol: 'ZZZZ', quantityBeforeToday: 5 },
    { symbol: 'NVDA', quantityBeforeToday: 10 },
  ];
  const price = (s: string) => (s === 'NVDA' ? 313.05 : 50);
  const prevClose = (s: string) => (s === 'NVDA' ? 306.68 : null);
  const result = todayChange(positions, [], price, prevClose, true);
  assertEquals(result.unpriced, ['ZZZZ']);
  assertAlmostEquals(result.total!, 10 * (313.05 - 306.68), 1e-9);
});

Deno.test('C2: no positions and no trades at all is a genuine, real zero — not null', () => {
  const result = todayChange([], [], () => 50, () => 50, true);
  assertEquals(result.unpriced, []);
  assertEquals(result.total, 0);
});

Deno.test('a non-trading day hides the "today" segment entirely', () => {
  const positions: TodayPosition[] = [{ symbol: 'NVDA', quantityBeforeToday: 10 }];
  const result = todayChange(positions, [], () => 313.05, () => 306.68, false);
  assertEquals(result.total, null);
});
