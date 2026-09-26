// Stockpile — "Game Day" elevation tokens (Phase 2 foundation).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9.
// Game surfaces are flat (no shadow) — the stadium band reads as a surface,
// not a floating card. Follows the ios shadow* / android elevation split
// used by constants/theme/shadows.ts.

import { Platform, ViewStyle } from 'react-native';
import { color } from './color';

export interface ElevationStyle extends ViewStyle {
  borderWidth?: number;
  borderColor?: string;
}

export const elevation = {
  money: {
    card: Platform.select<ElevationStyle>({
      ios: {
        borderWidth: 1,
        borderColor: color.border.default,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      },
      android: {
        borderWidth: 1,
        borderColor: color.border.default,
        elevation: 2,
      },
      default: { borderWidth: 1, borderColor: color.border.default },
    }) as ElevationStyle,
  },
  // Game surfaces are flat — no shadow, no border. Depth comes from
  // color.surface.game.{base,raised} alone.
  game: {
    flat: {} as ElevationStyle,
  },
  sheet: Platform.select<ElevationStyle>({
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
  }) as ElevationStyle,
} as const;
