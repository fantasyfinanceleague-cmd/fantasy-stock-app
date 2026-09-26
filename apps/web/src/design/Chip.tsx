import type { CSSProperties, ReactNode } from 'react';
import { useSurfaceKind } from './Surface';
import './Chip.css';

export type ChipTone = 'neutral' | 'brand';

export interface ChipProps {
  tone?: ChipTone;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function Chip({ tone = 'neutral', className, style, children }: ChipProps) {
  const surfaceKind = useSurfaceKind();
  return (
    <span
      className={['sp-chip', `sp-chip--${tone}-${surfaceKind}`, className].filter(Boolean).join(' ')}
      style={style}
    >
      {children}
    </span>
  );
}

export default Chip;
