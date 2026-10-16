/**
 * Where a manager's row or avatar goes (the leaguemate team view; Planner ruling 2026-10-16,
 * following ESPN / Sleeper / Yahoo: tap a manager in the standings or the matchup header to
 * open their team). Another manager opens their read-only team (`/player-portfolio`); YOUR
 * own row opens your Portfolio tab. Nothing else links to the team view. Pure, so Deno tests it.
 */

export const PORTFOLIO_TAB_HREF = '/(tabs)/portfolio' as const;

export type TeamHref =
  | typeof PORTFOLIO_TAB_HREF
  | { pathname: '/player-portfolio'; params: { userId: string; username: string } };

/** The destination of a manager's row/avatar, or null when there is nobody to open (an empty
 * id: the row then isn't a button at all, never a dead tap). */
export function teamHref(i: { userId: string | null | undefined; name: string; isYou: boolean }): TeamHref | null {
  if (i.isYou) return PORTFOLIO_TAB_HREF;
  if (!i.userId) return null;
  return { pathname: '/player-portfolio', params: { userId: i.userId, username: i.name } };
}

/** The VoiceOver text for that destination ("View Paolo M.'s team"; yours: "View your portfolio"). */
export function teamLinkLabel(i: { name: string; isYou: boolean }): string {
  return i.isYou ? 'View your portfolio' : `View ${i.name}'s team`;
}

/** The name a deep link carries (`username`), made safe to show while the team loads: control and
 * bidi-override characters stripped, trimmed, capped at 40 (a crafted link can put any text in the
 * URL). The screen shows it ONLY while loading; once the ledger answers, the member's own display
 * name replaces it, and a failed load shows no URL-supplied text at all. */
export function linkedName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 40).trim();
  return clean || null;
}
