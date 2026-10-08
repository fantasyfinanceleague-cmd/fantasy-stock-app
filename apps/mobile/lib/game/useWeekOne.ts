/**
 * useWeekOne (3c-2, U-10): your Week 1 game for the draft's ending, read once
 * the draft is complete (finalize writes the whole schedule with it). A failed
 * or empty read is "not known yet", never a guessed opponent or time.
 */
import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { seamTable } from './seamCalls';
import { weekOneFor, type WeekOneRow } from './draftComplete';

export function useWeekOne(leagueId: string, myUserId: string, enabled: boolean): { opponentId: string | null; weekStart: string | null } | null {
  const [game, setGame] = useState<{ opponentId: string | null; weekStart: string | null } | null>(null);
  useEffect(() => {
    if (!enabled || !leagueId || !myUserId) return;
    let cancelled = false;
    void seamTable<WeekOneRow>('matchups_week_one', () =>
      supabase.from('matchups').select('team1_user_id, team2_user_id, week_start').eq('league_id', leagueId).eq('week_number', 1),
    ).then((res) => {
      if (cancelled || res.error) return;
      setGame(weekOneFor(res.data ?? [], myUserId));
    });
    return () => {
      cancelled = true;
    };
  }, [leagueId, myUserId, enabled]);
  return game;
}
