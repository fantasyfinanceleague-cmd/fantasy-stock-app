import type { CSSProperties } from 'react';
import { useSurfaceKind } from './Surface';
import { Chip } from './Chip';
import './Chip.css';

// DESIGN_DIRECTION.md §3 "One league-lifecycle model": every surface reads
// ONE phase from a shared helper and renders that phase's state — no
// screen infers phase on its own. This is the one visual treatment for
// that phase, defined once.
export type Phase =
  | 'pre_draft'
  | 'drafting'
  | 'pre_season'
  | 'live_open'
  | 'live_closed'
  | 'week_final'
  | 'playoffs'
  | 'season_complete';

export const PHASE_LABEL: Record<Phase, string> = {
  pre_draft: 'Pre-Draft',
  drafting: 'Drafting',
  pre_season: 'Pre-Season',
  live_open: 'Live',
  live_closed: 'Resumes Mon 9:30 AM ET',
  week_final: 'Final',
  playoffs: 'Playoffs',
  season_complete: 'Season Complete',
};

export interface PhaseChipProps {
  phase: Phase;
  className?: string;
  style?: CSSProperties;
}

/** Visual only — reads a `phase` its caller already resolved (§3's shared
 * helper), it doesn't infer one. `live_open` on a game surface renders as
 * a broadcast tag (uppercase, `color.live`); everything else is a plain
 * neutral chip. */
export function PhaseChip({ phase, className, style }: PhaseChipProps) {
  const surfaceKind = useSurfaceKind();
  const label = PHASE_LABEL[phase];

  if (phase === 'live_open' && surfaceKind === 'game') {
    return (
      <span className={['sp-chip', 'sp-chip--tag', className].filter(Boolean).join(' ')} style={style}>
        {label}
      </span>
    );
  }

  return (
    <Chip tone="neutral" className={className} style={style}>
      {label}
    </Chip>
  );
}

export default PhaseChip;
