// Stockpile — theme resolution (pure). Dependency-free, same reasoning as
// ./money.ts and ./tug.ts. Extracted out of ThemeProvider.tsx so the "forced
// wins over everything except dev" rule is testable without an RN renderer.

// Relative import, not the `@/` alias other app code uses: Metro resolves
// that alias, but Deno (which runs this file directly for tests-deno/)
// does not.
import type { ThemeMode } from '../../../constants/tokens/color';

export type ThemePreference = 'system' | ThemeMode;
export type SystemScheme = 'light' | 'dark' | null | undefined;

/**
 * Resolves the theme actually in effect. `forced` (non-null) wins over the
 * user's stored/system preference everywhere EXCEPT while `isDev` — see
 * components/sp/ThemeProvider.tsx's THEME_FORCED for why this exists (every
 * legacy 1.1.0 screen is still light-only) and why the override is gated on
 * `isDev` rather than a scoping prop (nothing outside the dev-only design
 * gallery calls setPreference() today, so this is equivalent to "override
 * only from the gallery" without threading a prop through the hook).
 */
export function resolveTheme(preference: ThemePreference, systemScheme: SystemScheme, forced: ThemeMode | null, isDev: boolean): ThemeMode {
  if (forced !== null && !isDev) return forced;
  if (preference === 'system') return systemScheme === 'dark' ? 'dark' : 'light';
  return preference;
}
