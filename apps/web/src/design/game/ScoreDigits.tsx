import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMotion } from '../useMotion';
import { digitDiff } from '../lib/digitDiff';
import './ScoreDigits.css';
import '../game/a11y.css';

export interface ScoreDigitsProps {
  /** Pre-formatted value (e.g. from lib/money's formatMoney) — ScoreDigits
   * only decides HOW it changes, not how it's formatted. */
  value: string;
  className?: string;
}

/** Per-digit roll, only on change, never on first paint (DESIGN_DIRECTION
 * §4/§9). The visible characters are `aria-hidden`; a visually-hidden
 * sibling carries the plain value so assistive tech reads the whole
 * number rather than animated fragments. */
export function ScoreDigits({ value, className }: ScoreDigitsProps) {
  const { reduced, duration, ease } = useMotion();
  const prevValueRef = useRef<string | null>(null);
  const hasMountedRef = useRef(false);
  const [changedMask, setChangedMask] = useState<boolean[]>(() => new Array(value.length).fill(false));

  useEffect(() => {
    if (!hasMountedRef.current) {
      // Never on first paint.
      hasMountedRef.current = true;
      prevValueRef.current = value;
      setChangedMask(new Array(value.length).fill(false));
      return;
    }
    const diff = digitDiff(prevValueRef.current ?? '', value);
    setChangedMask(diff);
    prevValueRef.current = value;
  }, [value]);

  return (
    <span className={['sp-score-digits', className].filter(Boolean).join(' ')}>
      <span aria-hidden="true" className="sp-score-digits__visual">
        {value.split('').map((char, i) => {
          const changed = changedMask[i] ?? false;
          if (reduced || !changed) {
            // Reduced motion: "digit roll -> instant swap" (§5) — render
            // the new character with no transition at all.
            return (
              <span key={i} className="sp-score-digits__char">
                {char}
              </span>
            );
          }
          return (
            <span key={i} className="sp-score-digits__char sp-score-digits__char--roll-wrap">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                  key={`${i}-${char}`}
                  className="sp-score-digits__char"
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: '0%', opacity: 1 }}
                  exit={{ y: '-100%', opacity: 0 }}
                  transition={{ duration: duration.base, ease: ease.settle }}
                >
                  {char}
                </motion.span>
              </AnimatePresence>
            </span>
          );
        })}
      </span>
      <span className="sp-visually-hidden">{value}</span>
    </span>
  );
}

export default ScoreDigits;
