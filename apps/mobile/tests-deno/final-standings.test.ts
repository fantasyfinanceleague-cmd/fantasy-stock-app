/**
 * Final standings (GS-4; Giorgio, option A, 2026-10-10): once the season is over the
 * medals follow the playoffs. Champion 1st, the Final's loser 2nd, the better-seeded
 * semifinal loser 3rd, everyone else in regular-season order. A bracket that isn't
 * fully decided gives no podium at all (never a partial one).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { finalPlaceOf, finalStandingsOrder, playoffPodium, seasonCompletePlace, type PodiumGameRow } from '../lib/game/finalStandings.ts';

const g = (round: number, t1: string, t2: string | null, winner: string | null): PodiumGameRow =>
  ({ playoff_round_number: round, team1_user_id: t1, team2_user_id: t2, winner_user_id: winner });
const seeds = (order: string[]) => (id: string) => { const i = order.indexOf(id); return i < 0 ? null : i + 1; };
const ids = (order: string[]) => order.map((id) => ({ user_id: id }));
const names = (places: { row: { user_id: string } }[]) => places.map((p) => p.row.user_id);

// A normal 4-team bracket, no byes: semis 1v4, 2v3; the Final 3 beats 1.
const REG4 = ['a', 'b', 'c', 'd'];
const BRACKET4 = [g(1, 'a', 'd', 'a'), g(1, 'b', 'c', 'c'), g(2, 'a', 'c', 'c')];

Deno.test('4 teams, no byes: champion, runner-up, then the better-seeded semifinal loser', () => {
  const podium = playoffPodium(BRACKET4, seeds(REG4), { teams: 4 });
  assertEquals(podium, { champion: 'c', runnerUp: 'a', third: 'b' }); // b (seed 2) over d (seed 4)
  const order = finalStandingsOrder(ids(REG4), (r) => r.user_id, podium!)!;
  assertEquals(names(order), ['c', 'a', 'b', 'd']);
  assertEquals(order.map((p) => p.tag), ['Champion', 'Runner-up', null, null]);
  assertEquals(order.map((p) => p.place), [1, 2, 3, 4]);
});

Deno.test('6 teams with byes (the board\'s Summer Cup): everyone outside the podium keeps regular-season order', () => {
  // Seeds 1–2 bye. Wild card: 3 beats 6, 4 beats 5. Semis: 1 beats 4, 2 beats 3. Final: 2 beats 1.
  const reg = ['paolo', 'roberto', 'alessandro', 'francesco', 'gianluigi', 'andrea'];
  const rows = [
    g(1, 'alessandro', 'andrea', 'alessandro'), g(1, 'francesco', 'gianluigi', 'francesco'),
    g(2, 'paolo', 'francesco', 'paolo'), g(2, 'roberto', 'alessandro', 'roberto'),
    g(3, 'roberto', 'paolo', 'roberto'),
  ];
  const podium = playoffPodium(rows, seeds(reg), { teams: 6 })!;
  assertEquals(podium, { champion: 'roberto', runnerUp: 'paolo', third: 'alessandro' });
  assertEquals(names(finalStandingsOrder(ids(reg), (r) => r.user_id, podium)!), ['roberto', 'paolo', 'alessandro', 'francesco', 'gianluigi', 'andrea']);
});

Deno.test('an odd 3-team bracket: the bye seed reaches the Final; the wild card\'s loser is 3rd', () => {
  const reg = ['x', 'y', 'z', 'w'];
  const rows = [g(1, 'y', 'z', 'z'), g(2, 'x', 'z', 'x')];
  const podium = playoffPodium(rows, seeds(reg), { teams: 3 })!;
  assertEquals(podium, { champion: 'x', runnerUp: 'z', third: 'y' });
  assertEquals(names(finalStandingsOrder(ids(reg), (r) => r.user_id, podium)!), ['x', 'z', 'y', 'w']);
});

Deno.test('a 5-team bracket where the 3rd place comes from a semifinal against a bye seed', () => {
  // 5 teams: 3 byes (seeds 1–3); wild card 4 beats 5. Semis: 1 beats 4, 3 beats 2. Final: 3 beats 1.
  const reg = ['s1', 's2', 's3', 's4', 's5', 's6'];
  const rows = [g(1, 's4', 's5', 's4'), g(2, 's1', 's4', 's1'), g(2, 's2', 's3', 's3'), g(3, 's1', 's3', 's3')];
  const podium = playoffPodium(rows, seeds(reg), { teams: 5 })!;
  assertEquals(podium, { champion: 's3', runnerUp: 's1', third: 's2' }); // s2 (seed 2) over s4
  assertEquals(names(finalStandingsOrder(ids(reg), (r) => r.user_id, podium)!), ['s3', 's1', 's2', 's4', 's5', 's6']);
});

Deno.test('2 teams: the Final is the only round, so there is no bronze', () => {
  const podium = playoffPodium([g(1, 'a', 'b', 'b')], seeds(['a', 'b', 'c']), { teams: 2 })!;
  assertEquals(podium, { champion: 'b', runnerUp: 'a', third: null });
  const order = finalStandingsOrder(ids(['a', 'b', 'c']), (r) => r.user_id, podium)!;
  assertEquals(names(order), ['b', 'a', 'c']);
  assertEquals(order[2].tag, null);
});

Deno.test('the regular-season champion who also wins the playoffs: the top two still follow the Final', () => {
  const podium = playoffPodium([g(1, 'a', 'd', 'a'), g(1, 'b', 'c', 'b'), g(2, 'a', 'b', 'a')], seeds(REG4), { teams: 4 })!;
  assertEquals(names(finalStandingsOrder(ids(REG4), (r) => r.user_id, podium)!), ['a', 'b', 'c', 'd']);
});

Deno.test('no podium from a bracket that isn\'t finished (partial state is never read as done)', () => {
  // Semis decided, Final not written yet.
  assertEquals(playoffPodium(BRACKET4.slice(0, 2), seeds(REG4), { teams: 4 }), null);
  // Final written, not scored.
  assertEquals(playoffPodium([...BRACKET4.slice(0, 2), g(2, 'a', 'c', null)], seeds(REG4), { teams: 4 }), null);
  // One semifinal undecided.
  assertEquals(playoffPodium([g(1, 'a', 'd', 'a'), g(1, 'b', 'c', null), g(2, 'a', 'c', 'c')], seeds(REG4), { teams: 4 }), null);
  // A 3-team bracket with only its wild card written: one decided game is NOT the Final.
  assertEquals(playoffPodium([g(1, 'y', 'z', 'z')], seeds(['x', 'y', 'z']), { teams: 3 }), null);
  // No rows, or nothing to check the last round against.
  assertEquals(playoffPodium([], seeds(REG4), { teams: 4 }), null);
  assertEquals(playoffPodium(BRACKET4, seeds(REG4), {}), null);
});

Deno.test('History\'s check: the Final\'s winner must be the server\'s champion', () => {
  assertEquals(playoffPodium(BRACKET4, seeds(REG4), { championId: 'c' })?.champion, 'c');
  assertEquals(playoffPodium(BRACKET4, seeds(REG4), { championId: 'a' }), null);
});

Deno.test('a podium manager missing from the standings gives no order, not a guessed one', () => {
  assertEquals(finalStandingsOrder(ids(['a', 'b']), (r) => r.user_id, { champion: 'c', runnerUp: 'a', third: null }), null);
});

Deno.test('finalPlaceOf: your place for the season-complete card', () => {
  const podium = playoffPodium(BRACKET4, seeds(REG4), { teams: 4 });
  assertEquals(finalPlaceOf(ids(REG4), (r) => r.user_id, podium, 'a'), 2);
  assertEquals(finalPlaceOf(ids(REG4), (r) => r.user_id, podium, 'd'), 4);
  assertEquals(finalPlaceOf(ids(REG4), (r) => r.user_id, null, 'a'), null);
});

Deno.test('seasonCompletePlace: the card\'s place follows the playoffs, never the regular-season rank', () => {
  const standings = REG4.map((user_id, i) => ({ user_id, rank: i + 1 }));
  const base = { standings, playoffTeams: 4, playoffResult: null, bracketStatus: 'ready' as const, playoffRows: BRACKET4 };
  // b was 2nd in the regular season and lost a semifinal as the better seed: 3rd.
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'b', regularRank: 2, playoffResult: 'eliminated' }), 3);
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'd', regularRank: 4, playoffResult: 'eliminated' }), 4);
  // The server's podium answer: a, the 1st seed, lost the Final: "2nd place", not "1st place".
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'a', regularRank: 1, playoffResult: 'runner_up', bracketStatus: 'loading', playoffRows: [] }), 2);
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'c', regularRank: 3, playoffResult: 'champion', bracketStatus: 'error', playoffRows: [] }), 1);
  // Not provable yet (or the read failed): no place, rather than the regular-season one.
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'b', regularRank: 2, bracketStatus: 'loading', playoffRows: [] }), null);
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'b', regularRank: 2, bracketStatus: 'error', playoffRows: [] }), null);
  // A league with no playoffs: the regular season decided it.
  assertEquals(seasonCompletePlace({ ...base, myUserId: 'b', regularRank: 2, playoffTeams: null }), 2);
});
