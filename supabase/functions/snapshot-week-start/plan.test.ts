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
import { matchupParticipants, snapshotHoldings } from '../_shared/snapshot-holdings.ts';

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

// ===========================================================================
// Bots + SKIP rows, end to end through the shared holdings helper
// (../_shared/snapshot-holdings.ts). These run the SAME pipeline as the handler:
// matchups -> matchupParticipants -> snapshotHoldings -> classifyCoverage /
// selectMissingHoldings / buildPricedRows.
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

Deno.test('bots: a bot participant is snapshotted like anyone else (F1)', () => {
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: BOT }],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: BOT, symbol: 'MSFT', quantity: 1 },
    ],
  );
  assertEquals(classifyCoverage(uh, new Set()), 'incomplete');
  const { rows, missingSymbols } = buildPricedRows(
    'L', 2, selectMissingHoldings(uh, new Set()), priceMap({ AAPL: 200, MSFT: 400 }),
  );
  assertEquals(missingSymbols, []);
  assertEquals(rows.map((r) => r.user_id).sort(), [HUMAN_A, BOT].sort());
});

Deno.test('SKIP: a SKIP row never reaches the price fetch or blocks the league (F2)', () => {
  // Before the fix the SKIP row became a 1-share 'SKIP' holding, which no price
  // could satisfy, so buildPricedRows returned missingSymbols=['SKIP'] and the
  // WHOLE league aborted on every retry.
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: BOT }],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: BOT, symbol: 'MSFT', quantity: 1 },
      { user_id: BOT, symbol: 'SKIP', quantity: 0 },
    ],
  );
  const { rows, missingSymbols } = buildPricedRows(
    'L', 2, selectMissingHoldings(uh, new Set()), priceMap({ AAPL: 200, MSFT: 400 }),
  );
  assertEquals(missingSymbols, []);
  assert(!rows.some((r) => r.symbol === 'SKIP'));
  assertEquals(rows.length, 2);
});

Deno.test('SKIP: a user whose only row is SKIP is legitimately EMPTY, not missing', () => {
  // The partial-state rule: an empty holder must not make the league-week read
  // incomplete, or a fully-snapshotted league would re-run (and re-price) forever.
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: HUMAN_B }],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: HUMAN_B, symbol: 'SKIP', quantity: 0 },
    ],
  );
  assertEquals(uh.get(HUMAN_B), []);
  // HUMAN_A covered, HUMAN_B has no row and needs none -> complete.
  assertEquals(classifyCoverage(uh, new Set([HUMAN_A])), 'complete');
  assertEquals(selectMissingHoldings(uh, new Set([HUMAN_A])).size, 0);
});

Deno.test('SKIP: a league where the only participant holds only SKIP -> none_expected', () => {
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_B, team2_user_id: null }],
    [{ user_id: HUMAN_B, symbol: 'SKIP', quantity: 0 }],
  );
  assertEquals(classifyCoverage(uh, new Set()), 'none_expected');
});

Deno.test('quantity 0 on a real symbol is not coerced to a 1-share holding', () => {
  const uh = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: null }],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 0 },
      { user_id: HUMAN_A, symbol: 'MSFT', quantity: 2 },
    ],
  );
  assertEquals(uh.get(HUMAN_A), [{ symbol: 'MSFT', quantity: 2 }]);
});

Deno.test('mixed bot+human: humans covered, bot missing -> incomplete, heal writes ONLY the bot', () => {
  // The "already-missed week" heal: the pre-fix Monday run wrote the humans and
  // skipped the bot. A post-deploy run (e.g. the Tuesday cron) must fill the bot
  // without touching the humans' rows.
  const uh = holdingsFor(
    [
      { team1_user_id: HUMAN_A, team2_user_id: BOT },
      { team1_user_id: HUMAN_B, team2_user_id: 'bot-2' },
    ],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: HUMAN_B, symbol: 'KO', quantity: 1 },
      { user_id: BOT, symbol: 'MSFT', quantity: 1 },
      { user_id: 'bot-2', symbol: 'SKIP', quantity: 0 }, // skip-only bot: empty
    ],
  );
  const covered = new Set([HUMAN_A, HUMAN_B]);
  assertEquals(classifyCoverage(uh, covered), 'incomplete');
  const missing = selectMissingHoldings(uh, covered);
  assertEquals([...missing.keys()], [BOT]);
  const { rows, missingSymbols } = buildPricedRows('L', 2, missing, priceMap({ MSFT: 400 }));
  assertEquals(missingSymbols, []);
  assertEquals(rows, [{
    league_id: 'L', user_id: BOT, week_number: 2, symbol: 'MSFT', quantity: 1, week_start_price: 400,
  }]);
});

Deno.test('mixed bot+human: every holder covered (skip-only bot has none) -> complete', () => {
  const uh = holdingsFor(
    [
      { team1_user_id: HUMAN_A, team2_user_id: BOT },
      { team1_user_id: HUMAN_B, team2_user_id: 'bot-2' },
    ],
    [
      { user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 },
      { user_id: HUMAN_B, symbol: 'KO', quantity: 1 },
      { user_id: BOT, symbol: 'MSFT', quantity: 1 },
      { user_id: 'bot-2', symbol: 'SKIP', quantity: 0 },
    ],
  );
  assertEquals(classifyCoverage(uh, new Set([HUMAN_A, HUMAN_B, BOT])), 'complete');
});

Deno.test('why reads are gated BEFORE coverage: defaulted-empty inputs are indistinguishable from "nothing held"', () => {
  // classifyCoverage cannot tell "drafts read failed -> []" from "nobody holds
  // anything". The old `drafts || []` therefore turned a DB blip into
  // 'none_expected' (skip, success, every retry skips too), and a defaulted
  // week_snapshots read made covered users look uncovered (re-upsert at today's
  // price). The fix is ordering in index.ts: checkSnapshotReads must pass
  // before any of this runs — pinned in _shared/snapshot-holdings.test.ts.
  const failedDraftsRead = holdingsFor([{ team1_user_id: HUMAN_A, team2_user_id: BOT }], []);
  assertEquals(classifyCoverage(failedDraftsRead, new Set()), 'none_expected');

  const real = holdingsFor(
    [{ team1_user_id: HUMAN_A, team2_user_id: null }],
    [{ user_id: HUMAN_A, symbol: 'AAPL', quantity: 1 }],
  );
  const failedSnapshotsRead = new Set<string>(); // really: HUMAN_A is covered
  assertEquals([...selectMissingHoldings(real, failedSnapshotsRead).keys()], [HUMAN_A]);
});
