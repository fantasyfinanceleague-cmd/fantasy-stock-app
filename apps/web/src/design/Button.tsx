import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMotion } from './useMotion';
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
 * reduced motion too) — see DESIGN_DIRECTION §4 "Card / row press". */
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const { spring } = useMotion();
  return (
    <motion.button
      className={['sp-button', `sp-button--${variant}`, `sp-button--${size}`, className]
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
