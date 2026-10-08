/**
 * League tab routing (3c): which screen the League tab shows, by the league's phase.
 * The phase is getSeasonPhase's (T0-correct). A renewed league before its draft is
 * Run it back's screen; a pre-draft league is the lobby. A season in progress, its
 * playoffs, and a season that is over show the season's view; the commissioner of a
 * finished season also gets the Run it back strip. Pure, so the routing is tested.
 */
import type { SeasonPhase } from '../weekStatus';

export type LeagueScreen = 'lobby' | 'renewal' | 'draft_room' | 'season' | 'placeholder';

export function leagueScreenFor(input: { phase: SeasonPhase; isRenewal: boolean }): LeagueScreen {
  switch (input.phase) {
    case 'pre_draft': return input.isRenewal ? 'renewal' : 'lobby';
    case 'drafting': return 'draft_room';
    case 'pre_season':
    case 'regular':
    case 'playoffs':
    case 'completed':
      return 'season';
  }
}

/** The Run it back strip shows on a finished season to its commissioner, until it has a successor. */
export function showRunItBackStrip(input: { phase: SeasonPhase; isCommissioner: boolean; hasSuccessor: boolean }): boolean {
  return input.phase === 'completed' && input.isCommissioner && !input.hasSuccessor;
}

/** The season's segments (the board): Standings and Schedule always, Playoffs once the
 * season is in the playoffs (or over) with a playoff bracket, History always. */
export function seasonSegments(input: { phase: SeasonPhase; playoffTeams: number | null }): ('standings' | 'schedule' | 'playoffs' | 'history')[] {
  const playoffs = (input.phase === 'playoffs' || input.phase === 'completed') && (input.playoffTeams ?? 0) > 0;
  return playoffs ? ['standings', 'schedule', 'playoffs', 'history'] : ['standings', 'schedule', 'history'];
}
