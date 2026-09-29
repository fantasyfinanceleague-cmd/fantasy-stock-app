/**
 * Unit tests for the scoring-refusal guards (see ./scoring-eligibility.ts).
 *
 * These lock in three refuse-don't-fabricate guards that previously lived inside
 * Deno.serve with NO coverage. They all defend the same defect: the snapshot-less
 * fallback returns CUMULATIVE gain from draft entry (all-time P/L), not this week's
 * delta, and league_standings increments are irreversible — so a fabricated score
 * can never be walked back.
 *
 *   1. decideBatchScoring   -> 'stale_no_snapshots' / 'no_snapshots_week_gt_1'
 *   2. (same fn)               (guards 1 and 2 are both batch-level)
 *   3. decideUserScorer +    -> 'unscoreable' user, 'unscoreable_participant_no_snapshot'
 *      decideMatchupScoring    matchup refusal
 *
 * The centerpiece is the PARTIALLY-SNAPSHOTTED WEEK regression at the bottom: in a
 * single week>1, a matchup whose participants are all snapshotted still scores,
 * while a matchup containing the one snapshot-less user is left NULL. A
 * discriminator test proves that property goes RED against the pre-guard-3 logic
 * (which fabricated a score for that user) and GREEN against the current code.
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/process-week-results/scoring-eligibility.test.ts
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  decideBatchScoring,
  decideUserScorer,
  decideMatchupScoring,
  ledgerPositionState,
  BATCH_SKIP_REASON,
  MATCHUP_REFUSAL_REASON,
  type LedgerDraftRow,
  type LedgerState,
  type LedgerTradeRow,
  type ScorerKind,
} from './scoring-eligibility.ts';

// index.ts uses FALLBACK_MAX_AGE_HOURS = 72; mirror it here so the boundary tests
// exercise the same threshold the handler passes in.
const MAX_AGE = 72;

// ===========================================================================
// GUARDS 1 & 2 — decideBatchScoring
// ===========================================================================

Deno.test('batch: snapshots present always proceeds (any age, any week)', () => {
  // A batch with snapshots is scoreable regardless of age or week number — the
  // refusals only ever fire on the snapshot-less path.
  assertEquals(
    decideBatchScoring({ hasSnapshots: true, weekAgeHours: 1000, weekNumber: 9, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'proceed' },
  );
  assertEquals(
    decideBatchScoring({ hasSnapshots: true, weekAgeHours: 0, weekNumber: 1, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'proceed' },
  );
});

Deno.test('batch: week 1, no snapshots, fresh -> proceed (week-1 fallback is allowed)', () => {
  // The only case a snapshot-less batch is allowed through: week 1, within the
  // freshness window. Draft entry ~= week-1 start price, so the fallback is a
  // valid proxy here.
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: 10, weekNumber: 1, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'proceed' },
  );
});

Deno.test("batch: no snapshots + stale (> max age) -> skip 'stale_no_snapshots'", () => {
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: 73, weekNumber: 1, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'skip', reason: BATCH_SKIP_REASON.STALE_NO_SNAPSHOTS },
  );
});

Deno.test("batch: no snapshots + week>1 within freshness window -> skip 'no_snapshots_week_gt_1'", () => {
  // Fresh (age <= max) but past week 1: the week>1 guard catches what the
  // freshness guard does not.
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: 10, weekNumber: 2, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'skip', reason: BATCH_SKIP_REASON.NO_SNAPSHOTS_WEEK_GT_1 },
  );
});

Deno.test('batch: strict > boundary — exactly max age is NOT stale', () => {
  // week 1 at exactly the threshold: not stale (strict >), so it proceeds.
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: MAX_AGE, weekNumber: 1, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'proceed' },
  );
  // week 2 at exactly the threshold: not stale, but the week>1 guard still fires.
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: MAX_AGE, weekNumber: 2, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'skip', reason: BATCH_SKIP_REASON.NO_SNAPSHOTS_WEEK_GT_1 },
  );
});

Deno.test('batch: ORDER is load-bearing — stale wins over week>1 when both apply', () => {
  // Snapshot-less, stale, AND week>1: the freshness reason is reported (the more
  // specific operational cause). Reversing the checks would relabel this skip and
  // break ops dashboards that separate the two reasons.
  assertEquals(
    decideBatchScoring({ hasSnapshots: false, weekAgeHours: 500, weekNumber: 6, fallbackMaxAgeHours: MAX_AGE }),
    { action: 'skip', reason: BATCH_SKIP_REASON.STALE_NO_SNAPSHOTS },
  );
});

Deno.test('batch: null week_end (Infinity age) -> stale even at week 1', () => {
  // index.ts maps a null week_end to +Infinity; that must trip the stale guard for
  // a snapshot-less batch rather than sneaking through as "fresh".
  assertEquals(
    decideBatchScoring({
      hasSnapshots: false,
      weekAgeHours: Number.POSITIVE_INFINITY,
      weekNumber: 1,
      fallbackMaxAgeHours: MAX_AGE,
    }),
    { action: 'skip', reason: BATCH_SKIP_REASON.STALE_NO_SNAPSHOTS },
  );
});

// ===========================================================================
// GUARD 3a — decideUserScorer
// ===========================================================================

Deno.test('user: snapshot + week_end_price -> full', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: true, hasWeekEndPrices: true, weekNumber: 5 }),
    'full' as ScorerKind,
  );
});

Deno.test('user: snapshot without week_end_price -> legacy', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: true, hasWeekEndPrices: false, weekNumber: 5 }),
    'legacy' as ScorerKind,
  );
});

Deno.test('user: no snapshot at week 1 -> fallback (valid week-1 proxy)', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: false, weekNumber: 1 }),
    'fallback' as ScorerKind,
  );
});

Deno.test('user: no snapshot past week 1 -> unscoreable (the per-user refusal)', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: false, weekNumber: 2 }),
    'unscoreable' as ScorerKind,
  );
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 8 }),
    'unscoreable' as ScorerKind,
  );
});

Deno.test('user: a snapshotted user is scored regardless of week number', () => {
  // The week>1 refusal must NEVER apply to a snapshotted user — the snapshot
  // branches short-circuit before the week check.
  assertEquals(
    decideUserScorer({ hasSnapshot: true, hasWeekEndPrices: true, weekNumber: 99 }),
    'full' as ScorerKind,
  );
});

// ===========================================================================
// GUARD 3b — decideMatchupScoring
// ===========================================================================

Deno.test('matchup: neither participant unscoreable -> proceed', () => {
  const unscoreable = new Set<string>();
  assertEquals(decideMatchupScoring('u1', 'u2', unscoreable), { action: 'proceed' });
});

Deno.test('matchup: team1 unscoreable -> refuse', () => {
  const unscoreable = new Set(['u1']);
  assertEquals(
    decideMatchupScoring('u1', 'u2', unscoreable),
    { action: 'refuse', reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT },
  );
});

Deno.test('matchup: team2 unscoreable -> refuse', () => {
  const unscoreable = new Set(['u2']);
  assertEquals(
    decideMatchupScoring('u1', 'u2', unscoreable),
    { action: 'refuse', reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT },
  );
});

Deno.test('matchup: bye week gates on team1 only (null team2 never consulted)', () => {
  // A bye has team2 == null. Even if the unscoreable set is non-empty, a null id
  // can't be unscoreable, so a scoreable team1 proceeds...
  assertEquals(decideMatchupScoring('u1', null, new Set(['someone-else'])), { action: 'proceed' });
  // ...and an unscoreable team1 on a bye still refuses.
  assertEquals(
    decideMatchupScoring('u1', null, new Set(['u1'])),
    { action: 'refuse', reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT },
  );
});

// ===========================================================================
// THE KEY REGRESSION — partially-snapshotted week > 1
//
// One week>1 with a mix of snapshotted and snapshot-less users. The matchup whose
// participants are all snapshotted must still score; the matchup containing the
// snapshot-less user must be refused (team1_gain left NULL). This composes the
// per-user gate with the matchup gate exactly as the handler does.
// ===========================================================================

interface SimUser {
  id: string;
  hasSnapshot: boolean;
}

interface SimMatchup {
  team1: string;
  team2: string | null;
}

/**
 * Mirror of the handler's flow: build the unscoreable set from the per-user
 * decision (using `scorer`), then decide each matchup. `scorer` is injected so the
 * discriminator below can swap in the pre-fix per-user logic and run the SAME
 * pipeline against it.
 */
function simulateWeek(
  users: SimUser[],
  matchups: SimMatchup[],
  weekNumber: number,
  hasWeekEndPrices: boolean,
  scorer: (i: { hasSnapshot: boolean; hasWeekEndPrices: boolean; weekNumber: number }) => ScorerKind,
): { scored: SimMatchup[]; refused: SimMatchup[] } {
  const unscoreable = new Set<string>();
  for (const u of users) {
    if (scorer({ hasSnapshot: u.hasSnapshot, hasWeekEndPrices, weekNumber }) === 'unscoreable') {
      unscoreable.add(u.id);
    }
  }

  const scored: SimMatchup[] = [];
  const refused: SimMatchup[] = [];
  for (const m of matchups) {
    const decision = decideMatchupScoring(m.team1, m.team2, unscoreable);
    if (decision.action === 'refuse') refused.push(m);
    else scored.push(m);
  }
  return { scored, refused };
}

/**
 * Reconstruction of the PRE-guard-3 per-user logic (before commit 1a6233a): no
 * 'unscoreable' branch — a snapshot-less user past week 1 fell straight into the
 * cumulative-from-entry 'fallback', fabricating an all-time-P/L score. This is the
 * exact leak the per-user gate closes.
 */
function decideUserScorerPreFix(i: {
  hasSnapshot: boolean;
  hasWeekEndPrices: boolean;
  weekNumber: number;
}): ScorerKind {
  if (i.hasSnapshot && i.hasWeekEndPrices) return 'full';
  if (i.hasSnapshot) return 'legacy';
  return 'fallback';
}

Deno.test('REGRESSION: partial-snapshot week>1 — clean matchup scores, tainted one is refused', () => {
  const users: SimUser[] = [
    { id: 'alice', hasSnapshot: true },
    { id: 'bob', hasSnapshot: true },
    { id: 'carol', hasSnapshot: false }, // the one snapshot-less user
    { id: 'dave', hasSnapshot: true },
  ];
  const cleanMatchup: SimMatchup = { team1: 'alice', team2: 'bob' };
  const taintedMatchup: SimMatchup = { team1: 'carol', team2: 'dave' };
  const matchups = [cleanMatchup, taintedMatchup];

  const { scored, refused } = simulateWeek(
    users,
    matchups,
    /* weekNumber */ 3,
    /* hasWeekEndPrices */ true,
    decideUserScorer,
  );

  // The fully-snapshotted matchup still scores...
  assertEquals(scored, [cleanMatchup], 'all-snapshotted matchup in a week>1 must still score');
  // ...and ONLY the matchup with the snapshot-less user is refused (left NULL).
  assertEquals(refused, [taintedMatchup], 'the matchup with the snapshot-less user must be refused');
});

Deno.test('DISCRIMINATOR: pre-fix logic would have fabricated carol\'s score (matchup NOT refused)', () => {
  const users: SimUser[] = [
    { id: 'alice', hasSnapshot: true },
    { id: 'bob', hasSnapshot: true },
    { id: 'carol', hasSnapshot: false },
    { id: 'dave', hasSnapshot: true },
  ];
  const cleanMatchup: SimMatchup = { team1: 'alice', team2: 'bob' };
  const taintedMatchup: SimMatchup = { team1: 'carol', team2: 'dave' };
  const matchups = [cleanMatchup, taintedMatchup];

  // GREEN: with the real decision, carol is unscoreable and her matchup is refused.
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 3 }),
    'unscoreable' as ScorerKind,
  );
  const fixed = simulateWeek(users, matchups, 3, true, decideUserScorer);
  assertEquals(fixed.refused, [taintedMatchup]);

  // RED: the pre-fix per-user logic routes carol to 'fallback' (a fabricated
  // all-time-P/L score) instead of 'unscoreable', so NOTHING is unscoreable and
  // BOTH matchups get scored — the exact bug the per-user gate closes.
  assertEquals(
    decideUserScorerPreFix({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 3 }),
    'fallback' as ScorerKind,
    'pre-fix logic fabricates a score for the snapshot-less user',
  );
  const buggy = simulateWeek(users, matchups, 3, true, decideUserScorerPreFix);
  assertEquals(buggy.refused, [], 'pre-fix logic refuses nothing — the tainted matchup is fabricated');
  assertEquals(buggy.scored, matchups, 'pre-fix logic scores BOTH matchups, including the tainted one');

  // Same input, opposite outcome on the tainted matchup: this is what the guard buys.
  assert(
    fixed.refused.length === 1 && buggy.refused.length === 0,
    'the guard flips the tainted matchup from fabricated to refused',
  );
});

Deno.test('REGRESSION: same partial-snapshot mix at WEEK 1 scores everything (no over-refusal)', () => {
  // Guard 3 must not over-fire: at week 1 the snapshot-less user is a valid
  // 'fallback', not 'unscoreable', so BOTH matchups score. This proves the gate is
  // scoped to week>1 and doesn't regress legitimate week-1 fallback scoring.
  const users: SimUser[] = [
    { id: 'alice', hasSnapshot: true },
    { id: 'carol', hasSnapshot: false },
  ];
  const m1: SimMatchup = { team1: 'alice', team2: 'carol' };

  const { scored, refused } = simulateWeek(users, [m1], /* weekNumber */ 1, false, decideUserScorer);
  assertEquals(refused, [], 'week-1 snapshot-less user is a valid fallback, not unscoreable');
  assertEquals(scored, [m1]);
});

// ===========================================================================
// GUARD 4 — THE ALL-CASH RULE: ledgerPositionState + the 'cash_only' scorer kind
//
// A snapshot-less user may be scored as all-cash ONLY when the ledger proves them
// flat at BOTH week boundaries. Everything ambiguous fails closed to "held".
// End-to-end scenarios (a)-(e) live in user-score.test.ts; these pin the pieces.
// ===========================================================================

const WEEK_START = '2026-10-06T14:30:00.000Z';
const WEEK_END = '2026-10-09T21:00:00.000Z';
const BEFORE = '2026-10-02T15:00:00.000Z'; // prior week
const DURING = '2026-10-07T15:00:00.000Z';
const AFTER = '2026-10-12T15:00:00.000Z';

const U = 'aaaaaaaa-0000-4000-8000-000000000001';

const draft = (symbol: string, quantity: unknown = 10, user_id: unknown = U): LedgerDraftRow =>
  ({ user_id, symbol, quantity });
const trade = (
  action: 'buy' | 'sell',
  symbol: string,
  quantity: unknown,
  created_at: string | null,
  user_id: unknown = U,
): LedgerTradeRow => ({ user_id, symbol, action, quantity, created_at });

const FLAT: LedgerState = { heldAtWeekStart: false, heldAtWeekEnd: false, hasLedgerHistory: true };
const HELD_ALL: LedgerState = { heldAtWeekStart: true, heldAtWeekEnd: true, hasLedgerHistory: true };

Deno.test('ledger: drafted and never sold -> held at both boundaries', () => {
  assertEquals(
    ledgerPositionState(U, [draft('AAPL')], [], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('ledger: sold everything BEFORE week_start -> flat at both, with history', () => {
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 10, BEFORE)], WEEK_START, WEEK_END),
    FLAT,
  );
});

Deno.test('ledger: nets PER SYMBOL — one symbol flat, another still held -> held', () => {
  // The partial case: selling AAPL to zero must not hide the MSFT still held.
  assertEquals(
    ledgerPositionState(
      U,
      [draft('AAPL', 10), draft('MSFT', 3)],
      [trade('sell', 'AAPL', 10, BEFORE)],
      WEEK_START,
      WEEK_END,
    ),
    HELD_ALL,
  );
});

Deno.test('ledger: flat at start, bought mid-week and held -> held at END only', () => {
  assertEquals(
    ledgerPositionState(
      U,
      [draft('AAPL', 10)],
      [trade('sell', 'AAPL', 10, BEFORE), trade('buy', 'NVDA', 2, DURING)],
      WEEK_START,
      WEEK_END,
    ),
    { heldAtWeekStart: false, heldAtWeekEnd: true, hasLedgerHistory: true },
  );
});

Deno.test('ledger: boundary — a trade AT week_start is mid-week, not pre-week', () => {
  // Partitions exactly with the handler's mid-week query (gte week_start): a sell
  // at exactly week_start leaves the holding in place AT the start boundary.
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 10, WEEK_START)], WEEK_START, WEEK_END),
    { heldAtWeekStart: true, heldAtWeekEnd: false, hasLedgerHistory: true },
  );
});

Deno.test('ledger: boundary — a trade AT week_end counts; one after is ignored', () => {
  assertEquals(
    ledgerPositionState(
      U,
      [draft('AAPL', 10)],
      [trade('sell', 'AAPL', 10, BEFORE), trade('buy', 'NVDA', 1, WEEK_END)],
      WEEK_START,
      WEEK_END,
    ).heldAtWeekEnd,
    true,
  );
  // A post-week_end buy does not make the user held at week_end...
  assertEquals(
    ledgerPositionState(
      U,
      [draft('AAPL', 10)],
      [trade('sell', 'AAPL', 10, BEFORE), trade('buy', 'NVDA', 1, AFTER)],
      WEEK_START,
      WEEK_END,
    ),
    FLAT,
  );
  // ...and a post-week_end SELL does not make a held user look flat.
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 10, AFTER)], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('ledger: fixed_notional rounding dust (<= 1e-9) is flat; anything above is held', () => {
  const d = [draft('AAPL', 1.5)];
  assertEquals(
    ledgerPositionState(U, d, [trade('sell', 'AAPL', 1.5 - 1e-10, BEFORE)], WEEK_START, WEEK_END),
    FLAT,
  );
  assertEquals(
    ledgerPositionState(U, d, [trade('sell', 'AAPL', 1.5 - 1e-6, BEFORE)], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('ledger: SKIP sentinel draft rows are not holdings and not history', () => {
  // A forfeited pick (symbol SKIP, quantity 0). Mirroring calculateHoldings'
  // `|| 1` without the SKIP filter would make this "1 share of SKIP".
  assertEquals(
    ledgerPositionState(U, [draft('SKIP', 0), draft('skip', 0)], [], WEEK_START, WEEK_END),
    { heldAtWeekStart: false, heldAtWeekEnd: false, hasLedgerHistory: false },
  );
});

Deno.test('ledger: no rows at all -> flat with NO history (genuinely empty)', () => {
  assertEquals(
    ledgerPositionState(U, [], [], WEEK_START, WEEK_END),
    { heldAtWeekStart: false, heldAtWeekEnd: false, hasLedgerHistory: false },
  );
});

Deno.test("ledger: other users' rows are ignored", () => {
  const other = 'bbbbbbbb-0000-4000-8000-000000000002';
  assertEquals(
    ledgerPositionState(
      U,
      [draft('AAPL', 10), draft('MSFT', 5, other)],
      [trade('sell', 'AAPL', 10, BEFORE), trade('buy', 'NVDA', 3, DURING, other)],
      WEEK_START,
      WEEK_END,
    ),
    FLAT,
  );
});

Deno.test('ledger: drafts.user_id TEXT vs trades.user_id UUID — matched after normalisation', () => {
  // A non-canonical text id must NOT hide the user's drafts (which would read as
  // FLAT — the dangerous direction). Upper-case + padded text still matches.
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10, `  ${U.toUpperCase()} `)], [], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('ledger: draft quantity mirrors calculateHoldings `|| 1` (null/0 non-SKIP draft is held)', () => {
  assertEquals(ledgerPositionState(U, [draft('AAPL', null)], [], WEEK_START, WEEK_END), HELD_ALL);
  assertEquals(ledgerPositionState(U, [draft('AAPL', 0)], [], WEEK_START, WEEK_END), HELD_ALL);
  assertEquals(ledgerPositionState(U, [draft('AAPL', '2.5')], [], WEEK_START, WEEK_END), HELD_ALL);
});

Deno.test('ledger: FAILS CLOSED — null / unparseable week bounds -> held', () => {
  const d = [draft('AAPL', 10)];
  const t = [trade('sell', 'AAPL', 10, BEFORE)];
  assertEquals(ledgerPositionState(U, d, t, null, WEEK_END), HELD_ALL);
  assertEquals(ledgerPositionState(U, d, t, WEEK_START, null), HELD_ALL);
  assertEquals(ledgerPositionState(U, d, t, 'not-a-date', WEEK_END), HELD_ALL);
});

Deno.test("ledger: FAILS CLOSED — one of the user's trades has no parseable created_at -> held", () => {
  // A sell of unknown time could be hiding a start-of-week holding.
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 10, null)], WEEK_START, WEEK_END),
    HELD_ALL,
  );
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 10, 'garbage')], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('ledger: FAILS CLOSED — non-finite quantity -> held', () => {
  assertEquals(ledgerPositionState(U, [draft('AAPL', 'abc')], [], WEEK_START, WEEK_END), HELD_ALL);
  assertEquals(
    ledgerPositionState(U, [draft('AAPL', 10)], [trade('sell', 'AAPL', 'abc', BEFORE)], WEEK_START, WEEK_END),
    HELD_ALL,
  );
});

Deno.test('user: ledger flat at both boundaries -> cash_only, at week 1 AND past it', () => {
  for (const weekNumber of [1, 2, 7]) {
    assertEquals(
      decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber, ledger: FLAT }),
      'cash_only' as ScorerKind,
    );
    // Independent of the batch's end-price flag — cash needs no snapshot price.
    assertEquals(
      decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: false, weekNumber, ledger: FLAT }),
      'cash_only' as ScorerKind,
    );
  }
});

Deno.test('user: ledger held at EITHER boundary -> NOT cash_only (unscoreable past week 1)', () => {
  const heldStartOnly: LedgerState = { heldAtWeekStart: true, heldAtWeekEnd: false, hasLedgerHistory: true };
  const heldEndOnly: LedgerState = { heldAtWeekStart: false, heldAtWeekEnd: true, hasLedgerHistory: true };
  for (const ledger of [HELD_ALL, heldStartOnly, heldEndOnly]) {
    assertEquals(
      decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 4, ledger }),
      'unscoreable' as ScorerKind,
    );
    // Week 1 keeps its existing fallback for a genuinely-held snapshot-less user.
    assertEquals(
      decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: false, weekNumber: 1, ledger }),
      'fallback' as ScorerKind,
    );
  }
});

Deno.test('user: NO ledger supplied -> never cash_only (absence is not proof)', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 4 }),
    'unscoreable' as ScorerKind,
  );
});

Deno.test('user: a snapshot always wins over the ledger branch', () => {
  assertEquals(
    decideUserScorer({ hasSnapshot: true, hasWeekEndPrices: true, weekNumber: 4, ledger: FLAT }),
    'full' as ScorerKind,
  );
  assertEquals(
    decideUserScorer({ hasSnapshot: true, hasWeekEndPrices: false, weekNumber: 4, ledger: FLAT }),
    'legacy' as ScorerKind,
  );
});

Deno.test('batch: every participant all-cash + no snapshots -> proceed (any week, any age)', () => {
  // Correctly snapshot-less: nobody held anything. cash_only scores from stored
  // trade prices, so neither guard's rationale applies.
  for (const [weekNumber, weekAgeHours] of [[1, 10], [5, 10], [5, 500], [1, Number.POSITIVE_INFINITY]]) {
    assertEquals(
      decideBatchScoring({
        hasSnapshots: false,
        weekAgeHours,
        weekNumber,
        fallbackMaxAgeHours: MAX_AGE,
        allParticipantsCashOnly: true,
      }),
      { action: 'proceed' },
    );
  }
});

Deno.test('batch: MIXED snapshot-less batch (someone ledger-held) still skips as before', () => {
  assertEquals(
    decideBatchScoring({
      hasSnapshots: false,
      weekAgeHours: 10,
      weekNumber: 3,
      fallbackMaxAgeHours: MAX_AGE,
      allParticipantsCashOnly: false,
    }),
    { action: 'skip', reason: BATCH_SKIP_REASON.NO_SNAPSHOTS_WEEK_GT_1 },
  );
});

Deno.test("batch: a scoring-input fetch error -> skip 'scoring_inputs_fetch_failed', FIRST", () => {
  // The false-flat trap: a failed query reads as "no rows" = everyone flat. The
  // fetch-failed refusal must beat the all-cash proceed AND a snapshotted batch.
  assertEquals(
    decideBatchScoring({
      hasSnapshots: false,
      weekAgeHours: 10,
      weekNumber: 3,
      fallbackMaxAgeHours: MAX_AGE,
      scoringInputsFetchFailed: true,
      allParticipantsCashOnly: true,
    }),
    { action: 'skip', reason: BATCH_SKIP_REASON.SCORING_INPUTS_FETCH_FAILED },
  );
  assertEquals(
    decideBatchScoring({
      hasSnapshots: true,
      weekAgeHours: 10,
      weekNumber: 3,
      fallbackMaxAgeHours: MAX_AGE,
      scoringInputsFetchFailed: true,
    }),
    { action: 'skip', reason: BATCH_SKIP_REASON.SCORING_INPUTS_FETCH_FAILED },
  );
});
