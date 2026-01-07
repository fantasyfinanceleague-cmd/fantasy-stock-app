import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';
import { useUserProfiles } from '../context/UserProfilesContext';
import { useToast } from '../components/Toast';

export default function LeagueDetail() {
  const { leagueId } = useParams();
  const navigate = useNavigate();
  const user = useAuthUser();
  const toast = useToast();
  const { fetchProfiles, getDisplayName, getAvatar } = useUserProfiles();
  const USER_ID = user?.id;

  const [league, setLeague] = useState(null);
  const [members, setMembers] = useState([]);
  const [standings, setStandings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!leagueId) return;

    async function fetchLeagueData() {
      setLoading(true);

      // Fetch league details
      const { data: leagueData, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', leagueId)
        .single();

      if (leagueError || !leagueData) {
        console.error('Failed to fetch league:', leagueError);
        setLoading(false);
        return;
      }

      setLeague(leagueData);

      // Fetch members
      const { data: memberData } = await supabase
        .from('league_members')
        .select('user_id, role, joined_at')
        .eq('league_id', leagueId)
        .order('joined_at', { ascending: true });

      setMembers(memberData || []);

      // Fetch user profiles
      if (memberData?.length) {
        fetchProfiles(memberData.map(m => m.user_id));
      }

      // Fetch standings if matchup league
      if (leagueData.league_type === 'matchup') {
        const { data: standingsData } = await supabase
          .from('league_standings')
          .select('*')
          .eq('league_id', leagueId)
          .order('wins', { ascending: false });

        setStandings(standingsData || []);
      }

      setLoading(false);
    }

    fetchLeagueData();
  }, [leagueId, fetchProfiles]);

  const copyInviteLink = async () => {
    if (!league?.invite_code) return;
    const link = `${window.location.origin}/join/${league.invite_code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.success('Invite link copied!');
  };

  const isCommissioner = league?.commissioner_id === USER_ID;

  const getStatusBadge = () => {
    if (!league) return null;
    if (league.draft_status === 'completed') {
      return { label: 'Active', color: '#16a34a', bg: 'rgba(22, 163, 74, 0.15)' };
    }
    if (league.draft_status === 'in_progress') {
      return { label: 'Drafting', color: '#eab308', bg: 'rgba(234, 179, 8, 0.15)' };
    }
    return { label: 'Pending Draft', color: '#6b7280', bg: 'rgba(107, 114, 128, 0.15)' };
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'TBD';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const cardStyle = {
    background: '#1a1f2e',
    borderRadius: 12,
    padding: 20,
    border: '1px solid #2a3040',
  };

  const statBoxStyle = {
    background: '#111826',
    borderRadius: 8,
    padding: '16px 20px',
    textAlign: 'center',
  };

  if (loading) {
    return (
      <div className="page" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
          Loading league...
        </div>
      </div>
    );
  }

  if (!league) {
    return (
      <div className="page" style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h2 style={{ color: '#fff', marginBottom: 8 }}>League Not Found</h2>
          <p style={{ color: '#6b7280', marginBottom: 20 }}>This league doesn't exist or you don't have access.</p>
          <Link
            to="/leagues"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#3b82f6',
              borderRadius: 8,
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 500,
            }}
          >
            Back to Leagues
          </Link>
        </div>
      </div>
    );
  }

  const status = getStatusBadge();

  return (
    <div className="page" style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <Link to="/leagues" style={{ color: '#6b7280', textDecoration: 'none', fontSize: 14 }}>
          ← Back to Leagues
        </Link>
      </div>

      {/* League Title & Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h1 style={{ color: '#fff', margin: 0, fontSize: 28, fontWeight: 700 }}>{league.name}</h1>
        <span style={{
          padding: '6px 14px',
          borderRadius: 20,
          fontSize: 13,
          fontWeight: 600,
          background: status.bg,
          color: status.color,
        }}>
          {status.label}
        </span>
        {isCommissioner && (
          <span style={{
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 13,
            fontWeight: 600,
            background: 'rgba(168, 85, 247, 0.15)',
            color: '#a855f7',
          }}>
            Commissioner
          </span>
        )}
      </div>

      {/* Quick Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 24 }}>
        <div style={statBoxStyle}>
          <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>Type</div>
          <div style={{ color: '#fff', fontWeight: 600 }}>
            {league.league_type === 'matchup' ? '🏈 Matchup' : '📊 Duration'}
          </div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>Teams</div>
          <div style={{ color: '#fff', fontWeight: 600 }}>{members.length} / {league.num_participants}</div>
        </div>
        <div style={statBoxStyle}>
          <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>Stocks/Team</div>
          <div style={{ color: '#fff', fontWeight: 600 }}>{league.num_rounds || 6}</div>
        </div>
        {league.league_type === 'matchup' && (
          <div style={statBoxStyle}>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>Week</div>
            <div style={{ color: '#fff', fontWeight: 600 }}>{league.current_week || 1} / {league.num_weeks || '-'}</div>
          </div>
        )}
        {league.budget_mode === 'budget' && (
          <div style={statBoxStyle}>
            <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 4 }}>Budget</div>
            <div style={{ color: '#fff', fontWeight: 600 }}>${(league.budget_amount || 100000).toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            localStorage.setItem('activeLeagueId', leagueId);
            navigate(`/draft/${leagueId}`);
          }}
          style={{
            padding: '10px 20px',
            background: '#3b82f6',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Go to Draft
        </button>
        <button
          onClick={() => {
            localStorage.setItem('activeLeagueId', leagueId);
            navigate('/leaderboard');
          }}
          style={{
            padding: '10px 20px',
            background: '#374151',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          View Leaderboard
        </button>
        {isCommissioner && (
          <button
            onClick={copyInviteLink}
            style={{
              padding: '10px 20px',
              background: '#16a34a',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Copy Invite Link
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        {/* League Info */}
        <div style={cardStyle}>
          <h3 style={{ color: '#fff', margin: '0 0 16px', fontSize: 16 }}>📋 League Info</h3>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Draft Date</span>
              <span style={{ color: '#fff' }}>{formatDate(league.draft_date)}</span>
            </div>
            {league.league_type === 'duration' && league.end_date && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b7280' }}>End Date</span>
                <span style={{ color: '#fff' }}>{formatDate(league.end_date)}</span>
              </div>
            )}
            {league.league_type === 'matchup' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Season Length</span>
                  <span style={{ color: '#fff' }}>{league.num_weeks} weeks</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#6b7280' }}>Playoff Teams</span>
                  <span style={{ color: '#fff' }}>{league.playoff_teams || 4}</span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6b7280' }}>Budget Mode</span>
              <span style={{ color: '#fff' }}>{league.budget_mode === 'budget' ? 'Budget' : 'No Budget'}</span>
            </div>
          </div>
        </div>

        {/* Members */}
        <div style={cardStyle}>
          <h3 style={{ color: '#fff', margin: '0 0 16px', fontSize: 16 }}>👥 Members ({members.length})</h3>
          <div style={{ display: 'grid', gap: 8, maxHeight: 250, overflowY: 'auto' }}>
            {members.map((m) => (
              <div
                key={m.user_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  background: m.user_id === USER_ID ? '#1e3a5f' : '#111826',
                  borderRadius: 8,
                }}
              >
                <span style={{ fontSize: 20 }}>{getAvatar(m.user_id)}</span>
                <span style={{ color: '#fff', flex: 1 }}>
                  {getDisplayName(m.user_id, USER_ID)}
                </span>
                {m.role === 'commissioner' && (
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    background: 'rgba(168, 85, 247, 0.2)',
                    color: '#a855f7',
                  }}>
                    Commissioner
                  </span>
                )}
              </div>
            ))}
            {members.length === 0 && (
              <div style={{ color: '#6b7280', textAlign: 'center', padding: 20 }}>
                No members yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Standings Preview (matchup leagues only) */}
      {league.league_type === 'matchup' && standings.length > 0 && (
        <div style={{ ...cardStyle, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ color: '#fff', margin: 0, fontSize: 16 }}>🏆 Standings</h3>
            <button
              onClick={() => {
                localStorage.setItem('activeLeagueId', leagueId);
                navigate('/leaderboard');
              }}
              style={{
                padding: '6px 12px',
                background: '#374151',
                border: 'none',
                borderRadius: 6,
                color: '#9ca3af',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              View Full →
            </button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {standings.slice(0, 5).map((s, idx) => (
              <div
                key={s.user_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  background: s.user_id === USER_ID ? '#1e3a5f' : '#111826',
                  borderRadius: 8,
                }}
              >
                <span style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: idx === 0 ? '#fbbf24' : idx === 1 ? '#9ca3af' : idx === 2 ? '#cd7c32' : '#374151',
                  color: idx < 3 ? '#000' : '#fff',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 700,
                  fontSize: 12,
                }}>
                  {idx + 1}
                </span>
                <span style={{ fontSize: 18 }}>{getAvatar(s.user_id)}</span>
                <span style={{ color: '#fff', flex: 1 }}>{getDisplayName(s.user_id, USER_ID)}</span>
                <span style={{ color: '#16a34a', fontWeight: 600 }}>
                  {s.wins}-{s.losses}{s.ties > 0 ? `-${s.ties}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
