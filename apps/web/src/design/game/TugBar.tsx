import { useRef } from 'react';
import { motion } from 'motion/react';
import { useMotion } from '../useMotion';
import { spring as gameSpring } from './motion';
import { tugRatio } from '../lib/tugRatio';
import './TugBar.css';

export interface TugBarProps {
  you: number;
  opponent: number;
  className?: string;
}

type Leader = 'you' | 'opponent' | 'tied';

function leaderOf(you: number, opponent: number): Leader {
  if (you === opponent) return 'tied';
  return you > opponent ? 'you' : 'opponent';
}

/** You-vs-opponent fill ratio (lib/tugRatio). Overshoots with
 * `spring.lively` only on an actual lead change; a ratio shift with no
 * lead change (still winning, just by more or less) settles with the
 * ordinary `spring.snappy`. Reduced motion: jumps straight to the new
 * value, no spring at all. */
export function TugBar({ you, opponent, className }: TugBarProps) {
  const { reduced, spring } = useMotion();
  const ratio = tugRatio(you, opponent);
  const prevLeaderRef = useRef<Leader | null>(null);
  const leader = leaderOf(you, opponent);
  const leadChanged = prevLeaderRef.current !== null && prevLeaderRef.current !== leader && leader !== 'tied';
  prevLeaderRef.current = leader;

  const transition = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, ...(leadChanged ? gameSpring.lively : spring.snappy) };

  const youPercent = Math.round(ratio * 100);

  return (
    <div
      className={['sp-tug-bar', className].filter(Boolean).join(' ')}
      role="img"
      aria-label={`You ${youPercent}%, opponent ${100 - youPercent}%`}
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
