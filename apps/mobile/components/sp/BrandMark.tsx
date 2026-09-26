import Svg, { Rect } from 'react-native-svg';

import { color } from '@/constants/tokens';

// Stockpile — <BrandMark> (Phase 2 foundation).
// SOURCE OF TRUTH: DESIGN_DIRECTION.md, mark option "1 · Bars, refined"
// (the Decisions block: today's icon, equalised — name-agnostic, safe to
// build regardless of the pending brand-name decision).
//
// Three equal-WIDTH bars sharing a baseline, rounded tops, ascending height
// left to right; the tallest (rightmost) bar carries the brand accent
// colour (§9 color.brand — "mark accent bar"). The other two use the
// surface-appropriate secondary text colour, so the mark reads correctly
// on both a light card and a stadium background without a second asset.

export interface BrandMarkProps {
  /** Overall square size in points. Bars scale proportionally. */
  size?: number;
  tone: 'onLight' | 'onGame';
}

const VIEWBOX = 24;
const BAR_WIDTH = 4;
const GAP = 2.5;
const BASELINE = 19;
const RADIUS = 1.5;
// Ascending heights, left to right — the third bar is tallest.
const HEIGHTS = [8, 12, 16];

export function BrandMark({ size = 24, tone }: BrandMarkProps) {
  const mutedColor = tone === 'onGame' ? color.text.onGame.secondary : color.text.secondary;
  const totalWidth = HEIGHTS.length * BAR_WIDTH + (HEIGHTS.length - 1) * GAP;
  const startX = (VIEWBOX - totalWidth) / 2;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
      {HEIGHTS.map((height, index) => {
        const isTallest = index === HEIGHTS.length - 1;
        const x = startX + index * (BAR_WIDTH + GAP);
        const y = BASELINE - height;
        return (
          <Rect
            key={index}
            x={x}
            y={y}
            width={BAR_WIDTH}
            height={height}
            rx={RADIUS}
            ry={RADIUS}
            fill={isTallest ? color.brand : mutedColor}
          />
        );
      })}
    </Svg>
  );
}
