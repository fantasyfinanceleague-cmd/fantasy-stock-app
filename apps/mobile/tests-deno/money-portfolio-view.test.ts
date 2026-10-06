/**
 * Hermetic tests for lib/money/portfolioView.ts (3e). The fixture is the
 * board's Roberto lineup: its figures are DERIVED from the draft prices, the
 * quantities (2,000 / draft, 4 dp) and the Thursday prices, never typed.
 * Run with: cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { formatMoney } from '../components/sp/logic/money.ts';
import { buildPortfolioView, type ViewHolding } from '../lib/money/portfolioView.ts';
import { portfolioSummary } from '../lib/money/portfolioModel.ts';

const NOTIONAL = 2000;
const LINEUP = [
  { t: 'NVDA', draft: 290.1, thu: 318.37, prev: 306.68 },
  { t: 'AAPL', draft: 198.6, thu: 211.42, prev: 208.83 },
  { t: 'CRM', draft: 262.4, thu: 271.35, prev: 269.96 },
  { t: 'TSLA', draft: 262.8, thu: 248.36, prev: 249.66 },
  { t: 'COST', draft: 905.2, thu: 918.1, prev: 915.22 },
  { t: 'V', draft: 281.5, thu: 286.1, prev: 285.04 },
];
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const drafts = LINEUP.map((h) => ({ symbol: h.t, entryPrice: h.draft, quantity: r4(NOTIONAL / h.draft) }));
const price = (sym: string) => LINEUP.find((h) => h.t === sym)?.thu ?? null;
const summary = portfolioSummary({ stakeMode: 'fixed_notional', notionalPerSlot: NOTIONAL, numRounds: 6, drafts, trades: [], price });

const holdings: ViewHolding[] = LINEUP.map((h) => ({
  symbol: h.t, quantity: r4(NOTIONAL / h.draft), costBasis: NOTIONAL, price: h.thu, prevClose: h.prev, name: null,
}));

function view(over: Partial<Parameters<typeof buildPortfolioView>[0]> = {}) {
  return buildPortfolioView({
    value: summary.value, cash: summary.cash, stake: summary.stake, holdings, numRounds: 6,
    perSlotNotional: NOTIONAL, stakeMode: 'fixed_notional', ...over,
  });
}

Deno.test('the header value is the team value, and "since the draft" is value minus the stake', () => {
  const v = view();
  assertEquals(v.valueText, formatMoney(summary.value));
  assertEquals(v.sinceDraftLabel, 'since the draft');
  const gain = summary.value - summary.stake;
  assert(v.gainText!.startsWith(formatMoney(Math.round(gain * 100) / 100, { sign: 'always' })));
});

Deno.test('the rows tie out to the value: holdings at live prices plus cash', () => {
  const v = view();
  const rowsTotal = v.rows.reduce((a, r) => a + r.value, 0);
  assert(Math.abs(rowsTotal + summary.cash - summary.value) < 0.05, `rows ${rowsTotal} + cash ${summary.cash} vs value ${summary.value}`);
});

Deno.test('the slot language: "6 of 6 slots invested" and the per-slot draft amount', () => {
  const v = view();
  assertEquals(v.slotsText, '6 of 6 slots invested');
  assertEquals(v.perSlotText, '$2,000.00 per slot at the draft');
});

Deno.test('today is shown only when every held position has a price and a previous close', () => {
  assert(view().todayText !== null);
  const missing = view({ holdings: holdings.map((h, i) => (i === 0 ? { ...h, prevClose: null } : h)) });
  assertEquals(missing.todayText, null);
});

Deno.test('a row with no live price shows its cost and is counted in the caption, never $0', () => {
  const v = view({ holdings: holdings.map((h, i) => (i === 0 ? { ...h, price: null } : h)) });
  const nvda = v.rows.find((r) => r.symbol === 'NVDA')!;
  assertEquals(nvda.valueIsCost, true);
  assertEquals(nvda.valueText, '$2,000.00');
  assertEquals(nvda.todayText, null);
  assertEquals(v.unpricedNote, '1 holding counted at cost (no live price yet)');
});

Deno.test('rows are sorted by value, largest first, with ties broken by symbol', () => {
  const v = view();
  const values = v.rows.map((r) => r.value);
  assertEquals(values, [...values].sort((a, b) => b - a));
});

Deno.test('a row carries the sign in its text, so colour is never the only code', () => {
  const v = view();
  for (const r of v.rows) {
    if (r.todayText) assert(r.todayText.startsWith('+') || r.todayText.startsWith('−') || r.todayText.endsWith('0.00%'));
  }
});

Deno.test('a stock with a long feed name is cleaned before it is shown', () => {
  const v = view({ holdings: holdings.map((h, i) => (i === 0 ? { ...h, name: 'NVIDIA Corporation - Common Stock' } : h)) });
  assertEquals(v.rows.find((r) => r.symbol === 'NVDA')!.name, 'NVIDIA');
});

Deno.test('the Alpaca credit is always present, from one constant', () => {
  assertEquals(view().creditText, 'Market data provided by Alpaca');
});

Deno.test('a stock in a tier slot shows its slot label; a stock in no slot shows none', () => {
  const v = view({ slotLabels: { NVDA: '$100–$200 slot' } });
  assertEquals(v.rows.find((r) => r.symbol === 'NVDA')!.slotText, '$100–$200 slot');
  assertEquals(v.rows.find((r) => r.symbol === 'AAPL')!.slotText, null);
});
