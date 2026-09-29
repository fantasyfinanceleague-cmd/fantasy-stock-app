/**
 * End-to-end scenarios for the ALL-CASH RULE (see ./scoring-eligibility.ts) through
 * the REAL scorer (./user-score.ts) and the REAL outcome decision
 * (./playoff-progression.ts).
 *
 * The bug: a user who sells their only position and doesn't rebuy before week
 * start correctly gets NO week_snapshots row (snapshot-week-start only snapshots
 * held symbols). Before this fix they were 'unscoreable' from week 2 on (a
 * matchup refused forever, with nothing to backfill) and an accidental auto-loss
 * in week 1 (the fallback saw empty holdings -> hasPositions:false).
 *
 *   (a) sold out before week_start, idle all week        -> $0, matchup proceeds
 *   (b) flat at start, buys mid-week and holds to Friday -> scored as a mid-week
 *       position off its entered_mid_week row; WITHOUT that row it is a missing
 *       week-END snapshot and stays refused
 *   (c) buys then sells in the same week                 -> the FIFO round trip
 *   (d) ledger says held, no snapshot                    -> STILL refused (must
 *       not regress: this is the broken-snapshot-job guard)
 *   (e) week 1, all-cash                                  -> not an accidental
 *       auto-loss; a genuinely EMPTY roster keeps the empty rules
 *   (f) the week-1 fallback (calculatePortfolio) no longer turns a SKIP draft row
 *       into a 1-share holding
 *
 * runWeek mirrors the handler's per-(league, week) flow: batch decision -> per-user
 * scorer choice -> scoring -> per-matchup refusal -> outcome. The scorer choice,
 * scoring and outcome functions are the production ones; only the plumbing (row
 * maps, the mid-week window filter) is re-stated here.
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/process-week-results/user-score.test.ts
 */

import { assert, assertAlmostEquals, assertEquals } from 'jsr:@std/assert';
import {
  decideBatchScoring,
  decideMatchupScoring,
  decideUserScorer,
  ledgerPositionState,
  BATCH_SKIP_REASON,
  MATCHUP_REFUSAL_REASON,
  type BatchDecision,
  type LedgerDraftRow,
  type LedgerTradeRow,
  type ScorerKind,
} from './scoring-eligibility.ts';
import {
  calculatePortfolio,
  calculateUserScore,
  scoreCashOnlyUser,
  type MidWeekTrade,
  type UserScore,
  type WeekSnapshot,
} from './user-score.ts';
import { decideMatchupOutcome, type Outcome } from './playoff-progression.ts';

const WEEK_START = '2026-10-06T14:30:00.000Z';
const WEEK_END = '2026-10-09T21:00:00.000Z';
const PRIOR_WEEK = '2026-10-01T15:00:00.000Z';
const TUE = '2026-10-06T16:00:00.000Z';
const THU = '2026-10-08T16:00:00.000Z';

const CASH = 'aaaaaaaa-0000-4000-8000-000000000001';
const OPP = 'bbbbbbbb-0000-4000-8000-000000000002';
const P3 = 'cccccccc-0000-4000-8000-000000000003';
const P4 = 'dddddddd-0000-4000-8000-000000000004';

interface TradeRow extends LedgerTradeRow {
  price: number;
}

interface WeekInput {
  weekNumber: number;
  drafts: LedgerDraftRow[];
  /** All league trades up to week_end (the handler's ledger query). */
  trades: TradeRow[];
  snapshots: Record<string, WeekSnapshot[]>;
  matchups: { team1: string; team2: string | null }[];
  weekAgeHours?: number;
}

type MatchupResult =
  | { refused: true; reason: string }
  | { refused: false; outcome: Outcome; team1: UserScore; team2: UserScore };

interface WeekResult {
  batch: BatchDecision;
  kinds: Map<string, ScorerKind>;
  scores: Map<string, UserScore>;
  matchups: MatchupResult[];
}

const d = (user_id: string, symbol: string, quantity: number): LedgerDraftRow =>
  ({ user_id, symbol, quantity });
const t = (
  user_id: string,
  action: 'buy' | 'sell',
  symbol: string,
  quantity: number,
  price: number,
  created_at: string,
): TradeRow => ({ user_id, action, symbol, quantity, price, created_at });

/** A Monday snapshot row that was held all week. */
const held = (symbol: string, quantity: number, start: number, end: number): WeekSnapshot =>
  ({ symbol, quantity, weekStartPrice: start, weekEndPrice: end, enteredMidWeek: false });

function runWeek(w: WeekInput): WeekResult {
  const userIds = new Set<string>();
  for (const m of w.matchups) {
    userIds.add(m.team1);
    if (m.team2) userIds.add(m.team2);
  }
  const startMs = Date.parse(WEEK_START);
  const endMs = Date.parse(WEEK_END);
  const midWeek = (u: string): MidWeekTrade[] =>
    w.trades
      .filter((r) => r.user_id === u)
      .filter((r) => {
        const at = Date.parse(r.created_at!);
        return at >= startMs && at <= endMs;
      })
      .map((r) => ({
        symbol: r.symbol!,
        action: r.action as 'buy' | 'sell',
        quantity: Number(r.quantity),
        price: r.price,
        createdAt: new Date(r.created_at!),
      }));

  const allSnaps = Object.values(w.snapshots).flat();
  const hasSnapshots = allSnaps.length > 0;
  const hasWeekEndPrices = allSnaps.some((s) => s.weekEndPrice != null);

  const ledgers = new Map(
    [...userIds].map((u) => [u, ledgerPositionState(u, w.drafts, w.trades, WEEK_START, WEEK_END)]),
  );
  const kinds = new Map<string, ScorerKind>();
  for (const u of userIds) {
    kinds.set(
      u,
      decideUserScorer({
        hasSnapshot: (w.snapshots[u]?.length ?? 0) > 0,
        hasWeekEndPrices,
        weekNumber: w.weekNumber,
        ledger: ledgers.get(u),
      }),
    );
  }

  const batch = decideBatchScoring({
    hasSnapshots,
    weekAgeHours: w.weekAgeHours ?? 1,
    weekNumber: w.weekNumber,
    fallbackMaxAgeHours: 72,
    allParticipantsCashOnly: [...kinds.values()].every((k) => k === 'cash_only'),
  });
  const scores = new Map<string, UserScore>();
  if (batch.action === 'skip') return { batch, kinds, scores, matchups: [] };

  const unscoreable = new Set<string>();
  for (const u of userIds) {
    const kind = kinds.get(u)!;
    if (kind === 'full') scores.set(u, calculateUserScore(u, w.snapshots[u], midWeek(u)));
    else if (kind === 'cash_only') scores.set(u, scoreCashOnlyUser(u, midWeek(u), ledgers.get(u)!.hasLedgerHistory));
    else if (kind === 'unscoreable') unscoreable.add(u);
    else throw new Error(`scenario reached unmodelled scorer '${kind}' for ${u}`);
  }

  const matchups: MatchupResult[] = w.matchups.map((m) => {
    const decision = decideMatchupScoring(m.team1, m.team2, unscoreable);
    if (decision.action === 'refuse') return { refused: true, reason: decision.reason };
    const team1 = scores.get(m.team1)!;
    const team2 = scores.get(m.team2!)!;
    const outcome = decideMatchupOutcome(
      { team1UserId: m.team1, team2UserId: m.team2, team1Seed: null, team2Seed: null, isPlayoff: false },
      team1,
      team2,
    );
    return { refused: false, outcome, team1, team2 };
  });
  return { batch, kinds, scores, matchups };
}

function scored(r: MatchupResult): Extract<MatchupResult, { refused: false }> {
  assert(!r.refused, `expected the matchup to be scored, got refused (${r.refused && r.reason})`);
  return r as Extract<MatchupResult, { refused: false }>;
}

/** CASH drafted AAPL and sold it all in a PRIOR week. */
const CASH_DRAFT = [d(CASH, 'AAPL', 10), d(OPP, 'MSFT', 5)];
const CASH_SOLD_OUT = t(CASH, 'sell', 'AAPL', 10, 150, PRIOR_WEEK);
/** OPP holds MSFT all week: 5 x (199 - 200) = -$5. */
const OPP_DOWN_5 = { [OPP]: [held('MSFT', 5, 200, 199)] };

// ===========================================================================
// (a) sold everything, cash all week, no trades -> $0 and the matchup proceeds
// ===========================================================================

Deno.test('(a) all-cash, idle all week, week 3: cash_only, $0 / 0%, matchup scores — $0 beats -$5', () => {
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT,
    trades: [CASH_SOLD_OUT],
    snapshots: OPP_DOWN_5,
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'cash_only');
  const m = scored(r.matchups[0]);
  assertEquals(m.team1, { dollarGain: 0, percentGain: 0, hasPositions: true });
  assertEquals(m.outcome.reason, 'dollar_gain');
  assertEquals(m.outcome.winnerId, CASH, 'dollars decide: $0 in cash beats a -$5 week');
});

Deno.test('(a) DISCRIMINATOR: without the ledger proof the same user is refused forever', () => {
  // Pre-fix decideUserScorer had no ledger input: snapshot-less past week 1 is
  // ALWAYS 'unscoreable', and there is no snapshot to backfill — it never heals.
  assertEquals(
    decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 3 }),
    'unscoreable',
  );
  assertEquals(
    decideMatchupScoring(CASH, OPP, new Set([CASH])),
    { action: 'refuse', reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT },
  );
});

Deno.test('(a) a two-player league where BOTH sit in cash: batch proceeds, true tie at $0', () => {
  // hasSnapshots is false for the whole league-week. Without allParticipantsCashOnly
  // the batch guard would skip it as no_snapshots_week_gt_1 — forever.
  const r = runWeek({
    weekNumber: 4,
    drafts: [d(CASH, 'AAPL', 10), d(OPP, 'MSFT', 5)],
    trades: [CASH_SOLD_OUT, t(OPP, 'sell', 'MSFT', 5, 210, PRIOR_WEEK)],
    snapshots: {},
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.batch, { action: 'proceed' });
  const m = scored(r.matchups[0]);
  assertEquals(m.outcome.reason, 'regular_season_true_tie');
  assertEquals(m.outcome.isTie, true);
});

// ===========================================================================
// (b) flat at start, buys mid-week and holds to Friday
// ===========================================================================

const CASH_BUYS_NVDA = t(CASH, 'buy', 'NVDA', 2, 50, TUE);

Deno.test('(b) mid-week buy held to Friday WITH its entered_mid_week row: scored purchase -> close', () => {
  // The normal state: snapshot-week-end INSERTed an entered_mid_week row for the
  // position held at the close, so this user has a snapshot and goes 'full'.
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT,
    trades: [CASH_SOLD_OUT, CASH_BUYS_NVDA],
    snapshots: {
      ...OPP_DOWN_5,
      [CASH]: [{ symbol: 'NVDA', quantity: 2, weekStartPrice: 50, weekEndPrice: 55, enteredMidWeek: true }],
    },
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'full');
  const m = scored(r.matchups[0]);
  // 2 x (55 - 50) = $10 on a $100 basis — counted ONCE (not also as a Monday holding).
  assertAlmostEquals(m.team1.dollarGain, 10, 1e-9);
  assertAlmostEquals(m.team1.percentGain, 10, 1e-9);
  assertEquals(m.outcome.winnerId, CASH);
});

Deno.test('(b) the same buy with NO row at all: a missing week-END snapshot — refused, not $0', () => {
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT,
    trades: [CASH_SOLD_OUT, CASH_BUYS_NVDA],
    snapshots: OPP_DOWN_5,
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'unscoreable');
  assertEquals(r.matchups[0], {
    refused: true,
    reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT,
  });
});

Deno.test('(b) DISCRIMINATOR: a start-only flatness check would have fabricated $0 for that week', () => {
  // What scoring it would have produced: the buy has no end price, so
  // calculateUserScore silently drops it — $0 and a real +$10 week erased.
  const fabricated = calculateUserScore(CASH, [], [
    { symbol: 'NVDA', action: 'buy', quantity: 2, price: 50, createdAt: new Date(TUE) },
  ]);
  assertEquals(fabricated.dollarGain, 0);
  // The ledger sees what the missing row hides.
  const ledger = ledgerPositionState(CASH, CASH_DRAFT, [CASH_SOLD_OUT, CASH_BUYS_NVDA], WEEK_START, WEEK_END);
  assertEquals(ledger.heldAtWeekStart, false, 'a start-only check would call this user flat');
  assertEquals(ledger.heldAtWeekEnd, true, 'the end check is what refuses it');
});

// ===========================================================================
// (c) buys mid-week, sells the same week -> the existing buy-then-sell FIFO path
// ===========================================================================

Deno.test('(c) buy then sell in-week, no snapshot: cash_only, scored as the round trip', () => {
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT,
    trades: [
      CASH_SOLD_OUT,
      t(CASH, 'buy', 'NVDA', 2, 50, TUE),
      t(CASH, 'buy', 'NVDA', 1, 60, TUE),
      t(CASH, 'sell', 'NVDA', 3, 58, THU),
    ],
    snapshots: OPP_DOWN_5,
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'cash_only');
  const m = scored(r.matchups[0]);
  // FIFO: 2 x (58 - 50) + 1 x (58 - 60) = 16 - 2 = $14 on a $160 basis.
  assertAlmostEquals(m.team1.dollarGain, 14, 1e-9);
  assertAlmostEquals(m.team1.percentGain, (14 / 160) * 100, 1e-9);
  assertEquals(m.team1.hasPositions, true);
  assertEquals(m.outcome.winnerId, CASH);
});

// ===========================================================================
// (d) a GENUINELY broken snapshot — the ledger says held -> STILL refused
// ===========================================================================

Deno.test('(d) REGRESSION GUARD: ledger-held user with no snapshot, week 3 -> unscoreable, refused', () => {
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT, // CASH still holds AAPL: never sold
    trades: [],
    snapshots: OPP_DOWN_5,
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'unscoreable');
  assertEquals(r.matchups[0], {
    refused: true,
    reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT,
  });
});

Deno.test('(d) PARTIAL: one symbol sold to zero, another still held -> still refused', () => {
  const r = runWeek({
    weekNumber: 3,
    drafts: [...CASH_DRAFT, d(CASH, 'KO', 4)],
    trades: [CASH_SOLD_OUT], // AAPL flat, KO still held
    snapshots: OPP_DOWN_5,
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'unscoreable');
  assert(r.matchups[0].refused);
});

Deno.test('(d) in the SAME week an all-cash matchup scores while the broken one is refused', () => {
  // Per-matchup granularity survives: the fix does not widen refusals, and the
  // refusal does not spread to the cash user's unrelated matchup.
  const r = runWeek({
    weekNumber: 3,
    drafts: [d(CASH, 'AAPL', 10), d(OPP, 'MSFT', 5), d(P3, 'KO', 4), d(P4, 'PEP', 2)],
    trades: [CASH_SOLD_OUT],
    snapshots: { ...OPP_DOWN_5, [P4]: [held('PEP', 2, 170, 171)] }, // P3 snapshot MISSING
    matchups: [{ team1: CASH, team2: OPP }, { team1: P3, team2: P4 }],
  });
  assertEquals(scored(r.matchups[0]).outcome.winnerId, CASH);
  assertEquals(r.matchups[1], {
    refused: true,
    reason: MATCHUP_REFUSAL_REASON.UNSCOREABLE_PARTICIPANT_NO_SNAPSHOT,
  });
});

Deno.test('(d) a mixed snapshot-less league-week (someone ledger-held) is still skipped whole', () => {
  // snapshot-week-start writes league-atomically: one held participant without a
  // row means the whole league's write failed. A backfill heals it; until then
  // nothing scores.
  const r = runWeek({
    weekNumber: 3,
    drafts: CASH_DRAFT, // OPP still holds MSFT
    trades: [CASH_SOLD_OUT],
    snapshots: {},
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.batch, { action: 'skip', reason: BATCH_SKIP_REASON.NO_SNAPSHOTS_WEEK_GT_1 });
});

Deno.test('(d) bots (never snapshotted today) hold drafted stock -> stay unscoreable past week 1', () => {
  // Pins CURRENT behaviour while the snapshot jobs exclude `bot-` ids: the cash
  // rule must not turn a snapshot-less bot into a $0 score.
  const bot = 'bot-1';
  const r = runWeek({
    weekNumber: 2,
    drafts: [d(CASH, 'AAPL', 10), d(bot, 'MSFT', 5)],
    trades: [CASH_SOLD_OUT],
    snapshots: { [P4]: [held('PEP', 2, 170, 171)] },
    matchups: [{ team1: CASH, team2: bot }],
  });
  assertEquals(r.kinds.get(bot), 'unscoreable');
  assert(r.matchups[0].refused);
});

// ===========================================================================
// (e) week 1 — not an accidental auto-loss; genuinely EMPTY keeps the empty rules
// ===========================================================================

Deno.test('(e) week 1: all-cash vs a +$10 opponent -> opponent wins on DOLLARS, not an auto-loss', () => {
  const r = runWeek({
    weekNumber: 1,
    drafts: CASH_DRAFT,
    trades: [CASH_SOLD_OUT],
    snapshots: { [OPP]: [held('MSFT', 5, 200, 202)] },
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(r.kinds.get(CASH), 'cash_only', 'week 1 takes cash_only, not the fallback');
  const m = scored(r.matchups[0]);
  assertEquals(m.outcome.reason, 'dollar_gain');
  assertEquals(m.outcome.winnerId, OPP);
});

Deno.test('(e) week 1: all-cash vs a -$10 opponent -> the cash user WINS', () => {
  const r = runWeek({
    weekNumber: 1,
    drafts: CASH_DRAFT,
    trades: [CASH_SOLD_OUT],
    snapshots: { [OPP]: [held('MSFT', 5, 200, 198)] },
    matchups: [{ team1: CASH, team2: OPP }],
  });
  const m = scored(r.matchups[0]);
  assertEquals(m.outcome.reason, 'dollar_gain');
  assertEquals(m.outcome.winnerId, CASH);
});

Deno.test('(e) DISCRIMINATOR: the old week-1 fallback made the same cash user an auto-loss', () => {
  // Pre-fix: 'fallback' -> calculatePortfolio sees no holdings -> hasPositions
  // false -> team1_empty_auto_loss, even against an opponent who LOST money.
  assertEquals(decideUserScorer({ hasSnapshot: false, hasWeekEndPrices: true, weekNumber: 1 }), 'fallback');
  const preFix = decideMatchupOutcome(
    { team1UserId: CASH, team2UserId: OPP, team1Seed: null, team2Seed: null, isPlayoff: false },
    { dollarGain: 0, percentGain: 0, hasPositions: false },
    { dollarGain: -10, percentGain: -1, hasPositions: true },
  );
  assertEquals(preFix.reason, 'team1_empty_auto_loss');
  assertEquals(preFix.winnerId, OPP);
});

Deno.test('(e) genuinely EMPTY (only SKIP draft rows, never traded) keeps the empty-portfolio rules', () => {
  const empty = runWeek({
    weekNumber: 1,
    drafts: [d(CASH, 'SKIP', 0), d(OPP, 'MSFT', 5)],
    trades: [],
    snapshots: { [OPP]: [held('MSFT', 5, 200, 198)] },
    matchups: [{ team1: CASH, team2: OPP }],
  });
  const m = scored(empty.matchups[0]);
  assertEquals(m.team1.hasPositions, false);
  assertEquals(m.outcome.reason, 'team1_empty_auto_loss', 'an empty roster still auto-loses');

  const bothEmpty = runWeek({
    weekNumber: 1,
    drafts: [d(CASH, 'SKIP', 0), d(OPP, 'SKIP', 0)],
    trades: [],
    snapshots: {},
    matchups: [{ team1: CASH, team2: OPP }],
  });
  assertEquals(scored(bothEmpty.matchups[0]).outcome.reason, 'both_empty_tie');
});

// ===========================================================================
// (f) calculatePortfolio — the week-1 snapshot-less fallback
// ===========================================================================

const SKIP_ROW = { user_id: CASH, symbol: 'SKIP', entry_price: 0, quantity: 0 };

Deno.test('(f) fallback: a SKIP draft row (qty 0) is NOT a 1-share holding', () => {
  const p = calculatePortfolio(CASH, [SKIP_ROW, { ...SKIP_ROW, symbol: 'skip' }], [], new Map());
  assertEquals(p.holdings, [], 'no SKIP holding');
  assertEquals(p.holdings.length > 0, false, 'so hasPositions (holdings.length > 0) is false');
  assertEquals({ totalCost: p.totalCost, totalValue: p.totalValue, gain: p.gain }, { totalCost: 0, totalValue: 0, gain: 0 });
});

Deno.test('(f) fallback: SKIP rows alongside real picks leave only the real holdings', () => {
  const p = calculatePortfolio(
    CASH,
    [SKIP_ROW, { user_id: CASH, symbol: 'AAPL', entry_price: 100, quantity: 2 }, { user_id: OPP, symbol: 'MSFT', entry_price: 1, quantity: 1 }],
    [],
    new Map([['AAPL', 110]]),
  );
  assertEquals(p.holdings, [{ symbol: 'AAPL', quantity: 2, totalCost: 200 }]);
  assertAlmostEquals(p.gain, 20, 1e-9);
});

Deno.test('(f) fallback: draft quantity is `Number(q) || 0` — a null/0 quantity is not coerced to 1', () => {
  const p = calculatePortfolio(
    CASH,
    [{ user_id: CASH, symbol: 'AAPL', entry_price: 100, quantity: null }, { user_id: CASH, symbol: 'KO', entry_price: 60, quantity: 0 }],
    [],
    new Map([['AAPL', 110], ['KO', 61]]),
  );
  assertEquals(p.holdings, []);
});

Deno.test('(f) fallback: a malformed SKIP row WITH a quantity is still not a holding (as userNetHoldings)', () => {
  // Excluded by symbol, not merely zeroed by quantity — the same isSkip rule the
  // shared netting helper applies regardless of quantity.
  const p = calculatePortfolio(CASH, [{ ...SKIP_ROW, quantity: 3, entry_price: 5 }], [], new Map());
  assertEquals(p.holdings, []);
});
