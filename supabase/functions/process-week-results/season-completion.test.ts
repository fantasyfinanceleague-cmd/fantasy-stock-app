import { assertEquals } from 'jsr:@std/assert';
import { playoffShape } from '../_shared/playoff-bracket.ts';
import {
  completeLeagueSeason,
  decideSeasonCompletion,
  healUncompletedSeasons,
  type SeasonPlayoffRow,
} from './season-completion.ts';

/** A finals row at the given round/position, defaulting to unscored. */
function finalRow(overrides: Partial<SeasonPlayoffRow> & { roundNumber: number }): SeasonPlayoffRow {
  return {
    id: 'final-1',
    position: 0,
    team1UserId: 'alice',
    team2UserId: 'bob',
    scored: false,
    winnerUserId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decideSeasonCompletion — the final is found BY ADDRESS (round === weeks),
// never by the playoff_round label, mirroring advancePlayoffWinner/planAdvance.
// ---------------------------------------------------------------------------

Deno.test('decideSeasonCompletion: no playoff rows at all -> not_ready (no bracket yet)', () => {
  assertEquals(decideSeasonCompletion([], 1), { kind: 'not_ready' });
});

Deno.test('decideSeasonCompletion: unaddressed row(s) refuse distinctly from "final not found"', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ roundNumber: 1 }),
    { id: 'legacy-1', roundNumber: null, position: null, team1UserId: 'x', team2UserId: 'y', scored: true, winnerUserId: 'x' },
  ];
  const d = decideSeasonCompletion(rows, 1);
  assertEquals(d.kind, 'refuse');
  if (d.kind === 'refuse') {
    assertEquals(d.reason, 'final_unaddressed: 1 of 2 playoff row(s) missing a bracket address');
  }
});

Deno.test('decideSeasonCompletion: an unaddressed row still refuses even when it IS the round-weeks row (position null)', () => {
  const rows: SeasonPlayoffRow[] = [
    { id: 'f', roundNumber: 2, position: null, team1UserId: 'x', team2UserId: 'y', scored: true, winnerUserId: 'x' },
  ];
  assertEquals(decideSeasonCompletion(rows, 2).kind, 'refuse');
});

Deno.test('decideSeasonCompletion: no row addressed at round === weeks -> final_missing', () => {
  const rows: SeasonPlayoffRow[] = [finalRow({ roundNumber: 1, id: 'semi', scored: true, winnerUserId: 'alice' })];
  const d = decideSeasonCompletion(rows, 2); // finals live at round 2; only round 1 present
  assertEquals(d, { kind: 'refuse', reason: 'final_missing: no round 2 row found among 1 playoff row(s)' });
});

Deno.test('decideSeasonCompletion: two rows at round === weeks -> final_ambiguous, never guesses', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ roundNumber: 1, id: 'f1', position: 0 }),
    finalRow({ roundNumber: 1, id: 'f2', position: 1 }),
  ];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'refuse', reason: 'final_ambiguous: 2 rows in round 1' });
});

Deno.test('decideSeasonCompletion: final not yet scored -> not_ready (retried once it is)', () => {
  const rows: SeasonPlayoffRow[] = [finalRow({ roundNumber: 1, scored: false })];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'not_ready' });
});

Deno.test('decideSeasonCompletion: scored final with no winner refuses (structurally unreachable via the current scorer, checked anyway)', () => {
  const rows: SeasonPlayoffRow[] = [finalRow({ roundNumber: 1, scored: true, winnerUserId: null })];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'refuse', reason: 'final_scored_without_winner' });
});

Deno.test('decideSeasonCompletion: scored final with an empty slot refuses rather than completing on half a bracket', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ roundNumber: 1, scored: true, winnerUserId: 'alice', team2UserId: null }),
  ];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'refuse', reason: 'final_empty_slot' });
});

Deno.test('decideSeasonCompletion: winner_user_id not one of the two slots refuses (data corruption)', () => {
  const rows: SeasonPlayoffRow[] = [finalRow({ roundNumber: 1, scored: true, winnerUserId: 'mallory' })];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'refuse', reason: 'final_winner_not_a_participant' });
});

Deno.test('decideSeasonCompletion: happy path names champion = winner, runner-up = the other slot', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ roundNumber: 1, scored: true, winnerUserId: 'bob', team1UserId: 'alice', team2UserId: 'bob' }),
  ];
  assertEquals(decideSeasonCompletion(rows, 1), { kind: 'complete', championUserId: 'bob', runnerUpUserId: 'alice' });
});

Deno.test('decideSeasonCompletion: happy path, winner is team1', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ roundNumber: 3, scored: true, winnerUserId: 'alice', team1UserId: 'alice', team2UserId: 'bob' }),
  ];
  assertEquals(decideSeasonCompletion(rows, 3), { kind: 'complete', championUserId: 'alice', runnerUpUserId: 'bob' });
});

Deno.test('decideSeasonCompletion: earlier-round rows present alongside the final do not confuse the address lookup', () => {
  const rows: SeasonPlayoffRow[] = [
    finalRow({ id: 'semi-0', roundNumber: 1, position: 0, scored: true, winnerUserId: 'alice' }),
    finalRow({ id: 'semi-1', roundNumber: 1, position: 1, scored: true, winnerUserId: 'carol' }),
    finalRow({ id: 'final', roundNumber: 2, position: 0, scored: true, winnerUserId: 'alice', team1UserId: 'alice', team2UserId: 'carol' }),
  ];
  assertEquals(decideSeasonCompletion(rows, 2), { kind: 'complete', championUserId: 'alice', runnerUpUserId: 'carol' });
});

Deno.test('decideSeasonCompletion: P=2..8 sweep, finals round = ceil(log2 P), happy path', () => {
  for (let p = 2; p <= 8; p++) {
    const weeks = playoffShape(p).weeks;
    const rows: SeasonPlayoffRow[] = [
      finalRow({ roundNumber: weeks, scored: true, winnerUserId: 'alice', team1UserId: 'alice', team2UserId: 'bob' }),
    ];
    assertEquals(
      decideSeasonCompletion(rows, weeks),
      { kind: 'complete', championUserId: 'alice', runnerUpUserId: 'bob' },
      `P=${p} weeks=${weeks}`,
    );
  }
});

// ---------------------------------------------------------------------------
// completeLeagueSeason — the rpc `{ error }` must be checked, never assumed ok
// (CLAUDE.md "Success signals" #5: the old caller discarded it entirely).
// ---------------------------------------------------------------------------

function fakeSupabase(rpcResult: { error: { message?: string } | null }) {
  const calls: unknown[] = [];
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    rpc(name: string, args: any) {
      calls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
}

Deno.test('completeLeagueSeason: rpc error is surfaced as a failure, never a silent success', async () => {
  const sb = fakeSupabase({ error: { message: 'League has no active season' } });
  const res = await completeLeagueSeason(sb, 'league-1', 'alice', 'bob');
  assertEquals(res, { ok: false, reason: 'complete_league_season_failed: League has no active season' });
});

Deno.test('completeLeagueSeason: an error with no message falls back to JSON, never swallowed', async () => {
  const sb = fakeSupabase({ error: { code: '23514' } as unknown as { message?: string } });
  const res = await completeLeagueSeason(sb, 'league-1', 'alice', 'bob');
  assertEquals(res.ok, false);
  if (!res.ok) assertEquals(res.reason.includes('23514'), true);
});

Deno.test('completeLeagueSeason: no error -> ok, and calls the rpc with the exact expected args', async () => {
  const sb = fakeSupabase({ error: null });
  const res = await completeLeagueSeason(sb, 'league-1', 'alice', 'bob');
  assertEquals(res, { ok: true });
  assertEquals(sb.calls, [{
    name: 'complete_league_season',
    args: { p_league_id: 'league-1', p_champion_user_id: 'alice', p_runner_up_user_id: 'bob' },
  }]);
});

// ---------------------------------------------------------------------------
// healUncompletedSeasons — the end-to-end wiring: leagues -> rows -> decision
// -> rpc, against a fake supabase client (a hand-rolled query builder, not the
// real thing — the real thing is exercised by supabase/tests/*.pglite.test.ts).
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
function makeQueryableSupabase(leagues: any[], rowsByLeague: Record<string, any[]>, rpcError: { message?: string } | null) {
  const rpcCalls: unknown[] = [];
  return {
    rpcCalls,
    // deno-lint-ignore no-explicit-any
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const filters: Record<string, any> = {};
      const builder = {
        eq(col: string, val: unknown) {
          filters[col] = val;
          return builder;
        },
        select() {
          return builder;
        },
        then(resolve: (v: unknown) => void) {
          if (table === 'leagues') {
            resolve({ data: leagues, error: null });
          } else if (table === 'matchups') {
            const rows = rowsByLeague[filters['league_id'] as string] ?? [];
            resolve({ data: rows, error: null });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return builder;
    },
    // deno-lint-ignore no-explicit-any
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ error: rpcError });
    },
  };
}

Deno.test('healUncompletedSeasons: a league whose final is scored but rpc fails is reported, and the caller can retry', async () => {
  const sb = makeQueryableSupabase(
    [{ id: 'league-1', playoff_teams: 2 }],
    {
      'league-1': [
        {
          id: 'final', playoff_round_number: 1, bracket_position: 0,
          team1_user_id: 'alice', team2_user_id: 'bob', team1_gain: 12.5, winner_user_id: 'alice',
        },
      ],
    },
    { message: 'League has no active season' },
  );
  const refusals = await healUncompletedSeasons(sb, null);
  assertEquals(refusals, [{
    league_id: 'league-1',
    reason: 'complete_league_season_failed: League has no active season',
  }]);
  assertEquals(sb.rpcCalls, [{
    name: 'complete_league_season',
    args: { p_league_id: 'league-1', p_champion_user_id: 'alice', p_runner_up_user_id: 'bob' },
  }]);
});

Deno.test('healUncompletedSeasons: a league whose final is not yet scored is left alone (not_ready is not a refusal)', async () => {
  const sb = makeQueryableSupabase(
    [{ id: 'league-1', playoff_teams: 2 }],
    { 'league-1': [{ id: 'final', playoff_round_number: 1, bracket_position: 0, team1_user_id: 'alice', team2_user_id: 'bob', team1_gain: null, winner_user_id: null }] },
    null,
  );
  const refusals = await healUncompletedSeasons(sb, null);
  assertEquals(refusals, []);
  assertEquals(sb.rpcCalls, []);
});

Deno.test('healUncompletedSeasons: a successfully completed league calls the rpc and reports no refusal', async () => {
  const sb = makeQueryableSupabase(
    [{ id: 'league-1', playoff_teams: 4 }],
    { 'league-1': [{ id: 'final', playoff_round_number: 2, bracket_position: 0, team1_user_id: 'alice', team2_user_id: 'bob', team1_gain: 5, winner_user_id: 'alice' }] },
    null,
  );
  const refusals = await healUncompletedSeasons(sb, null);
  assertEquals(refusals, []);
  assertEquals(sb.rpcCalls.length, 1);
});

Deno.test('healUncompletedSeasons: an invalid playoff_teams refuses distinctly, never throws or defaults to 4', async () => {
  const sb = makeQueryableSupabase([{ id: 'league-1', playoff_teams: null }], {}, null);
  const refusals = await healUncompletedSeasons(sb, null);
  assertEquals(refusals, [{ league_id: 'league-1', reason: 'invalid_playoff_teams: null' }]);
  assertEquals(sb.rpcCalls, []);
});

// Mutation-check: if the heal call were removed from the chain (or this
// function returned [] unconditionally), this file's own assertions on
// rpcCalls / refusals above would fail — there is no path here that passes
// vacuously. See supabase/tests/season_completion_heal.pglite.test.ts for the
// same mutation-check against a real Postgres instance.
//
// The structural check that index.ts actually WIRES this heal in (before the
// pending-matchup query) lives in supabase/tests/season_completion_wiring.test.ts,
// not here: it needs Deno.readTextFile, which would cost this whole directory
// its "deno test supabase/functions/ needs no --allow-* flags" contract
// (CLAUDE.md; see supabase/tests/README.md on why draft_insert_sites.test.ts's
// structural check lives outside supabase/functions/ for the same reason).
