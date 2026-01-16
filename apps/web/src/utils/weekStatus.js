// src/utils/weekStatus.js
import { isMarketHoliday, getMarketHolidays } from './marketHolidays';

/**
 * Get the next Monday from a given date
 * @param {Date} date
 * @returns {Date}
 */
function getNextMonday(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Check if the next Monday is a market holiday
 * @returns {{ isHoliday: boolean, holidayName: string|null, nextTradingDay: string }}
 */
export function isNextMondayHoliday() {
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

/**
 * Determine if we're currently in a weekend (Saturday or Sunday)
 * @returns {boolean}
 */
export function isWeekend() {
  const day = new Date().getDay();
  return day === 0 || day === 6;
}

/**
 * Determine if we're after market close on Friday (4 PM ET)
 * @returns {boolean}
 */
export function isAfterFridayClose() {
  const now = new Date();
  const day = now.getDay();

  if (day !== 5) return false; // Not Friday

  // Convert to ET (approximate - doesn't account for DST perfectly)
  const etOffset = -5; // EST
  const utcHours = now.getUTCHours();
  const etHours = utcHours + etOffset;

  return etHours >= 16; // 4 PM ET
}

/**
 * Get the current day of week (0 = Sunday, 1 = Monday, etc.)
 * @returns {number}
 */
function getDayOfWeek() {
  return new Date().getDay();
}

/**
 * Determine the week status for a matchup league
 * @param {Object} league - League object with current_week, num_weeks
 * @param {Object} matchup - Current matchup object with winner_user_id, team1_gain, team2_gain
 * @returns {Object} Week status information
 */
export function getWeekStatus(league, matchup) {
  const currentWeek = league?.current_week || 1;
  const numWeeks = league?.num_weeks || 0;
  const isSeasonComplete = currentWeek > numWeeks;

  // Check if matchup has results (week is complete)
  const isWeekComplete = matchup && (
    matchup.winner_user_id !== null ||
    matchup.is_tie === true ||
    (matchup.team1_gain !== null && matchup.team2_gain !== null)
  );

  // Determine if we're in a transition period (weekend)
  const dayOfWeek = getDayOfWeek();
  const isInWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const isAfterClose = isAfterFridayClose();
  const isTransitionPeriod = isInWeekend || isAfterClose;

  // Check for holiday
  const holidayInfo = isNextMondayHoliday();

  // Determine status
  let status = 'active'; // Default: week in progress
  let countdown = null;

  if (isSeasonComplete) {
    status = 'season_complete';
  } else if (isWeekComplete && isTransitionPeriod) {
    status = 'final';
    // Show countdown to next week
    countdown = getRelativeCountdown(currentWeek + 1, holidayInfo);
  } else if (isWeekComplete) {
    status = 'final';
  } else if (isTransitionPeriod && !isWeekComplete) {
    // Weekend but results not in yet
    status = 'pending_results';
  }

  return {
    status,
    currentWeek,
    numWeeks,
    isWeekComplete,
    isSeasonComplete,
    isTransitionPeriod,
    countdown,
    isHoliday: holidayInfo.isHoliday,
    holidayName: holidayInfo.holidayName,
    nextTradingDay: holidayInfo.nextTradingDay
  };
}

/**
 * Get relative countdown text for the next week
 * @param {number} nextWeek - The upcoming week number
 * @param {Object} holidayInfo - Holiday information from isNextMondayHoliday()
 * @returns {string}
 */
export function getRelativeCountdown(nextWeek, holidayInfo = null) {
  const info = holidayInfo || isNextMondayHoliday();

  if (info.isHoliday) {
    return `Week ${nextWeek} starts Tuesday`;
  }

  return `Week ${nextWeek} starts Monday`;
}

/**
 * Determine if the week is currently active (Monday-Friday, market hours)
 * @param {Object} matchup - Matchup object
 * @returns {boolean}
 */
export function isWeekActive(matchup) {
  if (!matchup) return false;

  // If matchup has results, it's not active
  if (matchup.winner_user_id !== null || matchup.is_tie === true) {
    return false;
  }

  // If both gains are populated, results are in
  if (matchup.team1_gain !== null && matchup.team2_gain !== null) {
    return false;
  }

  // Check if we're in a weekday
  const day = getDayOfWeek();
  if (day === 0 || day === 6) return false; // Weekend

  return true;
}

/**
 * Get status badge configuration
 * @param {string} status - Status from getWeekStatus
 * @param {number} week - Week number
 * @param {Object} options - Additional options
 * @returns {Object|null} Badge configuration
 */
export function getStatusBadge(status, week, options = {}) {
  const { countdown, isHoliday, holidayName } = options;

  switch (status) {
    case 'final':
      return {
        type: 'final',
        text: 'Final',
        className: 'badge-final'
      };

    case 'active':
      return {
        type: 'live',
        text: 'Live',
        className: 'badge-live'
      };

    case 'pending_results':
      return {
        type: 'pending',
        text: 'Results Pending',
        className: 'badge-pending'
      };

    case 'season_complete':
      return {
        type: 'champion',
        text: 'Season Complete',
        className: 'badge-champion'
      };

    default:
      return null;
  }
}

/**
 * Format the countdown/next week message
 * @param {Object} weekStatus - Status object from getWeekStatus
 * @returns {string|null}
 */
export function getCountdownMessage(weekStatus) {
  const { status, countdown, isHoliday, holidayName, currentWeek, numWeeks } = weekStatus;

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
