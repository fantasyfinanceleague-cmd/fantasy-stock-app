import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMotion } from './useMotion';
import { useSurfaceKind } from './Surface';
import './Button.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'md' | 'sm';

// motion.button's props (HTMLMotionProps) redefine several native DOM
// event handlers with drag/animation-gesture signatures that collide with
// React's native ButtonHTMLAttributes typings — omit the ones that conflict
// rather than widen everything to `any`.
type NonMotionButtonAttributes = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | 'children'
  | 'onDrag'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onAnimationStart'
  | 'onAnimationEnd'
  | 'onAnimationIteration'
>;

export interface ButtonProps extends NonMotionButtonAttributes {
  variant?: ButtonVariant;
  /** Both sizes meet the 44pt / 36px minimum touch target (§9). */
  size?: ButtonSize;
  children?: ReactNode;
}

/** Action buttons: primary (stadium navy), secondary, ghost, destructive.
 * Press feedback is `spring.snappy` (no overshoot, so it's safe under
 * reduced motion too) — see DESIGN_DIRECTION §4 "Card / row press".
 *
 * primary/secondary/ghost resolve per surface (DESIGN_DIRECTION §9,
 * amended fb0bc9d: navy-on-navy made an unbordered primary invisible on a
 * game surface, so it INVERTS there instead of just growing a border).
 * destructive is intentionally the same status.danger red on both — a
 * strong universal warning colour, not one of the tokens that collided. */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const { spring } = useMotion();
  const onGame = useSurfaceKind() === 'game';
  return (
    <motion.button
      className={[
        'sp-button',
        `sp-button--${variant}`,
        `sp-button--${size}`,
        onGame && variant !== 'destructive' && 'sp-button--on-game',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', ...spring.snappy }}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

export default Button;
