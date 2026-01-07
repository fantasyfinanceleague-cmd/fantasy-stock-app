// Utility functions for formatting data

/**
 * Shorten long official names for UI display
 * Removes common suffixes like "Common Stock", "Class A", etc.
 * @param {string} raw - The raw company name
 * @returns {string} - The prettified name
 */
export function prettyName(raw = '') {
  return String(raw)
    .replace(/\s*[-–—]?\s*Common Stock$/i, '')
    .replace(/\s*Depositary Shares?.*$/i, '')
    .replace(/\s*ADR?s?$/i, '')
    .replace(/\s*Class [A-Z]\b.*$/i, '')
    .replace(/\s*[-–—,:;.]?\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Format a number as USD currency
 * @param {number} n - The number to format
 * @returns {string} - Formatted currency string
 */
export function formatUSD(n) {
  return `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

/**
 * Format a number as percentage
 * @param {number} n - The number to format
 * @param {boolean} includeSign - Whether to include + for positive numbers
 * @returns {string} - Formatted percentage string
 */
export function formatPercent(n, includeSign = false) {
  const formatted = `${Number(n || 0).toFixed(2)}%`;
  return includeSign && n >= 0 ? `+${formatted}` : formatted;
}

/**
 * Format a user ID for display
 * Shows friendly names for bots and truncated IDs for real users
 * @param {string} uid - The user ID
 * @param {string} currentUserId - The current user's ID (to show "You")
 * @returns {string} - Formatted display name
 */
export function formatUserId(uid, currentUserId = null) {
  if (!uid) return 'Unknown';

  // Show "You" for current user
  if (currentUserId && uid === currentUserId) {
    return 'You';
  }

  // Format bot names nicely
  if (uid.startsWith('bot-')) {
    const num = uid.replace('bot-', '');
    return `Bot ${num}`;
  }

  // Truncate long UUIDs
  if (uid.length > 12) {
    return uid.substring(0, 8) + '...';
  }

  return uid;
}
