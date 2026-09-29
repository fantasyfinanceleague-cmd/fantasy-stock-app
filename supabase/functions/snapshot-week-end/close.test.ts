/**
 * Unit tests for the week-end closing decisions (see ./close.ts).
 *
 * These lock in the fix for the last live instance of the partial-state family
 * documented in CLAUDE.md:
 *
 *   1. classifyCloseCoverage -> 'none_expected' / 'complete' / 'incomplete'
 *      The old skip-check was existence-only: `existingSnapshots.some(s =>
 *      s.week_end_price != null)`. ANY end-priced row marked the WHOLE
 *      league-week done, so a partial week-end write (some rows priced, some
 *      still null) was unhealable. classifyCloseCoverage now walks every row
 *      and every held (user, symbol) and reports 'incomplete' for either the
 *      KIND 1 gap (unpriced Monday row) or the KIND 2 gap (mid-week buy with
 *      no row at all) — see the REGRESSION test below for the case that
 *      matters most.
 *
 *   2. midWeekEntryPrice -> weighted-average entry price, or null when no
 *      priced buy exists (the caller must refuse to fabricate a cost basis).
 *
 *   3. buildCloseWork -> { updates, inserts, missingSymbols, unbasedPositions }
 *      All-or-nothing over the league: a single missing price anywhere zeroes
 *      out BOTH updates and inserts so a careless caller cannot write a
 *      subset by ignoring missingSymbols. unbasedPositions is the one
 *      exception — priced but not retryable, so it does not abort the league.
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/snapshot-week-end/close.test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  classifyCloseCoverage,
  midWeekEntryPrice,
  buildCloseWork,
  type Holding,
  type ExistingSnapshot,
} from './close.ts';
import { matchupParticipants, snapshotHoldings } from '../_shared/snapshot-holdings.ts';

// Small builders to keep the intent of each case legible (mirrors plan.test.ts).
const holdings = (...pairs: [string, number][]): Holding[] =>
  pairs.map(([symbol, quantity]) => ({ symbol, quantity }));

const userHoldings = (
  entries: Record<string, Holding[]>,
): Map<string, Holding[]> => new Map(Object.entries(entries));

const priceMap = (entries: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(entries));

const row = (
  id: string,
  userId: string,
  symbol: string,
  quantity: number,
  weekStartPrice: number | null,
  weekEndPrice: number | null,
  enteredMidWeek?: boolean,
): ExistingSnapshot => ({
  id,
  user_id: userId,
  symbol,
  quantity,
  week_start_price: weekStartPrice,
  week_end_price: weekEndPrice,
  entered_mid_week: enteredMidWeek ?? false,
});

const trade = (
  userId: string,
  symbol: string,
  action: string,
  quantity: number,
  price: number,
) => ({ user_id: userId, symbol, action, quantity, price });

// ===========================================================================
// classifyCloseCoverage
// ===========================================================================

Deno.test('classifyCloseCoverage: no holdings and no existing rows -> none_expected', () => {
  assertEquals(classifyCloseCoverage(new Map(), []), 'none_expected');
  assertEquals(classifyCloseCoverage(userHoldings({ u1: [] }), []), 'none_expected');
});

Deno.test(
  'classifyCloseCoverage: an existing row with week_end_price == null -> incomplete (KIND 1 missing)',
  () => {
    const uh = userHoldings({ u1: holdings(['AAPL', 1]) });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)];
    assertEquals(classifyCloseCoverage(uh, existing), 'incomplete');
  },
);

Deno.test(
  'classifyCloseCoverage: all existing rows priced but a held symbol has no row -> incomplete (KIND 2 missing, mid-week buy)',
  () => {
    // u1's AAPL row is fully closed, but u1 also holds TSLA (bought mid-week)
    // with no row at all.
    const uh = userHoldings({ u1: holdings(['AAPL', 1], ['TSLA', 2]) });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, 110)];
    assertEquals(classifyCloseCoverage(uh, existing), 'incomplete');
  },
);

Deno.test(
  'classifyCloseCoverage: all rows priced AND every holding has a row -> complete',
  () => {
    const uh = userHoldings({
      u1: holdings(['AAPL', 1], ['MSFT', 2]),
      u2: holdings(['TSLA', 3]),
    });
    const existing = [
      row('r1', 'u1', 'AAPL', 1, 100, 110),
      row('r2', 'u1', 'MSFT', 2, 200, 210),
      row('r3', 'u2', 'TSLA', 3, 300, 290),
    ];
    assertEquals(classifyCloseCoverage(uh, existing), 'complete');
  },
);

// --- THE REGRESSION TEST THAT MATTERS MOST ---------------------------------
Deno.test(
  'REGRESSION: a PARTIAL week-end write (some rows priced, some still null) classifies incomplete, not complete',
  () => {
    // The old guard was `existingSnapshots.some(s => s.week_end_price != null)`.
    // u1's row IS end-priced, so `.some()` was already true and the whole
    // league-week read as DONE — even though u2's row is still open. A
    // mid-loop failure (Alpaca timeout, bad symbol) after pricing u1 but
    // before pricing u2 became permanently unhealable: every retry saw u1's
    // priced row and skipped the league without looking at u2.
    const uh = userHoldings({ u1: holdings(['AAPL', 1]), u2: holdings(['TSLA', 3]) });
    const existing = [
      row('r1', 'u1', 'AAPL', 1, 100, 110), // priced
      row('r2', 'u2', 'TSLA', 3, 300, null), // still open
    ];
    assertEquals(classifyCloseCoverage(uh, existing), 'incomplete');
  },
);

Deno.test(
  'classifyCloseCoverage: a participant holding nothing does not block completeness',
  () => {
    const uh = userHoldings({ u1: holdings(['AAPL', 1]), u2: [] });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, 110)];
    assertEquals(classifyCloseCoverage(uh, existing), 'complete');
  },
);

// ===========================================================================
// midWeekEntryPrice
// ===========================================================================

Deno.test(
  'midWeekEntryPrice: weighted average across multiple buys of the same symbol',
  () => {
    // 10@100 + 10@200 -> (1000 + 2000) / 20 = 150
    const trades = [
      trade('u1', 'AAPL', 'buy', 10, 100),
      trade('u1', 'AAPL', 'buy', 10, 200),
    ];
    assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 150);
  },
);

Deno.test('midWeekEntryPrice: sells are ignored', () => {
  const trades = [
    trade('u1', 'AAPL', 'buy', 10, 100),
    trade('u1', 'AAPL', 'sell', 5, 500), // must not pull the average toward 500
  ];
  assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 100);
});

Deno.test("midWeekEntryPrice: other users' trades are ignored", () => {
  const trades = [
    trade('u1', 'AAPL', 'buy', 10, 100),
    trade('u2', 'AAPL', 'buy', 10, 900), // different user, same symbol
  ];
  assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 100);
});

Deno.test("midWeekEntryPrice: other symbols' trades are ignored", () => {
  const trades = [
    trade('u1', 'AAPL', 'buy', 10, 100),
    trade('u1', 'MSFT', 'buy', 10, 900), // same user, different symbol
  ];
  assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 100);
});

Deno.test('midWeekEntryPrice: symbol matching is case-insensitive', () => {
  const trades = [trade('u1', 'aapl', 'buy', 10, 100)];
  assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 100);
});

Deno.test('midWeekEntryPrice: no priced buy -> null', () => {
  assertEquals(midWeekEntryPrice('u1', 'AAPL', []), null);
  // Only a sell exists for this symbol.
  assertEquals(
    midWeekEntryPrice('u1', 'AAPL', [trade('u1', 'AAPL', 'sell', 5, 100)]),
    null,
  );
});

Deno.test(
  'midWeekEntryPrice: zero/negative quantity or price is skipped',
  () => {
    const trades = [
      trade('u1', 'AAPL', 'buy', 0, 100), // zero quantity
      trade('u1', 'AAPL', 'buy', -5, 100), // negative quantity
      trade('u1', 'AAPL', 'buy', 5, 0), // zero price
      trade('u1', 'AAPL', 'buy', 5, -10), // negative price
      trade('u1', 'AAPL', 'buy', 10, 100), // the only valid buy
    ];
    assertEquals(midWeekEntryPrice('u1', 'AAPL', trades), 100);
  },
);

// ===========================================================================
// buildCloseWork
// ===========================================================================

Deno.test(
  'buildCloseWork: all symbols priced -> updates for unpriced rows, inserts for mid-week buys, empty missingSymbols',
  () => {
    const uh = userHoldings({ u1: holdings(['AAPL', 1], ['TSLA', 2]) });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)]; // KIND 1: needs closing
    const trades = [trade('u1', 'TSLA', 'buy', 2, 300)]; // KIND 2: mid-week buy
    const { updates, inserts, missingSymbols, unbasedPositions } = buildCloseWork(
      'lg1',
      4,
      uh,
      existing,
      priceMap({ AAPL: 110, TSLA: 320 }),
      trades,
    );

    assertEquals(missingSymbols, []);
    assertEquals(unbasedPositions, []);
    assertEquals(updates, [{ id: 'r1', week_end_price: 110 }]);
    assertEquals(inserts, [
      {
        league_id: 'lg1',
        user_id: 'u1',
        week_number: 4,
        symbol: 'TSLA',
        quantity: 2,
        week_start_price: 300,
        entered_mid_week: true,
        week_end_price: 320,
      },
    ]);
  },
);

Deno.test(
  'buildCloseWork: an existing row that already has week_end_price is never re-written',
  () => {
    const uh = userHoldings({ u1: holdings(['AAPL', 1]) });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, 110)]; // already closed
    const { updates, missingSymbols } = buildCloseWork(
      'lg1',
      4,
      uh,
      existing,
      priceMap({ AAPL: 999 }), // even if a new price is available, must not rewrite
      [],
    );
    assertEquals(missingSymbols, []);
    assertEquals(updates, []);
  },
);

// --- ALL-OR-NOTHING: the core atomicity guarantee --------------------------

Deno.test(
  'ALL-OR-NOTHING (KIND 1 path): a missing price on an unpriced existing row aborts the whole league — updates AND inserts both come back empty',
  () => {
    // u1's AAPL row needs closing but has no price. u2's mid-week TSLA buy IS
    // priceable. If the caller could write "the ones we could", TSLA would
    // insert while AAPL stayed open — producing the exact unhealable partial
    // this module exists to prevent.
    const uh = userHoldings({
      u1: holdings(['AAPL', 1]),
      u2: holdings(['TSLA', 2]),
    });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)]; // KIND 1, unpriced
    const trades = [trade('u2', 'TSLA', 'buy', 2, 300)];
    const { updates, inserts, missingSymbols } = buildCloseWork(
      'lg1',
      4,
      uh,
      existing,
      priceMap({ TSLA: 320 }), // AAPL absent
      trades,
    );
    assertEquals(missingSymbols, ['AAPL']);
    assertEquals(updates, []);
    assertEquals(inserts, []);
  },
);

Deno.test(
  'ALL-OR-NOTHING (KIND 2 path): a missing price on a mid-week buy aborts the whole league — updates AND inserts both come back empty',
  () => {
    // u1's AAPL row is fully priceable and ready to close. u2's mid-week
    // TSLA buy has no price available. The presence of u2's gap must block
    // u1's otherwise-ready update too.
    const uh = userHoldings({
      u1: holdings(['AAPL', 1]),
      u2: holdings(['TSLA', 2]),
    });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)];
    const trades = [trade('u2', 'TSLA', 'buy', 2, 300)];
    const { updates, inserts, missingSymbols } = buildCloseWork(
      'lg1',
      4,
      uh,
      existing,
      priceMap({ AAPL: 110 }), // TSLA absent
      trades,
    );
    assertEquals(missingSymbols, ['TSLA']);
    assertEquals(updates, []);
    assertEquals(inserts, []);
  },
);

Deno.test('buildCloseWork: price of 0 or negative counts as missing, not as a valid price', () => {
  const uh = userHoldings({ u1: holdings(['AAPL', 1], ['ZERO', 1], ['NEG', 1]) });
  const existing = [
    row('r1', 'u1', 'AAPL', 1, 100, null),
    row('r2', 'u1', 'ZERO', 1, 50, null),
    row('r3', 'u1', 'NEG', 1, 50, null),
  ];
  const { missingSymbols, updates } = buildCloseWork(
    'lg1',
    1,
    uh,
    existing,
    priceMap({ AAPL: 100, ZERO: 0, NEG: -5 }),
    [],
  );
  assertEquals(missingSymbols.sort(), ['NEG', 'ZERO']);
  assertEquals(updates, []); // all-or-nothing: AAPL's valid price is withheld too
});

Deno.test(
  'buildCloseWork: a mid-week buy with a close price but no derivable entry price goes to unbasedPositions, is not inserted, and does not abort the league',
  () => {
    // TSLA has a close price but no buy trade exists to derive a cost basis
    // from (e.g. the trade record is missing/corrupt). This is not
    // retryable — no amount of retrying invents a trade — so it must not set
    // missingSymbols or block the rest of the league.
    const uh = userHoldings({
      u1: holdings(['AAPL', 1]), // ordinary KIND 1 close, should proceed normally
      u2: holdings(['TSLA', 2]), // priced but unbased
    });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)];
    const { updates, inserts, missingSymbols, unbasedPositions } = buildCloseWork(
      'lg1',
      4,
      uh,
      existing,
      priceMap({ AAPL: 110, TSLA: 320 }),
      [], // no trades at all -> no basis for TSLA
    );
    assertEquals(missingSymbols, []);
    assertEquals(updates, [{ id: 'r1', week_end_price: 110 }]);
    assertEquals(inserts, []);
    assertEquals(unbasedPositions, [{ userId: 'u2', symbol: 'TSLA' }]);
  },
);

Deno.test(
  'buildCloseWork: inserted rows carry entered_mid_week: true, week_start_price = the weighted entry price, and week_end_price = the close',
  () => {
    const uh = userHoldings({ u1: holdings(['TSLA', 20]) });
    const trades = [
      trade('u1', 'TSLA', 'buy', 10, 100),
      trade('u1', 'TSLA', 'buy', 10, 200), // weighted average -> 150
    ];
    const { inserts } = buildCloseWork(
      'lg1',
      4,
      uh,
      [], // no existing row for TSLA -> KIND 2
      priceMap({ TSLA: 320 }),
      trades,
    );
    assertEquals(inserts, [
      {
        league_id: 'lg1',
        user_id: 'u1',
        week_number: 4,
        symbol: 'TSLA',
        quantity: 20,
        week_start_price: 150,
        entered_mid_week: true,
        week_end_price: 320,
      },
    ]);
  },
);

Deno.test('buildCloseWork: empty inputs -> empty work, no missing', () => {
  const { updates, inserts, missingSymbols, unbasedPositions } = buildCloseWork(
    'lg1',
    1,
    new Map(),
    [],
    priceMap({}),
    [],
  );
  assertEquals(updates, []);
  assertEquals(inserts, []);
  assertEquals(missingSymbols, []);
  assertEquals(unbasedPositions, []);
});

// Sanity check that ALL-OR-NOTHING really means "nothing", not "fewer" — a
// belt-and-suspenders assertion alongside the two named tests above.
Deno.test(
  'sanity: ALL-OR-NOTHING never returns a non-empty updates/inserts alongside a non-empty missingSymbols',
  () => {
    const uh = userHoldings({ u1: holdings(['AAPL', 1], ['MSFT', 2]) });
    const existing = [row('r1', 'u1', 'AAPL', 1, 100, null)];
    const { updates, inserts, missingSymbols } = buildCloseWork(
      'lg1',
      1,
      uh,
      existing,
      priceMap({ AAPL: 110 }), // MSFT (mid-week buy, KIND 2) is unpriced
      [trade('u1', 'MSFT', 'buy', 2, 200)],
    );
    assert(missingSymbols.length > 0, 'sanity: this case should have a missing symbol');
    assertEquals(updates.length, 0);
    assertEquals(inserts.length, 0);
  },
);

// ===========================================================================
// Bots + SKIP rows, end to end through the shared holdings helper
// (../_shared/snapshot-holdings.ts) — the SAME pipeline as the handler:
// matchups -> matchupParticipants -> snapshotHoldings -> classifyCloseCoverage /
// buildCloseWork.
// ===========================================================================

const HUMAN_A = '11111111-1111-1111-1111-111111111111';
const HUMAN_B = '22222222-2222-2222-2222-222222222222';
const BOT = 'bot-1';

function holdingsFor(
  matchups: Array<{ team1_user_id: string | null; team2_user_id: string | null }>,
  drafts: Array<{ user_id: string; symbol: string | null; quantity: number | null }>,
): Map<string, Holding[]> {
  const out = new Map<string, Holding[]>();
  for (const id of matchupParticipants(matchups)) out.set(id, snapshotHoldings(id, drafts, []));
  return out;
}

const MIXED_MATCHUPS = [
  { team1_user_id: HUMAN_A, team2_user_id: BOT },
  { team1_user_id: HUMAN_B, team2_user_id: 'bot-2' },
];
const MIXED_DRAFTS = [
  { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
  { user_id: HUMAN_B, symbol: 'KO', quantity: 1 },
  { user_id: HUMAN_B, symbol: 'SKIP', quantity: 0 },
  { user_id: BOT, symbol: 'MSFT', quantity: 1 },
  { user_id: 'bot-2', symbol: 'SKIP', quantity: 0 }, // skip-only bot: empty
];

Deno.test('bots: a bot\'s Monday rows are closed like anyone else\'s (F1, KIND 1)', () => {
  const uh = holdingsFor(MIXED_MATCHUPS, MIXED_DRAFTS);
  const existing = [
    row('r1', HUMAN_A, 'AAPL', 1, 200, null),
    row('r2', HUMAN_B, 'KO', 1, 60, null),
    row('r3', BOT, 'MSFT', 1, 400, null),
  ];
  assertEquals(classifyCloseCoverage(uh, existing), 'incomplete');
  const work = buildCloseWork('L', 2, uh, existing, priceMap({ AAPL: 210, KO: 61, MSFT: 390 }), []);
  assertEquals(work.missingSymbols, []);
  assertEquals(work.inserts, []);
  assertEquals(work.unbasedPositions, []);
  assertEquals(
    work.updates.map((u) => u.id).sort(),
    ['r1', 'r2', 'r3'],
  );
});

Deno.test('SKIP: a SKIP row is never a KIND-2 mid-week holding that blocks the league (F2)', () => {
  // Before the fix HUMAN_B's SKIP row became a 1-share 'SKIP' holding with no
  // row and no close price -> missingSymbols=['SKIP'] -> the whole league's
  // week-end write aborted on every retry.
  const uh = holdingsFor(MIXED_MATCHUPS, MIXED_DRAFTS);
  const existing = [
    row('r1', HUMAN_A, 'AAPL', 1, 200, null),
    row('r2', HUMAN_B, 'KO', 1, 60, null),
    row('r3', BOT, 'MSFT', 1, 400, null),
  ];
  const work = buildCloseWork('L', 2, uh, existing, priceMap({ AAPL: 210, KO: 61, MSFT: 390 }), []);
  assert(!work.missingSymbols.includes('SKIP'));
  assert(!work.inserts.some((i) => i.symbol === 'SKIP'));
});

Deno.test('mixed bot+human league-week, all closed, skip-only bot has no rows -> complete', () => {
  const uh = holdingsFor(MIXED_MATCHUPS, MIXED_DRAFTS);
  assertEquals(uh.get('bot-2'), []);
  const existing = [
    row('r1', HUMAN_A, 'AAPL', 1, 200, 210),
    row('r2', HUMAN_B, 'KO', 1, 60, 61),
    row('r3', BOT, 'MSFT', 1, 400, 390),
  ];
  assertEquals(classifyCloseCoverage(uh, existing), 'complete');
});

Deno.test('SKIP: a league whose only participant holds only SKIP -> none_expected', () => {
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_B, team2_user_id: null }],
    [{ user_id: HUMAN_B, symbol: 'SKIP', quantity: 0 }],
  );
  assertEquals(classifyCloseCoverage(uh, []), 'none_expected');
});

Deno.test('quantity 0 on a real symbol is not coerced into a KIND-2 holding', () => {
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: null }],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: HUMAN_A, symbol: 'ZZZZ', quantity: 0 },
    ],
  );
  const existing = [row('r1', HUMAN_A, 'AAPL', 1, 200, 210)];
  assertEquals(classifyCloseCoverage(uh, existing), 'complete');
});

Deno.test('deploy transition: a bot with NO Monday row is unbased (not written), and does NOT block the humans', () => {
  // Pins current behaviour for the one-time transition: if the week-start run
  // for this week ran under the OLD code (bots excluded), the bot's drafted
  // holdings reach week-end as KIND 2. Bots never trade, so no entry price is
  // derivable -> unbasedPositions (logged, not written, no retry). The humans'
  // Monday rows must still close. Downstream: week 1 -> the bot falls back to
  // the week-1 scorer (same as before this fix); week >1 -> the matchup is
  // refused (same as before this fix). Healable only by a week-start run
  // before Friday close, or a manual backfill after it.
  const uh = holdingsFor(MIXED_MATCHUPS, MIXED_DRAFTS);
  const existing = [
    row('r1', HUMAN_A, 'AAPL', 1, 200, null),
    row('r2', HUMAN_B, 'KO', 1, 60, null),
    // no row for BOT
  ];
  assertEquals(classifyCloseCoverage(uh, existing), 'incomplete');
  const work = buildCloseWork('L', 2, uh, existing, priceMap({ AAPL: 210, KO: 61, MSFT: 390 }), []);
  assertEquals(work.missingSymbols, []);
  assertEquals(work.updates.map((u) => u.id).sort(), ['r1', 'r2']);
  assertEquals(work.inserts, []);
  assertEquals(work.unbasedPositions, [{ userId: BOT, symbol: 'MSFT' }]);
});
