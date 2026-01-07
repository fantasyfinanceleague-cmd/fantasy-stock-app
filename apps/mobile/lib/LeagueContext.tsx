import React, { createContext, useContext, useEffect, useState } from 'react';
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

interface LeagueContextType {
  leagues: League[];
  loading: boolean;
  activeLeagueId: string | null;
  setActiveLeagueId: (id: string | null) => void;
  activeLeague: League | null;
  refresh: () => Promise<void>;
}

const LeagueContext = createContext<LeagueContextType | undefined>(undefined);

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLeagueId, setActiveLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLeagues([]);
      setActiveLeagueId(null);
      setLoading(false);
      return;
    }

    fetchLeagues();
  }, [user]);

  async function fetchLeagues() {
    if (!user) return;

    setLoading(true);

    const { data: memberships, error: memberError } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', user.id);

    if (memberError || !memberships || memberships.length === 0) {
      setLeagues([]);
      setLoading(false);
      return;
    }

    const leagueIds = memberships.map((m) => m.league_id);

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

    // Set first league as active if none selected or current selection invalid
    if (leagueData && leagueData.length > 0) {
      const currentValid = leagueData.some(l => l.id === activeLeagueId);
      if (!activeLeagueId || !currentValid) {
        setActiveLeagueId(leagueData[0].id);
      }
    }

    setLoading(false);
  }

  const activeLeague = leagues.find((l) => l.id === activeLeagueId) || null;

  return (
    <LeagueContext.Provider
      value={{
        leagues,
        loading,
        activeLeagueId,
        setActiveLeagueId,
        activeLeague,
        refresh: fetchLeagues,
      }}
    >
      {children}
    </LeagueContext.Provider>
  );
}

export function useLeagueContext() {
  const context = useContext(LeagueContext);
  if (context === undefined) {
    throw new Error('useLeagueContext must be used within a LeagueProvider');
  }
  return context;
}
