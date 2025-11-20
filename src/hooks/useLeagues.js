// src/hooks/useLeagues.js
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function useLeagues() {
  const authUser = useAuthUser();
  const USER_ID = authUser?.id ?? 'test-user'; // Use authenticated user ID

  const [myLeagues, setMyLeagues] = useState([]);
  const [managedLeagues, setManagedLeagues] = useState([]);
  const [pendingInvites, setPendingInvites] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!USER_ID) return; // Wait for auth to load

    setLoading(true);
    setError('');
    try {
      console.log('🔍 Refreshing leagues for USER_ID:', USER_ID);

      // leagues I manage
      const { data: asComm, error: e1 } = await supabase
        .from('leagues')
        .select('*')
        .eq('commissioner_id', USER_ID)
        .order('created_at', { ascending: false });
      if (e1) throw e1;
      console.log('📊 Leagues I manage:', asComm);

      // my memberships (could include my own leagues too)
      const { data: memRows, error: e2 } = await supabase
        .from('league_members')
        .select('league_id, role')
        .eq('user_id', USER_ID);
      if (e2) throw e2;
      console.log('👥 My memberships:', memRows);

      let memberLeagues = [];
      if (memRows?.length) {
        const ids = memRows.map((r) => r.league_id);
        const { data: leagues, error: e3 } = await supabase
          .from('leagues')
          .select('*')
          .in('id', ids)
          .order('created_at', { ascending: false });
        if (e3) throw e3;

        const roleById = Object.fromEntries(memRows.map((r) => [r.league_id, r.role]));
        memberLeagues = (leagues || []).map((l) => ({
          ...l,
          role: roleById[l.id] || (l.commissioner_id === USER_ID ? 'commissioner' : 'member'),
        }));
      }

      const managed = (asComm || []).map((l) => ({ ...l, role: 'commissioner' }));

      const mergedMap = new Map();
      [...managed, ...memberLeagues].forEach((l) => mergedMap.set(l.id, l));
      const merged = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at)
      );

      setManagedLeagues(managed);
      setMyLeagues(merged);
      console.log('✅ Final merged leagues:', merged);

      // pending invites for leagues I manage
      if (managed.length) {
        const { data: invites } = await supabase
          .from('league_invites')
          .select('league_id, invited_identifier, status, created_at, code')
          .in('league_id', managed.map((l) => l.id))
          .order('created_at', { ascending: false });

        const grouped = {};
        (invites || []).forEach((row) => {
          (grouped[row.league_id] ||= []).push(row);
        });
        setPendingInvites(grouped);
      } else {
        setPendingInvites({});
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [USER_ID]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createLeague = useCallback(
    async ({
      name,
      draftDate,
      salaryCapLimit,
      numParticipants,
      numRounds = 6,
      budgetMode = 'budget',
      budgetAmount = 100,
    }) => {
      if (!USER_ID) throw new Error('Must be logged in to create a league');

      setLoading(true);
      setError('');
      try {
        const toInsert = {
          name,
          commissioner_id: USER_ID,
          invite_code: genCode(),
          draft_date: draftDate || null,
          salary_cap_limit: salaryCapLimit ?? null,
          num_participants: numParticipants,
          num_rounds: numRounds,
          budget_mode: budgetMode,
          budget_amount: budgetAmount,
        };
        const { data: league, error: e1 } = await supabase
          .from('leagues')
          .insert(toInsert)
          .select('*')
          .single();
        if (e1) throw e1;

        const { error: e2 } = await supabase
          .from('league_members')
          .upsert({ league_id: league.id, user_id: USER_ID, role: 'commissioner' });
        if (e2) throw e2;

        await refresh();
        return league;
      } catch (err) {
        setError(err.message || String(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refresh, USER_ID]
  );

  const updateLeague = useCallback(
    async (leagueId, patch) => {
      setLoading(true);
      setError('');
      try {
        const { error: e1 } = await supabase.from('leagues').update(patch).eq('id', leagueId);
        if (e1) throw e1;
        await refresh();
      } catch (err) {
        setError(err.message || String(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refresh, USER_ID]
  );

  const inviteToLeague = useCallback(
    async (leagueId, invitedIdentifier) => {
      setLoading(true);
      setError('');
      try {
        const row = {
          league_id: leagueId,
          inviter_id: USER_ID,
          invited_identifier: invitedIdentifier,
          code: genCode(),
          status: 'pending',
        };
        const { data, error: e1 } = await supabase
          .from('league_invites')
          .insert(row)
          .select('code')
          .single();
        if (e1) throw e1;
        await refresh();
        return data.code;
      } catch (err) {
        setError(err.message || String(err));
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [refresh, USER_ID]
  );

  const leaveLeague = useCallback(
    async (leagueId) => {
      setLoading(true);
      try {
        await supabase.from('league_members').delete().eq('league_id', leagueId).eq('user_id', USER_ID);
        await refresh();
      } finally {
        setLoading(false);
      }
    },
    [refresh, USER_ID]
  );
  const deleteLeague = useCallback(async (leagueId) => {
    setLoading(true);
    setError('');
    try {
      const { error } = await supabase.from('leagues').delete().eq('id', leagueId);
      if (error) throw error;
      // clean up active league if you just deleted it
      const activeId = localStorage.getItem('activeLeagueId');
      if (activeId === leagueId) localStorage.removeItem('activeLeagueId');
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, [refresh, USER_ID]);

  return {
    USER_ID,
    myLeagues,
    managedLeagues,
    pendingInvites,
    loading,
    error,
    refresh,
    createLeague,
    updateLeague,
    inviteToLeague,
    leaveLeague,
    deleteLeague
  };
}
