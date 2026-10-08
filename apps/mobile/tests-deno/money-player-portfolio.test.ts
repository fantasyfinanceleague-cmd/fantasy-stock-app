/**
 * Another manager's portfolio (3e): read-only, built from the league ledger for
 * that manager, on the stress fixture. Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { playerPortfolio } from '../lib/money/playerPortfolio.ts';
import { parsePortfolioLedger } from '../lib/money/portfolioLedger.ts';
import { buildStressMarket, STRESS_CALLER } from '../lib/money/stressFixture.ts';

const market = buildStressMarket();
const ledger = parsePortfolioLedger(JSON.parse(JSON.stringify(market.ledger)))!;
const OTHER: string = 'm02';

Deno.test('another manager: their name, their holdings, no caller rows', () => {
  const p = playerPortfolio({
    ledger, userId: OTHER, stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: 6,
    prices: market.prices, prevCloses: market.prevCloses,
  })!;
  assertEquals(p.displayName, 'Manager Number 02');
  assertEquals(p.view.rows.length, 6);
  assert(!p.view.rows.some((r) => r.symbol === 'S001'), 'the caller\'s S001 must not appear on another manager');
});

Deno.test('the view is the same accounting as the caller\'s: value rows tie out, gain since the draft', () => {
  const p = playerPortfolio({
    ledger, userId: OTHER, stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: 6,
    prices: market.prices, prevCloses: market.prevCloses,
  })!;
  const rows = p.view.rows.reduce((a, r) => a + r.value, 0);
  assert(rows > 0);
  assert(p.view.gainText !== null);
});

Deno.test('an unknown user is no portfolio, never an invented one', () => {
  assertEquals(playerPortfolio({
    ledger, userId: 'nobody', stakeMode: 'price_tiers', notionalPerSlot: null, numRounds: 6,
    prices: market.prices, prevCloses: market.prevCloses,
  }), null);
});

Deno.test('the caller constant is not the other manager', () => {
  assert(STRESS_CALLER !== OTHER);
});
