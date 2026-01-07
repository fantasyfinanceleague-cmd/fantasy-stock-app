import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './useAuth';

export interface League {
  id: string;
  name: string;
  draft_status: 'not_started' | 'in_progress' | 'completed';
  draft_date: string;
  budget_mode: 'budget' | 'no-budget';
  budget_amount: number | null;
  league_type: 'duration' | 'matchup';
  current_week: number;
  created_at: string;
}

export function useLeagues() {
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    fetchLeagues();
  }, [user]);

  async function fetchLeagues() {
    if (!user) return;

    setLoading(true);

    // Get league IDs user is a member of
    const { data: memberships, error: memberError } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', user.id);

    if (memberError) {
      console.error('Error fetching memberships:', memberError);
      setLoading(false);
      return;
    }

    if (!memberships || memberships.length === 0) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    const leagueIds = memberships.map((m) => m.league_id);

    // Fetch league details
    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .select('*')
      .in('id', leagueIds)
      .order('created_at', { ascending: false });

    if (leagueError) {
      console.error('Error fetching leagues:', leagueError);
      setLoading(false);
      return;
    }

    setLeagues(leagueData || []);

    // Set first league as active if none selected
    if (leagueData && leagueData.length > 0 && !activeLeagueId) {
      setActiveLeagueId(leagueData[0].id);
    }

    setLoading(false);
  }

  const activeLeague = leagues.find((l) => l.id === activeLeagueId) || null;

  return {
    leagues,
    loading,
    activeLeagueId,
    setActiveLeagueId,
    activeLeague,
    refresh: fetchLeagues,
  };
}
