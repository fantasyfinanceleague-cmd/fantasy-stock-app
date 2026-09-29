/**
 * Hermetic tests for ./playoff-bracket.ts. No DB, no network, no flags:
 *
 *   deno test supabase/functions/_shared/playoff-bracket.test.ts
 *
 * The property tests run every P from 2 to 64 (W up to 6), well past today's
 * 16-manager league cap, so the math is proven independent of that cap.
 */
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert';
import {
  bracketSlotTable,
  type BracketGame,
  isValidPlayoffTeams,
  nextSlot,
  planBracket,
  playoffRoundCode,
  playoffRoundLabels,
  playoffShape,
  seedOrder,
  type SlotSource,
} from './playoff-bracket.ts';

const ALL_P = Array.from({ length: 63 }, (_, i) => i + 2); // 2..64

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

Deno.test("shape: Giorgio's examples (P -> weeks, byes)", () => {
  const cases: Array<[number, number, number]> = [
    [2, 1, 0], [3, 2, 1], [4, 2, 0], [5, 3, 3], [6, 3, 2], [7, 3, 1], [8, 3, 0], [10, 4, 6],
  ];
  for (const [p, weeks, byes] of cases) {
    const s = playoffShape(p);
    assertEquals([s.weeks, s.byes], [weeks, byes], `P=${p}`);
  }
});

Deno.test('shape: W = ceil(log2 P), byes = 2^W - P < 2^(W-1), games = P - 1', () => {
  for (const p of ALL_P) {
    const s = playoffShape(p);
    assertEquals(s.weeks, Math.ceil(Math.log2(p)), `P=${p}`);
    assertEquals(s.bracketSize, 2 ** s.weeks);
    assertEquals(s.byes, 2 ** s.weeks - p);
    assert(s.byes < 2 ** (s.weeks - 1), `P=${p}: a bye count this large would leave round 1 empty`);
    assertEquals(s.gamesPerRound.length, s.weeks);
    assertEquals(s.gamesPerRound.reduce((a, b) => a + b, 0), p - 1, `P=${p}`);
    assertEquals(s.totalGames, p - 1);
    assert(s.gamesPerRound[0] >= 1, `P=${p}: round 1 must have a real game`);
    assertEquals(s.gamesPerRound[s.weeks - 1], 1, `P=${p}: exactly one final`);
  }
});

Deno.test('shape: invalid P is refused', () => {
  for (const bad of [1, 0, -4, 2.5, NaN, Infinity]) {
    assert(!isValidPlayoffTeams(bad));
    assertThrows(() => playoffShape(bad), RangeError);
  }
  for (const bad of ['4', null, undefined, {}]) assert(!isValidPlayoffTeams(bad));
  assert(isValidPlayoffTeams(2) && isValidPlayoffTeams(16) && isValidPlayoffTeams(64));
});

// ---------------------------------------------------------------------------
// Seed placement
// ---------------------------------------------------------------------------

Deno.test('seedOrder: the design board display order', () => {
  assertEquals(seedOrder(2), [1, 2]);
  assertEquals(seedOrder(4), [1, 4, 3, 2]);
  assertEquals(seedOrder(8), [1, 8, 5, 4, 3, 6, 7, 2]);
  assertEquals(seedOrder(16), [1, 16, 9, 8, 5, 12, 13, 4, 3, 14, 11, 6, 7, 10, 15, 2]);
  for (const bad of [0, 1, 3, 6, 12]) assertThrows(() => seedOrder(bad), RangeError);
});

/** The textbook order (1,8,4,5,2,7,3,6): [1] -> each s becomes [s, 2n+1-s]. */
function textbookOrder(size: number): number[] {
  let o = [1];
  while (o.length < size) {
    const n2 = o.length * 2;
    o = o.flatMap((s) => [s, n2 + 1 - s]);
  }
  return o;
}

/** Which seeds share a game, round by round, ignoring vertical position. */
function topology(order: number[]): string[] {
  const out: string[] = [];
  let groups = order.map((s) => [s]);
  while (groups.length > 1) {
    const next: number[][] = [];
    for (let i = 0; i < groups.length; i += 2) next.push([...groups[i], ...groups[i + 1]].sort((a, b) => a - b));
    out.push(next.map((g) => g.join(',')).sort().join('|'));
    groups = next;
  }
  return out;
}

Deno.test('seedOrder pairs teams exactly like the textbook bracket (only the drawing differs)', () => {
  for (let w = 1; w <= 6; w++) assertEquals(topology(seedOrder(2 ** w)), topology(textbookOrder(2 ** w)), `size ${2 ** w}`);
});

Deno.test('seedOrder: every line pair sums to size+1 (seed s always opens against size+1-s)', () => {
  for (let w = 1; w <= 6; w++) {
    const o = seedOrder(2 ** w);
    for (let i = 0; i < o.length; i += 2) assertEquals(o[i] + o[i + 1], o.length + 1);
  }
});

// ---------------------------------------------------------------------------
// The bracket: structural properties for every P
// ---------------------------------------------------------------------------

const key = (round: number, position: number) => `${round}:${position}`;
const seedsIn = (g: BracketGame) => [g.team1, g.team2].filter((s): s is Extract<SlotSource, { kind: 'seed' }> => s.kind === 'seed').map((s) => s.seed);

Deno.test('bracket: P-1 games, per-round counts, unique in-range positions', () => {
  for (const p of ALL_P) {
    const s = playoffShape(p);
    const games = planBracket(p);
    assertEquals(games.length, p - 1, `P=${p}`);
    for (let r = 1; r <= s.weeks; r++) {
      const round = games.filter((g) => g.round === r);
      assertEquals(round.length, s.gamesPerRound[r - 1], `P=${p} round ${r}`);
      const positions = round.map((g) => g.position);
      assertEquals(new Set(positions).size, positions.length, `P=${p} round ${r}: duplicate position`);
      for (const pos of positions) assert(pos >= 0 && pos < 2 ** (s.weeks - r), `P=${p} round ${r} position ${pos}`);
    }
    // ordered by round, then position
    const sorted = [...games].sort((a, b) => a.round - b.round || a.position - b.position);
    assertEquals(games, sorted);
  }
});

Deno.test('bracket: every seed enters exactly once; seeds 1..byes never play round 1', () => {
  for (const p of ALL_P) {
    const { byes } = playoffShape(p);
    const games = planBracket(p);
    const all = games.flatMap(seedsIn).sort((a, b) => a - b);
    assertEquals(all, Array.from({ length: p }, (_, i) => i + 1), `P=${p}: each seed once`);

    const round1 = games.filter((g) => g.round === 1).flatMap(seedsIn).sort((a, b) => a - b);
    assertEquals(round1, Array.from({ length: p - byes }, (_, i) => byes + 1 + i), `P=${p}: round 1 = seeds byes+1..P`);

    // Bye seeds enter in round 2, and seeds enter nowhere later than round 2.
    const round2 = games.filter((g) => g.round === 2).flatMap(seedsIn).sort((a, b) => a - b);
    assertEquals(round2, Array.from({ length: byes }, (_, i) => i + 1), `P=${p}: byes = top seeds, into round 2`);
    for (const g of games.filter((g) => g.round > 2)) assertEquals(seedsIn(g), [], `P=${p}: no seed enters after round 2`);

    // Round 1: higher seed (lower number) is team1, and every game is fully seeded.
    for (const g of games.filter((g) => g.round === 1)) {
      assert(g.team1.kind === 'seed' && g.team2.kind === 'seed', `P=${p}: round 1 must be fully seeded`);
      assert(g.team1.seed < g.team2.seed);
      assertEquals(g.team1.seed + g.team2.seed, playoffShape(p).bracketSize + 1, 'seed s opens against size+1-s');
    }
  }
});

Deno.test('bracket: every winner feeds exactly one slot, every winner-slot has exactly one feeder, one final', () => {
  for (const p of ALL_P) {
    const { weeks } = playoffShape(p);
    const games = planBracket(p);
    const byKey = new Map(games.map((g) => [key(g.round, g.position), g]));

    const fed = new Map<string, number>();
    for (const g of games) {
      const next = nextSlot(g.round, g.position, weeks);
      if (g.round === weeks) {
        assertEquals(next, null);
        continue;
      }
      assert(next, `P=${p}: non-final game must advance`);
      const target = byKey.get(key(next.round, next.position));
      assert(target, `P=${p}: ${key(g.round, g.position)} advances into a missing game ${key(next.round, next.position)}`);
      assertEquals(target[next.slot], { kind: 'winner', round: g.round, position: g.position }, `P=${p}`);
      const k = `${key(next.round, next.position)}.${next.slot}`;
      fed.set(k, (fed.get(k) ?? 0) + 1);
    }
    // Every 'winner' slot is fed by exactly one existing game.
    for (const g of games) {
      for (const slot of ['team1', 'team2'] as const) {
        const src = g[slot];
        if (src.kind !== 'winner') continue;
        assert(byKey.has(key(src.round, src.position)), `P=${p}: slot fed by a missing game`);
        assertEquals(src.round, g.round - 1, `P=${p}: feeder must be the previous round`);
        assertEquals(fed.get(`${key(g.round, g.position)}.${slot}`), 1, `P=${p}`);
      }
    }
    const finals = games.filter((g) => g.round === weeks);
    assertEquals(finals.map((g) => g.position), [0], `P=${p}: exactly one final`);
  }
});

// ---------------------------------------------------------------------------
// Simulated tournaments: every week, every alive team plays or has an earned
// bye; nobody plays twice in a week; one champion after W weeks.
// ---------------------------------------------------------------------------

type Pick = (a: number, b: number, round: number) => number;
const higherSeedWins: Pick = (a, b) => Math.min(a, b);
const lowerSeedWins: Pick = (a, b) => Math.max(a, b);
/** A pseudo-random result that depends only on the pairing, never on the
 * order games are processed, so a reversed pass must reproduce it exactly. */
function hashed(salt: number): Pick {
  return (a, b, round) => {
    let x = (Math.min(a, b) * 73856093) ^ (Math.max(a, b) * 19349663) ^ (round * 83492791) ^ (salt * 2654435761);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return ((x ^ (x >>> 16)) & 1) === 0 ? a : b;
  };
}

function simulate(p: number, pick: Pick, reverseOrder = false): { champion: number; weeks: number } {
  const { weeks, byes } = playoffShape(p);
  const games = planBracket(p);
  const winners = new Map<string, number>();
  const resolve = (s: SlotSource) => (s.kind === 'seed' ? s.seed : winners.get(key(s.round, s.position)));
  let alive = new Set(Array.from({ length: p }, (_, i) => i + 1));

  for (let r = 1; r <= weeks; r++) {
    const round = games.filter((g) => g.round === r);
    if (reverseOrder) round.reverse(); // processing order must not matter (D1)
    const playing: number[] = [];
    for (const g of round) {
      const a = resolve(g.team1), b = resolve(g.team2);
      assert(a !== undefined && b !== undefined, `P=${p} round ${r}: a slot is unfilled when its week starts`);
      assert(alive.has(a) && alive.has(b), `P=${p} round ${r}: an eliminated team is playing`);
      playing.push(a, b);
      const w = pick(a, b, r);
      winners.set(key(g.round, g.position), w);
      alive.delete(w === a ? b : a);
    }
    assertEquals(new Set(playing).size, playing.length, `P=${p} round ${r}: a team plays twice in one week`);
    if (r === 1) {
      // Round 1: the players plus the bye seeds are exactly the whole field.
      const idle = Array.from({ length: p }, (_, i) => i + 1).filter((t) => !playing.includes(t));
      assertEquals(idle, Array.from({ length: byes }, (_, i) => i + 1), `P=${p}: only the top ${byes} seeds sit round 1 out`);
    } else {
      // Later rounds: no byes; every alive team at the start of the week played.
      assertEquals(playing.length, 2 * round.length);
    }
  }
  assertEquals(alive.size, 1, `P=${p}: exactly one champion`);
  return { champion: [...alive][0], weeks };
}

Deno.test('simulation: higher seed always wins -> seed 1 is champion in W weeks', () => {
  for (const p of ALL_P) assertEquals(simulate(p, higherSeedWins).champion, 1, `P=${p}`);
});

Deno.test('simulation: lower seed always wins -> the lowest seed that plays round 1 wins it all', () => {
  for (const p of ALL_P) assertEquals(simulate(p, lowerSeedWins).champion, p, `P=${p}`);
});

Deno.test('simulation: pseudo-random results; reversed processing order gives the identical tournament', () => {
  const champions = new Set<number>();
  for (const p of ALL_P) {
    for (const salt of [1, 7, 42, 1234]) {
      const fwd = simulate(p, hashed(salt));
      assertEquals(simulate(p, hashed(salt), true), fwd, `P=${p} salt ${salt}`);
      champions.add(fwd.champion);
    }
  }
  assert(champions.size > 10, 'the hashed picker must actually produce varied champions');
});

// ---------------------------------------------------------------------------
// Golden: Giorgio's P=6 example, the full slot table, nextSlot
// ---------------------------------------------------------------------------

Deno.test("golden: P=6 is Giorgio's example (3v6 and 4v5; 1 and 2 bye; then 1 v W(4v5), 2 v W(3v6))", () => {
  assertEquals(planBracket(6), [
    { round: 1, position: 1, team1: { kind: 'seed', seed: 4 }, team2: { kind: 'seed', seed: 5 } },
    { round: 1, position: 2, team1: { kind: 'seed', seed: 3 }, team2: { kind: 'seed', seed: 6 } },
    { round: 2, position: 0, team1: { kind: 'seed', seed: 1 }, team2: { kind: 'winner', round: 1, position: 1 } },
    { round: 2, position: 1, team1: { kind: 'winner', round: 1, position: 2 }, team2: { kind: 'seed', seed: 2 } },
    { round: 3, position: 0, team1: { kind: 'winner', round: 2, position: 0 }, team2: { kind: 'winner', round: 2, position: 1 } },
  ]);
});

Deno.test('golden: P=4 and P=8 keep the current prod bracket pairings', () => {
  assertEquals(bracketSlotTable(4), 'P=4 W2 b0  #0 1v4  #1 2v3');
  assertEquals(bracketSlotTable(8), 'P=8 W3 b0  #0 1v8  #1 4v5  #2 3v6  #3 2v7');
  // 8 teams: 1/8 meets 4/5, 3/6 meets 2/7 in the semis.
  const semis = planBracket(8).filter((g) => g.round === 2);
  assertEquals(semis.map((g) => [g.team1, g.team2]), [
    [{ kind: 'winner', round: 1, position: 0 }, { kind: 'winner', round: 1, position: 1 }],
    [{ kind: 'winner', round: 1, position: 2 }, { kind: 'winner', round: 1, position: 3 }],
  ]);
});

Deno.test('golden: the slot table in the module header, P=2..16', () => {
  assertEquals(Array.from({ length: 15 }, (_, i) => bracketSlotTable(i + 2)), [
    'P=2 W1 b0  #0 1v2',
    'P=3 W2 b1  #1 2v3  | 1->R2#0.t1',
    'P=4 W2 b0  #0 1v4  #1 2v3',
    'P=5 W3 b3  #1 4v5  | 1->R2#0.t1  3->R2#1.t1  2->R2#1.t2',
    'P=6 W3 b2  #1 4v5  #2 3v6  | 1->R2#0.t1  2->R2#1.t2',
    'P=7 W3 b1  #1 4v5  #2 3v6  #3 2v7  | 1->R2#0.t1',
    'P=8 W3 b0  #0 1v8  #1 4v5  #2 3v6  #3 2v7',
    'P=9 W4 b7  #1 8v9  | 1->R2#0.t1  5->R2#1.t1  4->R2#1.t2  3->R2#2.t1  6->R2#2.t2  7->R2#3.t1  2->R2#3.t2',
    'P=10 W4 b6  #1 8v9  #6 7v10  | 1->R2#0.t1  5->R2#1.t1  4->R2#1.t2  3->R2#2.t1  6->R2#2.t2  2->R2#3.t2',
    'P=11 W4 b5  #1 8v9  #5 6v11  #6 7v10  | 1->R2#0.t1  5->R2#1.t1  4->R2#1.t2  3->R2#2.t1  2->R2#3.t2',
    'P=12 W4 b4  #1 8v9  #2 5v12  #5 6v11  #6 7v10  | 1->R2#0.t1  4->R2#1.t2  3->R2#2.t1  2->R2#3.t2',
    'P=13 W4 b3  #1 8v9  #2 5v12  #3 4v13  #5 6v11  #6 7v10  | 1->R2#0.t1  3->R2#2.t1  2->R2#3.t2',
    'P=14 W4 b2  #1 8v9  #2 5v12  #3 4v13  #4 3v14  #5 6v11  #6 7v10  | 1->R2#0.t1  2->R2#3.t2',
    'P=15 W4 b1  #1 8v9  #2 5v12  #3 4v13  #4 3v14  #5 6v11  #6 7v10  #7 2v15  | 1->R2#0.t1',
    'P=16 W4 b0  #0 1v16  #1 8v9  #2 5v12  #3 4v13  #4 3v14  #5 6v11  #6 7v10  #7 2v15',
  ]);
});

Deno.test('nextSlot: parity decides the slot; the final has no next; out of range throws', () => {
  assertEquals(nextSlot(1, 0, 3), { round: 2, position: 0, slot: 'team1' });
  assertEquals(nextSlot(1, 1, 3), { round: 2, position: 0, slot: 'team2' });
  assertEquals(nextSlot(1, 3, 3), { round: 2, position: 1, slot: 'team2' });
  assertEquals(nextSlot(2, 1, 3), { round: 3, position: 0, slot: 'team2' });
  assertEquals(nextSlot(3, 0, 3), null);
  assertEquals(nextSlot(1, 0, 1), null); // P=2: round 1 is the final
  for (const [r, p, w] of [[0, 0, 3], [4, 0, 3], [1, 4, 3], [2, 2, 3], [1, -1, 3], [1.5, 0, 3]]) {
    assertThrows(() => nextSlot(r, p, w), RangeError);
  }
});

// ---------------------------------------------------------------------------
// Round names (DECIDED, Giorgio 2026-09-29) and the structural round code
// ---------------------------------------------------------------------------

Deno.test('labels: all 15 league sizes, pinned', () => {
  const expected: Record<number, string> = {
    2: 'Final',
    3: 'Wild card · Final',
    4: 'Semifinals · Final',
    5: 'Wild card · Semifinals · Final',
    6: 'Wild card · Semifinals · Final',
    7: 'Wild card · Semifinals · Final',
    8: 'Quarterfinals · Semifinals · Final',
    9: 'Wild card · Quarterfinals · Semifinals · Final',
    10: 'Wild card · Quarterfinals · Semifinals · Final',
    11: 'Wild card · Quarterfinals · Semifinals · Final',
    12: 'Wild card · Quarterfinals · Semifinals · Final',
    13: 'Wild card · Quarterfinals · Semifinals · Final',
    14: 'Wild card · Quarterfinals · Semifinals · Final',
    15: 'Wild card · Quarterfinals · Semifinals · Final',
    16: 'Round of 16 · Quarterfinals · Semifinals · Final',
  };
  for (let p = 2; p <= 16; p++) {
    const labels = playoffRoundLabels(p);
    assert(labels, `P=${p}`);
    assertEquals(labels.length, playoffShape(p).weeks);
    assertEquals(labels.join(' · '), expected[p], `P=${p}`);
  }
});

Deno.test('labels: null beyond the named rounds (W > 4) and for an invalid P', () => {
  for (const p of [17, 32, 64]) assertEquals(playoffRoundLabels(p), null);
  for (const p of [1, 0, 2.5, NaN]) assertEquals(playoffRoundLabels(p), null);
});

Deno.test('round code: structural, by distance from the final', () => {
  assertEquals(playoffRoundCode(1, 1), 'finals');
  assertEquals([1, 2].map((r) => playoffRoundCode(r, 2)), ['semi', 'finals']);
  assertEquals([1, 2, 3].map((r) => playoffRoundCode(r, 3)), ['quarter', 'semi', 'finals']);
  assertEquals([1, 2, 3, 4].map((r) => playoffRoundCode(r, 4)), ['round_of_16', 'quarter', 'semi', 'finals']);
  for (const [r, w] of [[0, 3], [4, 3], [1, 5], [1.5, 3]]) assertThrows(() => playoffRoundCode(r, w), RangeError);
});
