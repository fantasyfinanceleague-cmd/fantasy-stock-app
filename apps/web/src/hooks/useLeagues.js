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
    // Don't run if user is not authenticated (skip the 'test-user' fallback)
    if (!authUser?.id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {

      // leagues I manage
      const { data: asComm, error: e1 } = await supabase
        .from('leagues')
        .select('*')
        .eq('commissioner_id', USER_ID)
        .order('created_at', { ascending: false });
      if (e1) throw e1;

      // my memberships (could include my own leagues too)
      const { data: memRows, error: e2 } = await supabase
        .from('league_members')
        .select('league_id, role')
        .eq('user_id', USER_ID);
      if (e2) throw e2;

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
  }, [USER_ID, authUser]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createLeague = useCallback(
    async ({
      name,
      draftDate,
      numParticipants,
      numRounds = 6,
      stakeMode = 'fixed_notional',
      notionalPerSlot = 1000,
      budgetAmount = null, // budget_cap mode only
      leagueType = 'duration',
      durationDays = 30,
      numWeeks = null,
      playoffTeams = 4,
    }) => {
      if (!USER_ID) throw new Error('Must be logged in to create a league');

      setLoading(true);
      setError('');
      try {
        // stake_mode is the authoritative field (Phase 4 UI). budget_mode is
        // deprecated and no longer written (DB default applies; nothing reads
        // it on new paths); salary_cap_limit is retired — drop migration
        // authored on this branch.
        const toInsert = {
          name,
          commissioner_id: USER_ID,
          invite_code: genCode(),
          draft_date: draftDate || null,
          num_participants: numParticipants,
          num_rounds: numRounds,
          stake_mode: stakeMode,
          notional_per_slot: Number(notionalPerSlot) || 1000,
          ...(stakeMode === 'budget_cap' && budgetAmount != null
            ? { budget_amount: Number(budgetAmount) }
            : {}),
          league_type: leagueType,
          // duration_days is NOT NULL + CHECK in (7,30,90,180,365)
          // (20251230000000): an explicit null is rejected, so matchup
          // leagues omit the key and take the DB default (30).
          ...(leagueType === 'duration' ? { duration_days: durationDays } : {}),
          num_weeks: leagueType === 'matchup' ? numWeeks : null,
          playoff_teams: leagueType === 'matchup' ? playoffTeams : null,
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

  /** Replace a league's roster-slot definitions (commissioner-only via RLS).
   * Full replace: delete existing rows, insert the new set. Only callable
   * pre-draft (callers gate on draft_status). */
  const saveLeagueSlots = useCallback(
    async (leagueId, slots) => {
      const { error: delErr } = await supabase
        .from('league_draft_slots')
        .delete()
        .eq('league_id', leagueId);
      if (delErr) throw delErr;
      if (!slots || slots.length === 0) return;
      const rows = slots.map((s, i) => ({
        league_id: leagueId,
        slot_index: i,
        slot_count: Math.max(1, Number(s.slotCount) || 1),
        price_min: s.priceMin === '' || s.priceMin == null ? null : Number(s.priceMin),
        price_max: s.priceMax === '' || s.priceMax == null ? null : Number(s.priceMax),
        category_id: s.categoryId || null,
      }));
      const { error: insErr } = await supabase.from('league_draft_slots').insert(rows);
      if (insErr) throw insErr;
    },
    []
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
    saveLeagueSlots,
    inviteToLeague,
    leaveLeague,
    deleteLeague
  };
}
