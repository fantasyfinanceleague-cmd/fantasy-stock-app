// src/hooks/useRealtimeTrades.js
import { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';

/**
 * Custom hook for real-time trade notifications
 * Subscribes to Supabase Realtime for new trades in a league
 *
 * @param {string} leagueId - The league ID to subscribe to
 * @param {boolean} enabled - Whether subscription is enabled (default: true)
 * @returns {object} { newTrade, clearNewTrade }
 */
export function useRealtimeTrades(leagueId, enabled = true) {
  const [newTrade, setNewTrade] = useState(null);

  useEffect(() => {
    if (!enabled || !leagueId) return;

    // Subscribe to trades table for this league
    const channel = supabase
      .channel(`trades:league_id=eq.${leagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trades',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          setNewTrade(payload.new);

          // Auto-clear after 5 seconds
          setTimeout(() => {
            setNewTrade(null);
          }, 5000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, enabled]);

  const clearNewTrade = () => setNewTrade(null);

  return { newTrade, clearNewTrade };
}
