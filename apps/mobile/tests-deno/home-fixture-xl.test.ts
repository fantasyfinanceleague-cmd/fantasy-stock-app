/**
 * XL capture fixture (17e, 2026-10-05): the hero's numbers are DERIVED from
 * the trade inputs in homeFixtureData.ts, not typed in. These tests run the
 * app's own teamValue and seasonGain over that data and pin the result to
 * the cent: value $123,456.78, season gain +$23,456.78.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  XL_LEAGUE, XL_ROBERTO_HOLDINGS, XL_GIANLUIGI_HOLDINGS, XL_ROBERTO_WEEKS, fixtureQty,
} from '../lib/home/homeFixtureData.ts';
import { teamValue } from '../lib/home/teamValue.ts';
import { seasonGain } from '../lib/home/seasonGain.ts';

const cents = (v: number) => Math.round(v * 100) / 100;

function live(rows: typeof XL_ROBERTO_HOLDINGS): number {
  return cents(rows.reduce((s, h) => s + (h.unpriced ? 0 : fixtureQty(h) * (h.thu - h.mon)), 0));
}

function scoredTotal(): number {
  return cents(XL_ROBERTO_WEEKS.reduce((s, w) => s + w.gain, 0));
}

Deno.test('XL: the hero value is $123,456.78 (stake + season gain), priced live', () => {
  const stake = teamValue({
    stakeMode: 'fixed_notional', notionalPerSlot: XL_LEAGUE.notionalPerSlot, numRounds: XL_LEAGUE.numRounds,
    drafts: XL_ROBERTO_HOLDINGS.map((h) => ({ symbol: h.symbol, entryPrice: h.draft, quantity: fixtureQty(h) })),
    trades: [],
    price: (sym) => {
      const h = XL_ROBERTO_HOLDINGS.find((r) => r.symbol === sym);
      return h && !h.unpriced ? h.thu : null;
    },
  });
  assertEquals(stake.stake, 100000);
  assertEquals(cents(stake.value), 123456.78);
  assertEquals(stake.unpriced, ['PLTR']);
});

Deno.test('XL: season gain is +$23,456.78 = scored weeks 1-5 + week 6 live', () => {
  const liveGain = live(XL_ROBERTO_HOLDINGS);
  assertEquals(liveGain, 8221.02);
  assertEquals(scoredTotal(), 15235.76);
  const { gain, pct } = seasonGain(XL_ROBERTO_WEEKS.map((w) => w.gain), liveGain, XL_LEAGUE.notionalPerSlot * XL_LEAGUE.numRounds);
  assertEquals(gain, 23456.78);
  assertEquals(cents(pct), 23.46);
});

Deno.test('XL: scored history reconciles to the holdings (Monday open minus draft)', () => {
  const monMinusDraft = cents(XL_ROBERTO_HOLDINGS.reduce((s, h) => s + (h.unpriced ? 0 : fixtureQty(h) * (h.mon - h.draft)), 0));
  assertEquals(monMinusDraft, scoredTotal());
});

Deno.test('XL: the opponent mirrors the scored losses and carries a small live week', () => {
  const monMinusDraft = cents(XL_GIANLUIGI_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.mon - h.draft), 0));
  assertEquals(monMinusDraft, -scoredTotal());
  assertEquals(cents(XL_GIANLUIGI_HOLDINGS.reduce((s, h) => s + fixtureQty(h) * (h.thu - h.mon), 0)), 1150.33);
});

Deno.test('XL: every Wednesday close sits between Monday open and Thursday live (today = Wed to Thu)', () => {
  for (const h of [...XL_ROBERTO_HOLDINGS, ...XL_GIANLUIGI_HOLDINGS]) {
    if (h.unpriced) continue;
    const lo = Math.min(h.mon, h.thu);
    const hi = Math.max(h.mon, h.thu);
    assertEquals(h.prev >= lo && h.prev <= hi, true, `${h.symbol} prev ${h.prev} outside [${lo}, ${hi}]`);
  }
});
