/**
 * Unit tests for the snapshot-planning decisions (see ./plan.ts).
 *
 * These lock in the fixes that previously lived inside Deno.serve with NO coverage:
 *
 *   1. classifyCoverage -> 'none_expected' / 'complete' / 'incomplete'
 *      The old skip-check treated ANY existing row as "done", so a zero-row
 *      participant was unhealable. classifyCoverage now reports 'incomplete' for a
 *      missing participant (heal) — WITHOUT re-snapshotting a covered participant
 *      who merely acquired a new symbol mid-week (the drift-immunity property).
 *
 *   2. selectMissingHoldings -> only the uncovered participants
 *      Guarantees a heal writes ONLY missing users, so an already-correct user's
 *      rows are never rebuilt/overwritten.
 *
 *   3. buildPricedRows -> { rows, missingSymbols }
 *      All-or-nothing: a single missing price yields a non-empty missingSymbols
 *      (caller aborts, writes nothing) instead of a partial row set.
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/snapshot-week-start/plan.test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  classifyCoverage,
  selectMissingHoldings,
  buildPricedRows,
  type Holding,
} from './plan.ts';

// Small builders to keep the intent of each case legible.
const holdings = (...pairs: [string, number][]): Holding[] =>
  pairs.map(([symbol, quantity]) => ({ symbol, quantity }));

const userHoldings = (
  entries: Record<string, Holding[]>,
): Map<string, Holding[]> => new Map(Object.entries(entries));

const priceMap = (entries: Record<string, number>): Map<string, number> =>
  new Map(Object.entries(entries));

// ===========================================================================
// classifyCoverage (per-participant)
// ===========================================================================

Deno.test('classifyCoverage: no participant holds anything -> none_expected', () => {
  // An empty league must NOT be treated as incomplete, or it would wedge the
  // retry loop forever (nothing to write, yet never "complete").
  assertEquals(classifyCoverage(new Map(), new Set()), 'none_expected');
  assertEquals(
    classifyCoverage(userHoldings({ u1: [] }), new Set()),
    'none_expected',
  );
});

Deno.test('classifyCoverage: nobody snapshotted yet -> incomplete', () => {
  const uh = userHoldings({ u1: holdings(['AAPL', 1]), u2: holdings(['TSLA', 3]) });
  assertEquals(classifyCoverage(uh, new Set()), 'incomplete');
});

Deno.test('classifyCoverage: every participant covered -> complete', () => {
  const uh = userHoldings({
    u1: holdings(['AAPL', 1], ['MSFT', 2]),
    u2: holdings(['TSLA', 3]),
  });
  assertEquals(classifyCoverage(uh, new Set(['u1', 'u2'])), 'complete');
});

Deno.test('classifyCoverage: a participant holding nothing does not block completeness', () => {
  // u2 has an empty portfolio -> no expected rows -> not required for completeness.
  const uh = userHoldings({ u1: holdings(['AAPL', 1]), u2: [] });
  assertEquals(classifyCoverage(uh, new Set(['u1'])), 'complete');
});

// --- REGRESSION A: a zero-row participant is healable, not skipped ----------
Deno.test(
  'REGRESSION: a participant with ZERO rows classifies incomplete (heal), not complete (locked out)',
  () => {
    // u1 snapshotted, u2 has NO rows (their only symbol missed a price on the
    // first run). The OLD existence-only skip saw u1's rows and skipped the whole
    // league forever. classifyCoverage must report 'incomplete' so a retry fills u2.
    const uh = userHoldings({
      u1: holdings(['AAPL', 1]),
      u2: holdings(['DELISTED', 5]),
    });
    assertEquals(classifyCoverage(uh, new Set(['u1'])), 'incomplete');
  },
);

// --- REGRESSION B: holdings drift must NOT force a re-snapshot --------------
Deno.test(
  'REGRESSION: a covered participant who acquired a NEW symbol mid-week stays complete (drift-immune)',
  () => {
    // snapshot-week-start fires Monday AND Tuesday. u1 was fully snapshotted Monday,
    // then bought GOOG Monday afternoon. On Tuesday userHoldings shows [AAPL, GOOG]
    // but u1 is already covered. A per-(user,symbol) check would see GOOG "missing"
    // and re-snapshot the whole league at Tuesday prices (overwriting Monday's
    // week_start_price and recording a mid-week buy as a week-start holding). Per
    // participant, u1 is covered -> complete -> Tuesday is a no-op.
    const tuesday = userHoldings({ u1: holdings(['AAPL', 1], ['GOOG', 2]) });
    assertEquals(classifyCoverage(tuesday, new Set(['u1'])), 'complete');
  },
);

// ===========================================================================
// selectMissingHoldings
// ===========================================================================

Deno.test('selectMissingHoldings: returns only uncovered participants with holdings', () => {
  const uh = userHoldings({
    u1: holdings(['AAPL', 1]), // covered
    u2: holdings(['TSLA', 3]), // missing
    u3: [], // no holdings -> never written
  });
  const missing = selectMissingHoldings(uh, new Set(['u1']));
  assertEquals([...missing.keys()], ['u2']);
  assertEquals(missing.get('u2'), holdings(['TSLA', 3]));
});

Deno.test('selectMissingHoldings: nothing missing when all covered', () => {
  const uh = userHoldings({ u1: holdings(['AAPL', 1]), u2: holdings(['TSLA', 3]) });
  assertEquals(selectMissingHoldings(uh, new Set(['u1', 'u2'])).size, 0);
});

Deno.test('selectMissingHoldings: a covered user is EXCLUDED so their rows are never rebuilt', () => {
  // The whole point of finding #1's fix: even though u1 now holds an extra symbol,
  // a covered u1 is not returned, so buildPricedRows never rebuilds/overwrites them.
  const uh = userHoldings({ u1: holdings(['AAPL', 1], ['GOOG', 2]) });
  assertEquals(selectMissingHoldings(uh, new Set(['u1'])).size, 0);
});

// ===========================================================================
// buildPricedRows
// ===========================================================================

Deno.test('buildPricedRows: all holdings priced -> full row set, no missing', () => {
  const uh = userHoldings({
    u1: holdings(['AAPL', 1], ['MSFT', 2]),
    u2: holdings(['TSLA', 3]),
  });
  const { rows, missingSymbols } = buildPricedRows(
    'lg1',
    4,
    uh,
    priceMap({ AAPL: 100, MSFT: 200, TSLA: 300 }),
  );

  assertEquals(missingSymbols, []);
  assertEquals(rows.length, 3);
  const aapl = rows.find((r) => r.user_id === 'u1' && r.symbol === 'AAPL')!;
  assertEquals(aapl, {
    league_id: 'lg1',
    user_id: 'u1',
    week_number: 4,
    symbol: 'AAPL',
    quantity: 1,
    week_start_price: 100,
  });
});

Deno.test(
  'REGRESSION: one missing price aborts the whole write (missingSymbols non-empty)',
  () => {
    // The OLD handler dropped MSFT and inserted AAPL — a partial write. Now the
    // missing symbol must surface so the caller writes NOTHING and retries.
    const uh = userHoldings({ u1: holdings(['AAPL', 1], ['MSFT', 2]) });
    const { rows, missingSymbols } = buildPricedRows(
      'lg1',
      2,
      uh,
      priceMap({ AAPL: 100 }), // MSFT absent
    );
    assertEquals(missingSymbols, ['MSFT']);
    assert(rows.length < 2, 'sanity: a short/partial row set was produced (caller must ignore it)');
  },
);

Deno.test('buildPricedRows: zero / non-positive price counts as missing', () => {
  const uh = userHoldings({ u1: holdings(['AAPL', 1], ['ZERO', 1], ['NEG', 1]) });
  const { missingSymbols } = buildPricedRows(
    'lg1',
    1,
    uh,
    priceMap({ AAPL: 100, ZERO: 0, NEG: -5 }),
  );
  assertEquals(missingSymbols.sort(), ['NEG', 'ZERO']);
});

Deno.test('buildPricedRows: a missing symbol for ANY user aborts (per-league atomic)', () => {
  // u1 fully priced, u2 holds an unpriceable symbol. Per-league atomicity means
  // the presence of u2's missing symbol blocks the run even though u1 is fine.
  const uh = userHoldings({
    u1: holdings(['AAPL', 1]),
    u2: holdings(['DELISTED', 5]),
  });
  const { missingSymbols } = buildPricedRows('lg1', 3, uh, priceMap({ AAPL: 100 }));
  assertEquals(missingSymbols, ['DELISTED']);
});

Deno.test('buildPricedRows: no users -> empty rows, empty missing', () => {
  const { rows, missingSymbols } = buildPricedRows('lg1', 1, new Map(), priceMap({}));
  assertEquals(rows, []);
  assertEquals(missingSymbols, []);
});
