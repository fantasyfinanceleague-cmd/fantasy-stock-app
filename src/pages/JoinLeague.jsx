import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';

const USER_ID = 'test-user'; // swap for auth later

export function JoinLeague() {
  const { code } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [invite, setInvite] = useState(null);
  const [league, setLeague] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data: inv, error: e1 } = await supabase
          .from('league_invites')
          .select('*')
          .eq('code', code)
          .maybeSingle();
        if (e1) throw e1;
        if (!inv) throw new Error('Invite not found');

        const { data: lg, error: e2 } = await supabase
          .from('leagues')
          .select('*')
          .eq('id', inv.league_id)
          .single();
        if (e2) throw e2;

        if (!cancelled) { setInvite(inv); setLeague(lg); }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const handleJoin = async () => {
    if (!invite || !league) return;
    setLoading(true);
    setError('');
    try {
      // add me as a member (idempotent)
      await supabase.from('league_members')
        .upsert({ league_id: invite.league_id, user_id: USER_ID, role: 'member' });

      // mark invite accepted (best-effort)
      await supabase.from('league_invites')
        .update({ status: 'accepted' })
        .eq('code', code);

      // set active league for Draft page and go to /leagues
      localStorage.setItem('activeLeagueId', invite.league_id);
      nav('/leagues');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1 className="page-title">Join League</h1>
      {loading && <p className="muted">Loading invite…</p>}
      {error && <p className="muted">Error: {error}</p>}
      {league && !loading && (
        <div className="card">
          <h3 style={{ marginTop: 0, color: '#fff' }}>{league.name}</h3>
          <p className="muted">
            Participants: {league.num_participants} • Draft: {league.draft_date ? new Date(league.draft_date).toLocaleString() : 'TBD'}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={handleJoin} disabled={loading}>Join League</button>
            <Link className="btn ghost" to="/leagues">Back</Link>
          </div>
        </div>
      )}
    </div>
  );
}
