import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';

const REASON_MSG = {
  league_full: 'This league is full',
  invite_expired: 'This invite has already been used or expired',
  season_completed: "This league's season has ended",
  invalid_code: 'Invite not found',
};

export function JoinLeague() {
  const { code } = useParams();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [league, setLeague] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: fnErr } = await supabase.functions.invoke('preview-league', { body: { code } });
        if (fnErr) throw fnErr;
        if (!data.found) throw new Error('Invite not found');
        if (!cancelled) setLeague(data.league);
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  const handleJoin = async () => {
    if (!league) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('join-league', { body: { code } });
      // already_member = SILENT SUCCESS (preserves the old idempotent-upsert UX)
      if (!fnErr && (data.ok || data.reason === 'already_member')) {
        if (data.league) localStorage.setItem('activeLeagueId', data.league.id);
        nav('/leagues');
        return;
      }
      setError(REASON_MSG[data?.reason] ?? (fnErr?.message ?? 'Failed to join'));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
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
