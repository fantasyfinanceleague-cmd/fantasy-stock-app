// src/utils/marketHours.js

/**
 * Market Hours Utility
 * Detects if US stock market is currently open
 */

// US Stock Market hours: 9:30 AM - 4:00 PM ET
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Market holidays (2025) - Add more as needed
const MARKET_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-20', // MLK Day
  '2025-02-17', // Presidents Day
  '2025-04-18', // Good Friday
  '2025-05-26', // Memorial Day
  '2025-06-19', // Juneteenth
  '2025-07-04', // Independence Day
  '2025-09-01', // Labor Day
  '2025-11-27', // Thanksgiving
  '2025-12-25', // Christmas
];

/**
 * Get current time in ET timezone
 */
function getEasternTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

/**
 * Check if today is a market holiday
 */
function isMarketHoliday(date = new Date()) {
  const etDate = getEasternTime();
  const dateStr = etDate.toISOString().split('T')[0];
  return MARKET_HOLIDAYS_2025.includes(dateStr);
}

/**
 * Check if the market is currently open
 * Returns true during regular trading hours (9:30 AM - 4:00 PM ET, Mon-Fri)
 */
export function isMarketOpen() {
  const now = getEasternTime();

  // Check if weekend
  const day = now.getDay();
  if (day === 0 || day === 6) return false; // Sunday or Saturday

  // Check if holiday
  if (isMarketHoliday(now)) return false;

  // Check time
  const hours = now.getHours();
  const minutes = now.getMinutes();

  const currentMinutes = hours * 60 + minutes;
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/**
 * Check if we're in pre-market hours (4:00 AM - 9:30 AM ET)
 */
export function isPreMarket() {
  const now = getEasternTime();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  if (isMarketHoliday(now)) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  return currentMinutes >= 4 * 60 && currentMinutes < (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE);
}

/**
 * Check if we're in after-hours (4:00 PM - 8:00 PM ET)
 */
export function isAfterHours() {
  const now = getEasternTime();
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  if (isMarketHoliday(now)) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  return currentMinutes >= (MARKET_CLOSE_HOUR * 60) && currentMinutes < 20 * 60;
}

/**
 * Get market status as string
 * Returns: 'open', 'pre-market', 'after-hours', 'closed'
 */
export function getMarketStatus() {
  if (isMarketOpen()) return 'open';
  if (isPreMarket()) return 'pre-market';
  if (isAfterHours()) return 'after-hours';
  return 'closed';
}

/**
 * Get next market open time
 */
export function getNextMarketOpen() {
  const now = getEasternTime();
  let nextOpen = new Date(now);

  // If currently in trading hours, next open is tomorrow
  if (isMarketOpen()) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  }

  // Skip to next weekday
  while (nextOpen.getDay() === 0 || nextOpen.getDay() === 6 || isMarketHoliday(nextOpen)) {
    nextOpen.setDate(nextOpen.getDate() + 1);
  }

  // Set to 9:30 AM
  nextOpen.setHours(MARKET_OPEN_HOUR, MARKET_OPEN_MINUTE, 0, 0);

  return nextOpen;
}

/**
 * Get time until market opens (in milliseconds)
 */
export function getTimeUntilMarketOpen() {
  if (isMarketOpen()) return 0;

  const now = getEasternTime();
  const nextOpen = getNextMarketOpen();

  return nextOpen.getTime() - now.getTime();
}

/**
 * Get recommended polling interval based on market status
 * Returns interval in milliseconds
 */
export function getPollingInterval() {
  const status = getMarketStatus();

  switch (status) {
    case 'open':
      return 10_000; // 10 seconds during market hours
    case 'pre-market':
    case 'after-hours':
      return 30_000; // 30 seconds during extended hours
    default:
      return 120_000; // 2 minutes when market is closed
  }
}
