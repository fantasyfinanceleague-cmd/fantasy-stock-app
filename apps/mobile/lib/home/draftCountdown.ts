/**
 * draftCountdown: pure date/time formatting for the pre-draft card (Design
 * Lead ruling, 2026-09-30, B4) -- the board's "Sat, Oct 3 · 7:00 PM ET"
 * date line, the "3d 04h 12m" countdown, and "Draft order set Sat 6:00 PM
 * ET, an hour before the draft". All three are ALWAYS-ET, weekday-aware
 * formatting off a real ISO timestamp (league.draft_date /
 * DraftOrderInfo.finalizeAt) -- never a hardcoded string, the same
 * discipline homeCopy.ts's endsAtLabel/marketResumesAt already follow.
 *
 * No market-calendar involvement here (unlike marketWeek.ts): a draft date
 * is a specific instant a commissioner picked, not a trading-session
 * boundary, so there's nothing to resolve against a calendar -- just
 * format it in ET.
 */

const ET_WEEKDAY_DATE: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
};
const ET_TIME: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' };
const ET_WEEKDAY_TIME: Intl.DateTimeFormatOptions = {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
};

/** "Sat, Oct 3 · 7:00 PM ET" (board) from a real ISO timestamp. Built from
 * two plain `.format()` calls, never `formatToParts()` -- Hermes's Intl
 * (this app's RN runtime) does not reliably return `hour`/`minute`/
 * `dayPeriod` parts, even though `.format()` itself renders them
 * correctly (the same gap homeCopy.ts's endsAtLabel/marketResumesAt
 * already route around by using `.format()` alone). */
export function draftDateTimeLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const datePart = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_DATE).format(d); // "Sat, Oct 3"
  const timePart = new Intl.DateTimeFormat('en-US', ET_TIME).format(d); // "7:00 PM"
  return `${datePart} · ${timePart} ET`; // board
}

/** "The draft room opens Sat 6:00 PM ET, when the order is set." (board,
 * Home's draft card, PR #135; it matches the lobby's line) from
 * DraftOrderInfo.finalizeAt -- draft_date minus 1h, when the room opens and
 * the order takes effect. Home shows it BEFORE the room opens. Null
 * (order-set time unknown) omits the whole line -- the caller shows
 * OrderWaiting instead in that case. */
export function orderSetLine(finalizeAtIso: string | null): string | null {
  if (!finalizeAtIso) return null;
  const d = new Date(finalizeAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_TIME).format(d);
  return `The draft room opens ${formatted} ET, when the order is set.`; // board
}

/** "Draft order set Sat 6:00 PM ET, an hour before the draft" (the board's
 * earlier wording), for the lobby's revealed-order card, which shows AFTER the
 * order is set: orderSetLine's future tense would be wrong there. */
export function orderWasSetLine(finalizeAtIso: string | null): string | null {
  if (!finalizeAtIso) return null;
  const d = new Date(finalizeAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const formatted = new Intl.DateTimeFormat('en-US', ET_WEEKDAY_TIME).format(d);
  return `Draft order set ${formatted} ET, an hour before the draft`; // board
}

/** "3d 04h 12m" (board) -- the largest non-zero unit leads unpadded,
 * smaller units that follow are always 2-digit. Rounds DOWN to the
 * minute (spec: "updates each minute, no animation" -- a ticking-seconds
 * countdown was explicitly not asked for). Null once `targetIso` has
 * passed or is missing -- the caller falls back to OrderWaiting/no line,
 * never a negative countdown. */
export function countdownLabel(now: Date, targetIso: string | null): string | null {
  if (!targetIso) return null;
  const target = new Date(targetIso);
  if (Number.isNaN(target.getTime())) return null;
  const totalMs = target.getTime() - now.getTime();
  if (totalMs <= 0) return null;
  const totalMinutes = Math.floor(totalMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  return `${minutes}m`;
}
