// Stockpile — elevation tokens (§9A, "One design, two themes", 2026-09-29).
// SOURCE OF TRUTH: docs/design/DESIGN_DIRECTION.md §9A / themes.css's
// `--c-shadow` and `--c-sheet-shadow` (see color.ts's `shadow`/`sheetShadow`
// for the verbatim CSS strings this hand-translates to RN's native shadow
// props — RN can't consume a CSS box-shadow shorthand directly).
//
// Supersedes the old money/game split (flat game surfaces, shadowed money
// cards): elevation is now keyed by THEME, not by surface kind. Light keeps
// a soft shadow on cards; Dark has none at all (`--c-shadow: none` —
// depth there comes from `surface`/`inset`/`sunken` value steps instead, not
// a shadow that would just read as a smudge on a dark background).

import { Platform, ViewStyle } from 'react-native';
import type { ThemeMode } from './color';
import { color } from './color';

export interface ElevationStyle extends ViewStyle {
  borderWidth?: number;
  borderColor?: string;
}

function cardFor(theme: ThemeMode): ElevationStyle {
  const c = color[theme];
  if (theme === 'dark') {
    // `--c-shadow: none` — no shadow, no border; depth comes from the
    // surface/inset/sunken value steps alone.
    return {};
  }
  return Platform.select<ElevationStyle>({
    ios: {
      borderWidth: 1,
      borderColor: c.border,
      shadowColor: '#000',
      shadowOpacity: 0.04,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
    },
    android: {
      borderWidth: 1,
      borderColor: c.border,
      elevation: 2,
    },
    default: { borderWidth: 1, borderColor: c.border },
  }) as ElevationStyle;
}

function sheetFor(theme: ThemeMode): ElevationStyle {
  if (theme === 'dark') {
    // Sheets slide up from the bottom, so Dark's shadow casts UPWARD
    // (`--c-sheet-shadow: 0 -8px 32px rgba(0,0,0,.45)`) — Android's single
    // `elevation` number can't express a directional cast, so it falls back
    // to a slightly stronger flat elevation there.
    return Platform.select<ElevationStyle>({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.45,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: -8 },
      },
      android: { elevation: 12 },
      default: {},
    }) as ElevationStyle;
  }
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
