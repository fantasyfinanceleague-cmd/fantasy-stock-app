// src/utils/marketHolidays.js

/**
 * US Stock Market Holidays (NYSE/NASDAQ)
 *
 * Fixed holidays:
 * - New Year's Day: January 1
 * - Juneteenth: June 19
 * - Independence Day: July 4
 * - Christmas Day: December 25
 *
 * Floating holidays:
 * - MLK Day: 3rd Monday of January
 * - Presidents' Day: 3rd Monday of February
 * - Good Friday: Friday before Easter Sunday
 * - Memorial Day: Last Monday of May
 * - Labor Day: 1st Monday of September
 * - Thanksgiving: 4th Thursday of November
 *
 * Note: When a fixed holiday falls on Saturday, markets close Friday.
 * When it falls on Sunday, markets close Monday.
 */

/**
 * Get the Nth occurrence of a weekday in a month
 * @param {number} year
 * @param {number} month - 0-indexed (0 = January)
 * @param {number} weekday - 0 = Sunday, 1 = Monday, etc.
 * @param {number} n - Which occurrence (1 = first, 2 = second, etc.)
 * @returns {Date}
 */
function getNthWeekdayOfMonth(year, month, weekday, n) {
  const date = new Date(year, month, 1);
  let count = 0;

  while (count < n) {
    if (date.getDay() === weekday) {
      count++;
      if (count === n) break;
    }
    date.setDate(date.getDate() + 1);
  }

  return date;
}

/**
 * Get the last occurrence of a weekday in a month
 * @param {number} year
 * @param {number} month - 0-indexed
 * @param {number} weekday - 0 = Sunday, 1 = Monday, etc.
 * @returns {Date}
 */
function getLastWeekdayOfMonth(year, month, weekday) {
  const date = new Date(year, month + 1, 0); // Last day of month

  while (date.getDay() !== weekday) {
    date.setDate(date.getDate() - 1);
  }

  return date;
}

/**
 * Calculate Easter Sunday using the Anonymous Gregorian algorithm
 * @param {number} year
 * @returns {Date}
 */
function getEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(year, month, day);
}

/**
 * Adjust holiday date for weekend observance
 * If Saturday -> observe Friday, if Sunday -> observe Monday
 * @param {Date} date
 * @returns {Date}
 */
function adjustForWeekend(date) {
  const day = date.getDay();
  const adjusted = new Date(date);

  if (day === 6) { // Saturday -> Friday
    adjusted.setDate(adjusted.getDate() - 1);
  } else if (day === 0) { // Sunday -> Monday
    adjusted.setDate(adjusted.getDate() + 1);
  }

  return adjusted;
}

/**
 * Get all market holidays for a given year
 * @param {number} year
 * @returns {Array<{date: Date, name: string}>}
 */
export function getMarketHolidays(year) {
  const holidays = [];

  // New Year's Day - January 1
  holidays.push({
    date: adjustForWeekend(new Date(year, 0, 1)),
    name: "New Year's Day"
  });

  // MLK Day - 3rd Monday of January
  holidays.push({
    date: getNthWeekdayOfMonth(year, 0, 1, 3),
    name: 'Martin Luther King Jr. Day'
  });

  // Presidents' Day - 3rd Monday of February
  holidays.push({
    date: getNthWeekdayOfMonth(year, 1, 1, 3),
    name: "Presidents' Day"
  });

  // Good Friday - Friday before Easter
  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  holidays.push({
    date: goodFriday,
    name: 'Good Friday'
  });

  // Memorial Day - Last Monday of May
  holidays.push({
    date: getLastWeekdayOfMonth(year, 4, 1),
    name: 'Memorial Day'
  });

  // Juneteenth - June 19
  holidays.push({
    date: adjustForWeekend(new Date(year, 5, 19)),
    name: 'Juneteenth'
  });

  // Independence Day - July 4
  holidays.push({
    date: adjustForWeekend(new Date(year, 6, 4)),
    name: 'Independence Day'
  });

  // Labor Day - 1st Monday of September
  holidays.push({
    date: getNthWeekdayOfMonth(year, 8, 1, 1),
    name: 'Labor Day'
  });

  // Thanksgiving - 4th Thursday of November
  holidays.push({
    date: getNthWeekdayOfMonth(year, 10, 4, 4),
    name: 'Thanksgiving'
  });

  // Christmas - December 25
  holidays.push({
    date: adjustForWeekend(new Date(year, 11, 25)),
    name: 'Christmas Day'
  });

  return holidays;
}

/**
 * Check if a date is a market holiday
 * @param {Date} date
 * @returns {{isHoliday: boolean, name: string|null}}
 */
export function isMarketHoliday(date) {
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

/**
 * Get all holidays that fall within a date range (inclusive)
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array<{date: Date, name: string}>}
 */
export function getHolidaysInRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  // Get holidays for all years in the range
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  const allHolidays = [];
  for (let year = startYear; year <= endYear; year++) {
    allHolidays.push(...getMarketHolidays(year));
  }

  // Filter to those within the range
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  return allHolidays.filter(h => {
    const hStr = h.date.toISOString().split('T')[0];
    return hStr >= startStr && hStr <= endStr;
  });
}

/**
 * Count trading days in a week (excluding weekends and holidays)
 * @param {Date} weekStart - Tuesday
 * @param {Date} weekEnd - Friday
 * @returns {{tradingDays: number, totalDays: number, holidays: Array}}
 */
export function countTradingDays(weekStart, weekEnd) {
  const holidays = getHolidaysInRange(weekStart, weekEnd);

  // Tuesday to Friday = 4 potential trading days
  const totalDays = 4;
  const tradingDays = totalDays - holidays.length;

  return {
    tradingDays,
    totalDays,
    holidays
  };
}
