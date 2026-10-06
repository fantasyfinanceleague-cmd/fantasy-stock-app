/**
 * Playoff bracket (3c). Rounds come from the server's playoff rows
 * (matchups.playoff_round_number, bracket_position); round names come from
 * lib/playoffs (never re-derived). First-round byes are the top seeds, and a
 * bye has no round-1 game. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { buildBracket, type BracketRow } from '../lib/game/bracket.ts';

const standings = [
  { user_id: 'roberto', rank: 1, display_name: 'Roberto B.' },
  { user_id: 'paolo', rank: 2, display_name: 'Paolo M.' },
  { user_id: 'alessandro', rank: 3, display_name: 'Alessandro D.' },
  { user_id: 'francesco', rank: 4, display_name: 'Francesco T.' },
  { user_id: 'gianluigi', rank: 5, display_name: 'Gianluigi B.' },
  { user_id: 'andrea', rank: 6, display_name: 'Andrea P.' },
];

const game = (round: number, pos: number, t1: string, t2: string, g1: number | null, g2: number | null, winner: string | null): BracketRow =>
  ({ playoff_round_number: round, bracket_position: pos, team1_user_id: t1, team2_user_id: t2, team1_gain: g1, team2_gain: g2, winner_user_id: winner });

Deno.test('4 teams: two rounds, no byes, labelled Semifinals and Final', () => {
  const rows = [
    game(1, 0, 'roberto', 'francesco', 288.1, 96.42, 'roberto'),
    game(1, 1, 'paolo', 'alessandro', -41.3, 120.55, 'alessandro'),
    game(2, 0, 'roberto', 'alessandro', null, null, null),
  ];
  const b = buildBracket({ rows, teams: 4, standings: standings.slice(0, 4) });
  assertEquals(b.rounds.map((r) => r.label), ['Semifinals', 'Final']);
  assertEquals(b.byes, []);
  assertEquals(b.rounds[0].games[0].winnerUserId, 'roberto');
  assertEquals(b.rounds[0].games[0].a!.seed, 1); // seeds follow the standings rank (the server's seeding rule)
});

Deno.test('6 teams: the top two seeds are first-round byes, labelled Wild card, with no round-1 game for them', () => {
  const rows = [
    game(1, 0, 'francesco', 'gianluigi', 84.2, 112.65, 'gianluigi'),
    game(1, 1, 'alessandro', 'andrea', 58.1, -21.4, 'alessandro'),
    game(2, 0, 'roberto', 'gianluigi', null, null, null),
    game(2, 1, 'paolo', 'alessandro', null, null, null),
  ];
  const b = buildBracket({ rows, teams: 6, standings });
  assertEquals(b.rounds.map((r) => r.label), ['Wild card', 'Semifinals', 'Final']);
  assertEquals(b.byes.map((x) => x.name), ['Roberto B.', 'Paolo M.']);
  assertEquals(b.rounds[0].games.length, 2); // only the real games are in round 1
  assertEquals(b.rounds[0].games.some((g) => g.a?.userId === 'roberto' || g.b?.userId === 'roberto'), false);
});

Deno.test('a playoff team count the bracket cannot name gives no rounds, never a made-up label', () => {
  const b = buildBracket({ rows: [], teams: 40, standings });
  assertEquals(b.rounds, []);
  assertEquals(b.byes, []);
});

Deno.test('a row with no team 1 is skipped, not thrown on', () => {
  const b = buildBracket({ rows: [game(1, 0, null as unknown as string, 'paolo', null, null, null)], teams: 4, standings });
  assertEquals(b.rounds[0].games.length, 0);
});
