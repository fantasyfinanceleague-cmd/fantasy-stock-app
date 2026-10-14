/**
 * W4 Portfolio (DL gate, the Orchestrator's ruling on defect (b)): every surface that shows a
 * percent of the season divides by the SAME basis, teamValue's stake — which, since (b), grows
 * by money put in after the draft (a net buy) instead of showing negative cash. The surfaces:
 *   1. Home's hero "+Y% season gain" (buildHomeViewModel → seasonGain(…, teamValue(…).stake));
 *   2. Portfolio's "+Y% since the draft" (usePortfolioData → portfolioSummary → teamValue);
 *   3. another manager's Portfolio (playerPortfolio → portfolioSummary → teamValue).
 * Run: cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .
 */
import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';
import { teamValue } from '../lib/home/teamValue.ts';
import { seasonGain } from '../lib/home/seasonGain.ts';
import { portfolioSummary } from '../lib/money/portfolioModel.ts';
import { buildPortfolioView } from '../lib/money/portfolioView.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// A budget league with a post-draft net buy (KO bought with headroom, no sale).
const INPUT = {
  stakeMode: 'budget_cap' as const,
  notionalPerSlot: null,
  numRounds: 3,
  drafts: [{ symbol: 'JPM', entryPrice: 1000, quantity: 1 }, { symbol: 'DIS', entryPrice: 100, quantity: 1 }],
  trades: [{ symbol: 'KO', action: 'buy' as const, quantity: 1, price: 70 }],
  price: (s: string) => ({ JPM: 1100, DIS: 95, KO: 72 } as Record<string, number>)[s] ?? null,
};

Deno.test('the one basis: teamValue, portfolioSummary and the views all use the same stake', () => {
  const tv = teamValue(INPUT);
  const summary = portfolioSummary(INPUT);
  assertEquals(summary.stake, tv.stake);
  assertEquals(tv.stake, 1170); // the draft (1,100) + the money put in after it (70)

  // Home: the season gain's percent is of that stake.
  const home = seasonGain([12.5, -3], 8, tv.stake);
  assertAlmostEquals(home.pct, (17.5 / 1170) * 100, 1e-9);

  // Portfolio (yours or another manager's: both build the view from portfolioSummary).
  const v = buildPortfolioView({ value: summary.value, cash: summary.cash, stake: summary.stake, holdings: [], numRounds: 3, perSlotNotional: null, stakeMode: 'budget_cap' });
  const gain = summary.value - summary.stake;
  assertEquals(v.gainPctText, `+${((gain / 1170) * 100).toFixed(2)}%`);
});

Deno.test('wiring: Home passes teamValue\'s stake to seasonGain; both Portfolios build from portfolioSummary', () => {
  const home = SOURCES['lib/home/buildHomeViewModel.ts'];
  assertEquals(/const stake = teamValue\(/.test(home), true);
  assertEquals(home.includes('seasonGain(scoredWeeklyGains, currentWeekLiveGain, stake.stake)'), true);
  assertEquals(SOURCES['lib/money/usePortfolioData.ts'].includes('stake: summary.stake'), true);
  assertEquals(SOURCES['lib/money/playerPortfolio.ts'].includes('stake: summary.stake'), true);
  assertEquals(SOURCES['lib/money/portfolioModel.ts'].includes('stake: tv.stake'), true);
});
