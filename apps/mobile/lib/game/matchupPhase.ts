/**
 * matchupPhase: maps Home's PhaseResult onto what the Matchup screen shows
 * (3c). It never re-derives the phase: homePhase decides, and this only picks
 * the view. A league that hasn't started has no matchup; a bye has no
 * scoreboard (it's a neutral no-result, never W or L).
 */
import type { PhaseResult } from '../home/homePhase';

export type MatchupView =
  | { kind: 'scoreboard'; live: true; closed: boolean }
  | { kind: 'scoring' }
  | { kind: 'final'; won: boolean | null }
  | { kind: 'pre_season' }
  | { kind: 'bye' }
  | { kind: 'playoff_bye'; round: string | null }
  | { kind: 'playoff_pending'; round: string | null }
  | { kind: 'eliminated'; round: string | null }
  | { kind: 'missed_playoffs' }
  | { kind: 'complete' }
  | { kind: 'not_started' };

export function matchupView(phase: PhaseResult): MatchupView {
  switch (phase.kind) {
    case 'live_open':
      return { kind: 'scoreboard', live: true, closed: false };
    case 'live_closed':
      return { kind: 'scoreboard', live: true, closed: true };
    case 'scoring':
      return { kind: 'scoring' };
    case 'scored':
      return { kind: 'final', won: phase.won };
    case 'pre_season':
      return { kind: 'pre_season' };
    case 'bye':
      return { kind: 'bye' };
    case 'playoff_bye':
      return { kind: 'playoff_bye', round: phase.round };
    case 'playoff_pending':
      return { kind: 'playoff_pending', round: phase.round };
    case 'eliminated':
      return { kind: 'eliminated', round: phase.round };
    case 'missed_playoffs':
      return { kind: 'missed_playoffs' };
    case 'complete':
      return { kind: 'complete' };
    case 'pre_draft':
    case 'drafting':
      return { kind: 'not_started' };
  }
}
