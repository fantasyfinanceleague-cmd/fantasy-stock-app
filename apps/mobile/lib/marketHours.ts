/**
 * Market Hours Utility
 * Detects if US stock market is currently open
 */

// US Stock Market hours: 9:30 AM - 4:00 PM ET
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 16;
const MARKET_CLOSE_MINUTE = 0;

// Market holidays (2025-2026)
const MARKET_HOLIDAYS = [
  // 2025
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
  // 2026
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
];

/**
 * Get current time components in ET timezone
 * Uses Intl.DateTimeFormat for reliable cross-platform timezone conversion
 */
function getEasternTimeComponents(): { hours: number; minutes: number; dayOfWeek: number; dateStr: string } {
  const now = new Date();

  // Use Intl.DateTimeFormat for reliable timezone conversion
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const getPart = (type: string): string => parts.find(p => p.type === type)?.value || '0';

  const hours = parseInt(getPart('hour'), 10) % 24; // Handle "24" as 0
  const minutes = parseInt(getPart('minute'), 10);

  const weekdayStr = getPart('weekday');
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const dayOfWeek = weekdayMap[weekdayStr] ?? 0;

  const year = getPart('year');
  const month = getPart('month');
  const day = getPart('day');
  const dateStr = `${year}-${month}-${day}`;

  return { hours, minutes, dayOfWeek, dateStr };
}

/**
 * Check if today is a market holiday
 */
function isMarketHoliday(): boolean {
  const { dateStr } = getEasternTimeComponents();
  return MARKET_HOLIDAYS.includes(dateStr);
}

/**
 * Check if the market is currently open
 * Returns true during regular trading hours (9:30 AM - 4:00 PM ET, Mon-Fri)
 */
export function isMarketOpen(): boolean {
  const { hours, minutes, dayOfWeek } = getEasternTimeComponents();

  // Check if weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Sunday or Saturday

  // Check if holiday
  if (isMarketHoliday()) return false;

  // Check time
  const currentMinutes = hours * 60 + minutes;
  const openMinutes = MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE;
  const closeMinutes = MARKET_CLOSE_HOUR * 60 + MARKET_CLOSE_MINUTE;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

/**
 * Check if we're in pre-market hours (4:00 AM - 9:30 AM ET)
 */
export function isPreMarket(): boolean {
  const { hours, minutes, dayOfWeek } = getEasternTimeComponents();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  if (isMarketHoliday()) return false;

  const currentMinutes = hours * 60 + minutes;

  return currentMinutes >= 4 * 60 && currentMinutes < (MARKET_OPEN_HOUR * 60 + MARKET_OPEN_MINUTE);
}

/**
 * Check if we're in after-hours (4:00 PM - 8:00 PM ET)
 */
export function isAfterHours(): boolean {
  const { hours, minutes, dayOfWeek } = getEasternTimeComponents();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  if (isMarketHoliday()) return false;

  const currentMinutes = hours * 60 + minutes;

  return currentMinutes >= (MARKET_CLOSE_HOUR * 60) && currentMinutes < 20 * 60;
}

export type MarketStatus = 'open' | 'pre-market' | 'after-hours' | 'closed';

/**
 * Get market status as string
 */
export function getMarketStatus(): MarketStatus {
  if (isMarketOpen()) return 'open';
  if (isPreMarket()) return 'pre-market';
  if (isAfterHours()) return 'after-hours';
  return 'closed';
}

/**
 * Get a human-readable market status message
 */
export function getMarketStatusMessage(): string {
  const status = getMarketStatus();

  switch (status) {
    case 'open':
      return 'Market is open';
    case 'pre-market':
      return 'Pre-market (opens 9:30 AM ET)';
    case 'after-hours':
      return 'After-hours trading';
    case 'closed':
      const { dayOfWeek } = getEasternTimeComponents();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return 'Market closed (weekend)';
      }
      if (isMarketHoliday()) {
        return 'Market closed (holiday)';
      }
      return 'Market closed';
  }
}

/**
 * Check if trading is allowed
 * For now, we allow trading during market hours only
 * (Extended hours trading could be added later)
 */
export function isTradingAllowed(): boolean {
  return isMarketOpen();
}
