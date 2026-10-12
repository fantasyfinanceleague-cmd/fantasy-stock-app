import type { ReactNode } from 'react';
import { MotionConfig } from 'motion/react';

/** Wrap every web app root in this (Design Lead, 2026-09-26). motion's
 * default context is reducedMotion "never", which makes motion's OWN
 * components (motion.div transforms, layout animations) ignore the OS
 * reduced-motion setting; "user" makes them honour it. useMotion() already
 * reads the OS preference directly, so this covers the other half: motion
 * primitives that don't branch on `reduced` themselves. The landing uses it
 * now; the 3d app shell adopts it later. */
export function MotionRoot({ children }: { children?: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export default MotionRoot;
