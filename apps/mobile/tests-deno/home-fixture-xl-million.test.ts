/**
 * XL MILLION capture fixture (17e, 2026-10-07, X-1 re-capture): the XL
 * fixture's exact roster, scaled x10 on share count only (every price
 * unchanged) -- pins that the derivation lands on a hero of
 * $1,234,567.80, exactly 10x the pinned $123,456.78 XL fixture.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  XL_MILLION_LEAGUE, XL_MILLION_ROBERTO_HOLDINGS, XL_MILLION_GIANLUIGI_HOLDINGS, XL_MILLION_ROBERTO_WEEKS,
  XL_LEAGUE, XL_ROBERTO_HOLDINGS, fixtureQty,
} from '../lib/home/homeFixtureData.ts';
import { teamValue } from '../lib/home/teamValue.ts';
import { seasonGain } from '../lib/home/seasonGain.ts';

const cents = (v: number) => Math.round(v * 100) / 100;

function live(rows: typeof XL_MILLION_ROBERTO_HOLDINGS): number {
  return cents(rows.reduce((s, h) => s + (h.unpriced ? 0 : fixtureQty(h) * (h.thu - h.mon)), 0));
}

Deno.test('XL MILLION: the stake is exactly 10x the XL fixture\'s, crossing $1,000,000', () => {
  assertEquals(XL_MILLION_LEAGUE.notionalPerSlot, XL_LEAGUE.notionalPerSlot * 10);
  assertEquals(XL_MILLION_LEAGUE.notionalPerSlot * XL_MILLION_LEAGUE.numRounds, 1000000);
});

Deno.test('XL MILLION: every share count is exactly 10x the XL fixture\'s, prices unchanged', () => {
  for (let i = 0; i < XL_MILLION_ROBERTO_HOLDINGS.length; i++) {
    const million = XL_MILLION_ROBERTO_HOLDINGS[i];
    const xl = XL_ROBERTO_HOLDINGS[i];
    assertEquals(fixtureQty(million), fixtureQty(xl) * 10, `${million.symbol} qty`);
    assertEquals(million.draft, xl.draft, `${million.symbol} draft price`);
    assertEquals(million.mon, xl.mon, `${million.symbol} Monday price`);
    assertEquals(million.thu, xl.thu, `${million.symbol} Thursday price`);
  }
  assertEquals(XL_MILLION_ROBERTO_HOLDINGS.map((h) => h.symbol), ['NVDA', 'AAPL', 'CRM', 'TSLA', 'COST', 'V', 'PLTR']);
  assertEquals(fixtureQty(XL_MILLION_ROBERTO_HOLDINGS[0]), 600); // NVDA: 60 * 10
  assertEquals(XL_MILLION_ROBERTO_HOLDINGS[0].draft, 290.1); // price untouched
});

Deno.test('XL MILLION: the hero value is $1,234,567.80 -- exactly 10x the pinned XL fixture', () => {
  const stake = teamValue({
    stakeMode: 'fixed_notional', notionalPerSlot: XL_MILLION_LEAGUE.notionalPerSlot, numRounds: XL_MILLION_LEAGUE.numRounds,
    drafts: XL_MILLION_ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, entryPrice: h.draft, quantity: fixtureQty(h) })),
    trades: [],
    price: (sym) => {
      const h = XL_MILLION_ROBERTO_HOLDINGS.find((r) => r.symbol === sym);
      return h && !h.unpriced ? h.thu : null;
    },
  });
  assertEquals(stake.stake, 1000000);
  assertEquals(cents(stake.value), 1234567.8);
  assertEquals(stake.unpriced, ['PLTR']);
});

Deno.test('XL MILLION: season gain is +$234,567.80 -- exactly 10x the pinned XL fixture', () => {
  const liveGain = live(XL_MILLION_ROBERTO_HOLDINGS);
  assertEquals(liveGain, 82210.2);
  const scoredTotal = cents(XL_MILLION_ROBERTO_WEEKS.reduce((s, w) => s + w.gain, 0));
  assertEquals(scoredTotal, 152357.6);
  const { gain, pct } = seasonGain(
    XL_MILLION_ROBERTO_WEEKS.map((w) => w.gain), liveGain, XL_MILLION_LEAGUE.notionalPerSlot * XL_MILLION_LEAGUE.numRounds,
  );
  assertEquals(gain, 234567.8);
  assertEquals(cents(pct), 23.46); // the pct is scale-invariant -- same ratio as the XL fixture
});

Deno.test('XL MILLION: the opponent mirrors the scored losses, scaled the same way', () => {
  const monMinusDraft = cents(XL_MILLION_GIANLUIGI_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.mon - h.draft), 0));
  const scoredTotal = cents(XL_MILLION_ROBERTO_WEEKS.reduce((s, w) => s + w.gain, 0));
  assertEquals(monMinusDraft, -scoredTotal);
});
