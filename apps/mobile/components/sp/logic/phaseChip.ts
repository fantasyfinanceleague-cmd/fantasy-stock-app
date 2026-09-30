// Stockpile — PhaseChip's text and style (pure). Dependency-free, same
// reasoning as ./money.ts, so tests-deno can pin it.
//
// Design Lead ruling (Phase 3b-1): the PHASE decides the chip's style
// (live-type: liveText + a live dot; final-type: inverse; default); an
// optional `label` overrides only the TEXT ("Week 6", "Draft Sat 7:00 PM ET",
// "Final"), which the tag type style uppercases on screen.

export type LeaguePhase =
  | 'pre_draft'
  | 'drafting'
  | 'pre_season'
  | 'live_open'
  | 'live_closed'
  | 'week_final'
  | 'playoffs'
  | 'season_complete';

export type PhaseStyle = 'live' | 'final' | 'default';

export const PHASE_LABELS: Record<LeaguePhase, string> = {
  pre_draft: 'Pre-draft',
  drafting: 'Drafting',
  pre_season: 'Pre-season',
  live_open: 'Live',
  live_closed: 'Closed',
  week_final: 'Final',
  playoffs: 'Playoffs',
  season_complete: 'Complete',
};

const PHASE_STYLES: Record<LeaguePhase, PhaseStyle> = {
  pre_draft: 'default',
  drafting: 'live',
  pre_season: 'default',
  live_open: 'live',
  live_closed: 'default',
  week_final: 'final',
  playoffs: 'live',
  season_complete: 'final',
};

export function phaseChipStyle(phase: LeaguePhase): PhaseStyle {
  return PHASE_STYLES[phase];
}

export function phaseChipText(phase: LeaguePhase, label?: string): string {
  return label && label.trim() ? label.trim() : PHASE_LABELS[phase];
}
