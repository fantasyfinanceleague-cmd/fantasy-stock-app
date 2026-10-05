/**
 * matchupWindow: the matchup week's trading days, from the market calendar
 * (3c). A day is a session whose open and close both fall inside the week's
 * REAL window (resolveWeekWindow), never the stored nominal timestamps (B1).
 * Each day carries its real close, which the race needs to price a point.
 */
import { etWallClockToUtcIso, type MarketCalendarSession } from '../time/marketWeek';

export interface MatchupDay {
  /** YYYY-MM-DD, the session date. */
  date: string;
  /** The session's real close instant (ISO). */
  closeAt: Date;
}

export function matchupDays(
  calendar: MarketCalendarSession[],
  window: { weekStart: string; weekEnd: string },
): MatchupDay[] {
  const startMs = new Date(window.weekStart).getTime();
  const endMs = new Date(window.weekEnd).getTime();
  const days: MatchupDay[] = [];
  for (const s of [...calendar].sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : 1))) {
    const openIso = etWallClockToUtcIso(s.sessionDate, s.openEt);
    const closeIso = etWallClockToUtcIso(s.sessionDate, s.closeEt);
    if (!openIso || !closeIso) continue;
    const openMs = new Date(openIso).getTime();
    const closeMs = new Date(closeIso).getTime();
    if (openMs >= startMs && closeMs <= endMs) days.push({ date: s.sessionDate, closeAt: new Date(closeIso) });
  }
  return days;
}
