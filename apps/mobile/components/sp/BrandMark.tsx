import Svg, { Rect } from 'react-native-svg';

import { useTheme } from '@/components/sp/ThemeProvider';

// Stockpile — <BrandMark> (§9A, "One design, two themes", 2026-09-29).
// SOURCE OF TRUTH: DESIGN_DIRECTION.md, mark option "1 · Bars, refined"
// (the Decisions block: today's icon, equalised — name-agnostic, safe to
// build regardless of the pending brand-name decision).
//
// Three equal-WIDTH bars sharing a baseline, rounded tops, ascending height
// left to right; the tallest (rightmost) bar carries the accent colour
// (colors.accent — "mark accent bar"). The other two use the theme's
// secondary text colour. No more `tone` prop: the mark reads its colours
// from the active theme directly, the same as every other component, so it
// reads correctly wherever it's placed without the caller needing to know
// what's behind it.

export interface BrandMarkProps {
  /** Overall square size in points. Bars scale proportionally. */
  size?: number;
}

const VIEWBOX = 24;
const BAR_WIDTH = 4;
const GAP = 2.5;
const BASELINE = 19;
const RADIUS = 1.5;
// Ascending heights, left to right — the third bar is tallest.
const HEIGHTS = [8, 12, 16];

export function BrandMark({ size = 24 }: BrandMarkProps) {
  const { colors } = useTheme();
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
            fill={isTallest ? colors.accent : colors.text2}
          />
        );
      })}
    </Svg>
  );
}
