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
