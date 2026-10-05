/**
 * Unit tests for the shared snapshot participant/holdings helpers (see
 * ./snapshot-holdings.ts).
 *
 * These lock in the two defects the helper replaced (both copied verbatim in
 * snapshot-week-start and snapshot-week-end):
 *
 *   F1. BOTS NEVER GOT SNAPSHOTS. Both jobs skipped any `bot-*` participant, so
 *       from week 2 on every matchup against a bot was refused downstream as
 *       unscoreable_participant_no_snapshot and stayed unscored forever.
 *
 *   F2. SKIP ROWS BECAME 1-SHARE HOLDINGS. `Number(draft.quantity || 1)` coerced
 *       the SKIP sentinel's quantity 0 to 1 and nothing filtered the symbol, so a
 *       forfeited turn became an unpriceable 'SKIP' holding that aborted the
 *       whole league's snapshot on every retry.
 *
 * Hermetic: no DB, no Alpaca, no Deno runtime APIs. Run from repo root with
 *   deno test supabase/functions/_shared/snapshot-holdings.test.ts
 */

import { assertEquals } from 'jsr:@std/assert';
import { checkSnapshotReads, matchupParticipants, snapshotHoldings } from './snapshot-holdings.ts';

const HUMAN = '11111111-1111-1111-1111-111111111111';
const HUMAN2 = '22222222-2222-2222-2222-222222222222';
const BOT = 'bot-1';

// ── matchupParticipants ──────────────────────────────────────────────────────

Deno.test('matchupParticipants: bot participants are INCLUDED (F1)', () => {
  const ids = matchupParticipants([
    { team1_user_id: HUMAN, team2_user_id: BOT },
    { team1_user_id: 'bot-2', team2_user_id: HUMAN2 },
  ]);
  assertEquals([...ids].sort(), [HUMAN, HUMAN2, BOT, 'bot-2'].sort());
});

Deno.test('matchupParticipants: a bye (null team2) contributes only team1', () => {
  const ids = matchupParticipants([{ team1_user_id: HUMAN, team2_user_id: null }]);
  assertEquals([...ids], [HUMAN]);
});

Deno.test('matchupParticipants: null / empty ids are ignored, duplicates collapse', () => {
  const ids = matchupParticipants([
    { team1_user_id: HUMAN, team2_user_id: BOT },
    { team1_user_id: BOT, team2_user_id: HUMAN },
    { team1_user_id: null, team2_user_id: '' },
  ]);
  assertEquals([...ids].sort(), [HUMAN, BOT].sort());
});

Deno.test('matchupParticipants: null/undefined matchups -> empty set', () => {
  assertEquals(matchupParticipants(null).size, 0);
  assertEquals(matchupParticipants(undefined).size, 0);
});

// ── snapshotHoldings ─────────────────────────────────────────────────────────

Deno.test('snapshotHoldings: a bot\'s holdings are its non-SKIP draft rows', () => {
  const drafts = [
    { user_id: BOT, symbol: 'AAPL', quantity: 1 },
    { user_id: BOT, symbol: 'SKIP', quantity: 0 },
    { user_id: BOT, symbol: 'msft', quantity: 2.5 },
    { user_id: HUMAN, symbol: 'NVDA', quantity: 1 },
  ];
  assertEquals(snapshotHoldings(BOT, drafts, []), [
    { symbol: 'AAPL', quantity: 1 },
    { symbol: 'MSFT', quantity: 2.5 },
  ]);
});

Deno.test('snapshotHoldings: SKIP sentinel is dropped, case-insensitively (F2)', () => {
  const drafts = [
    { user_id: HUMAN, symbol: 'SKIP', quantity: 0 },
    { user_id: HUMAN, symbol: 'skip', quantity: 0 },
    { user_id: HUMAN, symbol: 'Skip', quantity: 3 }, // even a non-zero qty
    { user_id: HUMAN, symbol: 'AAPL', quantity: 1 },
  ];
  assertEquals(snapshotHoldings(HUMAN, drafts, []), [{ symbol: 'AAPL', quantity: 1 }]);
});

Deno.test('snapshotHoldings: quantity 0 is NOT coerced to 1 (F2 — the `|| 1` bug)', () => {
  const drafts = [{ user_id: HUMAN, symbol: 'AAPL', quantity: 0 }];
  assertEquals(snapshotHoldings(HUMAN, drafts, []), []);
});

Deno.test('snapshotHoldings: a user whose ONLY row is SKIP holds nothing', () => {
  const drafts = [{ user_id: HUMAN, symbol: 'SKIP', quantity: 0 }];
  assertEquals(snapshotHoldings(HUMAN, drafts, []), []);
});

Deno.test('snapshotHoldings: NULL quantity counts as 0 (no holding), matching the draft validator', () => {
  // drafts.quantity is NOT NULL in the DB, so this is unreachable today; the
  // decision is pinned so it cannot silently flip back to "1 share".
  const drafts = [{ user_id: HUMAN, symbol: 'AAPL', quantity: null }];
  assertEquals(snapshotHoldings(HUMAN, drafts, []), []);
});

Deno.test('snapshotHoldings: null / empty symbols are ignored rather than throwing', () => {
  const drafts = [
    { user_id: HUMAN, symbol: null, quantity: 1 },
    { user_id: HUMAN, symbol: '', quantity: 1 },
    { user_id: HUMAN, symbol: 'AAPL', quantity: 1 },
  ];
  const trades = [{ user_id: HUMAN, symbol: null, action: 'buy', quantity: 1 }];
  assertEquals(snapshotHoldings(HUMAN, drafts, trades), [{ symbol: 'AAPL', quantity: 1 }]);
});

Deno.test('snapshotHoldings: trades net against drafts; a full sell removes the holding', () => {
  const drafts = [
    { user_id: HUMAN, symbol: 'AAPL', quantity: 2 },
    { user_id: HUMAN, symbol: 'MSFT', quantity: 1 },
  ];
  const trades = [
    { user_id: HUMAN, symbol: 'AAPL', action: 'sell', quantity: 1 },
    { user_id: HUMAN, symbol: 'msft', action: 'sell', quantity: 1 },
    { user_id: HUMAN, symbol: 'TSLA', action: 'buy', quantity: 3 },
  ];
  assertEquals(snapshotHoldings(HUMAN, drafts, trades), [
    { symbol: 'AAPL', quantity: 1 },
    { symbol: 'TSLA', quantity: 3 },
  ]);
});

Deno.test('snapshotHoldings: fractional float residue after a full sell is not a holding', () => {
  const drafts = [{ user_id: HUMAN, symbol: 'AAPL', quantity: 0.1 + 0.2 }];
  const trades = [{ user_id: HUMAN, symbol: 'AAPL', action: 'sell', quantity: 0.3 }];
  assertEquals(snapshotHoldings(HUMAN, drafts, trades), []);
});

Deno.test('snapshotHoldings: only the requested user\'s rows count', () => {
  const drafts = [
    { user_id: HUMAN, symbol: 'AAPL', quantity: 1 },
    { user_id: HUMAN2, symbol: 'AAPL', quantity: 5 },
  ];
  const trades = [{ user_id: HUMAN2, symbol: 'AAPL', action: 'sell', quantity: 5 }];
  assertEquals(snapshotHoldings(HUMAN, drafts, trades), [{ symbol: 'AAPL', quantity: 1 }]);
});

Deno.test('snapshotHoldings: numeric-string quantities (Postgres numeric via PostgREST) parse', () => {
  const drafts = [{ user_id: HUMAN, symbol: 'AAPL', quantity: '1.500000' }];
  const trades = [{ user_id: HUMAN, symbol: 'AAPL', action: 'buy', quantity: '0.5' }];
  assertEquals(snapshotHoldings(HUMAN, drafts, trades), [{ symbol: 'AAPL', quantity: 2 }]);
});

Deno.test('snapshotHoldings: output is sorted by symbol (deterministic row order)', () => {
  const drafts = [
    { user_id: HUMAN, symbol: 'ZM', quantity: 1 },
    { user_id: HUMAN, symbol: 'AAPL', quantity: 1 },
    { user_id: HUMAN, symbol: 'KO', quantity: 1 },
  ];
  assertEquals(snapshotHoldings(HUMAN, drafts, []).map((h) => h.symbol), ['AAPL', 'KO', 'ZM']);
});

// ── checkSnapshotReads ───────────────────────────────────────────────────────
// supabase-js resolves a failed read to { data: null, error } — it does not
// throw. The handlers used to default `data || []`, so a transient failure on
// drafts/trades/matchups read as "everyone holds nothing" -> 'none_expected' /
// 'complete' -> nothing written, status success, and every retry skipped too.

const ok = (data: unknown[]) => ({ data, error: null });
const fail = (message = 'boom') => ({ data: null, error: { message } });

Deno.test('checkSnapshotReads: all reads succeeded -> ok with the rows', () => {
  const r = checkSnapshotReads({ drafts: ok([{ a: 1 }]), trades: ok([]) });
  assertEquals(r, { ok: true, rows: { drafts: [{ a: 1 }], trades: [] } });
});

Deno.test('checkSnapshotReads: an EMPTY result is a legitimate success, not a failure', () => {
  // A league with no trades is normal; only an error (or a missing array) is not.
  const r = checkSnapshotReads({ matchups: ok([]), drafts: ok([]), trades: ok([]) });
  assertEquals(r.ok, true);
});

Deno.test('checkSnapshotReads: ANY failed read fails the whole set, naming each failure', () => {
  const r = checkSnapshotReads({
    matchups: ok([{}]),
    drafts: fail('timeout'),
    trades: ok([]),
    snapshots: fail('reset'),
  });
  assertEquals(r.ok, false);
  if (!r.ok) {
    assertEquals(r.failed.map((f) => f.read), ['drafts', 'snapshots']);
    assertEquals(r.failed.map((f) => f.message), ['timeout', 'reset']);
    // No rows are handed back on failure, so a caller cannot fall through to
    // coverage classification with defaulted empty arrays.
    assertEquals('rows' in r, false);
  }
});

Deno.test('checkSnapshotReads: data null with NO error is still a failure (never defaulted to [])', () => {
  const r = checkSnapshotReads({ drafts: { data: null, error: null } });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.failed, [{ read: 'drafts', message: 'no data returned' }]);
});

Deno.test('checkSnapshotReads: a non-object error still produces a readable message', () => {
  const r = checkSnapshotReads({ trades: { data: null, error: 'socket hang up' } });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.failed, [{ read: 'trades', message: 'socket hang up' }]);
});

Deno.test('truncation: a read whose rows are fewer than its exact count FAILS, never feeds a partial set', () => {
  const r = checkSnapshotReads({
    trades: { data: [{ user_id: 'u1' }], error: null, count: 3 },
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.failed[0].read, 'trades');
  if (!r.ok) assertEquals(r.failed[0].message.startsWith('truncated: 1 of 3'), true);
});

Deno.test('truncation: a complete read (rows == count) passes', () => {
  const r = checkSnapshotReads({
    trades: { data: [{ user_id: 'u1' }, { user_id: 'u2' }], error: null, count: 2 },
  });
  assertEquals(r.ok, true);
});

Deno.test('truncation: a read with no count is unchanged (the guard applies only when counted)', () => {
  const r = checkSnapshotReads({ drafts: { data: [{ user_id: 'u1' }], error: null } });
  assertEquals(r.ok, true);
});

