import type { ReactNode } from 'react';
import { Text } from '../../design/Text';
import { TugBar } from '../../design/game/TugBar';
import { Chyron } from '../../design/game/Chyron';

export interface MatchBoardProps {
  tag: string;
  aside?: string;
  youName: string;
  oppName: string;
  youScore: ReactNode;
  oppScore: ReactNode;
  /** Values the tug bar tracks (may lag the scores, e.g. mid-count). */
  tugYou: number;
  tugOpp: number;
  /** The line under the bar. Its height is reserved when empty. */
  lead: ReactNode;
  chyron: string | null;
  onChyronDismiss: () => void;
  className?: string;
}

/** The landing's broadcast score bug: the foundation Scoreboard's parts
 * (tag, TugBar, Chyron, score type) laid out wide — scores flanking the bar
 * on large screens, side by side above it on phones — which the stacked
 * Scoreboard primitive doesn't do. Rendered on a game surface. The lead
 * line and chyron keep fixed heights, so nothing moves when they appear.
 *
 * The TugBar is hidden from assistive tech here: its dollar label would
 * repeat the lead line directly below it word for word. */
export function MatchBoard({
  tag,
  aside,
  youName,
  oppName,
  youScore,
  oppScore,
  tugYou,
  tugOpp,
  lead,
  chyron,
  onChyronDismiss,
  className,
}: MatchBoardProps) {
  return (
    <div className={['lp-board', className].filter(Boolean).join(' ')} role="group" aria-label="Sample matchup">
      <div className="lp-board__header">
        <Text variant="tag" tone="secondary">
          {tag}
        </Text>
        {aside && (
          <Text variant="caption" tone="secondary" nowrap>
            {aside}
          </Text>
        )}
      </div>
      <div className="lp-board__score-row">
        <div className="lp-board__team">
          <span className="lp-board__name lp-board__name--you">{youName}</span>
          {youScore}
        </div>
        <div className="lp-board__tug" aria-hidden="true">
          <TugBar you={tugYou} opponent={tugOpp} youLabel={youName} opponentLabel={oppName} />
        </div>
        <div className="lp-board__team lp-board__team--opp">
          <span className="lp-board__name lp-board__name--opp">{oppName}</span>
          {oppScore}
        </div>
      </div>
      <p className="lp-board__lead">{lead}</p>
      <Chyron message={chyron} onDismiss={onChyronDismiss} className="lp-board__chyron" />
    </div>
  );
}

export default MatchBoard;
