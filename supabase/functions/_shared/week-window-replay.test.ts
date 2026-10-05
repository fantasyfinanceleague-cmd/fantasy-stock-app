/**
 * End-to-end replay of docs/audits/2026-09-30-week-window-audit.md's
 * scenarios, through the REAL fixed pipeline this branch adds:
 *
 *   weekCut (./week-window.ts)
 *   -> planWeekWindow (../snapshot-week-start/plan.ts) -> the baseline
 *      ledger cut (created_at < open) and buildPricedRows (the Monday row)
 *   -> planCloseWindow (../snapshot-week-end/close.ts) -> the close ledger
 *      cut (created_at <= close) and buildCloseWork (KIND 1 close / KIND 2
 *      mid-week insert)
 *   -> the in-week trade window (created_at BETWEEN open AND close —
 *      process-week-results/index.ts's own predicate, restated here since
 *      that file cannot be imported: it calls Deno.serve at module scope)
 *   -> calculateUserScore (../process-week-results/user-score.ts)
 *
 * This is the audit's own replay script
 * (docs/audits/2026-09-30-week-window-replay.ts) reworked to exercise the
 * FIX's own modules instead of hand-rolling the window arithmetic the old
 * code used — the audit script chained the OLD code's exact defective
 * predicates and asserted they were wrong (RED); this chains the NEW
 * modules and asserts they are now right (GREEN). Both are kept: the old
 * script is the historical proof the defect existed; this is the proof it
 * is fixed, wired into `deno test supabase/functions/`.
 *
 * DB reads and Alpaca prices are replaced by fixed inputs; everything else
 * is the production code.
 */

import { assertEquals } from 'jsr:@std/assert';
import { weekCut, type CalendarSession, type Coverage } from './week-window.ts';
import { snapshotHoldings } from './snapshot-holdings.ts';
import { classifyCoverage, selectMissingHoldings, buildPricedRows, planWeekWindow } from '../snapshot-week-start/plan.ts';
import { classifyCloseCoverage, buildCloseWork, planCloseWindow } from '../snapshot-week-end/close.ts';
import { calculateUserScore } from '../process-week-results/user-score.ts';

const U = 'u1';
const WIDE: Coverage = { from: '2026-01-01', through: '2027-12-31' };

interface TradeRow {
  user_id: string;
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  price: number;
  created_at: string;
}

/** A normal Mon-Fri week, 9:30-16:00 ET every day, starting `mondayDate`. */
function normalWeek(mondayDate: string): CalendarSession[] {
  const [y, m, d] = mondayDate.split('-').map(Number);
  return [0, 1, 2, 3, 4].map((n) => {
    const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
    const dt = new Date(t);
    const pad = (x: number) => String(x).padStart(2, '0');
    return { sessionDate: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, openEt: '09:30', closeEt: '16:00' };
  });
}

/**
 * Run ONE full week for user U through the real fixed pipeline.
 *
 * `nominalAnchor`: the OLD nominal week_start (Tuesday 14:30Z) — matchups
 * would store this before snapshot-week-start's first run reconciles it.
 * Passing the old nominal value (rather than a hand-computed real one) is
 * deliberate: it proves the fixpoint/reconciliation path, not just weekCut
 * in isolation.
 */
function runWeek(
  label: string,
  nominalAnchor: Date,
  floor: Date | null,
  sessions: CalendarSession[],
  drafts: Array<{ user_id: string; symbol: string; quantity: number }>,
  trades: TradeRow[],
  openPrices: Record<string, number>,
  closePrices: Record<string, number>,
  truth: number,
) {
  // ---- snapshot-week-start: plan the window, then the baseline ----------
  const startPlan = planWeekWindow(
    new Date('2099-01-01'), // "now" far in the future so 'not_due' never fires in this replay
    nominalAnchor, floor, sessions, WIDE,
    nominalAnchor.toISOString(), nominalAnchor.toISOString(), // stored = nominal (first run)
    0, // existingSnapshotCount
  );
  if (startPlan.action !== 'proceed') throw new Error(`${label}: expected proceed, got ${startPlan.action}`);

  const tradesBeforeOpen = trades.filter((t) => t.created_at < startPlan.open.toISOString());
  const holdings = new Map([[U, snapshotHoldings(U, drafts, tradesBeforeOpen)]]);
  const coverage = classifyCoverage(holdings, new Set());
  let rows: any[] = [];
  if (coverage === 'incomplete') {
    const { rows: newRows, missingSymbols } = buildPricedRows('L', 1, selectMissingHoldings(holdings, new Set()), new Map(Object.entries(openPrices)));
    if (missingSymbols.length > 0) throw new Error(`${label}: missing open prices for ${missingSymbols}`);
    rows = newRows.map((r) => ({ ...r, id: r.symbol, week_end_price: null, entered_mid_week: false }));
  }

  // ---- FIXPOINT check: re-deriving from the now-reconciled anchor must ---
  // ---- yield the identical window (the rewrite's own safety property). --
  const reconciledPlan = planWeekWindow(
    new Date('2099-01-01'), startPlan.open, floor, sessions, WIDE,
    startPlan.open.toISOString(), startPlan.close.toISOString(), rows.length,
  );
  if (reconciledPlan.action !== 'proceed') throw new Error(`${label}: fixpoint check failed`);
  assertEquals(reconciledPlan.open.getTime(), startPlan.open.getTime(), `${label}: fixpoint (open)`);
  assertEquals(reconciledPlan.close.getTime(), startPlan.close.getTime(), `${label}: fixpoint (close)`);
  assertEquals(reconciledPlan.rewrite, false, `${label}: a second run must never re-rewrite`);

  // ---- snapshot-week-end: plan the close, then close/insert -------------
  const closePlan = planCloseWindow(new Date('2099-01-01'), startPlan.open, floor, sessions, WIDE);
  if (closePlan.action !== 'proceed') throw new Error(`${label}: expected close proceed, got ${closePlan.action}`);
  assertEquals(closePlan.close.getTime(), startPlan.close.getTime(), `${label}: week-start and week-end must compute the SAME close`);

  const tradesThroughClose = trades.filter((t) => t.created_at <= closePlan.close.toISOString());
  const closeHoldings = new Map([[U, snapshotHoldings(U, drafts, tradesThroughClose)]]);
  const closeCoverage = classifyCloseCoverage(closeHoldings, rows);
  if (closeCoverage !== 'none_expected') {
    const work = buildCloseWork('L', 1, closeHoldings, rows, new Map(Object.entries(closePrices)), tradesThroughClose, closePlan.open.toISOString());
    for (const u of work.updates) {
      const target = rows.find((r) => r.id === u.id);
      if (target) target.week_end_price = u.week_end_price;
    }
    rows = rows.concat(work.inserts.map((r) => ({ ...r, id: r.symbol })));
  }

  // ---- process-week-results: the in-week trade window --------------------
  // Restated predicate (index.ts:625-626, unaffected by this fix — it
  // already read off matchups.week_start/week_end): created_at >= week_start
  // AND created_at <= week_end. Single-cut fix: those are now real instants.
  const ws = startPlan.open.toISOString(), we = closePlan.close.toISOString();
  const midWeek = trades
    .filter((t) => t.created_at >= ws && t.created_at <= we)
    .map((t) => ({ symbol: t.symbol, action: t.action, quantity: t.quantity, price: t.price, createdAt: new Date(t.created_at) }));
  const snaps = rows.map((r) => ({
    symbol: r.symbol, quantity: r.quantity,
    weekStartPrice: r.week_start_price, weekEndPrice: r.week_end_price,
    enteredMidWeek: r.entered_mid_week === true,
  }));
  const log = console.log; console.log = () => {}; // calculateUserScore logs every line — silence it
  const score = calculateUserScore(U, snaps, midWeek);
  console.log = log;

  if (Math.abs(score.dollarGain - truth) >= 1e-6) {
    throw new Error(`${label}: scored $${score.dollarGain.toFixed(2)}, truth $${truth.toFixed(2)}`);
  }
}

const DRAFT_AAA_10 = [{ user_id: U, symbol: 'AAA', quantity: 10 }];

// ===========================================================================
// The audit's own scenarios (docs/audits/2026-09-30-week-window-audit.md) —
// same trades, same truths. Every one of these scored WRONG under the old
// code (the audit's own replay proved it); this proves they now score right.
// ===========================================================================

Deno.test('REPLAY EDT-1: Monday-afternoon SELL of a Monday holding scores the real -$50, not a phantom held-to-Friday loss', () => {
  runWeek(
    'EDT-1',
    new Date('2026-09-29T14:30:00.000Z'), null, normalWeek('2026-09-28'),
    DRAFT_AAA_10,
    [{ user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-28T18:00:00.000Z' }],
    { AAA: 100 }, { AAA: 80 },
    10 * (95 - 100),
  );
});

Deno.test('REPLAY EDT-2: Monday-afternoon SELL + reinvest — the reinvest buy is no longer dropped', () => {
  runWeek(
    'EDT-2',
    new Date('2026-09-29T14:30:00.000Z'), null, normalWeek('2026-09-28'),
    DRAFT_AAA_10,
    [
      { user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-28T18:00:00.000Z' },
      { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-09-28T18:01:00.000Z' },
    ],
    { AAA: 100 }, { AAA: 80, BBB: 70 },
    10 * (95 - 100) + 19 * (70 - 50),
  );
});

Deno.test('REPLAY EDT-3 CONTROL: the same trades on Tuesday (already in the old window) still score correctly', () => {
  runWeek(
    'EDT-3',
    new Date('2026-09-29T14:30:00.000Z'), null, normalWeek('2026-09-28'),
    DRAFT_AAA_10,
    [
      { user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-29T15:00:00.000Z' },
      { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-09-29T15:01:00.000Z' },
    ],
    { AAA: 100 }, { AAA: 80, BBB: 70 },
    10 * (95 - 100) + 19 * (70 - 50),
  );
});

Deno.test('REPLAY EDT-4: a buy after the open but before the old 14:35Z snapshot now prices at its own fill, not the stale open', () => {
  runWeek(
    'EDT-4',
    new Date('2026-09-29T14:30:00.000Z'), null, normalWeek('2026-09-28'),
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-09-28T14:15:00.000Z' }], // Mon 10:15 EDT
    {}, { BBB: 70 },
    10 * (70 - 60),
  );
});

Deno.test('REPLAY EDT-5: a Friday after-hours buy scores $0 this week — it belongs to NEXT week\'s baseline', () => {
  runWeek(
    'EDT-5',
    new Date('2026-09-29T14:30:00.000Z'), null, normalWeek('2026-09-28'),
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-10-02T20:30:00.000Z' }], // Fri 4:30 PM EDT, after the 20:00Z real close
    {}, { BBB: 70 },
    0,
  );
});

Deno.test('REPLAY EST-1: Monday-afternoon SELL + reinvest in EST scores correctly too', () => {
  runWeek(
    'EST-1',
    new Date('2026-11-10T14:30:00.000Z'), null, normalWeek('2026-11-09'),
    DRAFT_AAA_10,
    [
      { user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-11-09T19:00:00.000Z' },
      { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-11-09T19:01:00.000Z' },
    ],
    { AAA: 100 }, { AAA: 80, BBB: 70 },
    10 * (95 - 100) + 19 * (70 - 50),
  );
});

Deno.test('REPLAY EST-2: an all-cash Monday buy is priced at its own fill — no Tuesday re-basing', () => {
  runWeek(
    'EST-2',
    new Date('2026-11-10T14:30:00.000Z'), null, normalWeek('2026-11-09'),
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 55, created_at: '2026-11-09T19:00:00.000Z' }], // Mon 2 PM EST
    {}, { BBB: 70 },
    10 * (70 - 55), // NOT 10*(70-52) — the old defect re-based this at Tuesday's open
  );
});

Deno.test('REPLAY HOLIDAY-MON: a buy just after Tuesday\'s real open (MLK Monday) scores at its own fill, no double count', () => {
  const sessions: CalendarSession[] = [
    // 2027-01-18 (Monday, MLK) deliberately absent.
    { sessionDate: '2027-01-19', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-20', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-21', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2027-01-22', openEt: '09:30', closeEt: '16:00' },
  ];
  runWeek(
    'HOLIDAY-MON',
    new Date('2027-01-19T14:30:00.000Z'), null, sessions,
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 50, created_at: '2027-01-19T14:32:00.000Z' }], // 2 min after Tuesday's real open
    {}, { BBB: 70 },
    10 * (70 - 50),
  );
});

// ===========================================================================
// Extras beyond the audit's own scenarios — the fix's other stated claims.
// ===========================================================================

Deno.test('REPLAY EARLY CLOSE: a trade after Black Friday\'s 1PM close belongs to next week, not this one', () => {
  const sessions: CalendarSession[] = [
    { sessionDate: '2026-11-23', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-11-24', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-11-25', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-11-27', openEt: '09:30', closeEt: '13:00' }, // Fri, Thanksgiving Thu absent
  ];
  runWeek(
    'EARLY-CLOSE',
    new Date('2026-11-24T14:30:00.000Z'), null, sessions,
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-11-27T18:30:00.000Z' }], // 6:30 PM EST, after the 1PM EST close
    {}, { BBB: 70 },
    0,
  );
});

Deno.test('REPLAY HOLIDAY FRIDAY: a Thursday-afternoon trade in a Christmas week is in-week, priced at Thursday\'s real close', () => {
  const sessions: CalendarSession[] = [
    { sessionDate: '2026-12-21', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-12-22', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-12-23', openEt: '09:30', closeEt: '16:00' },
    { sessionDate: '2026-12-24', openEt: '09:30', closeEt: '13:00' }, // Thu, early close, real close of the week
    // 2026-12-25 (Fri) Christmas: absent
  ];
  runWeek(
    'HOLIDAY-FRI',
    new Date('2026-12-22T14:30:00.000Z'), null, sessions,
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-12-24T17:00:00.000Z' }], // Thu noon EST, before the 13:00 ET close
    {}, { BBB: 65 },
    10 * (65 - 60),
  );
});

Deno.test('REPLAY WEEK-1 MONDAY-DRAFT FLOOR: a league drafted Monday 11 AM ET starts at Tuesday\'s open, not a pre-draft Monday instant', () => {
  const sessions = normalWeek('2026-09-28');
  const draftInstant = new Date('2026-09-28T15:00:00.000Z'); // Monday 11 AM EDT
  runWeek(
    'WEEK1-FLOOR',
    new Date('2026-09-29T14:30:00.000Z'), draftInstant, sessions,
    [],
    [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 55, created_at: '2026-09-29T14:00:00.000Z' }], // Tue 10 AM EDT, after Tue's real open
    {}, { BBB: 65 },
    10 * (65 - 55),
  );
});
