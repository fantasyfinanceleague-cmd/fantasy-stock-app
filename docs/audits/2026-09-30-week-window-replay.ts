/**
 * Hermetic replay for docs/audits/2026-09-30-week-window-audit.md.
 *
 * Chains the REAL pure modules the way the three weekly handlers do:
 *   weekWindow (_shared/schedule.ts)
 *   -> snapshot-week-start: ledger cut at each Mon/Tue RUN time, priced at the bar open
 *      (snapshotHoldings + classifyCoverage / selectMissingHoldings / buildPricedRows)
 *   -> snapshot-week-end: ledger cut at the Fri RUN time (buildCloseWork)
 *   -> process-week-results: in-week trades = created_at in [week_start, week_end]
 *      (index.ts:625-626), then calculateUserScore + ledgerPositionState.
 * DB reads and Alpaca prices are replaced by fixed inputs; everything else is the
 * production code. No DB, no network, no --allow-* beyond reading the repo.
 *
 * Run from repo root:  deno run --allow-read docs/audits/2026-09-30-week-window-replay.ts
 * Exits 1 if ANY scenario scores differently from its stated truth, so it can serve
 * as the failing test for the single-cut fix. "truth" is the audit's intended
 * semantics: a week runs from its first market open to its last market close, and
 * every trade inside it is priced at its fill. (EDT 5's truth of $0 encodes "a
 * trade after the close belongs to the next week"; the fix may choose otherwise.)
 */
const R = new URL('../../supabase/functions', import.meta.url).href;
const { weekWindow } = await import(`${R}/_shared/schedule.ts`);
const { snapshotHoldings } = await import(`${R}/_shared/snapshot-holdings.ts`);
const { classifyCoverage, selectMissingHoldings, buildPricedRows } = await import(`${R}/snapshot-week-start/plan.ts`);
const { buildCloseWork } = await import(`${R}/snapshot-week-end/close.ts`);
const { calculateUserScore } = await import(`${R}/process-week-results/user-score.ts`);
const { ledgerPositionState } = await import(`${R}/process-week-results/scoring-eligibility.ts`);

type T = { user_id: string; symbol: string; action: 'buy'|'sell'; quantity: number; price: number; created_at: string };
const U = 'u1';
let failures = 0;
const et = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit' });

function run(label: string, draftAt: string, snapRuns: string[], weekEndRunAt: string,
             drafts: any[], trades: T[], open: Record<string, number>, close: Record<string, number>, truth: number) {
  const w = weekWindow(new Date(draftAt), 1);
  const ws = w.start.toISOString(), we = w.end.toISOString();
  // snapshot-week-start: ledger as of RUN time (index.ts:366-374 reads ALL trades), priced at that day's bar OPEN
  let rows: any[] = [];
  for (const at of snapRuns) {
    const led = trades.filter(t => t.created_at <= at);
    const hold = new Map([[U, snapshotHoldings(U, drafts, led)]]);
    const covered = new Set(rows.map(r => r.user_id));
    if (classifyCoverage(hold, covered) !== 'incomplete') continue;
    const { rows: add } = buildPricedRows('L', 1, selectMissingHoldings(hold, covered), new Map(Object.entries(open)));
    rows = rows.concat(add.map(r => ({ ...r, id: r.symbol, week_end_price: null, entered_mid_week: false })));
  }
  // snapshot-week-end: ledger as of RUN time (index.ts:287-290), bar CLOSE
  const led = trades.filter(t => t.created_at <= weekEndRunAt);
  const hold = new Map([[U, snapshotHoldings(U, drafts, led)]]);
  const work = buildCloseWork('L', 1, hold, rows, new Map(Object.entries(close)), led);
  for (const u of work.updates) rows.find(r => r.id === u.id).week_end_price = u.week_end_price;
  rows = rows.concat(work.inserts);
  // process-week-results: trades with created_at >= week_start AND <= week_end (index.ts:625-626)
  const mid = trades.filter(t => t.created_at >= ws && t.created_at <= we)
    .map(t => ({ symbol: t.symbol, action: t.action, quantity: t.quantity, price: t.price, createdAt: new Date(t.created_at) }));
  const snaps = rows.map(r => ({ symbol: r.symbol, quantity: r.quantity, weekStartPrice: r.week_start_price, weekEndPrice: r.week_end_price, enteredMidWeek: r.entered_mid_week === true }));
  const log = console.log; console.log = () => {};
  const s = calculateUserScore(U, snaps, mid);
  const ledger = ledgerPositionState(U, drafts, trades, ws, we);
  console.log = log;
  console.log(`\n### ${label}`);
  console.log(`  window  ${ws} (${et(ws)} ET) .. ${we} (${et(we)} ET)`);
  for (const t of trades) console.log(`  trade   ${t.action} ${t.symbol} @${t.price} ${t.created_at} (${et(t.created_at)} ET) inWindow=${t.created_at >= ws && t.created_at <= we}`);
  console.log(`  rows    ${JSON.stringify(snaps)}`);
  if (Math.abs(s.dollarGain - truth) >= 1e-6) failures++;
  console.log(`  scored  $${s.dollarGain.toFixed(2)}   truth $${truth.toFixed(2)}   ${Math.abs(s.dollarGain - truth) < 1e-6 ? 'OK' : 'WRONG'}   ledger=${JSON.stringify(ledger)}`);
}

const D = [{ user_id: U, symbol: 'AAA', quantity: 10 }];
// ---- EDT week: draft Wed 2026-09-23 -> week 1 = Tue 09-29 14:30Z .. Fri 10-02 21:00Z; Monday 09-28 snapshot 14:35Z
const monEDT = '2026-09-28T14:35:00.000Z', friEDT = '2026-10-02T21:05:00.000Z';
const open = { AAA: 100, BBB: 50 }, close = { AAA: 80, BBB: 70 };
run('EDT 1: Monday-afternoon SELL of a Monday holding (sold AAA @95 Mon 2pm ET)', '2026-09-23T15:00:00Z', [monEDT, '2026-09-29T14:35:00.000Z'], friEDT, D,
  [{ user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-28T18:00:00.000Z' }], open, close, 10 * (95 - 100));
run('EDT 2: Monday-afternoon SELL AAA then BUY BBB (reinvest) — BBB bought @50', '2026-09-23T15:00:00Z', [monEDT, '2026-09-29T14:35:00.000Z'], friEDT, D,
  [{ user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-28T18:00:00.000Z' },
   { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-09-28T18:01:00.000Z' }], open, close, 10 * (95 - 100) + 19 * (70 - 50));
run('EDT 3: same trades on TUESDAY 11am ET (inside window) — control', '2026-09-23T15:00:00Z', [monEDT, '2026-09-29T14:35:00.000Z'], friEDT, D,
  [{ user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-09-29T15:00:00.000Z' },
   { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-09-29T15:01:00.000Z' }], open, close, 10 * (95 - 100) + 19 * (70 - 50));
run('EDT 4: buy after the open but before the 14:35Z snapshot (Mon 10:15 ET @60, open 50)', '2026-09-23T15:00:00Z', [monEDT], friEDT, [],
  [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-09-28T14:15:00.000Z' }], open, close, 10 * (70 - 60));
run('EDT 5: Friday 4:30 PM ET after-hours BUY @60 (4pm close 70)', '2026-09-23T15:00:00Z', [monEDT], friEDT, [],
  [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 60, created_at: '2026-10-02T20:30:00.000Z' }], open, close, 0);
// ---- EST week: draft Wed 2026-11-04 -> week 1 = Tue 11-10 .. Fri 11-13; Monday 11-09 snapshot 14:35Z = 9:35 ET
const monEST = '2026-11-09T14:35:00.000Z', friEST = '2026-11-13T21:05:00.000Z';
run('EST 1: Monday-afternoon SELL AAA then BUY BBB', '2026-11-04T15:00:00Z', [monEST, '2026-11-10T14:35:00.000Z'], friEST, D,
  [{ user_id: U, symbol: 'AAA', action: 'sell', quantity: 10, price: 95, created_at: '2026-11-09T19:00:00.000Z' },
   { user_id: U, symbol: 'BBB', action: 'buy', quantity: 19, price: 50, created_at: '2026-11-09T19:01:00.000Z' }], open, close, 10 * (95 - 100) + 19 * (70 - 50));
run('EST 2: all-cash Monday, BUY BBB Mon 2pm ET @55 -> Tuesday heal prices it at TUE open (52)', '2026-11-04T15:00:00Z', [monEST, '2026-11-10T14:35:00.000Z'], friEST, [],
  [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 55, created_at: '2026-11-09T19:00:00.000Z' }], { BBB: 52 }, close, 10 * (70 - 55));
// ---- Holiday Monday (MLK, Mon 2027-01-18, EST): Monday run skips; Tuesday 14:35Z run is the baseline
run('HOLIDAY-MON: buy BBB Tue 9:32 ET (14:32Z) @50 — between week_start 14:30Z and the 14:35Z snapshot', '2027-01-13T15:00:00Z', ['2027-01-19T14:35:00.000Z'], '2027-01-22T21:05:00.000Z', [],
  [{ user_id: U, symbol: 'BBB', action: 'buy', quantity: 10, price: 50, created_at: '2027-01-19T14:32:00.000Z' }], { BBB: 50 }, close, 10 * (70 - 50));

console.log(`\n${failures} scenario(s) scored WRONG`);
if (failures > 0) Deno.exit(1);
