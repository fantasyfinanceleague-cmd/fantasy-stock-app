/**
 * The record-trade request bodies carry WHAT to trade, never how much (3e).
 * Pins the exact keys so a quantity, amount, price or user id can't slip in.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { buyBody, previewBody, sellBody } from '../lib/money/tradeBodies.ts';

Deno.test('sell body: exactly the league and the symbol, no quantity, price or user id', () => {
  assertEquals(Object.keys(sellBody('L1', 'jpm')).sort(), ['action', 'league_id', 'symbol']);
  assertEquals(sellBody('L1', ' jpm '), { action: 'sell', league_id: 'L1', symbol: 'JPM' });
});

Deno.test('buy body: never a quantity or an amount; sold_trade_id only when the picker chose one', () => {
  assertEquals(Object.keys(buyBody('L1', 'vist')).sort(), ['action', 'league_id', 'symbol']);
  assertEquals(buyBody('L1', 'vist', 'trade-7'), { action: 'buy', league_id: 'L1', symbol: 'VIST', sold_trade_id: 'trade-7' });
  assertEquals('sold_trade_id' in buyBody('L1', 'vist', null), false);
});

Deno.test('preview body: the league only', () => {
  assertEquals(previewBody('L1'), { action: 'preview', league_id: 'L1' });
});
