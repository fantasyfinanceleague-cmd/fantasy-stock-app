// src/hooks/useRealtimeStandings.js
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabase/supabaseClient';

/**
 * Custom hook for real-time standings and matchup updates
 * Subscribes to Supabase Realtime for changes in league standings, matchups, and week advancement
 *
 * @param {string} leagueId - The league ID to subscribe to
 * @param {boolean} enabled - Whether subscription is enabled (default: true)
 * @returns {object} { standingsUpdated, matchupsUpdated, weekAdvanced, isConnected }
 */
export function useRealtimeStandings(leagueId, enabled = true) {
  const [standingsUpdated, setStandingsUpdated] = useState(null);
  const [matchupsUpdated, setMatchupsUpdated] = useState(null);
  const [weekAdvanced, setWeekAdvanced] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!enabled || !leagueId) return;

    const channelName = `standings-${leagueId}`;

    // Check for and remove existing channel
    const existingChannel = supabase.getChannels().find(
      ch => ch.topic === `realtime:${channelName}`
    );
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    // Create channel with subscriptions to multiple tables
    const channel = supabase
      .channel(channelName)
      // Listen for standings updates
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'league_standings',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          setStandingsUpdated({
            type: payload.eventType,
            data: payload.new,
            old: payload.old,
            timestamp: Date.now()
          });
        }
      )
      // Listen for matchup results
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'matchups',
          filter: `league_id=eq.${leagueId}`
        },
        (payload) => {
          // Only trigger if results were just added
          const hadResults = payload.old?.team1_gain !== null || payload.old?.team2_gain !== null;
          const hasResults = payload.new?.team1_gain !== null || payload.new?.team2_gain !== null;

          if (!hadResults && hasResults) {
            setMatchupsUpdated({
              type: 'results_posted',
              data: payload.new,
              timestamp: Date.now()
            });
          } else {
            setMatchupsUpdated({
              type: 'updated',
              data: payload.new,
              timestamp: Date.now()
            });
          }
        }
      )
      // Listen for week advancement in leagues table
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'leagues',
          filter: `id=eq.${leagueId}`
        },
        (payload) => {
          // Check if current_week changed
          if (payload.new?.current_week !== payload.old?.current_week) {
            setWeekAdvanced({
              previousWeek: payload.old?.current_week,
              currentWeek: payload.new?.current_week,
              timestamp: Date.now()
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsConnected(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, enabled]);

  // Clear functions for manual reset
  const clearStandingsUpdate = useCallback(() => setStandingsUpdated(null), []);
  const clearMatchupsUpdate = useCallback(() => setMatchupsUpdated(null), []);
  const clearWeekAdvanced = useCallback(() => setWeekAdvanced(null), []);

  return {
    standingsUpdated,
    matchupsUpdated,
    weekAdvanced,
    isConnected,
    clearStandingsUpdate,
    clearMatchupsUpdate,
    clearWeekAdvanced
  };
}
