/**
 * Hermetic unit tests for schedule.ts (server-side season schedule generation).
 * No DB, no network, no Deno runtime APIs — run:
 *
 *   deno test supabase/functions/_shared/schedule.test.ts
 *
 * Covers:
 *   - golden parity with apps/web/src/utils/scheduleGenerator.js (the fixtures
 *     below were captured by running the web generator itself, not hand-written)
 *   - even rosters: everyone plays once a week, full round-robin in n-1 weeks
 *   - odd rosters: exactly one bye per week, each player byes once per cycle
 *   - num_weeks > n-1 cycles; num_weeks < n-1 truncates; null falls back to n-1
 *   - next-Tuesday 14:30Z start from every weekday, Friday 21:00Z end, rollovers
 *   - duration leagues: next-day open .. +duration_days at close
 *   - determinism + canonical (commissioner-first, sorted) roster
 *   - refusals
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { computeDraftOrder } from './draft-validation.ts';
import {
  buildFinalizeArgs,
  marketCloseOn,
  nextDayMarketOpen,
  planSeason,
  readFinalizeResult,
  roundRobinPairings,
  type SeasonInput,
  weekWindow,
} from './schedule.ts';

const THU = new Date('2026-09-24T18:00:00Z'); // a Thursday

function matchup(over: Partial<SeasonInput> = {}): SeasonInput {
  return {
    leagueType: 'matchup',
    commissionerId: 'c',
    memberIds: ['a', 'b', 'c', 'd'],
    numWeeks: null,
    durationDays: null,
    now: THU,
    ...over,
  };
}

function plan(input: SeasonInput) {
  const p = planSeason(input);
  if (!p.ok) throw new Error(`unexpected refusal: ${p.reason}`);
  return p;
}

const rows = (input: SeasonInput) =>
  plan(input).matchups.map((m) => [m.week_number, m.team1_user_id, m.team2_user_id, m.week_start, m.week_end]);

const pairKey = (x: string, y: string) => [x, y].sort().join('|');

// ---------------------------------------------------------------------------
// Golden parity — captured from scheduleGenerator.js generateSchedule with
// roster ['c','a','b','d'(,'e')] (canonical order, commissioner 'c') at THU.
// ---------------------------------------------------------------------------

Deno.test('golden: 4 players, 4 weeks matches the web generator exactly', () => {
  assertEquals(rows(matchup({ numWeeks: 4 })), [
    [1, 'c', 'd', '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z'],
    [1, 'a', 'b', '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z'],
    [2, 'c', 'a', '2026-10-06T14:30:00.000Z', '2026-10-09T21:00:00.000Z'],
    [2, 'b', 'd', '2026-10-06T14:30:00.000Z', '2026-10-09T21:00:00.000Z'],
    [3, 'c', 'b', '2026-10-13T14:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    [3, 'd', 'a', '2026-10-13T14:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    [4, 'c', 'd', '2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z'],
    [4, 'a', 'b', '2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z'],
  ]);
});

Deno.test('golden: 5 players (byes), 6 weeks matches the web generator exactly', () => {
  assertEquals(rows(matchup({ memberIds: ['e', 'd', 'c', 'b', 'a'], numWeeks: 6 })), [
    [1, 'c', null, '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z'],
    [1, 'a', 'e', '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z'],
    [1, 'b', 'd', '2026-09-29T14:30:00.000Z', '2026-10-02T21:00:00.000Z'],
    [2, 'c', 'a', '2026-10-06T14:30:00.000Z', '2026-10-09T21:00:00.000Z'],
    [2, 'b', null, '2026-10-06T14:30:00.000Z', '2026-10-09T21:00:00.000Z'],
    [2, 'd', 'e', '2026-10-06T14:30:00.000Z', '2026-10-09T21:00:00.000Z'],
    [3, 'c', 'b', '2026-10-13T14:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    [3, 'd', 'a', '2026-10-13T14:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    [3, 'e', null, '2026-10-13T14:30:00.000Z', '2026-10-16T21:00:00.000Z'],
    [4, 'c', 'd', '2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z'],
    [4, 'e', 'b', '2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z'],
    [4, 'a', null, '2026-10-20T14:30:00.000Z', '2026-10-23T21:00:00.000Z'],
    [5, 'c', 'e', '2026-10-27T14:30:00.000Z', '2026-10-30T21:00:00.000Z'],
    [5, 'd', null, '2026-10-27T14:30:00.000Z', '2026-10-30T21:00:00.000Z'],
    [5, 'a', 'b', '2026-10-27T14:30:00.000Z', '2026-10-30T21:00:00.000Z'],
    [6, 'c', null, '2026-11-03T14:30:00.000Z', '2026-11-06T21:00:00.000Z'],
    [6, 'a', 'e', '2026-11-03T14:30:00.000Z', '2026-11-06T21:00:00.000Z'],
    [6, 'b', 'd', '2026-11-03T14:30:00.000Z', '2026-11-06T21:00:00.000Z'],
  ]);
});

Deno.test('golden: duration league window matches getNextDayMarketOpen/getMarketClose', () => {
  const p = plan(matchup({ leagueType: 'duration', durationDays: 30 }));
  assertEquals(p.leagueStart, '2026-09-25T14:30:00.000Z');
  assertEquals(p.leagueEnd, '2026-10-25T21:00:00.000Z'); // a Sunday — not snapped, as on web
  assertEquals(p.matchups, []);
});

// ---------------------------------------------------------------------------
// Round-robin invariants
// ---------------------------------------------------------------------------

for (const n of [2, 4, 6, 8]) {
  Deno.test(`even roster n=${n}: each member once per week, every pair exactly once in n-1 weeks`, () => {
    const roster = Array.from({ length: n }, (_, i) => `u${i}`);
    const pairs = roundRobinPairings(roster, n - 1);
    const seen = new Map<string, number>();
    for (let w = 1; w <= n - 1; w++) {
      const wk = pairs.filter((p) => p.week === w);
      assertEquals(wk.length, n / 2);
      const players = wk.flatMap((p) => [p.team1, p.team2]);
      assertEquals(new Set(players).size, n, `week ${w} repeats or omits a player`);
      for (const p of wk) {
        assert(p.team2 !== null, 'even roster must have no byes');
        assert(p.team1 !== p.team2, 'self-pairing');
        const k = pairKey(p.team1, p.team2!);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
    }
    assertEquals(seen.size, (n * (n - 1)) / 2);
    for (const [k, c] of seen) assertEquals(c, 1, `pair ${k} met ${c} times`);
  });
}

for (const n of [3, 5, 7]) {
  Deno.test(`odd roster n=${n}: exactly one bye per week, each player byes once per cycle`, () => {
    const roster = Array.from({ length: n }, (_, i) => `u${i}`);
    const pairs = roundRobinPairings(roster, n); // one full cycle = n weeks with the BYE seat
    const byes = new Map<string, number>();
    const seen = new Set<string>();
    for (let w = 1; w <= n; w++) {
      const wk = pairs.filter((p) => p.week === w);
      const weekByes = wk.filter((p) => p.team2 === null);
      assertEquals(weekByes.length, 1, `week ${w} bye count`);
      const players = wk.flatMap((p) => (p.team2 === null ? [p.team1] : [p.team1, p.team2]));
      assertEquals(new Set(players).size, n, `week ${w} repeats or omits a player`);
      for (const p of wk) {
        assert(roster.includes(p.team1), `team1 ${p.team1} is not a real member`);
        if (p.team2 === null) byes.set(p.team1, (byes.get(p.team1) ?? 0) + 1);
        else seen.add(pairKey(p.team1, p.team2));
      }
    }
    for (const u of roster) assertEquals(byes.get(u), 1, `${u} bye count`);
    assertEquals(seen.size, (n * (n - 1)) / 2, 'every real pair meets once per cycle');
  });
}

Deno.test('no BYE sentinel ever leaks into matchup rows', () => {
  for (const m of plan(matchup({ memberIds: ['a', 'b', 'c'], numWeeks: 9 })).matchups) {
    assert(m.team1_user_id !== 'BYE' && m.team2_user_id !== 'BYE');
    assert(typeof m.team1_user_id === 'string' && m.team1_user_id.length > 0);
  }
});

Deno.test('num_weeks > n-1 cycles: week n repeats week 1', () => {
  const p = plan(matchup({ numWeeks: 7 })); // n=4 -> cycle of 3
  const wk = (w: number) =>
    p.matchups.filter((m) => m.week_number === w).map((m) => pairKey(m.team1_user_id, m.team2_user_id!)).sort();
  assertEquals(wk(4), wk(1));
  assertEquals(wk(7), wk(1));
  assertEquals(wk(5), wk(2));
  assertEquals(Math.max(...p.matchups.map((m) => m.week_number)), 7);
});

Deno.test('num_weeks < n-1 truncates the round-robin', () => {
  const p = plan(matchup({ memberIds: ['a', 'b', 'c', 'd', 'e', 'f'], numWeeks: 2 }));
  assertEquals(p.matchups.length, 6); // 2 weeks x 3 games
  assertEquals(new Set(p.matchups.map((m) => m.week_number)), new Set([1, 2]));
});

Deno.test('num_weeks null or 0 falls back to members - 1 (DraftPage rule)', () => {
  for (const numWeeks of [null, 0]) {
    const p = plan(matchup({ numWeeks }));
    assertEquals(Math.max(...p.matchups.map((m) => m.week_number)), 3);
  }
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

Deno.test('week 1 starts the first Tuesday strictly after the draft day, from every weekday', () => {
  // 2026-09-20 is a Sunday. Tuesday 2026-09-22 must roll to the NEXT Tuesday.
  const expected: Record<string, string> = {
    '2026-09-20': '2026-09-22', // Sun
    '2026-09-21': '2026-09-22', // Mon
    '2026-09-22': '2026-09-29', // Tue -> next week
    '2026-09-23': '2026-09-29', // Wed
    '2026-09-24': '2026-09-29', // Thu
    '2026-09-25': '2026-09-29', // Fri
    '2026-09-26': '2026-09-29', // Sat
  };
  for (const [day, tue] of Object.entries(expected)) {
    for (const hhmm of ['00:00', '14:29', '23:59']) {
      const w = weekWindow(new Date(`${day}T${hhmm}:00Z`), 1);
      assertEquals(w.start.toISOString(), `${tue}T14:30:00.000Z`, `${day} ${hhmm}`);
    }
  }
});

Deno.test('week window is Tuesday 14:30Z .. Friday 21:00Z, week k is +7(k-1) days', () => {
  for (let k = 1; k <= 10; k++) {
    const w = weekWindow(THU, k);
    assertEquals(w.start.getUTCDay(), 2);
    assertEquals(w.end.getUTCDay(), 5);
    assertEquals([w.start.getUTCHours(), w.start.getUTCMinutes()], [14, 30]);
    assertEquals([w.end.getUTCHours(), w.end.getUTCMinutes()], [21, 0]);
    assertEquals(w.start.getTime() - weekWindow(THU, 1).start.getTime(), (k - 1) * 7 * 86400000);
  }
});

Deno.test('dates roll over month and year boundaries', () => {
  assertEquals(weekWindow(new Date('2026-12-30T12:00:00Z'), 1).start.toISOString(), '2027-01-05T14:30:00.000Z');
  assertEquals(weekWindow(new Date('2026-12-30T12:00:00Z'), 1).end.toISOString(), '2027-01-08T21:00:00.000Z');
  assertEquals(weekWindow(new Date('2027-02-24T12:00:00Z'), 1).end.toISOString(), '2027-03-05T21:00:00.000Z');
  assertEquals(nextDayMarketOpen(new Date('2026-12-31T23:59:59Z')).toISOString(), '2027-01-01T14:30:00.000Z');
});

Deno.test('fixed UTC clock is DST-invariant (documented, mirrors web)', () => {
  // US DST ends 2026-11-01; the window's UTC times must not shift across it.
  const before = weekWindow(new Date('2026-10-28T12:00:00Z'), 1);
  const after = weekWindow(new Date('2026-10-28T12:00:00Z'), 2);
  assertEquals(before.start.toISOString(), '2026-11-03T14:30:00.000Z');
  assertEquals(after.start.toISOString(), '2026-11-10T14:30:00.000Z');
  assertEquals(marketCloseOn(new Date('2026-07-01T03:00:00Z')).toISOString(), '2026-07-01T21:00:00.000Z');
});

Deno.test('matchup league window = week 1 start .. last week end', () => {
  const p = plan(matchup({ numWeeks: 5 }));
  assertEquals(p.leagueStart, p.matchups[0].week_start);
  assertEquals(p.leagueEnd, p.matchups[p.matchups.length - 1].week_end);
  assertEquals(p.leagueEnd, '2026-10-30T21:00:00.000Z');
});

Deno.test('duration league: durationDays null defaults to 30; other lengths honored', () => {
  assertEquals(plan(matchup({ leagueType: 'duration' })).leagueEnd, '2026-10-25T21:00:00.000Z');
  const p = plan(matchup({ leagueType: 'duration', durationDays: 7 }));
  assertEquals(p.leagueStart, '2026-09-25T14:30:00.000Z');
  assertEquals(p.leagueEnd, '2026-10-02T21:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Determinism + canonical roster
// ---------------------------------------------------------------------------

Deno.test('determinism: same inputs give deep-equal plans', () => {
  assertEquals(planSeason(matchup({ numWeeks: 6 })), planSeason(matchup({ numWeeks: 6 })));
});

Deno.test('member order from the query does not matter (canonical roster)', () => {
  const base = planSeason(matchup({ memberIds: ['a', 'b', 'c', 'd', 'e'], numWeeks: 5 }));
  for (const order of [['e', 'd', 'c', 'b', 'a'], ['c', 'e', 'a', 'd', 'b'], ['b', 'a', 'e', 'c', 'd']]) {
    assertEquals(planSeason(matchup({ memberIds: order, numWeeks: 5 })), base);
  }
});

Deno.test('roster is commissioner first, then remaining ids sorted ascending', () => {
  assertEquals(plan(matchup({ memberIds: ['z', 'bot-2', 'c', 'bot-1', 'a'] })).roster, ['c', 'a', 'bot-1', 'bot-2', 'z']);
  // Commissioner not a member (e.g. left): plain sorted order, as computeDraftOrder does.
  assertEquals(plan(matchup({ commissionerId: 'x', memberIds: ['b', 'a'] })).roster, ['a', 'b']);
});

Deno.test('duplicate member ids are collapsed, never double-scheduled', () => {
  const p = plan(matchup({ memberIds: ['a', 'b', 'a', 'c', 'd', 'd'] }));
  assertEquals(p.roster, ['c', 'a', 'b', 'd']);
  assertEquals(p.matchups.filter((m) => m.week_number === 1).length, 2);
});

// ---------------------------------------------------------------------------
// Refusals + payload shape
// ---------------------------------------------------------------------------

Deno.test('refusals: empty roster, solo matchup league, bad num_weeks, unknown type', () => {
  assertEquals(planSeason(matchup({ memberIds: [] })), { ok: false, reason: 'no_members' });
  assertEquals(planSeason(matchup({ memberIds: ['c'] })), { ok: false, reason: 'too_few_members' });
  assertEquals(planSeason(matchup({ numWeeks: -2 })), { ok: false, reason: 'invalid_num_weeks' });
  assertEquals(planSeason(matchup({ numWeeks: 2.5 })), { ok: false, reason: 'invalid_num_weeks' });
  assertEquals(planSeason(matchup({ leagueType: 'weird' })), { ok: false, reason: 'unknown_league_type' });
  // A solo DURATION league is fine — it has no pairings.
  assert(planSeason(matchup({ leagueType: 'duration', memberIds: ['c'] })).ok);
});

Deno.test('payload shape: integer weeks, ISO-8601 UTC strings, exactly the matchups columns', () => {
  for (const m of plan(matchup({ memberIds: ['a', 'b', 'c'], numWeeks: 3 })).matchups) {
    assertEquals(Object.keys(m).sort(), ['team1_user_id', 'team2_user_id', 'week_end', 'week_number', 'week_start']);
    assert(Number.isInteger(m.week_number) && m.week_number >= 1);
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(m.week_start));
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/.test(m.week_end));
  }
});

// ---------------------------------------------------------------------------
// RPC glue: id-string identity (cross-table type footgun) + result reading
// ---------------------------------------------------------------------------

Deno.test('payload ids are exactly computeDraftOrder strings (uuids, bots, mixed case)', () => {
  const members = [
    'f3a1c2d4-0000-4000-8000-00000000000b',
    'bot-2',
    'F3A1C2D4-0000-4000-8000-00000000000A', // case is preserved, never normalised
    'bot-10',
    'a0000000-0000-4000-8000-000000000001',
  ];
  const commissioner = 'a0000000-0000-4000-8000-000000000001';
  const p = plan(matchup({ commissionerId: commissioner, memberIds: members, numWeeks: 5 }));
  assertEquals(p.roster, computeDraftOrder(commissioner, members));
  const args = buildFinalizeArgs('L', p);
  assertEquals(args.p_member_ids, computeDraftOrder(commissioner, members));
  for (const m of args.p_matchups) {
    assert(args.p_member_ids.includes(m.team1_user_id), `team1 ${m.team1_user_id}`);
    assert(m.team2_user_id === null || args.p_member_ids.includes(m.team2_user_id), `team2 ${m.team2_user_id}`);
  }
});

Deno.test('buildFinalizeArgs keys match the SQL signature', () => {
  const args = buildFinalizeArgs('L', plan(matchup()));
  assertEquals(Object.keys(args).sort(), ['p_league_end', 'p_league_id', 'p_league_start', 'p_matchups', 'p_member_ids']);
});

Deno.test('readFinalizeResult: success statuses, refusals, rpc errors, junk', () => {
  assertEquals(readFinalizeResult({ data: { status: 'finalized' }, error: null }), { ok: true, status: 'finalized' });
  assertEquals(readFinalizeResult({ data: { status: 'already_finalized' }, error: null }), { ok: true, status: 'already_finalized' });
  assertEquals(
    readFinalizeResult({ data: { status: 'refused', reason: 'invalid_payload', detail: 'week_coverage' }, error: null }),
    { ok: false, retryable: false, error: 'finalize_refused:invalid_payload:week_coverage' },
  );
  assertEquals(
    readFinalizeResult({ data: { status: 'refused', reason: 'roster_mismatch' }, error: null }),
    { ok: false, retryable: false, error: 'finalize_refused:roster_mismatch' },
  );
  // .rpc() resolves (does not throw) with error set — must NOT read as success.
  assertEquals(readFinalizeResult({ data: null, error: { message: 'boom' } }), { ok: false, retryable: true, error: 'finalize_rpc_error' });
  assertEquals(readFinalizeResult({ data: { status: 'finalized' }, error: { message: 'x' } }).ok, false);
  assertEquals(readFinalizeResult({ data: null, error: null }), { ok: false, retryable: false, error: 'finalize_unexpected_response' });
});
