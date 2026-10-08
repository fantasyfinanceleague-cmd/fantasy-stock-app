/**
 * Final lineup parity (3c). A posted matchup's per-stock rows are the SAME
 * accounting as the server's score (liveWeekScore with the Friday close as the
 * price). They are shown ONLY when they sum to the recorded team gain to the
 * cent; otherwise the lineup is hidden and the mismatch is reported, never
 * shown. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import { finalLineup } from '../lib/game/finalLineup.ts';

const snap = (symbol: string, quantity: number, week_start_price: number, week_end_price: number | null, entered_mid_week = false) =>
  ({ symbol, quantity, week_start_price, week_end_price, entered_mid_week });

Deno.test('a consistent week: the rows sum to the recorded gain, so the lineup shows', () => {
  // NVDA 10 * (112.5 - 100) = 125.00; AAPL 5 * (198 - 200) = -10.00; total 115.00
  const r = finalLineup({
    snapshots: [snap('NVDA', 10, 100, 112.5), snap('AAPL', 5, 200, 198)],
    trades: [],
    teamGain: 115,
  });
  assert(r.ok);
  assertEquals(r.rows!.reduce((s, x) => s + x.cents, 0), 11500);
});

Deno.test('the rows sum to the recorded gain to the cent, for a full mixed week', () => {
  const r = finalLineup({
    snapshots: [snap('A', 3.3, 10.1, 11.27), snap('B', 7.7, 20.3, 19.9), snap('C', 1.1, 5, 5.45)],
    trades: [],
    teamGain: 3.3 * (11.27 - 10.1) + 7.7 * (19.9 - 20.3) + 1.1 * (5.45 - 5),
  });
  assert(r.ok);
  assertEquals(r.rows!.reduce((s, x) => s + x.cents, 0), Math.round(r.gain * 100));
});

Deno.test('a mismatch hides the lineup and reports the difference, never shows wrong numbers', () => {
  const r = finalLineup({
    snapshots: [snap('NVDA', 10, 100, 112.5)],
    trades: [],
    teamGain: 999, // the recorded gain disagrees with the Friday closes
  });
  assertEquals(r.ok, false);
  assertEquals(r.rows, null);
  // recorded minus computed: 999 - 125
  assert(Math.abs((r.mismatchDollars ?? 0) - (999 - 125)) < 1e-9);
});

Deno.test('a stock with no Friday close is a mismatch too (its gain cannot be known), never zero', () => {
  const r = finalLineup({
    snapshots: [snap('NVDA', 10, 100, 112.5), snap('PLTR', 3, 50, null)],
    trades: [],
    teamGain: 125,
  });
  assertEquals(r.ok, false);
  assertEquals(r.rows, null);
});

// The server's calculateUserScore counts a mid-week SELL of a Monday lot at
// sale minus Monday open, and a mid-week BUY still held at the close at close
// minus purchase. With trades, the same accounting must reconcile to the cent.
Deno.test('mid-week buy AND sell: the rows reconcile to the recorded gain, exactly as the server scores it', () => {
  const trades = [
    { symbol: 'NVDA', action: 'sell' as const, quantity: 4, price: 110, createdAt: new Date('2026-09-29T15:00:00Z') },
    { symbol: 'AAPL', action: 'buy' as const, quantity: 5, price: 200, createdAt: new Date('2026-09-30T15:00:00Z') },
  ];
  const r = finalLineup({
    snapshots: [
      // Monday lot held all week (qty 10 at Monday open 100, closed at 112).
      { symbol: 'NVDA', quantity: 10, week_start_price: 100, week_end_price: 112, entered_mid_week: false },
      // Bought mid-week, still held at the close (purchase 200, closed at 190).
      { symbol: 'AAPL', quantity: 5, week_start_price: 200, week_end_price: 190, entered_mid_week: true },
    ],
    trades,
    // NVDA: sold 4 at 110 (+40) and held 6 to 112 (+72); AAPL: 5 * (190 - 200) = -50. Total 62.
    teamGain: 62,
  });
  assert(r.ok);
  assertEquals(r.rows!.reduce((s, x) => s + x.cents, 0), 6200);
});

Deno.test('the same week with the trades missing does NOT reconcile, so the lineup is withheld', () => {
  const r = finalLineup({
    snapshots: [
      { symbol: 'NVDA', quantity: 10, week_start_price: 100, week_end_price: 112, entered_mid_week: false },
      { symbol: 'AAPL', quantity: 5, week_start_price: 200, week_end_price: 190, entered_mid_week: true },
    ],
    trades: [],
    teamGain: 62,
  });
  assertEquals(r.ok, false);
});
