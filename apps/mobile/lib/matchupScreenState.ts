// lib/matchupScreenState.ts
//
// Pure decision for what the Matchup tab (app/(tabs)/matchup.tsx) should
// render before any per-week matchup data is fetched. Extracted so the
// zero-league / cold-start branching can be unit tested without RN.
//
// Bug this fixes: the screen used to gate on `activeLeague?.league_type ===
// 'matchup'` alone. `activeLeague` is null in TWO different situations that
// need different UI:
//   1. The user genuinely has no leagues -> should say so, with a way in.
//   2. LeagueContext is still loading, or has leagues but hasn't finished
//      auto-selecting one into `activeLeagueId` yet (it always picks
//      leagues[0] once its fetch resolves) -> this is transient and should
//      show a loading state, not "Duration League".
// Both were previously indistinguishable from "this IS a duration league",
// because `undefined?.league_type === 'matchup'` is `false` in every case.

export type MatchupScreenState = 'leagues-loading' | 'no-league' | 'duration' | 'matchup';

export interface MatchupScreenInput {
  /** LeagueContext's `loading` flag (true while its initial fetch is in flight). */
  leaguesLoading: boolean;
  /** LeagueContext's `leagues.length`. */
  leagueCount: number;
  /** LeagueContext's `activeLeague` (null until one is selected). */
  activeLeague: { league_type?: string | null } | null;
}

export function getMatchupScreenState({
  leaguesLoading,
  leagueCount,
  activeLeague,
}: MatchupScreenInput): MatchupScreenState {
  if (activeLeague) {
    return activeLeague.league_type === 'matchup' ? 'matchup' : 'duration';
  }
  // No active league yet. If the context is still fetching, or it has
  // leagues it just hasn't auto-selected one from yet, this is transient.
  if (leaguesLoading || leagueCount > 0) {
    return 'leagues-loading';
  }
  return 'no-league';
}
