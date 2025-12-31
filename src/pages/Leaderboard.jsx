// src/pages/Leaderboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName, formatUSD, formatPercent } from '../utils/formatting';
import { fetchCompanyNamesInBatch } from '../utils/stockData';
import { usePrices } from '../context/PriceContext';
import { useUserProfiles } from '../context/UserProfilesContext';
import { PageLoader } from '../components/LoadingSpinner';
import { SkeletonLeaderboard } from '../components/Skeleton';
import { generateSchedule, generateInitialStandings, getPlayoffRoundName } from '../utils/scheduleGenerator';

// Helper component for playoff bracket matchup display
function PlayoffMatchupCard({ matchup, getDisplayName, getAvatar, userId, isCurrentRound, isFinals }) {
  const m = matchup;
  const isComplete = m.winner_user_id !== null;
  const team1Won = m.winner_user_id === m.team1_user_id;
  const team2Won = m.winner_user_id === m.team2_user_id;
  const isTBD = !m.team1_user_id || !m.team2_user_id;

  const cardStyle = {
    background: isFinals
      ? 'linear-gradient(135deg, #78350f 0%, #451a03 100%)'
      : isCurrentRound
        ? '#1e3a5f'
        : '#111826',
    borderRadius: 8,
    padding: 12,
    border: isFinals
      ? '1px solid #fbbf24'
      : isCurrentRound
        ? '1px solid #3b82f6'
        : '1px solid #374151',
  };

  const teamStyle = (isWinner, isUser) => ({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: 4,
    background: isWinner ? 'rgba(22, 163, 74, 0.2)' : 'transparent',
    color: isWinner ? '#16a34a' : isUser ? '#93c5fd' : '#e5e7eb',
    fontWeight: isWinner || isUser ? 600 : 400,
  });

  return (
    <div style={cardStyle}>
      {/* Team 1 */}
      <div style={teamStyle(team1Won, m.team1_user_id === userId)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {m.team1_seed && (
            <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 16 }}>#{m.team1_seed}</span>
          )}
          <span style={{ fontSize: 16 }}>{m.team1_user_id ? getAvatar(m.team1_user_id) : '❓'}</span>
          <span style={{ fontSize: 13 }}>
            {m.team1_user_id ? getDisplayName(m.team1_user_id, userId) : 'TBD'}
          </span>
          {team1Won && <span style={{ marginLeft: 4 }}>✓</span>}
        </div>
        {m.team1_gain !== null && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: Number(m.team1_gain) >= 0 ? '#16a34a' : '#dc2626'
          }}>
            {Number(m.team1_gain) >= 0 ? '+' : ''}{formatUSD(m.team1_gain)}
          </span>
        )}
      </div>

      {/* Divider */}
      <div style={{
        height: 1,
        background: '#374151',
        margin: '4px 0',
      }} />

      {/* Team 2 */}
      <div style={teamStyle(team2Won, m.team2_user_id === userId)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {m.team2_seed && (
            <span style={{ fontSize: 11, color: '#9ca3af', minWidth: 16 }}>#{m.team2_seed}</span>
          )}
          <span style={{ fontSize: 16 }}>{m.team2_user_id ? getAvatar(m.team2_user_id) : '❓'}</span>
          <span style={{ fontSize: 13 }}>
            {m.team2_user_id ? getDisplayName(m.team2_user_id, userId) : 'TBD'}
          </span>
          {team2Won && <span style={{ marginLeft: 4 }}>✓</span>}
        </div>
        {m.team2_gain !== null && (
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: Number(m.team2_gain) >= 0 ? '#16a34a' : '#dc2626'
          }}>
            {Number(m.team2_gain) >= 0 ? '+' : ''}{formatUSD(m.team2_gain)}
          </span>
        )}
      </div>

      {/* Status indicator */}
      {isTBD && (
        <div style={{ textAlign: 'center', fontSize: 11, color: '#6b7280', marginTop: 4 }}>
          Awaiting previous round
        </div>
      )}
      {isComplete && isFinals && (
        <div style={{ textAlign: 'center', fontSize: 12, color: '#fbbf24', marginTop: 6, fontWeight: 700 }}>
          🏆 CHAMPION
        </div>
      )}
    </div>
  );
}

export default function Leaderboard() {
  const authUser = useAuthUser();
  // keep a fallback for now so your draft keeps working if not signed in
  const USER_ID = authUser?.id ?? 'test-user';
  const navigate = useNavigate();

  // leagues
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const activeLeague = useMemo(() => leagues.find(l => l.id === leagueId) || null, [leagues, leagueId]);

  // data for selected league
  const [picks, setPicks] = useState([]);          // all rows from drafts for this league (all users)
  const [trades, setTrades] = useState([]);        // all trades for this league (all users)
  const [symbolToName, setSymbolToName] = useState({});

  // matchup league data
  const [leagueStandings, setLeagueStandings] = useState([]);  // W-L-T records
  const [matchups, setMatchups] = useState([]);                 // weekly matchups

  // Use shared price context
  const { prices, loading: pricesLoading, lastUpdate: lastUpdated, fetchPrices } = usePrices();

  // Use shared user profiles context
  const { fetchProfiles, getDisplayName, getAvatar } = useUserProfiles();

  // ui
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // peer portfolio modal
  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const [peerUserId, setPeerUserId] = useState('');
  const [peerRows, setPeerRows] = useState([]); // derived rows for modal view

  // schedule modal
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [schedulePlayerId, setSchedulePlayerId] = useState('');

  // ----- Load my leagues
  useEffect(() => {
    // Don't run with test-user fallback - wait for real auth
    if (!authUser?.id) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError('');

        const { data: mem, error: memErr } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', USER_ID);

        if (memErr) throw memErr;

        const ids = (mem || []).map(r => r.league_id);
        if (!ids.length) {
          setLeagues([]);
          setLeagueId('');
          setPicks([]);
          setPrices({});
          return;
        }

        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name, league_type, num_weeks, current_week')
          .in('id', ids)
          .order('name', { ascending: true });

        if (lgErr) throw lgErr;

        setLeagues(lg || []);
        const chosen =
          leagueId && (lg || []).some(x => x.id === leagueId)
            ? leagueId
            : (lg?.[0]?.id || '');

        setLeagueId(chosen);
        localStorage.setItem('activeLeagueId', chosen);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [USER_ID]);

  // ----- When league changes, load picks + trades + names
  useEffect(() => {
    if (!leagueId) {
      setPicks([]);
      setTrades([]);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError('');

        // Load drafts for all users in the league
        const { data: rows, error: pErr } = await supabase
          .from('drafts')
          .select('id, user_id, symbol, entry_price, quantity, round, pick_number, created_at')
          .eq('league_id', leagueId)
          .order('pick_number', { ascending: true });

        if (pErr) throw pErr;
        setPicks(rows || []);

        // Load trades for all users in the league
        const { data: tradeRows, error: tErr } = await supabase
          .from('trades')
          .select('id, user_id, symbol, action, quantity, price, total_value, created_at')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: true });

        if (tErr) throw tErr;
        setTrades(tradeRows || []);

        // Load matchup league data (standings and matchups)
        const { data: standingsRows, error: sErr } = await supabase
          .from('league_standings')
          .select('*')
          .eq('league_id', leagueId)
          .order('wins', { ascending: false });

        if (sErr) throw sErr;
        setLeagueStandings(standingsRows || []);

        const { data: matchupRows, error: mErr } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', leagueId)
          .order('week_number', { ascending: true });

        if (mErr) throw mErr;
        setMatchups(matchupRows || []);

        // Collect all unique symbols from both drafts and trades
        const draftSymbols = (rows || []).map(p => p.symbol?.toUpperCase());
        const tradeSymbols = (tradeRows || []).map(t => t.symbol?.toUpperCase());
        const uniq = [...new Set([...draftSymbols, ...tradeSymbols])].filter(Boolean);

        // Fetch prices and company names in parallel
        if (uniq.length > 0) {
          const [, nameData] = await Promise.all([
            fetchPrices(uniq),
            fetchCompanyNamesInBatch(uniq, symbolToName),
          ]);
          setSymbolToName(nameData);
        }
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // ----- Derived: per-user picks grouped
  const picksByUser = useMemo(() => {
    const map = new Map();
    for (const p of picks) {
      const u = p.user_id;
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(p);
    }
    return map;
  }, [picks]);

  // ----- Derived: per-user trades grouped
  const tradesByUser = useMemo(() => {
    const map = new Map();
    for (const t of trades) {
      const u = t.user_id;
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(t);
    }
    return map;
  }, [trades]);

  // ----- Derived: all unique user IDs (from picks and trades)
  const allUserIds = useMemo(() => {
    const ids = new Set([...picksByUser.keys(), ...tradesByUser.keys()]);
    return Array.from(ids);
  }, [picksByUser, tradesByUser]);

  // Fetch user profiles when we have user IDs
  useEffect(() => {
    if (allUserIds.length > 0) {
      fetchProfiles(allUserIds);
    }
  }, [allUserIds, fetchProfiles]);

  // ----- Auto-generate schedule for matchup leagues if missing -----
  useEffect(() => {
    const autoGenerateSchedule = async () => {
      // Only run if: matchup league, no matchups exist, and we have members
      if (!activeLeague) return;
      if (activeLeague.league_type !== 'matchup') return;
      if (matchups.length > 0) return;
      if (allUserIds.length < 2) return;

      console.log('Auto-generating schedule for matchup league...');

      const numWeeks = activeLeague.num_weeks || (allUserIds.length - 1);
      const startDate = new Date();

      // Generate schedule
      const schedule = generateSchedule(allUserIds, numWeeks, startDate);

      // Insert matchups
      const matchupRows = schedule.map(m => ({
        league_id: activeLeague.id,
        week_number: m.week,
        team1_user_id: m.team1,
        team2_user_id: m.team2,
        week_start: m.weekStart.toISOString(),
        week_end: m.weekEnd.toISOString(),
      }));

      if (matchupRows.length > 0) {
        const { data, error: matchupErr } = await supabase
          .from('matchups')
          .insert(matchupRows)
          .select();

        if (matchupErr) {
          console.error('Failed to auto-generate matchups:', matchupErr);
        } else {
          console.log('Auto-generated matchups:', data);
          setMatchups(data || matchupRows);
        }
      }

      // Initialize standings if they don't exist in database
      // Check database directly to avoid race condition with state
      const { data: existingStandings } = await supabase
        .from('league_standings')
        .select('user_id')
        .eq('league_id', activeLeague.id)
        .limit(1);

      if (!existingStandings || existingStandings.length === 0) {
        const standingsRows = generateInitialStandings(activeLeague.id, allUserIds);
        const { error: standingsErr } = await supabase
          .from('league_standings')
          .insert(standingsRows);  // Use insert, not upsert

        if (standingsErr) {
          console.error('Failed to initialize standings:', standingsErr);
        } else {
          setLeagueStandings(standingsRows);
        }
      }
    };

    autoGenerateSchedule();
  }, [activeLeague, matchups.length, allUserIds, leagueStandings.length]);

  // Calculate actual holdings for a user (drafts + buys - sells)
  function calcUserHoldings(userId) {
    const userPicks = picksByUser.get(userId) || [];
    const userTrades = tradesByUser.get(userId) || [];
    const holdingsMap = {}; // { SYMBOL: { quantity, totalCost } }

    // Start with draft picks
    for (const pick of userPicks) {
      const sym = pick.symbol?.toUpperCase();
      if (!sym) continue;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(pick.quantity || 1);
      const price = Number(pick.entry_price || 0);
      holdingsMap[sym].quantity += qty;
      holdingsMap[sym].totalCost += price * qty;
    }

    // Apply trades (buys add, sells subtract)
    for (const trade of userTrades) {
      const sym = trade.symbol?.toUpperCase();
      if (!sym) continue;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(trade.quantity || 0);
      const price = Number(trade.price || 0);

      if (trade.action === 'buy') {
        holdingsMap[sym].quantity += qty;
        holdingsMap[sym].totalCost += price * qty;
      } else if (trade.action === 'sell') {
        // Calculate proportional cost reduction
        const avgCost = holdingsMap[sym].quantity > 0
          ? holdingsMap[sym].totalCost / holdingsMap[sym].quantity
          : price;

        holdingsMap[sym].quantity -= qty;
        holdingsMap[sym].totalCost -= avgCost * qty;
      }
    }

    // Return holdings with positive quantity
    return Object.values(holdingsMap).filter(h => h.quantity > 0);
  }

  function calcUserStats(userId) {
    const holdings = calcUserHoldings(userId);
    let spent = 0;
    let value = 0;

    for (const h of holdings) {
      const qty = Number(h.quantity || 0);
      const avgEntry = h.quantity > 0 ? h.totalCost / h.quantity : 0;
      const live = prices[h.symbol];
      const last = Number.isFinite(live) ? live : avgEntry;

      spent += avgEntry * qty;
      value += last * qty;
    }

    const gain = value - spent;
    const pct = spent > 0 ? (gain / spent) * 100 : 0;
    return { spent, value, gain, pct };
  }

  const standings = useMemo(() => {
    const arr = allUserIds.map(u => {
      const { value, gain, pct } = calcUserStats(u);
      return { user_id: u, value, gain, pct };
    });
    // rank by total profit (gain), not percent
    arr.sort((a, b) => b.gain - a.gain);
    return arr;
  }, [allUserIds, prices, picksByUser, tradesByUser]);

  // ----- Matchup league computed values -----
  const isMatchupLeague = activeLeague?.league_type === 'matchup';
  const currentWeek = activeLeague?.current_week || 1;


  // Matchup standings sorted by win pct, then wins, then points_for
  const matchupStandings = useMemo(() => {
    if (!isMatchupLeague) return [];

    // If we have standings entries, use them
    if (leagueStandings.length > 0) {
      return [...leagueStandings].sort((a, b) => {
        // Calculate win percentage
        const aTotal = a.wins + a.losses + a.ties;
        const bTotal = b.wins + b.losses + b.ties;
        const aPct = aTotal > 0 ? (a.wins + a.ties * 0.5) / aTotal : 0;
        const bPct = bTotal > 0 ? (b.wins + b.ties * 0.5) / bTotal : 0;

        if (bPct !== aPct) return bPct - aPct;
        if (b.wins !== a.wins) return b.wins - a.wins;
        return Number(b.points_for) - Number(a.points_for);
      });
    }

    // No standings yet - show all users with 0-0 records
    return allUserIds.map(userId => ({
      user_id: userId,
      wins: 0,
      losses: 0,
      ties: 0,
      points_for: 0,
      points_against: 0
    }));
  }, [isMatchupLeague, leagueStandings, allUserIds]);

  // Current week matchups
  const currentWeekMatchups = useMemo(() => {
    return matchups.filter(m => m.week_number === currentWeek);
  }, [matchups, currentWeek]);

  // Playoff matchups organized by round
  const playoffData = useMemo(() => {
    const playoffMatchups = matchups.filter(m => m.is_playoff);
    if (playoffMatchups.length === 0) return null;

    // Group by round
    const quarters = playoffMatchups.filter(m => m.playoff_round === 'quarter');
    const semis = playoffMatchups.filter(m => m.playoff_round === 'semi');
    const finals = playoffMatchups.filter(m => m.playoff_round === 'finals');

    // Check if playoffs have started (any team1_user_id is set in first round)
    const firstRound = quarters.length > 0 ? quarters : (semis.length > 0 ? semis : finals);
    const hasStarted = firstRound.some(m => m.team1_user_id !== null);

    return {
      hasStarted,
      quarters,
      semis,
      finals,
      currentRound: finals.some(m => m.team1_user_id && m.team2_user_id && m.winner_user_id === null) ? 'finals'
        : semis.some(m => m.team1_user_id && m.team2_user_id && m.winner_user_id === null) ? 'semi'
        : quarters.some(m => m.winner_user_id === null) ? 'quarter'
        : finals.some(m => m.winner_user_id) ? 'complete' : 'upcoming',
      champion: finals.find(m => m.winner_user_id)?.winner_user_id || null,
    };
  }, [matchups]);

  // Get schedule for a specific player (all weeks)
  const getPlayerSchedule = (playerId) => {
    if (!playerId || matchups.length === 0) return [];

    return matchups
      .filter(m => m.team1_user_id === playerId || m.team2_user_id === playerId)
      .map(m => {
        const isTeam1 = m.team1_user_id === playerId;
        const opponentId = isTeam1 ? m.team2_user_id : m.team1_user_id;
        const myGain = isTeam1 ? m.team1_gain : m.team2_gain;
        const oppGain = isTeam1 ? m.team2_gain : m.team1_gain;
        const didWin = m.winner_user_id === playerId;
        const didLose = m.winner_user_id && m.winner_user_id !== playerId;
        const isTie = m.team1_gain !== null && m.team2_gain !== null && m.winner_user_id === null;
        const isComplete = m.team1_gain !== null && m.team2_gain !== null;

        return {
          ...m,
          opponentId,
          myGain,
          oppGain,
          didWin,
          didLose,
          isTie,
          isComplete,
        };
      })
      .sort((a, b) => a.week_number - b.week_number);
  };

  // Player schedule for modal
  const playerSchedule = useMemo(() => {
    const playerId = schedulePlayerId || USER_ID;
    return getPlayerSchedule(playerId);
  }, [schedulePlayerId, USER_ID, matchups]);

  // Open schedule modal
  const openScheduleModal = (playerId = USER_ID) => {
    setSchedulePlayerId(playerId);
    setScheduleModalOpen(true);
  };

  const closeScheduleModal = () => {
    setScheduleModalOpen(false);
  };

  const totalPlayers = allUserIds.length;

  // leader & best performer (same metric here)
  const leader = standings[0] || null;
  const matchupLeader = matchupStandings[0] || null;

  // top gainers across all picks (by % since entry)
  const topGainers = useMemo(() => {
    const rows = (picks || []).map(p => {
      const sym = p.symbol?.toUpperCase();
      const entry = Number(p.entry_price || 0) || 0;
      const live = prices[sym];
      const last = Number.isFinite(live) ? live : entry;
      const plp = entry > 0 ? ((last / entry) - 1) * 100 : 0;
      return {
        sym,
        name: symbolToName[sym] || sym,
        entry,
        last,
        plp,
        now: last * (Number(p.quantity || 0) || 0),
      };
    });
    return rows
      .sort((a, b) => b.plp - a.plp)
      .slice(0, 3);
  }, [picks, prices, symbolToName]);

  const handleLeagueChange = (e) => {
    const id = e.target.value;
    setLeagueId(id);
    localStorage.setItem('activeLeagueId', id);
  };

  function exportCSV() {
    const header = ['rank', 'player', 'value', 'pct_gain'];
    const rows = standings.map((s, idx) => [idx + 1, getDisplayName(s.user_id, USER_ID), s.value, s.pct]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `standings_${leagueId || 'league'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Peer portfolio modal helpers ----------
  const openPeerModal = (userId) => {
    setPeerUserId(userId);
    // Use calcUserHoldings to get actual holdings (drafts + trades)
    const holdings = calcUserHoldings(userId);
    const rows = holdings.map((h, idx) => {
      const sym = h.symbol;
      const qty = Number(h.quantity || 0);
      const entry = h.quantity > 0 ? h.totalCost / h.quantity : 0;
      const last = prices[sym] ?? entry;
      const pl = Number.isFinite(entry) && Number.isFinite(last) ? (last - entry) * qty : null;
      const plp = Number.isFinite(entry) && entry !== 0 ? ((last / entry) - 1) * 100 : null;
      return {
        id: `${sym}-${idx}`,
        sym,
        company: prettyName(symbolToName[sym] || ''),
        qty,
        entry,
        last,
        pl,
        plp,
      };
    });
    setPeerRows(rows);
    setPeerModalOpen(true);
  };

  const closePeerModal = () => {
    setPeerModalOpen(false);
    setPeerUserId('');
    setPeerRows([]);
  };

  // Modal totals
  const peerTotals = useMemo(() => {
    if (!peerRows.length) return { value: 0, gain: 0, pct: 0 };
    let value = 0, spent = 0;
    for (const r of peerRows) {
      const qty = Number(r.qty || 0);
      value += Number(r.last || 0) * qty;
      spent += Number(r.entry || 0) * qty;
    }
    const gain = value - spent;
    const pct = spent > 0 ? (gain / spent) * 100 : 0;
    return { value, gain, pct };
  }, [peerRows]);

  // ---------- UI ----------
  if (loading) {
    return <SkeletonLeaderboard />;
  }

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Leaderboard Unavailable</h3>
          <p className="muted">Error: {error}</p>
          <Link className="btn" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ color: '#fff', margin: 0 }}>League Standings</h2>
        <div>
          <label htmlFor="leagueSelect" className="muted" style={{ display: 'block', marginBottom: 4 }}>
            Select League:
          </label>
          <select
            id="leagueSelect"
            value={leagueId}
            onChange={handleLeagueChange}
            className="round-select"
            style={{ minWidth: 220 }}
          >
            {leagues.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>🏆 League Leader</div>
          {isMatchupLeague ? (
            matchupLeader ? (
              <>
                <div style={{ fontSize: 13 }} className="muted">{getDisplayName(matchupLeader.user_id, USER_ID)}</div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 18 }}>
                    {matchupLeader.wins}-{matchupLeader.losses}{matchupLeader.ties > 0 ? `-${matchupLeader.ties}` : ''}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatUSD(matchupLeader.points_for)} total gain
                  </div>
                </div>
              </>
            ) : (
              <div className="muted">No standings yet.</div>
            )
          ) : (
            leader ? (
              <>
                <div style={{ fontSize: 13 }} className="muted">{getDisplayName(leader.user_id, USER_ID)}</div>
                <div style={{ marginTop: 6 }}>
                  <div style={{ color: leader.gain >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700, fontSize: 18 }}>
                    {leader.gain >= 0 ? '+' : ''}{formatUSD(leader.gain)}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatPercent(leader.pct, true)} return
                  </div>
                </div>
              </>
            ) : (
              <div className="muted">No data yet.</div>
            )
          )}
        </div>

        <div className="card">
          {isMatchupLeague ? (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>📅 Current Week</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{currentWeek}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                of {activeLeague?.num_weeks || '?'} weeks
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>💰 Top Profit</div>
              {leader ? (
                <>
                  <div style={{ fontSize: 13 }} className="muted">{getDisplayName(leader.user_id, USER_ID)}</div>
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{formatUSD(leader.value)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>portfolio value</div>
                  </div>
                </>
              ) : (
                <div className="muted">No data yet.</div>
              )}
            </>
          )}
        </div>

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>👥 Total Players</div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>{totalPlayers}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Active participants</div>
        </div>
      </div>

      {/* Current Standings */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h3 style={{ marginTop: 0 }}>Current Standings</h3>
          <div className="muted" style={{ fontSize: 12 }}>
            {isMatchupLeague ? `Week ${currentWeek} of ${activeLeague?.num_weeks || '?'}` : null}
            {!isMatchupLeague && lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : null}
          </div>
        </div>

        {isMatchupLeague ? (
          // Matchup League Standings (W-L-T record)
          matchupStandings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No standings yet. Complete a week to see records.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {matchupStandings.map((s, idx) => {
                const mine = s.user_id === USER_ID;
                const winPct = (s.wins + s.losses + s.ties) > 0
                  ? ((s.wins + s.ties * 0.5) / (s.wins + s.losses + s.ties) * 100).toFixed(0)
                  : 0;
                return (
                  <div key={s.user_id} className="list-row" style={{ borderRadius: 10, background: mine ? '#18202c' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#0ea5e9',
                        color: '#0b1220', display: 'grid', placeItems: 'center', fontWeight: 800
                      }}>
                        {idx + 1}
                      </div>
                      <span style={{ fontSize: 24 }}>{getAvatar(s.user_id)}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{getDisplayName(s.user_id, USER_ID)}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{activeLeague?.name || ''}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                      <div style={{ textAlign: 'center', minWidth: 80 }}>
                        <div style={{ fontWeight: 700, fontSize: 18 }}>
                          {s.wins}-{s.losses}{s.ties > 0 ? `-${s.ties}` : ''}
                        </div>
                        <div style={{ fontSize: 12 }} className="muted">{winPct}% win rate</div>
                      </div>
                      <div style={{ textAlign: 'right', minWidth: 100 }}>
                        <div style={{ fontWeight: 600, color: Number(s.points_for) >= 0 ? '#16a34a' : '#dc2626' }}>
                          {formatUSD(s.points_for)}
                        </div>
                        <div style={{ fontSize: 12 }} className="muted">total gain</div>
                      </div>
                      <button
                        className="btn"
                        onClick={() => {
                          localStorage.setItem('activeLeagueId', leagueId);
                          if (mine) {
                            navigate('/portfolio');
                          } else {
                            openPeerModal(s.user_id);
                          }
                        }}
                      >
                        View Portfolio
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          // Duration League Standings (by total gain)
          standings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No standings yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {standings.map((s, idx) => {
                const mine = s.user_id === USER_ID;
                return (
                  <div key={s.user_id} className="list-row" style={{ borderRadius: 10, background: mine ? '#18202c' : undefined }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', background: '#0ea5e9',
                        color: '#0b1220', display: 'grid', placeItems: 'center', fontWeight: 800
                      }}>
                        {idx + 1}
                      </div>
                      <span style={{ fontSize: 24 }}>{getAvatar(s.user_id)}</span>
                      <div>
                        <div style={{ fontWeight: 600 }}>{getDisplayName(s.user_id, USER_ID)}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{activeLeague?.name || ''}</div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: s.gain >= 0 ? '#16a34a' : '#dc2626' }}>
                          {s.gain >= 0 ? '+' : ''}{formatUSD(s.gain)}
                        </div>
                        <div style={{ fontSize: 12 }} className="muted">{formatUSD(s.value)} total</div>
                      </div>
                      <button
                        className="btn"
                        onClick={() => {
                          localStorage.setItem('activeLeagueId', leagueId);
                          if (mine) {
                            navigate('/portfolio');
                          } else {
                            openPeerModal(s.user_id);
                          }
                        }}
                      >
                        View Portfolio
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* Current Week Matchups - only for matchup leagues */}
      {isMatchupLeague && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Week {currentWeek} Matchups</h3>
            <button className="btn" onClick={() => openScheduleModal(USER_ID)}>
              View Full Schedule
            </button>
          </div>
          {currentWeekMatchups.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No matchups scheduled for this week.</p>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {currentWeekMatchups.map((m) => {
                const isComplete = m.winner_user_id !== null || (m.team1_gain !== null && m.team2_gain !== null);
                const team1Won = m.winner_user_id === m.team1_user_id;
                const team2Won = m.winner_user_id === m.team2_user_id;
                const isTie = isComplete && m.winner_user_id === null;

                return (
                  <div
                    key={m.id}
                    className="card"
                    style={{
                      background: '#111826',
                      display: 'grid',
                      gridTemplateColumns: '1fr auto 1fr',
                      alignItems: 'center',
                      gap: 16,
                      padding: 16,
                    }}
                  >
                    {/* Team 1 */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 28, marginBottom: 4 }}>{getAvatar(m.team1_user_id)}</div>
                      <div style={{
                        fontWeight: 600,
                        color: team1Won ? '#16a34a' : isTie ? '#eab308' : undefined
                      }}>
                        {getDisplayName(m.team1_user_id, USER_ID)}
                        {team1Won && ' ✓'}
                      </div>
                      {m.team1_gain !== null && (
                        <div style={{
                          marginTop: 4,
                          fontWeight: 700,
                          fontSize: 18,
                          color: Number(m.team1_gain) >= 0 ? '#16a34a' : '#dc2626'
                        }}>
                          {Number(m.team1_gain) >= 0 ? '+' : ''}{formatUSD(m.team1_gain)}
                        </div>
                      )}
                    </div>

                    {/* VS */}
                    <div style={{
                      fontWeight: 800,
                      color: '#6b7280',
                      fontSize: 14
                    }}>
                      {isComplete ? (isTie ? 'TIE' : 'vs') : 'vs'}
                    </div>

                    {/* Team 2 */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 28, marginBottom: 4 }}>{getAvatar(m.team2_user_id)}</div>
                      <div style={{
                        fontWeight: 600,
                        color: team2Won ? '#16a34a' : isTie ? '#eab308' : undefined
                      }}>
                        {getDisplayName(m.team2_user_id, USER_ID)}
                        {team2Won && ' ✓'}
                      </div>
                      {m.team2_gain !== null && (
                        <div style={{
                          marginTop: 4,
                          fontWeight: 700,
                          fontSize: 18,
                          color: Number(m.team2_gain) >= 0 ? '#16a34a' : '#dc2626'
                        }}>
                          {Number(m.team2_gain) >= 0 ? '+' : ''}{formatUSD(m.team2_gain)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Playoff Bracket - only for matchup leagues with playoffs */}
      {isMatchupLeague && playoffData && playoffData.hasStarted && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>
              🏆 Playoff Bracket
              {playoffData.currentRound === 'complete' && playoffData.champion && (
                <span style={{ marginLeft: 12, fontSize: 14, color: '#fbbf24' }}>
                  Champion: {getDisplayName(playoffData.champion, USER_ID)}
                </span>
              )}
            </h3>
            <div className="muted" style={{ fontSize: 12 }}>
              {playoffData.currentRound === 'complete' ? 'Playoffs Complete' :
               playoffData.currentRound === 'quarter' ? 'Quarterfinals' :
               playoffData.currentRound === 'semi' ? 'Semifinals' :
               playoffData.currentRound === 'finals' ? 'Finals' : 'Upcoming'}
            </div>
          </div>

          {/* Bracket Visualization */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 24,
            overflowX: 'auto',
            padding: '16px 0'
          }}>
            {/* Quarterfinals Column */}
            {playoffData.quarters.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 180 }}>
                <div style={{ textAlign: 'center', fontWeight: 700, color: '#9ca3af', marginBottom: 8 }}>
                  Quarterfinals
                </div>
                {playoffData.quarters.map((m, idx) => (
                  <PlayoffMatchupCard
                    key={m.id || idx}
                    matchup={m}
                    getDisplayName={getDisplayName}
                    getAvatar={getAvatar}
                    userId={USER_ID}
                    isCurrentRound={playoffData.currentRound === 'quarter'}
                  />
                ))}
              </div>
            )}

            {/* Semifinals Column */}
            {playoffData.semis.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                minWidth: 180,
                justifyContent: 'center'
              }}>
                <div style={{ textAlign: 'center', fontWeight: 700, color: '#9ca3af', marginBottom: 8 }}>
                  Semifinals
                </div>
                {playoffData.semis.map((m, idx) => (
                  <PlayoffMatchupCard
                    key={m.id || idx}
                    matchup={m}
                    getDisplayName={getDisplayName}
                    getAvatar={getAvatar}
                    userId={USER_ID}
                    isCurrentRound={playoffData.currentRound === 'semi'}
                  />
                ))}
              </div>
            )}

            {/* Finals Column */}
            {playoffData.finals.length > 0 && (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                minWidth: 180,
                justifyContent: 'center'
              }}>
                <div style={{ textAlign: 'center', fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>
                  🏆 Finals
                </div>
                {playoffData.finals.map((m, idx) => (
                  <PlayoffMatchupCard
                    key={m.id || idx}
                    matchup={m}
                    getDisplayName={getDisplayName}
                    getAvatar={getAvatar}
                    userId={USER_ID}
                    isCurrentRound={playoffData.currentRound === 'finals'}
                    isFinals
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Performance Metrics */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>Performance Metrics</h3>
          <button className="btn" onClick={exportCSV}>Export Data</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Top Gainers */}
          <div className="card" style={{ background: '#111826' }}>
            <div className="muted" style={{ marginBottom: 8 }}>Top Gaining Stocks (Since Draft)</div>
            {topGainers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No data.</p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {topGainers.map(g => (
                  <div key={g.sym} className="list-row">
                    <div>
                      <div style={{ fontWeight: 700 }}>{g.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{g.sym}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>{formatUSD(g.now)}</div>
                      <div style={{ fontSize: 12, color: g.plp >= 0 ? '#16a34a' : '#dc2626' }}>
                        {formatPercent(g.plp, true)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Simple Draft Performance Panel */}
          <div className="card" style={{ background: '#111826' }}>
            <div className="muted" style={{ marginBottom: 8 }}>Draft Performance Analysis</div>
            {(picks || []).slice(0, 3).map(p => {
              const sym = p.symbol?.toUpperCase();
              const entry = Number(p.entry_price || 0) || 0;
              const live = prices[sym];
              const last = Number.isFinite(live) ? live : entry;
              const pct = entry > 0 ? ((last / entry) - 1) * 100 : 0;

              return (
                <div key={p.id} className="list-row">
                  <div>
                    <div style={{ fontWeight: 700 }}>{symbolToName[sym] || sym}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{sym} at ${entry.toFixed(2)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div>Now: {formatUSD(last)}</div>
                    <div style={{ fontSize: 12, color: pct >= 0 ? '#16a34a' : '#dc2626' }}>
                      {formatPercent(pct, true)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ---------- Peer Portfolio Modal ---------- */}
      {peerModalOpen && (
        <div
          className="modal-overlay"
          onClick={closePeerModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1f2937',
              color: '#fff',
              borderRadius: 12,
              width: 'min(1000px, 96vw)',
              maxWidth: '1000px',
              padding: 16,
              boxShadow: '0 20px 60px rgba(0,0,0,.6)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  Portfolio — <span style={{ color: '#93c5fd' }}>{peerUserId}</span>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Value: <strong>{formatUSD(peerTotals.value)}</strong> • P/L:{' '}
                  <strong style={{ color: peerTotals.gain >= 0 ? '#16a34a' : '#dc2626' }}>
                    {peerTotals.gain >= 0 ? '+' : ''}{formatUSD(Math.abs(peerTotals.gain))} ({formatPercent(peerTotals.pct, true)})
                  </strong>
                </div>
              </div>

              <button
                onClick={closePeerModal}
                aria-label="Close"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#9ca3af',
                  fontSize: 22,
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            <div style={{ marginTop: 12, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ overflowX: 'auto' }}>
                <table
                  className="holdings-table"
                  style={{ width: '100%', tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col style={{ width: 90 }} />   {/* Symbol */}
                    <col />                          {/* Company (flex) */}
                    <col style={{ width: 70 }} />   {/* Qty */}
                    <col style={{ width: 110 }} />  {/* Entry */}
                    <col style={{ width: 110 }} />  {/* Last */}
                    <col style={{ width: 90 }} />   {/* P/L $ */}
                    <col style={{ width: 90 }} />   {/* P/L % */}
                  </colgroup>

                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Company</th>
                      <th className="numeric">Qty</th>
                      <th className="numeric">Entry</th>
                      <th className="numeric">Last</th>
                      <th className="numeric">P/L $</th>
                      <th className="numeric">P/L %</th>
                    </tr>
                  </thead>

                  <tbody>
                    {peerRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '16px 8px', color: '#9ca3af' }}>
                          No holdings.
                        </td>
                      </tr>
                    ) : peerRows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.sym}</td>
                        <td>{r.company || '—'}</td>
                        <td className="numeric">{Number.isFinite(r.qty) ? r.qty : '—'}</td>
                        <td className="numeric">{Number.isFinite(r.entry) ? `$${r.entry.toFixed(2)}` : '—'}</td>
                        <td className="numeric">{Number.isFinite(r.last) ? `$${r.last.toFixed(2)}` : '—'}</td>
                        <td className="numeric" style={{ color: (r.pl ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                          {Number.isFinite(r.pl) ? `$${r.pl.toFixed(2)}` : '—'}
                        </td>
                        <td className="numeric" style={{ color: (r.plp ?? 0) >= 0 ? '#16a34a' : '#dc2626' }}>
                          {Number.isFinite(r.plp) ? `${r.plp.toFixed(2)}%` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Schedule Modal ---------- */}
      {scheduleModalOpen && (
        <div
          className="modal-overlay"
          onClick={closeScheduleModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#1f2937',
              color: '#fff',
              borderRadius: 12,
              width: 'min(600px, 96vw)',
              maxWidth: '600px',
              maxHeight: '80vh',
              padding: 16,
              boxShadow: '0 20px 60px rgba(0,0,0,.6)',
              display: 'flex',
              flexDirection: 'column'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
                  Full Season Schedule
                </div>
                <select
                  value={schedulePlayerId || USER_ID}
                  onChange={(e) => setSchedulePlayerId(e.target.value)}
                  className="round-select"
                  style={{ width: '100%', padding: '8px 12px' }}
                >
                  {allUserIds.map(uid => (
                    <option key={uid} value={uid}>
                      {getDisplayName(uid, USER_ID)}{uid === USER_ID ? ' (You)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={closeScheduleModal}
                aria-label="Close"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#9ca3af',
                  fontSize: 22,
                  cursor: 'pointer',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>

            {/* Schedule List */}
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {playerSchedule.length === 0 ? (
                <p className="muted" style={{ textAlign: 'center', padding: 20 }}>No schedule available.</p>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {playerSchedule.map((week) => {
                    const isCurrent = week.week_number === currentWeek;
                    return (
                      <div
                        key={week.id}
                        style={{
                          background: isCurrent ? '#1e3a5f' : '#111826',
                          borderRadius: 8,
                          padding: 12,
                          border: isCurrent ? '1px solid #3b82f6' : '1px solid transparent'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              Week {week.week_number}
                              {isCurrent && <span style={{ marginLeft: 8, color: '#3b82f6', fontSize: 12 }}>CURRENT</span>}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              vs <span style={{ fontWeight: 600 }}>{getDisplayName(week.opponentId, USER_ID)}</span>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            {week.isComplete ? (
                              <>
                                <div style={{
                                  fontWeight: 700,
                                  color: week.didWin ? '#16a34a' : week.didLose ? '#dc2626' : '#eab308'
                                }}>
                                  {week.didWin ? 'WIN' : week.didLose ? 'LOSS' : 'TIE'}
                                </div>
                                <div className="muted" style={{ fontSize: 12 }}>
                                  {formatUSD(week.myGain)} vs {formatUSD(week.oppGain)}
                                </div>
                              </>
                            ) : (
                              <div className="muted" style={{ fontSize: 12 }}>
                                {week.week_number < currentWeek ? 'Not played' : 'Upcoming'}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
