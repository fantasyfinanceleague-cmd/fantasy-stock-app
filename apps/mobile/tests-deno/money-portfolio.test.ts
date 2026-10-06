/**
 * Hermetic tests for lib/money/portfolioModel.ts (3e, D3 closed): a legacy
 * SKIP row produces no holding row and no cash, and changes nothing else.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { portfolioSummary, type PortfolioDraftRow } from '../lib/money/portfolioModel.ts';

// Five real picks at $100 x 20 shares = $2,000 each, valued at cost.
const REAL: PortfolioDraftRow[] = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'].map((symbol) => ({ symbol, entryPrice: 100, quantity: 20 }));
const SKIP: PortfolioDraftRow = { symbol: 'SKIP', entryPrice: 0, quantity: 0 };
const price = (symbol: string) => (symbol === 'SKIP' ? null : 100);

const BASE = { stakeMode: 'fixed_notional' as const, notionalPerSlot: 2000, numRounds: 6, trades: [], price };

Deno.test('a SKIP row produces no holding row and no cash', () => {
  const s = portfolioSummary({ ...BASE, drafts: [...REAL, SKIP] });
  assertEquals(s.holdingSymbols, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']);
  assertEquals(s.legacySkipRows, 1);
  assertEquals(s.cash, 0);
});

Deno.test('a SKIP row changes nothing: the same value and cash as the roster without it', () => {
  const withSkip = portfolioSummary({ ...BASE, drafts: [...REAL, SKIP] });
  const without = portfolioSummary({ ...BASE, drafts: REAL, numRounds: 5 });
  assertEquals(withSkip.value, without.value);
  assertEquals(withSkip.cash, without.cash);
  assertEquals(withSkip.value, 10000);
});

Deno.test('SKIP matching is case-insensitive and never a holding', () => {
  const s = portfolioSummary({ ...BASE, drafts: [...REAL, { symbol: 'skip', entryPrice: 0, quantity: 0 }] });
  assertEquals(s.holdingSymbols.includes('SKIP'), false);
  assertEquals(s.legacySkipRows, 1);
});

Deno.test('with no SKIP rows the stake is the full roster, so cash is zero at cost', () => {
  const s = portfolioSummary({ ...BASE, drafts: REAL });
  assertEquals(s.legacySkipRows, 0);
  assertEquals(s.cash, 2000); // 6 slots x $2,000 stake minus $10,000 drafted: one slot unallocated
});
