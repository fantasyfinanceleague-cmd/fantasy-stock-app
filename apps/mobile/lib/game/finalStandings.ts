/**
 * Final standings (game-screens gate GS-4; Giorgio, option A, 2026-10-10, PRODUCT_RULES
 * "Scoring and standings"): once the season is over, the medals follow the playoffs.
 * The champion is 1st (gold, "Champion"), the Final's loser 2nd (silver, "Runner-up"),
 * the better-seeded of the two semifinal losers 3rd (bronze); everyone else keeps their
 * regular-season order. Records and season gains stay the regular season's; the
 * Playoffs tab keeps the seeding. League › Standings, League › History and the
 * season-complete card all read their order from here, so they tell one story.
 *
 * Pure: the regular-season order stays the server's (league_standings_ranked, or a
 * season's frozen final_standings); this only lifts the podium to the top. A bracket
 * that is not fully decided gives NO podium (null), never a partial one: a caller then
 * shows no medals rather than medals the playoffs haven't earned.
 */
import { playoffPlan } from '../playoffs';

/** One playoff game, as the matchups table (or get_season_matchups) has it. */
export interface PodiumGameRow {
  playoff_round_number: number | null;
  team1_user_id: string | null;
  team2_user_id: string | null;
  winner_user_id: string | null;
}

export interface Podium {
  champion: string;
  runnerUp: string;
  /** The better-seeded semifinal loser; null when the bracket has no round before the Final. */
  third: string | null;
}

export interface PodiumCheck {
  /** The league's playoff team count: the Final must be the plan's last round. */
  teams?: number | null;
  /** The server's champion (a finished season's record): the Final's winner must match. */
  championId?: string | null;
}

/** The podium from a FINISHED bracket, or null when it can't be proven. `seedOf` is the
 * regular-season rank (the seeding). At least one of `check.teams` / `check.championId`
 * is required, so the last round read is known to be the Final, not merely the latest
 * round written so far. */
export function playoffPodium(rows: readonly PodiumGameRow[], seedOf: (userId: string) => number | null, check: PodiumCheck): Podium | null {
  const plan = check.teams != null ? playoffPlan(check.teams) : null;
  if (!plan && !check.championId) return null;
  const games = rows.filter((r) => r.playoff_round_number !== null && r.team1_user_id !== null);
  if (games.length === 0) return null;
  const lastRound = Math.max(...games.map((r) => r.playoff_round_number as number));
  if (plan && lastRound !== plan.weeks) return null;

  const finals = games.filter((r) => r.playoff_round_number === lastRound);
  if (finals.length !== 1) return null;
  const final = finals[0];
  const champion = final.winner_user_id;
  if (!champion || !final.team2_user_id || (champion !== final.team1_user_id && champion !== final.team2_user_id)) return null;
  if (check.championId && check.championId !== champion) return null;
  const runnerUp = champion === final.team1_user_id ? final.team2_user_id : final.team1_user_id!;

  // The round before the Final: its losers are the semifinal losers (in a 3-team
  // bracket that is the wild card's one loser). Every one of its games must be decided.
  let third: string | null = null;
  if (lastRound > 1) {
    const semis = games.filter((r) => r.playoff_round_number === lastRound - 1);
    if (semis.length === 0) return null;
    const losers: string[] = [];
    for (const g of semis) {
      if (!g.team2_user_id) continue; // a side with no opponent has no loser
      if (!g.winner_user_id || (g.winner_user_id !== g.team1_user_id && g.winner_user_id !== g.team2_user_id)) return null;
      losers.push(g.winner_user_id === g.team1_user_id ? g.team2_user_id : g.team1_user_id!);
    }
    const seeded = losers
      .map((id) => ({ id, seed: seedOf(id) }))
      .filter((l): l is { id: string; seed: number } => l.seed !== null)
      .sort((a, b) => a.seed - b.seed);
    // Every loser needs a seed to say which is "better-seeded"; one we can't place is no podium.
    if (seeded.length !== losers.length) return null;
    third = seeded[0]?.id ?? null;
  }
  return { champion, runnerUp, third };
}

export type PodiumTag = 'Champion' | 'Runner-up';

export interface FinalPlace<T> {
  row: T;
  /** 1-based place in the final standings: the medal follows it. */
  place: number;
  tag: PodiumTag | null;
}

/** The final standings: the podium on top, then everyone else in the regular-season
 * order given. Null when a podium manager isn't in `rows` (a mismatch is not guessed at). */
export function finalStandingsOrder<T>(rows: readonly T[], idOf: (row: T) => string, podium: Podium): FinalPlace<T>[] | null {
  const top = [podium.champion, podium.runnerUp, ...(podium.third ? [podium.third] : [])];
  const byId = new Map(rows.map((r) => [idOf(r), r]));
  if (top.some((id) => !byId.has(id))) return null;
  const rest = rows.filter((r) => !top.includes(idOf(r)));
  const ordered = [...top.map((id) => byId.get(id) as T), ...rest];
  return ordered.map((row, i) => ({
    row,
    place: i + 1,
    tag: i === 0 ? 'Champion' : i === 1 ? 'Runner-up' : null,
  }));
}

/** Your place in the final standings (the season-complete card's headline), or null. */
export function finalPlaceOf<T>(rows: readonly T[], idOf: (row: T) => string, podium: Podium | null, userId: string): number | null {
  if (!podium) return null;
  const order = finalStandingsOrder(rows, idOf, podium);
  return order?.find((p) => idOf(p.row) === userId)?.place ?? null;
}

/** The season-complete card's headline place ("Champion" / "2nd place" / …), from the
 * same order as League › Standings (GS-4: "every screen tells the same story"). The
 * server's own podium answer wins for 1st and 2nd; anyone else's place needs the
 * finished bracket. Null while it can't be proven: the card then shows no place rather
 * than the regular-season one, which put "1st place" on the manager who lost the Final. */
export function seasonCompletePlace(input: {
  myUserId: string;
  regularRank: number;
  standings: readonly { user_id: string; rank: number }[];
  playoffTeams: number | null;
  playoffResult: 'champion' | 'runner_up' | 'eliminated' | 'missed' | null;
  bracketStatus: 'idle' | 'loading' | 'ready' | 'error';
  playoffRows: readonly PodiumGameRow[];
}): number | null {
  if (!input.playoffTeams || input.playoffTeams < 2) return input.regularRank > 0 ? input.regularRank : null;
  if (input.playoffResult === 'champion') return 1;
  if (input.playoffResult === 'runner_up') return 2;
  if (input.bracketStatus !== 'ready') return null;
  const ordered = input.standings.slice().sort((a, b) => a.rank - b.rank);
  const seed = new Map(ordered.map((s) => [s.user_id, s.rank]));
  const podium = playoffPodium(input.playoffRows, (id) => seed.get(id) ?? null, { teams: input.playoffTeams });
  return finalPlaceOf(ordered, (s) => s.user_id, podium, input.myUserId);
}
