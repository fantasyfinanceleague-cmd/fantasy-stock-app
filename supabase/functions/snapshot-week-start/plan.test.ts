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
  planWeekWindow,
  type Holding,
} from './plan.ts';
import { matchupParticipants, snapshotHoldings } from '../_shared/snapshot-holdings.ts';
import type { CalendarSession, Coverage as MarketCalendarCoverage } from '../_shared/week-window.ts';

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

// ===========================================================================
// planWeekWindow — the single-cut week window (S1-S4 fix)
// ===========================================================================

const NORMAL_WEEK: CalendarSession[] = [
  { sessionDate: '2026-09-28', openEt: '09:30', closeEt: '16:00' }, // Mon
  { sessionDate: '2026-09-29', openEt: '09:30', closeEt: '16:00' },
  { sessionDate: '2026-09-30', openEt: '09:30', closeEt: '16:00' },
  { sessionDate: '2026-10-01', openEt: '09:30', closeEt: '16:00' },
  { sessionDate: '2026-10-02', openEt: '09:30', closeEt: '16:00' }, // Fri
];
const WIDE_COVERAGE: MarketCalendarCoverage = { from: '2026-01-01', through: '2027-12-31' };
const NOMINAL_ANCHOR = new Date('2026-09-29T14:30:00.000Z'); // old fixed-UTC Tuesday value

Deno.test('planWeekWindow: now before this week\'s real open -> not_due (replaces the old holiday/day-of-week branch)', () => {
  const beforeOpen = new Date('2026-09-28T12:00:00.000Z'); // before Monday's 13:30Z open
  const r = planWeekWindow(beforeOpen, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE, '', '', 0);
  assertEquals(r, { action: 'not_due' });
});

Deno.test('planWeekWindow: now at/after the real open -> proceed, with the real (not nominal) open/close', () => {
  const afterOpen = new Date('2026-09-28T13:30:00.000Z'); // exactly Monday's open
  const r = planWeekWindow(afterOpen, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE, '', '', 0);
  if (r.action !== 'proceed') throw new Error(`expected proceed, got ${r.action}`);
  assertEquals(r.open.toISOString(), '2026-09-28T13:30:00.000Z');
  assertEquals(r.close.toISOString(), '2026-10-02T20:00:00.000Z');
  assertEquals(r.openSessionDate, '2026-09-28');
});

Deno.test('planWeekWindow: cut failure (no calendar coverage) -> refuse, not not_due — an operational gap, not "nothing to do"', () => {
  const now = new Date('2026-09-29T15:00:00.000Z');
  const staleCoverage: MarketCalendarCoverage = { from: '2026-01-01', through: '2026-09-20' };
  const r = planWeekWindow(now, NOMINAL_ANCHOR, null, NORMAL_WEEK, staleCoverage, '', '', 0);
  assertEquals(r, { action: 'refuse', reason: 'no_coverage' });
});

Deno.test('planWeekWindow: REWRITE — zero existing snapshots, stored window differs from the cut -> rewrite: true', () => {
  const now = new Date('2026-09-28T14:00:00.000Z');
  const r = planWeekWindow(
    now, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE,
    /* storedWeekStartIso */ '2026-09-29T14:30:00.000Z', // the OLD nominal value
    /* storedWeekEndIso   */ '2026-10-02T21:00:00.000Z',
    /* existingSnapshotCount */ 0,
  );
  if (r.action !== 'proceed') throw new Error(`expected proceed, got ${r.action}`);
  assertEquals(r.rewrite, true);
});

Deno.test('planWeekWindow: PROTECTED WEEK — existingSnapshotCount > 0 -> rewrite: false, even though the stored window still differs', () => {
  // This is the exact case that protects prod's real week 1: already fully
  // snapshotted under the OLD nominal window before this fix deploys. It must
  // NEVER be re-windowed, no matter how many times this runs again.
  const now = new Date('2026-09-28T14:00:00.000Z');
  const r = planWeekWindow(
    now, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE,
    '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z',
    /* existingSnapshotCount */ 1,
  );
  if (r.action !== 'proceed') throw new Error(`expected proceed, got ${r.action}`);
  assertEquals(r.rewrite, false);
  // The cut itself is UNCHANGED by the protection — this run still computes
  // (and uses for ITS OWN baseline/pricing) the real Monday-open cut; only the
  // STORED matchups columns are left alone.
  assertEquals(r.open.toISOString(), '2026-09-28T13:30:00.000Z');
});

Deno.test('planWeekWindow: already matches the stored window -> rewrite: false (idempotent no-op, not just protected)', () => {
  const now = new Date('2026-09-28T14:00:00.000Z');
  const r = planWeekWindow(
    now, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE,
    '2026-09-28T13:30:00.000Z', '2026-10-02T20:00:00.000Z', // already the real cut
    0,
  );
  if (r.action !== 'proceed') throw new Error(`expected proceed, got ${r.action}`);
  assertEquals(r.rewrite, false);
});

Deno.test('planWeekWindow FIXPOINT: a second run anchored on the already-rewritten values never re-triggers a rewrite', () => {
  const now = new Date('2026-09-29T15:00:00.000Z'); // Tuesday heal run
  const firstRun = planWeekWindow(
    new Date('2026-09-28T14:00:00.000Z'), NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE,
    '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z', 0,
  );
  if (firstRun.action !== 'proceed' || !firstRun.rewrite) throw new Error('expected a rewrite on the first run');

  // Simulate index.ts having applied the rewrite: the stored columns AND the
  // anchor for the next run are now firstRun's own open/close.
  const secondRun = planWeekWindow(
    now, firstRun.open, null, NORMAL_WEEK, WIDE_COVERAGE,
    firstRun.open.toISOString(), firstRun.close.toISOString(),
    /* existingSnapshotCount */ 1, // Monday's run wrote at least one row
  );
  if (secondRun.action !== 'proceed') throw new Error('expected proceed');
  assertEquals(secondRun.rewrite, false);
  assertEquals(secondRun.open.getTime(), firstRun.open.getTime());
  assertEquals(secondRun.close.getTime(), firstRun.close.getTime());
});

Deno.test('planWeekWindow FLOOR: a league drafted Monday 11 AM ET (after Monday\'s open) starts Tuesday, and is due only from Tuesday\'s open', () => {
  const draftInstant = new Date('2026-09-28T15:00:00.000Z'); // Monday 11 AM EDT
  const beforeTuesdayOpen = new Date('2026-09-29T13:00:00.000Z'); // Tue 9:00 AM EDT
  const r1 = planWeekWindow(beforeTuesdayOpen, NOMINAL_ANCHOR, draftInstant, NORMAL_WEEK, WIDE_COVERAGE, '', '', 0);
  assertEquals(r1, { action: 'not_due' });

  const atTuesdayOpen = new Date('2026-09-29T13:30:00.000Z');
  const r2 = planWeekWindow(atTuesdayOpen, NOMINAL_ANCHOR, draftInstant, NORMAL_WEEK, WIDE_COVERAGE, '', '', 0);
  if (r2.action !== 'proceed') throw new Error(`expected proceed, got ${r2.action}`);
  assertEquals(r2.openSessionDate, '2026-09-29');
});

Deno.test('planWeekWindow S4: a stored window in PostgREST +00:00 form that equals the cut does NOT rewrite (no re-window every run)', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const r = planWeekWindow(
    now, NOMINAL_ANCHOR, null, NORMAL_WEEK, WIDE_COVERAGE,
    '2026-09-28T13:30:00+00:00', '2026-10-02T20:00:00+00:00', 5,
  );
  assert(r.action === 'proceed');
  assertEquals(r.rewrite, false);
});
