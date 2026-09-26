import { Surface } from '../Surface';
import { Text } from '../Text';
import { formatMoney } from '../lib/money';
import { ScoreDigits } from './ScoreDigits';
import { TugBar } from './TugBar';
import { LiveDot } from './LiveDot';
import { Chyron } from './Chyron';
import './Scoreboard.css';

export interface ScoreboardTeam {
  name: string;
  gain: number;
}

export interface ScoreboardProps {
  leagueName: string;
  week: number;
  you: ScoreboardTeam;
  opponent: ScoreboardTeam;
  /** Show the live dot (caller decides based on market-open state). */
  live?: boolean;
  chyronMessage?: string | null;
  onChyronDismiss?: () => void;
  className?: string;
}

/** Composes the game surfaces' signature moment: league/week line, two
 * teams' scores, the tug bar, a lead line, and the chyron region
 * (DESIGN_DIRECTION §9 `Scoreboard`). */
export function Scoreboard({
  leagueName,
  week,
  you,
  opponent,
  live = false,
  chyronMessage,
  onChyronDismiss,
  className,
}: ScoreboardProps) {
  const leading: 'you' | 'opponent' | null =
    you.gain === opponent.gain ? null : you.gain > opponent.gain ? 'you' : 'opponent';
  const margin = Math.abs(you.gain - opponent.gain);

  return (
    <Surface kind="game" className={['sp-scoreboard', className].filter(Boolean).join(' ')}>
      <div className="sp-scoreboard__header">
        <Text variant="tag" tone="secondary">
          {leagueName} · Week {week}
        </Text>
        {live && <LiveDot />}
      </div>

      <div className="sp-scoreboard__teams">
        <div className="sp-scoreboard__team">
          <Text variant="callout" tone="secondary" nowrap>
            {you.name}
          </Text>
          <ScoreDigits value={formatMoney(you.gain, { sign: 'always' })} />
        </div>
        <div className="sp-scoreboard__team sp-scoreboard__team--opponent">
          <Text variant="callout" tone="secondary" nowrap>
            {opponent.name}
          </Text>
          <ScoreDigits value={formatMoney(opponent.gain, { sign: 'always' })} />
        </div>
      </div>

      <TugBar you={you.gain} opponent={opponent.gain} />

      {leading && (
        <Text variant="caption" tone="secondary" as="p" className="sp-scoreboard__lead-line">
          {leading === 'you' ? 'You lead' : `${opponent.name} leads`} by {formatMoney(margin)}
        </Text>
      )}

      <Chyron message={chyronMessage ?? null} onDismiss={onChyronDismiss} />
    </Surface>
  );
}

export default Scoreboard;
