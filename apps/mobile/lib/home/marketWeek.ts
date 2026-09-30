/**
 * marketWeek: turns a nominal matchup week (schedule.ts's fixed-UTC,
 * nominal-Tuesday-to-Friday convention) into the REAL trading-session
 * bounds a person actually experiences, from the market calendar.
 *
 * B1 (Design Lead, 2026-09-30): matchups.week_start/week_end are fixed UTC
 * timestamps correct only in EST, and week_start is a nominal Tuesday, not
 * the real Monday baseline (_shared/schedule.ts's own documented quirk;
 * the real baseline is Monday's open, per snapshot-week-start). Used
 * directly, they make Home wrong by exactly one hour every summer and by a
 * full trading day every Monday (`started` stays false until Tue 10:30 AM
 * ET). "Don't change the schedule" (Design Lead) -- this module never
 * touches schedule.ts or the stored matchups rows; it only reinterprets
 * which real calendar week a row's own week_end identifies, using
 * public.market_calendar (20261005000002), already granted SELECT to
 * `authenticated`.
 *
 * The single caller, buildHomeViewModel's `matchupRowFor`, overwrites
 * MatchupRow.weekStart/weekEnd with this module's output before the row
 * ever reaches homePhase.ts or homeCopy.ts -- both already compare/format
 * whatever they're handed in ET correctly, so the fix lives entirely at
 * the one seam where a nominal row becomes a MatchupRow, not scattered
 * through the decision logic that reads it.
 */

export interface MarketCalendarSession {
  /** YYYY-MM-DD, America/New_York calendar date (market_calendar.session_date). */
  sessionDate: string;
  /** HH:MM:SS, ET wall-clock, no timezone (market_calendar.open_et). */
  openEt: string;
  /** HH:MM:SS, ET wall-clock, no timezone (market_calendar.close_et). */
  closeEt: string;
}

/** The ET calendar date (YYYY-MM-DD) of an instant, DST-aware. */
function etDateOnlyOf(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * The Monday (YYYY-MM-DD, America/New_York) of the ISO week containing
 * `dateIso` -- found from the REAL day of week, never by assuming
 * `dateIso` itself is any particular weekday. A matchup row's week_end
 * happens to always land on a Friday under schedule.ts's own convention,
 * but a caller anchoring on some OTHER date within the week (e.g. a
 * league's start date, which can fall on any day) must get the same
 * Monday either way -- an earlier version of this file assumed "Friday
 * minus 4 days" and would have silently mis-anchored on any non-Friday
 * input.
 */
function mondayOfIsoWeek(dateIso: string): string {
  const etDate = etDateOnlyOf(dateIso);
  const [y, m, d] = etDate.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun .. 6=Sat
  const daysSinceMonday = (dow + 6) % 7; // Mon->0, Tue->1, ..., Sun->6
  return addDaysToDateStr(etDate, -daysSinceMonday);
}

/**
 * An ET wall-clock date + time (as market_calendar stores them, no
 * timezone of its own) to the UTC instant it names, DST-aware. Same
 * offset-by-round-trip technique as the Postgres side's
 * `(session_date + open_et) at time zone 'America/New_York'` -- Intl
 * reports what the target zone's wall clock reads for a guessed UTC
 * instant, and the difference from the guess IS that zone's offset at that
 * instant, so the guess can be corrected in one step without a timezone
 * library. Exact at every US market hour; never called near the 2 AM DST
 * transition itself, the one moment this technique would need a second
 * pass.
 */
export function etWallClockToUtcIso(dateStr: string, timeStr: string): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [hh, mm, ss] = timeStr.split(':').map(Number);
  const guessUtcMs = Date.UTC(y, mo - 1, d, hh, mm, ss || 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(guessUtcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asIfUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asIfUtcMs - guessUtcMs; // America/New_York's offset east of UTC, for this instant
  return new Date(guessUtcMs - offsetMs).toISOString();
}

/**
 * The real trading-session window for the ISO week (Mon-Fri,
 * America/New_York) containing `anchorIso` -- ANY date within that week,
 * not necessarily a Friday (see mondayOfIsoWeek's doc). `sessions` need
 * only cover that week -- callers pass whatever range they already
 * fetched. Null when the calendar has no session that week at all
 * (outside the refreshed coverage window, or a truly empty range) --
 * never a fabricated guess; the caller falls back to the nominal value,
 * the same "unknown, not invented" discipline market_session_status
 * already uses.
 */
export function resolveWeekWindow(
  anchorIso: string,
  sessions: MarketCalendarSession[],
): { weekStart: string; weekEnd: string } | null {
  const mondayDate = mondayOfIsoWeek(anchorIso);
  const fridayDate = addDaysToDateStr(mondayDate, 4);
  const inWeek = sessions
    .filter((s) => s.sessionDate >= mondayDate && s.sessionDate <= fridayDate)
    .sort((a, b) => (a.sessionDate < b.sessionDate ? -1 : a.sessionDate > b.sessionDate ? 1 : 0));
  if (inWeek.length === 0) return null;
  const first = inWeek[0];
  const last = inWeek[inWeek.length - 1];
  return {
    weekStart: etWallClockToUtcIso(first.sessionDate, first.openEt),
    weekEnd: etWallClockToUtcIso(last.sessionDate, last.closeEt),
  };
}

/**
 * A normal, no-holiday Mon-Fri 9:30-4:00 ET week for the ISO week
 * containing `anchorIso` (any date within it). Used by the dev fixture
 * (never real prod data, which always reads the actual market_calendar)
 * so fixture captures also exercise the real resolveWeekWindow path end-
 * to-end, rather than falling back to the (known-wrong) nominal
 * timestamps for lack of any calendar rows.
 */
export function standardWeekSessions(anchorIso: string): MarketCalendarSession[] {
  const mondayDate = mondayOfIsoWeek(anchorIso);
  const sessions: MarketCalendarSession[] = [];
  for (let i = 0; i <= 4; i++) {
    sessions.push({ sessionDate: addDaysToDateStr(mondayDate, i), openEt: '09:30:00', closeEt: '16:00:00' });
  }
  return sessions;
}
