// src/hooks/useRealtimePrices.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchQuotesInBatch } from '../utils/stockData';
import { isMarketOpen, getPollingInterval, getMarketStatus } from '../utils/marketHours';

/**
 * Custom hook for real-time stock price updates
 * Automatically adjusts polling frequency based on market hours
 *
 * @param {string[]} symbols - Array of stock symbols to track
 * @param {boolean} enabled - Whether polling is enabled (default: true)
 * @param {boolean} pauseWhenClosed - Stop polling entirely when market is closed (default: true)
 * @returns {object} { prices, lastUpdate, isRefreshing, refresh, marketStatus, priceChanges }
 */
export function useRealtimePrices(symbols = [], enabled = true, pauseWhenClosed = true) {
  const [prices, setPrices] = useState({});
  const [priceChanges, setPriceChanges] = useState({}); // Track price changes for animations
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketStatus, setMarketStatus] = useState(getMarketStatus());

  const intervalRef = useRef(null);
  const prevPricesRef = useRef({});

  // Refresh prices manually
  const refresh = useCallback(async () => {
    if (!symbols.length || isRefreshing) return;

    setIsRefreshing(true);
    try {
      const results = await fetchQuotesInBatch(symbols);

      if (Object.keys(results).length > 0) {
        // Track price changes for visual indicators
        const changes = {};
        Object.keys(results).forEach(symbol => {
          const oldPrice = prevPricesRef.current[symbol];
          const newPrice = results[symbol];

          if (oldPrice !== undefined && oldPrice !== newPrice) {
            changes[symbol] = newPrice > oldPrice ? 'up' : 'down';
          }
        });

        setPriceChanges(changes);
        setPrices(prev => ({ ...prev, ...results }));
        prevPricesRef.current = { ...prevPricesRef.current, ...results };
        setLastUpdate(new Date());

        // Clear price change indicators after animation
        setTimeout(() => {
          setPriceChanges({});
        }, 2000);
      }
    } catch (error) {
      console.error('Error fetching prices:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [symbols, isRefreshing]);

  // Set up smart polling based on market hours
  useEffect(() => {
    if (!enabled || !symbols.length) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Update market status
    const updateMarketStatus = () => {
      setMarketStatus(getMarketStatus());
    };

    // Initial fetch
    refresh();
    updateMarketStatus();

    // Set up polling with dynamic interval
    const setupPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      const currentStatus = getMarketStatus();

      // If pauseWhenClosed is true and market is closed, don't poll
      if (pauseWhenClosed && currentStatus === 'closed') {
        return; // Don't set up polling when market is closed
      }

      const interval = getPollingInterval();
      intervalRef.current = setInterval(() => {
        if (!document.hidden) {
          refresh();
          updateMarketStatus();
        }
      }, interval);
    };

    setupPolling();

    // Pause polling when tab is hidden
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      } else {
        refresh();
        updateMarketStatus();
        setupPolling();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Re-setup polling when market status changes (e.g., market opens/closes)
    const statusCheckInterval = setInterval(() => {
      const newStatus = getMarketStatus();
      if (newStatus !== marketStatus) {
        updateMarketStatus();
        setupPolling(); // Adjust polling interval
      }
    }, 60_000); // Check every minute

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      clearInterval(statusCheckInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [symbols, enabled, refresh, marketStatus]);

  return {
    prices,
    priceChanges,
    lastUpdate,
    isRefreshing,
    refresh,
    marketStatus,
    isMarketOpen: marketStatus === 'open',
  };
}
