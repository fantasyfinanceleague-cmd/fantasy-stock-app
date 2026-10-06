// lib/weekStatus.ts

import { resolveWeekWindow, type MarketCalendarSession } from './time/marketWeek';

interface HolidayInfo {
  isHoliday: boolean;
  holidayName: string | null;
  nextTradingDay: string;
}

interface WeekStatus {
  status: 'upcoming' | 'active' | 'final' | 'pending_results' | 'season_complete';
  phase: 'regular' | 'playoffs' | 'completed';
  seasonPhase: SeasonPhase;
  currentWeek: number;
  numWeeks: number;
  isWeekComplete: boolean;
  isSeasonComplete: boolean;
  isTransitionPeriod: boolean;
  countdown: string | null;
  isHoliday: boolean;
  holidayName: string | null;
  nextTradingDay: string;
}

interface League {
  current_week?: number;
  // LeagueContext.League types this `number | null` — widened here (was
  // `number`) so passing the real League type through doesn't need a cast.
  num_weeks?: number | null;
  league_type?: string;
  season_status?: string;
  draft_status?: string;
  league_start_date?: string | null;
}

/**
 * Where a league sits before it reaches its ordinary regular/playoffs/
 * completed season lifecycle. Read draft_status FIRST, before any
 * season_status/current_week fallback — those fields default to
 * 'active'/1 for a league whose draft hasn't even started, which is why
 * getWeekStatus used to fall through to an 'active' ("Live") status for a
 * league still waiting on its draft (League tab + Home "Season N · Week 1"
 * bug, see CLAUDE.md's "Guards keyed on ALL-OR-NOTHING state" note: current_week
 * defaulting to 1 was read as "week 1 is live" rather than "no week yet").
 */
export type SeasonPhase = 'pre_draft' | 'drafting' | 'pre_season' | 'regular' | 'playoffs' | 'completed';

/**
 * T0: the instant the season really starts, i.e. week 1's FIRST CALENDAR OPEN
 * (U1, docs/audits/2026-09-30-week-window-audit.md). `league_start_date` is
 * week 1's stored `week_start`, a nominal Tuesday 14:30Z (_shared/schedule.ts),
 * but the Monday baseline is cut at Monday's open. Treating the stored value
 * as the boundary left all of week-1 Monday reading as pre-season while
 * roster moves landed in the unscored gap. resolveWeekWindow finds the real
 * first session of that ISO week (Tuesday's open on a holiday Monday), the
 * same derivation as Home's B3. With no calendar coverage it falls back to
 * the stored value, as Home does, rather than inventing an open time.
 */
export function seasonStartInstant(league: League | null, marketCalendar: MarketCalendarSession[] = []): Date | null {
  const raw = league?.league_start_date;
  if (!raw) return null;
  const stored = new Date(raw);
  if (Number.isNaN(stored.getTime())) return null;
  const t0 = resolveWeekWindow(raw, marketCalendar)?.weekStart;
  return t0 ? new Date(t0) : stored;
}

export function getSeasonPhase(
  league: League | null,
  now: Date = new Date(),
  marketCalendar: MarketCalendarSession[] = [],
): SeasonPhase {
  if (!league) return 'pre_draft';
  if (league.draft_status === 'not_started') return 'pre_draft';
  if (league.draft_status === 'in_progress') return 'drafting';

  // draft_status is 'completed' (or a legacy/unrecognized value — treated the
  // same as the rest of this file treats an unrecognized draft_status).
  const start = seasonStartInstant(league, marketCalendar);
  if (start && start.getTime() > now.getTime()) {
    return 'pre_season';
  }

  const currentWeek = league.current_week || 1;
  const numWeeks = league.num_weeks || 0;
  if (league.season_status === 'completed') return 'completed';
  if (league.season_status === 'playoffs') return 'playoffs';
  if (currentWeek > numWeeks && numWeeks > 0) return 'completed'; // fallback for legacy data
  return 'regular';
}

/** True for any phase that precedes the ordinary regular/playoffs/completed
 * season lifecycle — shared by getWeekStatus (to force status='upcoming')
 * and by screens that need to branch their own rendering on the same
 * condition, so the two checks can't drift apart. */
export function isPreSeasonPhase(phase: SeasonPhase): boolean {
  return phase === 'pre_draft' || phase === 'drafting' || phase === 'pre_season';
}

/** "Tue, Sep 29" — weekday + month + day, no year, no time. The single date
 * format shared by every pre-season surface (banner pill, getSeasonLabel,
 * and the Draft screen's timestamps via formatShortDateTime) so the app
 * never shows two different date formats for the same moment. */
export function formatShortWeekdayDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Sep 29" — month + day only, no weekday. For tight spaces (the Week KPI
 * card) where formatShortWeekdayDate's weekday made a two-line date wrap
 * inside a value slot sized for one short line. */
export function formatShortMonthDay(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Tue, Sep 29 · 6:43 PM" — date (see formatShortWeekdayDate) plus time,
 * deliberately without seconds: the Draft screen's timestamps used to go
 * through Date#toLocaleString(), which includes seconds and the year
 * ("9/25/2026, 6:43:59 PM") — more precision than a schedule needs and a
 * different format than every other date on the app. Accepts an ISO string
 * or a Date so callers don't all repeat `new Date(x)`. */
export function formatShortDateTime(input: string | Date): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return 'Invalid date';
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${formatShortWeekdayDate(d)} · ${time}`;
}


/** Short copy for a phase that precedes the ordinary season lifecycle. Empty
 * string for 'regular'/'playoffs'/'completed' — callers already have their
 * own copy for those and should keep using it. Shared by the League tab and
 * Home so both show the same words for the same phase (see CLAUDE.md's "UI
 * entry points" note on the Week-1-Live bug appearing in two places). */
export function getSeasonLabel(phase: SeasonPhase, league: League | null, marketCalendar: MarketCalendarSession[] = []): string {
  switch (phase) {
    case 'pre_draft':
      return 'Draft pending';
    case 'drafting':
      return 'Drafting';
    case 'pre_season': {
      const start = seasonStartInstant(league, marketCalendar);
      if (!start) return 'Starts soon';
      return `Starts ${formatShortWeekdayDate(start)}`;
    }
    default:
      return '';
  }
}

/** "Sep 29" for the Week KPI card's pre_season value — same source date as
 * getSeasonLabel's "Starts Tue, Sep 29", just without the weekday or the
 * "Starts" prefix (the KPI's own label already reads "Week", and its sub
 * line carries "starts · N weeks"). 'Soon' mirrors getSeasonLabel's
 * 'Starts soon' fallback for a missing/invalid date. */
export function formatSeasonStartShort(league: League | null, marketCalendar: MarketCalendarSession[] = []): string {
  const start = seasonStartInstant(league, marketCalendar);
  return start ? formatShortMonthDay(start) : 'Soon';
}

/** "+$1.23" / "-$3,000.00" / "$0.00" — the one signed-money formatter for
 * every gain/loss figure in the app. Before this, each screen built the sign
 * and the `$` separately (`{x >= 0 ? '+' : ''}${formatCurrency(x)}`), and
 * `formatCurrency`'s own `toLocaleString` already prints a leading `-` for a
 * negative number, so a loss rendered as "$-3,000.00" — the minus landed
 * after the `$` instead of before it (Home "THIS WEEK" pre-season cards).
 * An exact zero renders with no sign ("$0.00"), not "+$0.00": zero is
 * neither a gain nor a loss, and a bare `+` in front of it reads as one.
 *
 * Branches on the value rounded to whole cents, not the raw float: a value
 * like -0.004 is a real negative number but displays as "$0.00" once
 * rounded to two decimals, and branching on the unrounded sign would print
 * "-$0.00" — a minus sign in front of a number that reads as zero. Rounding
 * first means the sign shown always matches the two decimals shown next to
 * it. Math.round ties round toward +Infinity (JS's own rule), so a value
 * that rounds to exactly zero (e.g. -0.005, which is -0.4999...994 once
 * doubles round it) comes out as an unsigned "$0.00", not "-$0.01". */
export function formatSignedCurrency(value: number): string {
  const cents = Math.round(value * 100);
  const magnitude = (Math.abs(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (cents > 0) return `+$${magnitude}`;
  if (cents < 0) return `-$${magnitude}`;
  return `$${magnitude}`;
}

/** Whether the server would accept a trade for a league in this phase.
 * Mirrors supabase/functions/record-trade/index.ts's own gate exactly — it
 * refuses every buy/sell with `draft_not_completed` unless
 * `league.draft_status === 'completed'` (the only write path for trades;
 * the client-side INSERT policy on `trades` was dropped in
 * 20260811000002_trades_drop_direct_client_insert.sql). 'pre_season' is
 * `completed` with a future `league_start_date`, so trading is allowed
 * there — the draft itself is done, the server has no separate "season
 * hasn't started yet" check, and pre-season roster changes are a real,
 * currently-supported use case. Keep this in sync with that function if its
 * gate ever changes. */
export function canTradeInPhase(phase: SeasonPhase): boolean {
  return phase !== 'pre_draft' && phase !== 'drafting';
}

/** "Week 1 starts Mon, Sep 28" (T0's day, see seasonStartInstant) — the pre_season Matchup tab's headline for
 * an already-scheduled-but-not-yet-live matchup (the schedule exists once
 * the draft finalizes, so `current_week`/`league_start_date` are real by
 * this phase, unlike pre_draft/drafting where getSeasonLabel's generic copy
 * is used instead). Falls back to getSeasonLabel's "Starts soon" wording
 * for a missing/invalid start date, same as every other pre-season date
 * site in this file. */
export function getUpcomingMatchupLabel(league: League | null, marketCalendar: MarketCalendarSession[] = []): string {
  const week = league?.current_week || 1;
  const start = seasonStartInstant(league, marketCalendar);
  const startLabel = start ? formatShortWeekdayDate(start) : 'soon';
  return `Week ${week} starts ${startLabel}`;
}

interface Matchup {
  winner_user_id?: string | null;
  is_tie?: boolean;
  team1_gain?: number | null;
  team2_gain?: number | null;
  team2_user_id?: string | null;
  is_playoff?: boolean | null;
}

/**
 * A SCORED regular-season bye. Since 2026-09-29 a bye is NO RESULT: winner
 * NULL, is_tie false, team2_gain NULL, so none of the usual "has results"
 * signals fire and a scored bye week would read as live forever. The
 * discriminator is an explicitly null team2 on a non-playoff row with
 * team1_gain set (team1_gain NULL = not scored yet). An unselected team2_user_id
 * (undefined) does NOT match, so callers that don't select it keep the old
 * behaviour.
 */
function isScoredBye(m: Matchup): boolean {
  return m.team2_user_id === null && m.is_playoff !== true && m.team1_gain != null;
}

// US Market Holidays
function getMarketHolidays(year: number): { date: Date; name: string }[] {
  const holidays: { date: Date; name: string }[] = [];

  // Helper functions
  const getNthWeekdayOfMonth = (y: number, m: number, weekday: number, n: number): Date => {
    const date = new Date(y, m, 1);
    let count = 0;
    while (count < n) {
      if (date.getDay() === weekday) {
        count++;
        if (count === n) break;
      }
      date.setDate(date.getDate() + 1);
    }
    return date;
  };

  const getLastWeekdayOfMonth = (y: number, m: number, weekday: number): Date => {
    const date = new Date(y, m + 1, 0);
    while (date.getDay() !== weekday) {
      date.setDate(date.getDate() - 1);
    }
    return date;
  };

  const adjustForWeekend = (date: Date): Date => {
    const day = date.getDay();
    const adjusted = new Date(date);
    if (day === 6) adjusted.setDate(adjusted.getDate() - 1);
    else if (day === 0) adjusted.setDate(adjusted.getDate() + 1);
    return adjusted;
  };

  // New Year's Day
  holidays.push({ date: adjustForWeekend(new Date(year, 0, 1)), name: "New Year's Day" });

  // MLK Day - 3rd Monday of January
  holidays.push({ date: getNthWeekdayOfMonth(year, 0, 1, 3), name: 'Martin Luther King Jr. Day' });

  // Presidents' Day - 3rd Monday of February
  holidays.push({ date: getNthWeekdayOfMonth(year, 1, 1, 3), name: "Presidents' Day" });

  // Memorial Day - Last Monday of May
  holidays.push({ date: getLastWeekdayOfMonth(year, 4, 1), name: 'Memorial Day' });

  // Juneteenth - June 19
  holidays.push({ date: adjustForWeekend(new Date(year, 5, 19)), name: 'Juneteenth' });

  // Independence Day - July 4
  holidays.push({ date: adjustForWeekend(new Date(year, 6, 4)), name: 'Independence Day' });

  // Labor Day - 1st Monday of September
  holidays.push({ date: getNthWeekdayOfMonth(year, 8, 1, 1), name: 'Labor Day' });

  // Thanksgiving - 4th Thursday of November
  holidays.push({ date: getNthWeekdayOfMonth(year, 10, 4, 4), name: 'Thanksgiving' });

  // Christmas - December 25
  holidays.push({ date: adjustForWeekend(new Date(year, 11, 25)), name: 'Christmas Day' });

  return holidays;
}

function isMarketHoliday(date: Date): { isHoliday: boolean; name: string | null } {
  const year = date.getFullYear();
  const holidays = getMarketHolidays(year);
  const dateStr = date.toISOString().split('T')[0];

  for (const holiday of holidays) {
    const holidayStr = holiday.date.toISOString().split('T')[0];
    if (dateStr === holidayStr) {
      return { isHoliday: true, name: holiday.name };
    }
  }

  return { isHoliday: false, name: null };
}

function getNextMonday(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isNextMondayHoliday(now: Date = new Date()): HolidayInfo {
  const nextMonday = getNextMonday(now);
  const { isHoliday, name } = isMarketHoliday(nextMonday);

  if (isHoliday) {
    return {
      isHoliday: true,
      holidayName: name,
      nextTradingDay: 'Tuesday'
    };
  }

  return {
    isHoliday: false,
    holidayName: null,
    nextTradingDay: 'Monday'
  };
}

export function isWeekend(): boolean {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

export function isAfterFridayClose(now: Date = new Date()): boolean {
  const day = now.getDay();

  if (day !== 5) return false;

  // Approximate ET conversion
  const etOffset = -5;
  const utcHours = now.getUTCHours();
  const etHours = utcHours + etOffset;

  return etHours >= 16;
}

function getDayOfWeek(now: Date = new Date()): number {
  return now.getDay();
}

export function getRelativeCountdown(nextWeek: number, holidayInfo?: HolidayInfo | null, phase?: string): string {
  const info = holidayInfo || isNextMondayHoliday();
  const day = info.isHoliday ? 'Tuesday' : 'Monday';

  if (phase === 'completed') {
    return 'Season Complete';
  }

  if (phase === 'playoffs') {
    return `Playoffs continue ${day}`;
  }

  return `Week ${nextWeek} starts ${day}`;
}

export function getWeekStatus(league: League | null, matchup: Matchup | null, now: Date = new Date()): WeekStatus {
  const currentWeek = league?.current_week || 1;
  const numWeeks = league?.num_weeks || 0;
  const seasonStatus = league?.season_status || 'active';

  // Derive phase from season_status (DB source of truth)
  let phase: 'regular' | 'playoffs' | 'completed' = 'regular';
  if (seasonStatus === 'completed') phase = 'completed';
  else if (seasonStatus === 'playoffs') phase = 'playoffs';
  else if (currentWeek > numWeeks && numWeeks > 0) phase = 'completed'; // fallback for legacy data

  const isSeasonComplete = phase === 'completed';

  const seasonPhase = getSeasonPhase(league, now);
  // Draft-status-derived phases take priority over season_status/current_week
  // fallbacks below: those default to 'active'/1 for a league that hasn't
  // even drafted, which is exactly the "Week 1 · Live" bug this guards.
  const isPreSeason = isPreSeasonPhase(seasonPhase);

  const isWeekComplete = matchup && (
    matchup.winner_user_id !== null ||
    matchup.is_tie === true ||
    (matchup.team1_gain !== null && matchup.team2_gain !== null) ||
    isScoredBye(matchup)
  );

  // Threaded from getWeekStatus's own `now` param rather than reading
  // `new Date()` again here — these all used to ignore an injected `now`,
  // which made getWeekStatus's weekend/after-close branches untestable
  // (and, worse, dependent on the real day a test happened to run on).
  const dayOfWeek = getDayOfWeek(now);
  const isInWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isAfterClose = isAfterFridayClose(now);
  const isTransitionPeriod = isInWeekend || isAfterClose;

  const holidayInfo = isNextMondayHoliday(now);

  let status: WeekStatus['status'] = 'active';
  let countdown: string | null = null;

  if (isPreSeason) {
    status = 'upcoming';
  } else if (isSeasonComplete) {
    status = 'season_complete';
  } else if (isWeekComplete && isTransitionPeriod) {
    status = 'final';
    countdown = getRelativeCountdown(currentWeek + 1, holidayInfo, phase);
  } else if (isWeekComplete) {
    status = 'final';
  } else if (isTransitionPeriod && !isWeekComplete) {
    status = 'pending_results';
  }

  return {
    status,
    phase,
    seasonPhase,
    currentWeek,
    numWeeks,
    isWeekComplete: !!isWeekComplete,
    isSeasonComplete,
    isTransitionPeriod,
    countdown,
    isHoliday: holidayInfo.isHoliday,
    holidayName: holidayInfo.holidayName,
    nextTradingDay: holidayInfo.nextTradingDay
  };
}


export function isWeekActive(matchup: Matchup | null): boolean {
  if (!matchup) return false;

  if (matchup.winner_user_id !== null || matchup.is_tie === true) {
    return false;
  }

  if ((matchup.team1_gain !== null && matchup.team2_gain !== null) || isScoredBye(matchup)) {
    return false;
  }

  const day = getDayOfWeek();
  if (day === 0 || day === 6) return false;

  return true;
}

export function getCountdownMessage(weekStatus: WeekStatus): string | null {
  const { status, countdown, isHoliday, holidayName } = weekStatus;

  if (status === 'season_complete') {
    return null;
  }

  if (status === 'final' && countdown) {
    if (isHoliday) {
      return `Market closed Monday (${holidayName}) - ${countdown}`;
    }
    return countdown;
  }

  return null;
}
