import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useMotion } from '../useMotion';
import './Chyron.css';

export interface ChyronProps {
  /** null/undefined renders nothing (and the region announces nothing). */
  message?: string | null;
  onDismiss?: () => void;
  /** How long the message stays up before auto-dismissing. Not a motion
   * value (it's how long content is READ, not how it animates), so this
   * is a plain prop rather than a token. */
  autoDismissMs?: number;
  className?: string;
}

/** Slides in, auto-dismisses, and is announced via the wrapping
 * `aria-live="polite"` region — the web equivalent of
 * AccessibilityInfo.announceForAccessibility (mobile has no such native
 * API; a live region's text change is what a browser screen reader
 * announces automatically). */
export function Chyron({ message, onDismiss, autoDismissMs = 4000, className }: ChyronProps) {
  const { reduced, enterTransition } = useMotion();

  useEffect(() => {
    if (!message || !onDismiss) return;
    const timer = setTimeout(onDismiss, autoDismissMs);
    return () => clearTimeout(timer);
  }, [message, onDismiss, autoDismissMs]);

  return (
    <div className={['sp-chyron-region', className].filter(Boolean).join(' ')} aria-live="polite" role="status">
      <AnimatePresence>
        {message && (
          <motion.div
            className="sp-chyron"
            initial={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
            transition={enterTransition}
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Chyron;
