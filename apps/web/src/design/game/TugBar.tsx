import { useRef } from 'react';
import { motion } from 'motion/react';
import { useMotion } from '../useMotion';
import { spring as gameSpring } from './motion';
import { tugRatio } from '../lib/tugRatio';
import { formatMoney } from '../lib/money';
import './TugBar.css';

export interface TugBarProps {
  you: number;
  opponent: number;
  /** Names for the accessible label, e.g. "You" and "Priya". */
  youLabel: string;
  opponentLabel: string;
  className?: string;
}

type Leader = 'you' | 'opponent' | 'tied';

function leaderOf(you: number, opponent: number): Leader {
  if (you === opponent) return 'tied';
  return you > opponent ? 'you' : 'opponent';
}

/** The bar's accessible label, in DOLLARS (Design Lead, 2026-09-26): the
 * old "You 59%, opponent 41%" read like a win probability, and there is no
 * win-probability model. The ratio stays visual only; assistive tech hears
 * who leads and by how much, from the same gains the bar draws. */
export function tugLabel(you: number, opponent: number, youLabel: string, opponentLabel: string): string {
  const margin = formatMoney(Math.abs(you - opponent));
  if (margin === '$0.00') return 'Tied';
  const leader = you > opponent ? youLabel : opponentLabel;
  const verb = leader.trim().toLowerCase() === 'you' ? 'lead' : 'leads';
  return `${leader} ${verb} by ${margin}`;
}

/** You-vs-opponent fill ratio (lib/tugRatio). Overshoots with
 * `spring.lively` only on an actual lead change; a ratio shift with no
 * lead change (still winning, just by more or less) settles with the
 * ordinary `spring.snappy`. Reduced motion: jumps straight to the new
 * value, no spring at all. */
export function TugBar({ you, opponent, youLabel, opponentLabel, className }: TugBarProps) {
  const { reduced, spring } = useMotion();
  const ratio = tugRatio(you, opponent);
  const prevLeaderRef = useRef<Leader | null>(null);
  const leader = leaderOf(you, opponent);
  const leadChanged = prevLeaderRef.current !== null && prevLeaderRef.current !== leader && leader !== 'tied';
  prevLeaderRef.current = leader;

  const transition = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, ...(leadChanged ? gameSpring.lively : spring.snappy) };

  return (
    <div
      className={['sp-tug-bar', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={tugLabel(you, opponent, youLabel, opponentLabel)}
    >
      <motion.div className="sp-tug-bar__you" animate={{ width: `${ratio * 100}%` }} transition={transition} />
      <motion.div
        className="sp-tug-bar__opponent"
        animate={{ width: `${(1 - ratio) * 100}%` }}
        transition={transition}
      />
    </div>
  );
}

export default TugBar;
