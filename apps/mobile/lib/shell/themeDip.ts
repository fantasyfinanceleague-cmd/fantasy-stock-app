// Phase 3b-1 — whether an Appearance change needs the dip transition.
//
// The dip (components/shell/ThemeDip.tsx) covers the app in the NEW theme's
// background, swaps the theme underneath, and uncovers once the new theme
// has rendered. It must only start when the resolved theme will actually
// change: System → Light on a phone that is already light changes nothing
// on screen, so the "new theme rendered" signal would never come and the
// cover would never lift.
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import { resolveTheme, type SystemScheme, type ThemePreference } from '../../components/sp/logic/theme';
import type { ThemeMode } from '../../constants/tokens/color';

/** The theme to dip into, or null when the choice changes nothing on screen. */
export function dipTarget(
  currentResolved: ThemeMode,
  next: ThemePreference,
  systemScheme: SystemScheme,
  forced: ThemeMode | null,
  isDev: boolean
): ThemeMode | null {
  const target = resolveTheme(next, systemScheme, forced, isDev);
  return target === currentResolved ? null : target;
}
