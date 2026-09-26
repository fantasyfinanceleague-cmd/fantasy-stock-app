// lib/weekStatus.ts

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

export function getSeasonPhase(league: League | null, now: Date = new Date()): SeasonPhase {
  if (!league) return 'pre_draft';
  if (league.draft_status === 'not_started') return 'pre_draft';
  if (league.draft_status === 'in_progress') return 'drafting';

  // draft_status is 'completed' (or a legacy/unrecognized value — treated the
  // same as the rest of this file treats an unrecognized draft_status).
  if (league.league_start_date) {
    const start = new Date(league.league_start_date);
    if (!Number.isNaN(start.getTime()) && start.getTime() > now.getTime()) {
      return 'pre_season';
    }
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

function parseLeagueStartDate(league: League | null): Date | null {
  const raw = league?.league_start_date;
  if (!raw) return null;
  const start = new Date(raw);
  return Number.isNaN(start.getTime()) ? null : start;
}

/** Short copy for a phase that precedes the ordinary season lifecycle. Empty
 * string for 'regular'/'playoffs'/'completed' — callers already have their
 * own copy for those and should keep using it. Shared by the League tab and
 * Home so both show the same words for the same phase (see CLAUDE.md's "UI
 * entry points" note on the Week-1-Live bug appearing in two places). */
export function getSeasonLabel(phase: SeasonPhase, league: League | null): string {
  switch (phase) {
    case 'pre_draft':
      return 'Draft pending';
    case 'drafting':
      return 'Drafting';
    case 'pre_season': {
      const start = parseLeagueStartDate(league);
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
export function formatSeasonStartShort(league: League | null): string {
  const start = parseLeagueStartDate(league);
  return start ? formatShortMonthDay(start) : 'Soon';
}

interface Matchup {
  winner_user_id?: string | null;
  is_tie?: boolean;
  team1_gain?: number | null;
  team2_gain?: number | null;
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

export function isNextMondayHoliday(): HolidayInfo {
  const nextMonday = getNextMonday();
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

export function isAfterFridayClose(): boolean {
  const now = new Date();
  const day = now.getDay();

  if (day !== 5) return false;

  // Approximate ET conversion
  const etOffset = -5;
  const utcHours = now.getUTCHours();
  const etHours = utcHours + etOffset;

  return etHours >= 16;
}

function getDayOfWeek(): number {
  return new Date().getDay();
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
    (matchup.team1_gain !== null && matchup.team2_gain !== null)
  );

  const dayOfWeek = getDayOfWeek();
  const isInWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isAfterClose = isAfterFridayClose();
  const isTransitionPeriod = isInWeekend || isAfterClose;

  const holidayInfo = isNextMondayHoliday();

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

export function getPlayoffRoundLabel(round: string | null | undefined): string | null {
  if (!round) return null;
  const labels: Record<string, string> = {
    quarter: 'Quarterfinals',
    semi: 'Semifinals',
    finals: 'Finals',
  };
  return labels[round] || round;
}

export function isWeekActive(matchup: Matchup | null): boolean {
  if (!matchup) return false;

  if (matchup.winner_user_id !== null || matchup.is_tie === true) {
    return false;
  }

  if (matchup.team1_gain !== null && matchup.team2_gain !== null) {
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
