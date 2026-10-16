/**
 * Profile's back link names where it goes back to (the iOS convention; W8 follow-up F3). The avatar sits on four
 * tabs, so a fixed "‹ Home" lied from three of them: it called router.back() and returned to League. ShellHeader
 * sends the tab it is on as `?from=`; Profile labels its link from that and keeps router.back(). A missing or
 * unknown value (a deep link, a cold start) reads "‹ Back": the param is checked against these four values only.
 * Pure, so tests-deno pins it.
 */
export const PROFILE_FROM = ['home', 'matchup', 'league', 'portfolio'] as const;
export type ProfileFrom = (typeof PROFILE_FROM)[number];

/** The tab titles, as the tab bar labels them. */
const LABELS: Record<ProfileFrom, string> = { home: 'Home', matchup: 'Matchup', league: 'League', portfolio: 'Portfolio' };

/** The fallback when the tab is unknown. */
export const PROFILE_BACK_FALLBACK = 'Back';

/** `?from=` as the router hands it over (a string, or an array when repeated); null unless it is one of the four. */
export function profileFromParam(raw: string | string[] | undefined): ProfileFrom | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (PROFILE_FROM as readonly string[]).includes(v ?? '') ? (v as ProfileFrom) : null;
}

export function profileBackLabel(raw: string | string[] | undefined): string {
  const from = profileFromParam(raw);
  return from ? LABELS[from] : PROFILE_BACK_FALLBACK;
}

/** The tab a pathname belongs to ("/" is Home, whose route is the tabs' index); null for anything else. */
export function profileFromPathname(pathname: string | null | undefined): ProfileFrom | null {
  const p = (pathname ?? '').replace(/\/+$/, '');
  if (p === '' || p === '/index') return 'home';
  const seg = p.replace(/^\/(\(tabs\)\/)?/, '');
  return (PROFILE_FROM as readonly string[]).includes(seg) && seg !== 'home' ? (seg as ProfileFrom) : null;
}

/** The href the avatar pushes: the tab it is on when known, else a plain Profile. */
export function profileHref(from: ProfileFrom | null): { pathname: '/profile'; params: { from?: ProfileFrom } } {
  return { pathname: '/profile', params: from ? { from } : {} };
}
