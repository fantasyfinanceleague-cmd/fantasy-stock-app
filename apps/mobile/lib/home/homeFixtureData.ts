/**
 * The design board's sample data (docs/design/screens/data.js: "Stock
 * Scudetto", Roberto vs Gianluigi B., week 6 of 14), the parts Home
 * needs — as PURE data, with no `__DEV__`/env-var gating, so it can be
 * imported by both the app's dev fixture (lib/home/devFixture.ts) and by
 * tests-deno (which cannot resolve the RN global `__DEV__` — see
 * devFixture.ts's own doc comment for why the two are split).
 *
 * A fixture screen or test built from these numbers matches the board to
 * the cent — the honesty check's own bar for the states that can't be
 * captured on real data.
 */

import type { LiveSnapshot } from './liveWeekScore';

const NOTIONAL_PER_SLOT = 2000;
const NUM_ROUNDS = 6;

export interface HoldingRow {
  symbol: string;
  draft: number;
  mon: number;
  prev: number; // Wednesday close
  thu: number; // Thursday 1:37 PM ET live
  fri: number; // Friday close (final)
  /** Explicit share count. Absent on the standard board rows, which use
   * the NOTIONAL_PER_SLOT / draft formula instead (see fixtureQty). */
  qty?: number;
  /** True for a holding with no live price: the hero counts it at cost
   * (teamValue) and it contributes no gain. */
  unpriced?: boolean;
}

export const ROBERTO_HOLDINGS: HoldingRow[] = [
  { symbol: 'NVDA', draft: 290.1, mon: 300.2, prev: 306.68, thu: 318.37, fri: 321.9 },
  { symbol: 'AAPL', draft: 198.6, mon: 205.1, prev: 208.83, thu: 211.42, fri: 214.8 },
  { symbol: 'CRM', draft: 262.4, mon: 268.0, prev: 269.96, thu: 271.35, fri: 274.1 },
  { symbol: 'TSLA', draft: 262.8, mon: 251.9, prev: 249.66, thu: 248.36, fri: 250.1 },
  { symbol: 'COST', draft: 905.2, mon: 912.4, prev: 915.22, thu: 918.1, fri: 921.7 },
  { symbol: 'V', draft: 281.5, mon: 284.2, prev: 285.04, thu: 286.1, fri: 291.4 },
];
export const GIANLUIGI_HOLDINGS: HoldingRow[] = [
  { symbol: 'AMZN', draft: 221.3, mon: 238.1, prev: 239.22, thu: 236.4, fri: 234.9 },
  { symbol: 'JPM', draft: 204.9, mon: 214.2, prev: 214.98, thu: 215.45, fri: 216.3 },
  { symbol: 'DIS', draft: 104.2, mon: 101.3, prev: 101.41, thu: 102.9, fri: 100.2 },
  { symbol: 'NKE', draft: 82.4, mon: 79.6, prev: 79.71, thu: 81.3, fri: 79.1 },
  { symbol: 'KO', draft: 68.1, mon: 69.4, prev: 69.47, thu: 69.9, fri: 69.85 },
  { symbol: 'BA', draft: 172.6, mon: 176.3, prev: 176.02, thu: 176.9, fri: 175.4 },
];

export function fixtureQty(h: HoldingRow): number {
  if (h.qty !== undefined) return h.qty;
  return Math.round((NOTIONAL_PER_SLOT / h.draft) * 1e4) / 1e4;
}

/** Scored weeks 1-5 (Roberto), verbatim from the board — sums to $129.99 through Week 5. */
export const ROBERTO_WEEKS: { week: number; gain: number; result: 'W' | 'L' }[] = [
  { week: 1, gain: 41.3, result: 'W' },
  { week: 2, gain: 58.75, result: 'W' },
  { week: 3, gain: -96.4, result: 'L' },
  { week: 4, gain: 72.1, result: 'W' },
  { week: 5, gain: 54.24, result: 'W' },
];

export function fixtureSnapshots(side: 'roberto' | 'gianluigi'): LiveSnapshot[] {
  const rows = side === 'roberto' ? ROBERTO_HOLDINGS : GIANLUIGI_HOLDINGS;
  return rows.map((h) => ({ symbol: h.symbol, quantity: fixtureQty(h), weekStartPrice: h.mon, enteredMidWeek: false }));
}

export function fixturePrice(side: 'roberto' | 'gianluigi', at: 'thu' | 'fri' | 'prev' | 'mon'): (symbol: string) => number | null {
  const rows = side === 'roberto' ? ROBERTO_HOLDINGS : GIANLUIGI_HOLDINGS;
  return (symbol: string) => rows.find((h) => h.symbol === symbol)?.[at] ?? null;
}

export function fixtureDraftRows(side: 'roberto' | 'gianluigi'): { symbol: string; entryPrice: number; quantity: number }[] {
  const rows = side === 'roberto' ? ROBERTO_HOLDINGS : GIANLUIGI_HOLDINGS;
  return rows.map((h) => ({ symbol: h.symbol, entryPrice: h.draft, quantity: fixtureQty(h) }));
}

export const FIXTURE_LEAGUE = {
  id: '00000000-0000-4000-8000-0000000fea70',
  name: 'Stock Scudetto',
  currentWeek: 6,
  numWeeks: 14,
  playoffTeams: 6,
  notionalPerSlot: NOTIONAL_PER_SLOT,
  numRounds: NUM_ROUNDS,
  stakeMode: 'fixed_notional' as const,
};

export const FIXTURE_OPPONENT_NAME = 'Gianluigi B.';
export const FIXTURE_MY_NAME = 'Roberto B.';

/** Matches the board's Week 6 matchup timing (Mon 9/21 open, Fri 9/25 close). */
export const FIXTURE_WEEK6_START = '2026-09-21T09:30:00-04:00';
export const FIXTURE_WEEK6_END = '2026-09-25T16:00:00-04:00';

// ── XL capture (17e, Orchestrator 2026-10-05): a dedicated $100,000-stake
// league, separate from the board sample above. Trade inputs are below
// (share counts, draft, Monday open, Wednesday close, Thursday live); every
// total the hero shows is DERIVED from them by teamValue/seasonGain, and
// tests-deno/home-fixture-xl.test.ts pins the results to the cent:
//   value        $123,456.78  (= stake + season gain)
//   season gain  +$23,456.78  (= scored weeks 1-5 + week 6 live)
// Season gain is +$15,235.76 scored (weeks 1-5) and +$8,221.02 live.
// The opponent mirrors the scored losses (-$15,235.76) with a +$1,150.33
// live week. PLTR is unpriced: it counts at cost and moves nothing.

/** 5 slots × $20,000 = $100,000 stake (teamValue's fixed_notional stake). */
export const XL_LEAGUE = { notionalPerSlot: 20000, numRounds: 5 };

export const XL_ROBERTO_HOLDINGS: HoldingRow[] = [
  { symbol: 'NVDA', draft: 290.1, mon: 348.12, prev: 362.74, thu: 372.49, fri: 372.49, qty: 60 },
  { symbol: 'AAPL', draft: 198.6, mon: 234.35, prev: 247.0, thu: 255.44, fri: 255.44, qty: 90 },
  { symbol: 'CRM', draft: 262.4, mon: 314.88, prev: 326.26, thu: 333.85, fri: 333.85, qty: 50 },
  { symbol: 'TSLA', draft: 262.8, mon: 289.08, prev: 296.02, thu: 300.64, fri: 300.64, qty: 60 },
  { symbol: 'COST', draft: 905.2, mon: 1086.54, prev: 1138.68, thu: 1173.44, fri: 1173.44, qty: 15 },
  { symbol: 'V', draft: 281.5, mon: 325.18, prev: 356.24, thu: 376.94, fri: 376.94, qty: 37 },
  { symbol: 'PLTR', draft: 109.94, mon: 109.94, prev: 109.94, thu: 109.94, fri: 109.94, qty: 100, unpriced: true },
];

export const XL_GIANLUIGI_HOLDINGS: HoldingRow[] = [
  { symbol: 'AMZN', draft: 221.3, mon: 187.94, prev: 189.07, thu: 189.82, fri: 189.82, qty: 90 },
  { symbol: 'JPM', draft: 204.9, mon: 173.76, prev: 175.05, thu: 175.91, fri: 175.91, qty: 80 },
  { symbol: 'DIS', draft: 104.2, mon: 88.36, prev: 88.84, thu: 89.16, fri: 89.16, qty: 150 },
  { symbol: 'NKE', draft: 82.4, mon: 69.88, prev: 70.34, thu: 70.65, fri: 70.65, qty: 120 },
  { symbol: 'KO', draft: 68.1, mon: 57.75, prev: 58.03, thu: 58.21, fri: 58.21, qty: 200 },
  { symbol: 'BA', draft: 172.6, mon: 146.36, prev: 147.42, thu: 148.12, fri: 148.12, qty: 115 },
  { symbol: 'XOM', draft: 96.0, mon: 80.16, prev: 83.86, thu: 86.33, fri: 86.33, qty: 49 },
];

/** Roberto's scored weeks 1-5 for the XL league. Sums to +$15,235.76. */
export const XL_ROBERTO_WEEKS: { week: number; gain: number; result: 'W' | 'L' }[] = [
  { week: 1, gain: 2100.37, result: 'W' },
  { week: 2, gain: 4860.12, result: 'W' },
  { week: 3, gain: -1320.55, result: 'L' },
  { week: 4, gain: 6215.6, result: 'W' },
  { week: 5, gain: 3380.22, result: 'W' },
];

