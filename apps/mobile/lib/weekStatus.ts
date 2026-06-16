// lib/weekStatus.ts

interface HolidayInfo {
  isHoliday: boolean;
  holidayName: string | null;
  nextTradingDay: string;
}

interface WeekStatus {
  status: 'active' | 'final' | 'pending_results' | 'season_complete';
  phase: 'regular' | 'playoffs' | 'completed';
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
  num_weeks?: number;
  league_type?: string;
  season_status?: string;
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

export function getWeekStatus(league: League | null, matchup: Matchup | null): WeekStatus {
  const currentWeek = league?.current_week || 1;
  const numWeeks = league?.num_weeks || 0;
  const seasonStatus = league?.season_status || 'active';

  // Derive phase from season_status (DB source of truth)
  let phase: 'regular' | 'playoffs' | 'completed' = 'regular';
  if (seasonStatus === 'completed') phase = 'completed';
  else if (seasonStatus === 'playoffs') phase = 'playoffs';
  else if (currentWeek > numWeeks && numWeeks > 0) phase = 'completed'; // fallback for legacy data

  const isSeasonComplete = phase === 'completed';

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

  if (isSeasonComplete) {
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
