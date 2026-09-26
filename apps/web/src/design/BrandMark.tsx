import type { CSSProperties } from 'react';
import { brand } from '../brand';

export interface BrandMarkProps {
  /** Icon edge length in px (square viewBox). */
  size?: number;
  /** Which surface the mark sits on — picks the two shorter bars' colour. */
  tone?: 'onLight' | 'onGame';
  /** Overrides the tallest bar's colour (defaults to `color.brand`). */
  accent?: string;
  className?: string;
  style?: CSSProperties;
}

const VIEW_SIZE = 24;
const BASELINE = 21;
const BAR_WIDTH = 4.5;
const CORNER_RADIUS = 1.5;

/** Path for a bar with rounded top corners and a flat bottom edge, so
 * adjacent bars read as sitting on one shared baseline. */
function roundedTopBar(x: number, height: number): string {
  const yTop = BASELINE - height;
  const yCornerEnd = yTop + CORNER_RADIUS;
  const xRight = x + BAR_WIDTH;
  const xCornerStart = x + CORNER_RADIUS;
  const xCornerEnd = xRight - CORNER_RADIUS;
  return [
    `M ${x} ${BASELINE}`,
    `L ${x} ${yCornerEnd}`,
    `Q ${x} ${yTop} ${xCornerStart} ${yTop}`,
    `L ${xCornerEnd} ${yTop}`,
    `Q ${xRight} ${yTop} ${xRight} ${yCornerEnd}`,
    `L ${xRight} ${BASELINE}`,
    'Z',
  ].join(' ');
}

// Three equal-width bars, ascending left to right (the landing's existing
// "equity" motif — DESIGN_DIRECTION.md §1 mark #1 "keeps the landing's
// equity"), shared baseline, rounded tops. The tallest (rightmost) bar is
// the accent colour; the other two pick a surface-appropriate neutral via
// `tone`. Name-agnostic: safe to ship before the brand-name decision lands.
const BARS = [
  { x: 3, height: 8 },
  { x: 9.75, height: 12 },
  { x: 16.5, height: 16 },
];

/** The refined-bars mark (DESIGN_DIRECTION.md §1 mark #1, §9 `brand.mark`). */
export function BrandMark({ size = 24, tone = 'onLight', accent, style, className }: BrandMarkProps) {
  const tallestFill = accent ?? 'var(--sp-color-brand)';
  const minorFill =
    tone === 'onGame' ? 'var(--sp-color-text-on-game-secondary)' : 'var(--sp-color-text-secondary)';

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
      fill="none"
      role="img"
      aria-label={`${brand.name} mark`}
      className={className}
      style={style}
    >
      {BARS.map((bar, i) => (
        <path
          key={bar.x}
          d={roundedTopBar(bar.x, bar.height)}
          fill={i === BARS.length - 1 ? tallestFill : minorFill}
        />
      ))}
    </svg>
  );
}

export default BrandMark;
