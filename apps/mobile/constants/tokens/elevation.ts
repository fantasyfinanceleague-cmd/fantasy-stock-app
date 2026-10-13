// Stockpile — elevation tokens, v3 "Game Night" (§9C, 2026-10-12).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9C, rule 1: "Depth from
// lightness steps of one hue (272°), never shadow on Dark … Light: a
// navy-tinted off-white page, white cards with the `rim` as their edge; the
// only shadow is the sheet's."
//
// So a card is the same in both themes: no shadow, a 1pt `rim` edge (RN draws
// a border inside the box, which is exactly the board's `inset 0 0 0 1px`).
// Depth in Dark comes from `bg` → `surface` → `inset` alone. The sheet keeps
// its shadow in Light only (color.ts's `sheetShadow` is the CSS reference
// string this hand-translates); in Dark it has none.

import { Platform, ViewStyle } from 'react-native';
import type { ThemeMode } from './color';
import { color } from './color';

export interface ElevationStyle extends ViewStyle {
  borderWidth?: number;
  borderColor?: string;
}

/** The 1pt card rim (§9C "Shape and space"). */
export const RIM_WIDTH = 1;

function cardFor(theme: ThemeMode): ElevationStyle {
  return { borderWidth: RIM_WIDTH, borderColor: color[theme].rim };
}

function sheetFor(theme: ThemeMode): ElevationStyle {
  if (theme === 'dark') return {};
  return Platform.select<ElevationStyle>({
    ios: {
      shadowColor: '#000',
      shadowOpacity: 0.12,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
    },
    android: {
      elevation: 8,
    },
    default: {},
  }) as ElevationStyle;
}

export const elevation = {
  light: { card: cardFor('light'), sheet: sheetFor('light') },
  dark: { card: cardFor('dark'), sheet: sheetFor('dark') },
} as const;
