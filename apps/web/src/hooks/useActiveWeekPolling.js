// src/hooks/useActiveWeekPolling.js
import { useEffect, useRef } from 'react';

/**
 * Custom hook for polling prices during active matchup weeks
 * Refreshes prices every 5 minutes when the week is active
 *
 * @param {string} leagueId - The league ID
 * @param {boolean} isActive - Whether the week is currently active
 * @param {Function} fetchPrices - Function to fetch prices (from PriceContext)
 * @param {string[]} symbols - Array of stock symbols to fetch
 * @param {number} intervalMs - Polling interval in milliseconds (default: 5 minutes)
 */
export function useActiveWeekPolling(
  leagueId,
  isActive,
  fetchPrices,
  symbols,
  intervalMs = 5 * 60 * 1000 // 5 minutes
) {
  const intervalRef = useRef(null);
  const symbolsKey = symbols?.join(',') || '';

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Only poll if active week and we have symbols
    if (!isActive || !leagueId || !symbols || symbols.length === 0) {
      return;
    }

    // Initial fetch with force refresh
    if (fetchPrices && symbols.length > 0) {
      fetchPrices(symbols, true);
    }

    // Set up polling interval
    intervalRef.current = setInterval(() => {
      if (fetchPrices && symbols.length > 0) {
        fetchPrices(symbols, true);
      }
    }, intervalMs);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [leagueId, isActive, symbolsKey, intervalMs]);

  // Handle visibility change - pause when tab is hidden
  useEffect(() => {
    if (!isActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab hidden - clear interval
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        // Tab visible - restart polling
        if (fetchPrices && symbols && symbols.length > 0) {
          fetchPrices(symbols, true);

          intervalRef.current = setInterval(() => {
            fetchPrices(symbols, true);
          }, intervalMs);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isActive, symbolsKey, intervalMs]);
}
