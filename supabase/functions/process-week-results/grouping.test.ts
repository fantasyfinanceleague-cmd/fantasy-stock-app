/**
 * Unit tests for groupMatchupsByLeagueWeek (see ./grouping.ts).
 *
 * These tests exist to lock in the fix for a real bug: the pre-fix handler
 * grouped pending matchups by league_id ALONE and hoisted weekNumber /
 * weekStart / weekEnd off matchups[0], so a league with matchups spanning
 * several pending weeks collapsed into ONE batch that scored every later
 * week against week[0]'s snapshots, trade window, and stale guard.
 *
 * The centerpiece is the DISCRIMINATOR test below: it runs the SAME shared
 * property checker against both the real function and a reconstruction of
 * the old buggy algorithm, and shows the property is GREEN for the new code
 * and RED for the old code on the same input.
 */

import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import { groupMatchupsByLeagueWeek, type MatchupBatch, type MatchupRow } from './grouping.ts';

// ---------------------------------------------------------------------------
// Test-data helper
// ---------------------------------------------------------------------------

let mkCounter = 0;

/**
 * Build a matchup row for a given (leagueId, week). week_start/week_end are
 * DERIVED from (leagueId, week) so every (league, week) pair has a distinct,
 * checkable window — tests can assert a batch carries the RIGHT week's
 * window, not merely A window. A couple of pass-through fields (id,
 * team1_user_id) are included by default to prove grouping doesn't drop
 * columns it never reads.
 */
function mk(leagueId: string, week: number, extra: Partial<MatchupRow> = {}): MatchupRow {
  mkCounter += 1;
  return {
    id: `${leagueId}-w${week}-${mkCounter}`,
    league_id: leagueId,
    week_number: week,
    week_start: `${leagueId}-w${week}-start`,
    week_end: `${leagueId}-w${week}-end`,
    team1_user_id: `${leagueId}-team1`,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Shared property checker — this is the contract both the old and the new
// grouping implementations are judged against.
// ---------------------------------------------------------------------------

/**
 * Asserts that `batches` is a well-formed grouping of `inputMatchups`:
 *   (i)   exactly one batch per DISTINCT (league_id, week_number) pair present
 *         in the input;
 *   (ii)  every batch's weekNumber/weekStart/weekEnd equal the week fields of
 *         its OWN member matchups, and every member matchup shares that same
 *         week_number (no batch mixes weeks);
 *   (iii) by construction of (ii) + the derived, distinct windows from mk(),
 *         a batch's weekStart/weekEnd match THAT week's window, not some
 *         other week's;
 *   (iv)  batches are ordered by (leagueId ASC via localeCompare, weekNumber
 *         ASC).
 */
function assertWellFormedBatches(batches: MatchupBatch[], inputMatchups: MatchupRow[]): void {
  const key = (leagueId: string, weekNumber: number) => `${leagueId}::${weekNumber}`;

  // (i) exactly one batch per distinct (league_id, week_number) pair present in input.
  const expectedKeys = [...new Set(inputMatchups.map((m) => key(m.league_id, m.week_number)))].sort();
  const actualKeys = batches.map((b) => key(b.leagueId, b.weekNumber));
  assertEquals(
    actualKeys.length,
    new Set(actualKeys).size,
    'batch keys must be unique — no duplicate (league,week) batches'
  );
  assertEquals(
    [...actualKeys].sort(),
    expectedKeys,
    'batches must cover exactly the distinct (league,week) pairs present in input, one each'
  );

  // (ii) + (iii) every member matchup belongs to its batch's week, and the
  // batch's window is that week's own window.
  for (const batch of batches) {
    assert(batch.matchups.length > 0, `batch ${key(batch.leagueId, batch.weekNumber)} must not be empty`);
    for (const m of batch.matchups) {
      assertEquals(
        m.league_id,
        batch.leagueId,
        `matchup ${String(m.id)} leagueId must match its batch's leagueId`
      );
      assertEquals(
        m.week_number,
        batch.weekNumber,
        `matchup ${String(m.id)} week_number must match its batch's weekNumber — a batch must not mix weeks`
      );
      assertEquals(
        batch.weekStart,
        m.week_start,
        `batch weekStart must equal its member matchup's own week_start (this week's window, not another week's)`
      );
      assertEquals(
        batch.weekEnd,
        m.week_end,
        `batch weekEnd must equal its member matchup's own week_end (this week's window, not another week's)`
      );
    }
  }

  // (iv) ordering: (leagueId ASC via localeCompare, weekNumber ASC).
  for (let i = 1; i < batches.length; i++) {
    const prev = batches[i - 1];
    const curr = batches[i];
    const cmp = prev.leagueId.localeCompare(curr.leagueId);
    assert(
      cmp < 0 || (cmp === 0 && prev.weekNumber < curr.weekNumber),
      `batches out of order at index ${i}: (${prev.leagueId}, ${prev.weekNumber}) must sort before (${curr.leagueId}, ${curr.weekNumber})`
    );
  }
}

// ---------------------------------------------------------------------------
// GREEN: one league, mixed weeks, fed out of order
// ---------------------------------------------------------------------------

Deno.test('groupMatchupsByLeagueWeek — GREEN: one league, mixed weeks 1/2/3', () => {
  const input = [
    mk('league-a', 2),
    mk('league-a', 1),
    mk('league-a', 3),
    mk('league-a', 2, { id: 'league-a-w2-extra' }), // second matchup in the same week
  ];

  const batches = groupMatchupsByLeagueWeek(input);
  assertWellFormedBatches(batches, input);
  assertEquals(batches.length, 3, 'one batch per distinct week, not one batch for the whole league');

  // Spot-check: the week-2 batch must carry week-2's own window, proving the
  // fields come from the week-2 matchups themselves and not from matchups[0]
  // (which here is a week-2 row anyway only by luck of construction below —
  // the real proof is the discriminator test, this is a sanity spot-check).
  const week2 = batches.find((b) => b.weekNumber === 2);
  assert(week2, 'expected a week-2 batch to exist');
  assertEquals(week2!.weekStart, 'league-a-w2-start');
  assertEquals(week2!.weekEnd, 'league-a-w2-end');
  assertEquals(week2!.matchups.length, 2, 'both week-2 matchups should land in the same batch');
  assert(
    week2!.matchups.every((m) => m.team1_user_id === 'league-a-team1'),
    'grouping must not drop pass-through columns like team1_user_id'
  );
});

// ---------------------------------------------------------------------------
// THE DISCRIMINATOR TEST
//
// This proves the property goes RED against the old grouping and GREEN
// against the new — it does not merely assert the new behavior.
// ---------------------------------------------------------------------------

/**
 * Reconstruction of the OLD, pre-fix handler logic: one batch per league_id
 * (week_number ignored as a grouping key), with weekNumber/weekStart/weekEnd
 * hoisted off the FIRST matchup encountered for that league — i.e.
 * matchups[0] for that league, exactly as the old handler did.
 */
function groupByLeagueOnly(matchups: MatchupRow[]): MatchupBatch[] {
  const batches = new Map<string, MatchupBatch>();

  for (const m of matchups) {
    let batch = batches.get(m.league_id);
    if (!batch) {
      batch = {
        leagueId: m.league_id,
        weekNumber: m.week_number,
        weekStart: m.week_start,
        weekEnd: m.week_end,
        matchups: [],
      };
      batches.set(m.league_id, batch);
    }
    batch.matchups.push(m);
  }

  return [...batches.values()].sort((a, b) => a.leagueId.localeCompare(b.leagueId));
}

Deno.test('property DISCRIMINATES old league-only grouping from new', () => {
  const input = [mk('league-a', 1), mk('league-a', 2), mk('league-a', 3)];

  // GREEN: the real function satisfies the well-formedness property.
  const newBatches = groupMatchupsByLeagueWeek(input);
  assertWellFormedBatches(newBatches, input);

  // RED: the old league-only algorithm fails the SAME property on the SAME input.
  assertThrows(() => assertWellFormedBatches(groupByLeagueOnly(input), input));

  // Concrete bug shape: the old grouping collapses the whole 3-week league
  // into ONE batch, and that batch's window is week-1's — i.e. weeks 2 and 3
  // would be scored against week 1's snapshots, mid-week trade window, and
  // stale guard.
  const oldBatches = groupByLeagueOnly(input);
  assertEquals(oldBatches.length, 1, 'old grouping collapses all pending weeks of a league into one batch');
  assertEquals(oldBatches[0].matchups.length, 3, 'the single old batch swallows all 3 weeks worth of matchups');
  assertEquals(oldBatches[0].weekNumber, 1);
  assertEquals(oldBatches[0].weekStart, 'league-a-w1-start');
  assertEquals(
    oldBatches[0].weekEnd,
    'league-a-w1-end',
    "old batch's weekEnd is week-1's window, not week-3's — later weeks would be scored against week-1's fields"
  );
});

// ---------------------------------------------------------------------------
// Multi-league
// ---------------------------------------------------------------------------

Deno.test('multi-league: two leagues x two weeks → 4 correctly-keyed batches', () => {
  const input = [mk('league-a', 1), mk('league-a', 2), mk('league-b', 1), mk('league-b', 2)];

  const batches = groupMatchupsByLeagueWeek(input);
  assertWellFormedBatches(batches, input);
  assertEquals(batches.length, 4);
  assertEquals(
    batches.map((b) => `${b.leagueId}::${b.weekNumber}`),
    ['league-a::1', 'league-a::2', 'league-b::1', 'league-b::2']
  );
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

Deno.test('ordering is normalized', () => {
  const input = [
    mk('league-b', 2),
    mk('league-a', 3),
    mk('league-b', 1),
    mk('league-a', 1),
  ];

  const batches = groupMatchupsByLeagueWeek(input);
  assertWellFormedBatches(batches, input);
  assertEquals(
    batches.map((b) => `${b.leagueId}::${b.weekNumber}`),
    ['league-a::1', 'league-a::3', 'league-b::1', 'league-b::2']
  );
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

Deno.test('edge cases', () => {
  // Empty input -> empty output.
  assertEquals(groupMatchupsByLeagueWeek([]), []);

  // Single (league, week) -> one batch, all input rows preserved in order.
  const row1 = mk('league-solo', 5, { id: 'solo-1' });
  const row2 = mk('league-solo', 5, { id: 'solo-2' });
  const batches = groupMatchupsByLeagueWeek([row1, row2]);
  assertWellFormedBatches(batches, [row1, row2]);
  assertEquals(batches.length, 1);
  assertEquals(batches[0].matchups, [row1, row2]);
});
