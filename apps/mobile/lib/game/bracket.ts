/**
 * bracket (3c, the playoff bracket). The structure is the server's: each
 * playoff row carries its round (playoff_round_number) and its slot
 * (bracket_position). Round names come from lib/playoffs (never re-derived
 * here). The first-round byes are the TOP seeds (standings rank = seed), and
 * a bye has no round-1 game, so they are listed as byes, not as games.
 */
import { playoffPlan } from '../playoffs';

export interface BracketRow {
  playoff_round_number: number;
  bracket_position: number;
  team1_user_id: string | null;
  team2_user_id: string | null;
  team1_gain: number | null;
  team2_gain: number | null;
  winner_user_id: string | null;
}

export interface BracketStanding {
  user_id: string;
  rank: number;
  display_name: string;
}

export interface BracketSide {
  userId: string | null;
  name: string;
  /** The standings rank this team entered the playoffs with. */
  seed: number | null;
  gain: number | null;
}

export interface BracketGame {
  position: number;
  a: BracketSide | null;
  b: BracketSide | null;
  winnerUserId: string | null;
  scored: boolean;
}

export interface BracketRound {
  round: number;
  label: string;
  games: BracketGame[];
}

export interface Bracket {
  rounds: BracketRound[];
  /** First-round byes: the top seeds, who advance without a game. */
  byes: BracketSide[];
}

export function buildBracket(input: { rows: BracketRow[]; teams: number; standings: BracketStanding[] }): Bracket {
  const plan = playoffPlan(input.teams);
  if (!plan) return { rounds: [], byes: [] }; // no label we can name: show nothing rather than guess
  const nameOf = (id: string | null) => {
    if (id === null) return { name: '', seed: null as number | null };
    const st = input.standings.find((s) => s.user_id === id);
    return { name: st?.display_name ?? '', seed: st?.rank ?? null };
  };
  const side = (id: string | null, gain: number | null): BracketSide | null => {
    if (id === null) return null;
    const n = nameOf(id);
    return { userId: id, name: n.name, seed: n.seed, gain };
  };

  const rounds: BracketRound[] = [];
  for (let r = 1; r <= plan.weeks; r++) {
    const games = input.rows
      .filter((row) => row.playoff_round_number === r && row.team1_user_id !== null)
      .sort((x, y) => x.bracket_position - y.bracket_position)
      .map((row): BracketGame => ({
        position: row.bracket_position,
        a: side(row.team1_user_id, row.team1_gain),
        b: side(row.team2_user_id, row.team2_gain),
        winnerUserId: row.winner_user_id,
        scored: row.team1_gain !== null && (row.team2_user_id === null || row.team2_gain !== null),
      }));
    rounds.push({ round: r, label: plan.rounds[r - 1] ?? '', games });
  }

  // The top `byes` seeds are the first-round byes (no round-1 game).
  const byes: BracketSide[] = input.standings
    .filter((s) => s.rank <= plan.byes)
    .sort((x, y) => x.rank - y.rank)
    .map((s) => ({ userId: s.user_id, name: s.display_name, seed: s.rank, gain: null }));

  return { rounds, byes };
}
