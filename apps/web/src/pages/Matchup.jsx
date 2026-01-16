// src/pages/Matchup.jsx
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import { useAuthUser } from '../auth/useAuthUser';
import { useUserProfiles } from '../context/UserProfilesContext';
import { usePrices } from '../context/PriceContext';
import { useRealtimeStandings } from '../hooks/useRealtimeStandings';
import { useActiveWeekPolling } from '../hooks/useActiveWeekPolling';
import WeekNavigator from '../components/WeekNavigator';
import WeekIndicator from '../components/WeekIndicator';
import { isWeekActive, getWeekStatus } from '../utils/weekStatus';
import '../layout.css';

function formatUSD(value) {
  return Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function Matchup() {
  const user = useAuthUser();
  const USER_ID = user?.id;
  const { fetchProfiles, getDisplayName, getAvatar } = useUserProfiles();
  const { prices, fetchPrices } = usePrices();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const [league, setLeague] = useState(null);
  const [matchup, setMatchup] = useState(null);
  const [team1Holdings, setTeam1Holdings] = useState([]);
  const [team2Holdings, setTeam2Holdings] = useState([]);
  const [weekSnapshots, setWeekSnapshots] = useState({}); // { symbol: weekStartPrice }
  const [hasSnapshots, setHasSnapshots] = useState(false);

  const isMatchupLeague = league?.league_type === 'matchup';
  const currentWeek = league?.current_week || 1;

  // Selected week for navigation (defaults to current week)
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);

  // Real-time subscription for matchup updates
  const { matchupsUpdated } = useRealtimeStandings(leagueId, isMatchupLeague);

  // Determine if the selected week is active (for polling)
  const weekIsActive = useMemo(() => {
    if (!matchup) return false;
    return isWeekActive(matchup);
  }, [matchup]);

  // Get all symbols for polling
  const allSymbols = useMemo(() => {
    const symbols = new Set();
    team1Holdings.forEach(h => symbols.add(h.symbol));
    team2Holdings.forEach(h => symbols.add(h.symbol));
    return Array.from(symbols);
  }, [team1Holdings, team2Holdings]);

  // 5-minute polling during active weeks
  useActiveWeekPolling(leagueId, weekIsActive && selectedWeek === currentWeek, fetchPrices, allSymbols);

  // Update selectedWeek when currentWeek changes
  useEffect(() => {
    if (currentWeek > 0) {
      setSelectedWeek(currentWeek);
    }
  }, [currentWeek]);

  // Refetch matchup data callback
  const refetchMatchupData = useCallback(async () => {
    if (!leagueId || !USER_ID || !isMatchupLeague) return;

    try {
      const { data: matchupData } = await supabase
        .from('matchups')
        .select('*')
        .eq('league_id', leagueId)
        .eq('week_number', selectedWeek)
        .or(`team1_user_id.eq.${USER_ID},team2_user_id.eq.${USER_ID}`)
        .single();

      if (matchupData) {
        setMatchup(matchupData);
      }
    } catch (e) {
      console.error('Error refetching matchup:', e);
    }
  }, [leagueId, USER_ID, selectedWeek, isMatchupLeague]);

  // Handle real-time matchup updates
  useEffect(() => {
    if (matchupsUpdated && selectedWeek === currentWeek) {
      refetchMatchupData();
    }
  }, [matchupsUpdated, selectedWeek, currentWeek, refetchMatchupData]);

  // Load leagues
  useEffect(() => {
    if (!USER_ID) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError('');

        const { data: mem } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', USER_ID);

        const ids = (mem || []).map(r => r.league_id);
        if (ids.length === 0) {
          setLeagues([]);
          setLeagueId('');
          return;
        }

        const { data: lg } = await supabase
          .from('leagues')
          .select('id, name, league_type, current_week, num_weeks')
          .in('id', ids);

        setLeagues(lg || []);

        const chosen = leagueId && lg?.some(x => x.id === leagueId)
          ? leagueId
          : lg?.[0]?.id || '';

        setLeagueId(chosen);
        localStorage.setItem('activeLeagueId', chosen);
        setLeague(lg?.find(x => x.id === chosen) || null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [USER_ID]);

  // Load matchup data when league or selected week changes
  useEffect(() => {
    if (!USER_ID || !leagueId || !isMatchupLeague || selectedWeek < 1) {
      setMatchup(null);
      setTeam1Holdings([]);
      setTeam2Holdings([]);
      setWeekSnapshots({});
      setHasSnapshots(false);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError('');

        // Find user's matchup for selected week
        const { data: matchupData, error: matchupError } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', leagueId)
          .eq('week_number', selectedWeek)
          .or(`team1_user_id.eq.${USER_ID},team2_user_id.eq.${USER_ID}`)
          .single();

        if (matchupError && matchupError.code !== 'PGRST116') {
          throw matchupError;
        }

        if (!matchupData) {
          setMatchup(null);
          setLoading(false);
          return;
        }

        setMatchup(matchupData);

        // Fetch profiles for both users
        const userIds = [matchupData.team1_user_id, matchupData.team2_user_id];
        fetchProfiles(userIds);

        // Fetch week snapshots for both users
        const { data: snapshots } = await supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price')
          .eq('league_id', leagueId)
          .eq('week_number', selectedWeek)
          .in('user_id', userIds.filter(Boolean));

        // Build snapshot map: { `${userId}-${symbol}`: { quantity, weekStartPrice } }
        const snapshotMap = {};
        if (snapshots && snapshots.length > 0) {
          for (const s of snapshots) {
            const key = `${s.user_id}-${s.symbol}`;
            snapshotMap[key] = {
              quantity: Number(s.quantity),
              weekStartPrice: Number(s.week_start_price),
            };
          }
          setWeekSnapshots(snapshotMap);
          setHasSnapshots(true);
        } else {
          setWeekSnapshots({});
          setHasSnapshots(false);
        }

        // Fetch holdings for both teams
        const [team1, team2] = await Promise.all([
          fetchTeamHoldings(matchupData.team1_user_id),
          fetchTeamHoldings(matchupData.team2_user_id),
        ]);

        setTeam1Holdings(team1);
        setTeam2Holdings(team2);

      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [USER_ID, leagueId, selectedWeek, isMatchupLeague]);

  async function fetchTeamHoldings(userId) {
    if (!leagueId) return [];

    // Fetch draft picks
    const { data: picks } = await supabase
      .from('drafts')
      .select('id, symbol, entry_price, quantity, user_id')
      .eq('league_id', leagueId)
      .eq('user_id', userId);

    // Fetch trades
    const { data: trades } = await supabase
      .from('trades')
      .select('id, symbol, price, quantity, action, user_id')
      .eq('league_id', leagueId)
      .eq('user_id', userId);

    // Calculate holdings
    const holdingsMap = {};

    (picks || []).forEach(pick => {
      const sym = pick.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(pick.quantity || 1);
      const price = Number(pick.entry_price);
      holdingsMap[sym].quantity += qty;
      holdingsMap[sym].totalCost += price * qty;
    });

    (trades || []).forEach(trade => {
      const sym = trade.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = { symbol: sym, quantity: 0, totalCost: 0 };
      }

      const qty = Number(trade.quantity);
      const price = Number(trade.price);

      if (trade.action === 'buy') {
        holdingsMap[sym].quantity += qty;
        holdingsMap[sym].totalCost += price * qty;
      } else if (trade.action === 'sell') {
        const avgEntry = holdingsMap[sym].quantity > 0
          ? holdingsMap[sym].totalCost / holdingsMap[sym].quantity
          : price;
        holdingsMap[sym].quantity -= qty;
        holdingsMap[sym].totalCost = avgEntry * holdingsMap[sym].quantity;
      }
    });

    // Filter and fetch prices
    const holdingsList = Object.values(holdingsMap).filter(h => h.quantity > 0);
    const symbols = holdingsList.map(h => h.symbol);

    if (symbols.length > 0) {
      await fetchPrices(symbols);
    }

    return holdingsList;
  }

  // Calculate gains using week start prices (if available) or entry prices as fallback
  const team1WithGains = useMemo(() => {
    const userId = matchup?.team1_user_id;
    return team1Holdings.map(h => {
      const currentPrice = prices[h.symbol] || h.totalCost / h.quantity;
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      let gain;
      if (hasSnapshots && snapshot) {
        // Use week start price for gain calculation
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
      } else {
        // Fallback to entry price (week hasn't started yet or no snapshot)
        // Before week starts, show 0 gain
        gain = hasSnapshots ? 0 : (currentPrice * h.quantity) - h.totalCost;
      }

      return { ...h, currentPrice, gain };
    }).sort((a, b) => b.gain - a.gain);
  }, [team1Holdings, prices, weekSnapshots, hasSnapshots, matchup]);

  const team2WithGains = useMemo(() => {
    const userId = matchup?.team2_user_id;
    return team2Holdings.map(h => {
      const currentPrice = prices[h.symbol] || h.totalCost / h.quantity;
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      let gain;
      if (hasSnapshots && snapshot) {
        // Use week start price for gain calculation
        gain = (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
      } else {
        // Fallback to entry price (week hasn't started yet or no snapshot)
        gain = hasSnapshots ? 0 : (currentPrice * h.quantity) - h.totalCost;
      }

      return { ...h, currentPrice, gain };
    }).sort((a, b) => b.gain - a.gain);
  }, [team2Holdings, prices, weekSnapshots, hasSnapshots, matchup]);

  const team1Total = useMemo(() => team1WithGains.reduce((sum, h) => sum + h.gain, 0), [team1WithGains]);
  const team2Total = useMemo(() => team2WithGains.reduce((sum, h) => sum + h.gain, 0), [team2WithGains]);

  const isTeam1Winning = team1Total > team2Total;
  const isTeam2Winning = team2Total > team1Total;

  function handleLeagueChange(e) {
    const newId = e.target.value;
    setLeagueId(newId);
    localStorage.setItem('activeLeagueId', newId);
    setLeague(leagues.find(l => l.id === newId) || null);
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
        Loading matchup...
      </div>
    );
  }

  if (!USER_ID) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <p className="muted">Please log in to view your matchup.</p>
        <Link to="/login" className="btn primary" style={{ marginTop: 16 }}>Log In</Link>
      </div>
    );
  }

  if (!isMatchupLeague) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ margin: '0 0 8px 0' }}>Duration League</h2>
        <p className="muted">This league doesn't have weekly matchups.</p>
        <Link to="/leaderboard" className="btn" style={{ marginTop: 16 }}>View Standings</Link>
      </div>
    );
  }

  if (!matchup) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🏈</div>
        <h2 style={{ margin: '0 0 8px 0' }}>No Matchup This Week</h2>
        <p className="muted">You don't have a matchup scheduled for Week {currentWeek}.</p>
      </div>
    );
  }

  const isUserTeam1 = matchup.team1_user_id === USER_ID;
  const maxRows = Math.max(team1WithGains.length, team2WithGains.length, 1);

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>Matchup</h1>
            <p className="muted" style={{ margin: '4px 0 0 0' }}>{league?.name}</p>
          </div>
          {leagues.length > 1 && (
            <select
              value={leagueId}
              onChange={handleLeagueChange}
              className="select"
              style={{ width: 'auto' }}
            >
              {leagues.filter(l => l.league_type === 'matchup').map(l => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Week Navigator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <WeekNavigator
            currentWeek={currentWeek}
            selectedWeek={selectedWeek}
            totalWeeks={league?.num_weeks}
            onWeekChange={setSelectedWeek}
          />
          <WeekIndicator
            league={league}
            matchup={matchup}
            showCountdown={selectedWeek === currentWeek}
            size="small"
          />
        </div>
      </div>

      {/* Scoreboard */}
      <div className="card" style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        padding: 0,
        marginBottom: 20,
        overflow: 'hidden',
      }}>
        {/* Team 1 */}
        <div style={{
          textAlign: 'center',
          padding: 24,
          background: isTeam1Winning ? 'rgba(34, 197, 94, 0.1)' : undefined,
        }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{getAvatar(matchup.team1_user_id)}</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {getDisplayName(matchup.team1_user_id, USER_ID)}
          </div>
          <div style={{
            fontSize: 24,
            fontWeight: 800,
            color: team1Total >= 0 ? '#22c55e' : '#ef4444',
          }}>
            {team1Total >= 0 ? '+' : ''}${formatUSD(team1Total)}
          </div>
          {isTeam1Winning && (
            <div style={{
              marginTop: 8,
              fontSize: 11,
              fontWeight: 700,
              color: '#22c55e',
              background: 'rgba(34, 197, 94, 0.2)',
              padding: '4px 10px',
              borderRadius: 4,
              display: 'inline-block',
            }}>
              LEADING
            </div>
          )}
        </div>

        {/* VS */}
        <div style={{
          padding: '0 16px',
          fontWeight: 800,
          color: '#6b7280',
          fontSize: 18,
        }}>
          VS
        </div>

        {/* Team 2 */}
        <div style={{
          textAlign: 'center',
          padding: 24,
          background: isTeam2Winning ? 'rgba(34, 197, 94, 0.1)' : undefined,
        }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{getAvatar(matchup.team2_user_id)}</div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>
            {getDisplayName(matchup.team2_user_id, USER_ID)}
          </div>
          <div style={{
            fontSize: 24,
            fontWeight: 800,
            color: team2Total >= 0 ? '#22c55e' : '#ef4444',
          }}>
            {team2Total >= 0 ? '+' : ''}${formatUSD(team2Total)}
          </div>
          {isTeam2Winning && (
            <div style={{
              marginTop: 8,
              fontSize: 11,
              fontWeight: 700,
              color: '#22c55e',
              background: 'rgba(34, 197, 94, 0.2)',
              padding: '4px 10px',
              borderRadius: 4,
              display: 'inline-block',
            }}>
              LEADING
            </div>
          )}
        </div>
      </div>

      {/* Side-by-side Lineups */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Headers */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 50px 1fr',
          borderBottom: '1px solid #2a3040',
        }}>
          <div style={{
            padding: 12,
            fontWeight: 700,
            textAlign: 'center',
            background: isTeam1Winning ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.03)',
          }}>
            {isUserTeam1 ? 'You' : getDisplayName(matchup.team1_user_id)}
          </div>
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            color: '#4b5563',
            fontSize: 12,
          }}>
            SLOT
          </div>
          <div style={{
            padding: 12,
            fontWeight: 700,
            textAlign: 'center',
            background: isTeam2Winning ? 'rgba(34, 197, 94, 0.1)' : 'rgba(255,255,255,0.03)',
          }}>
            {!isUserTeam1 ? 'You' : getDisplayName(matchup.team2_user_id)}
          </div>
        </div>

        {/* Stock rows */}
        {Array.from({ length: maxRows }).map((_, idx) => {
          const h1 = team1WithGains[idx];
          const h2 = team2WithGains[idx];

          return (
            <div key={idx} style={{
              display: 'grid',
              gridTemplateColumns: '1fr 50px 1fr',
              borderBottom: '1px solid #2a3040',
            }}>
              {/* Team 1 Stock */}
              <div style={{ padding: 14, textAlign: 'center' }}>
                {h1 ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{h1.symbol}</div>
                    <div style={{
                      fontWeight: 700,
                      marginTop: 4,
                      color: h1.gain >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                      {h1.gain >= 0 ? '+' : ''}${formatUSD(h1.gain)}
                    </div>
                  </>
                ) : (
                  <span style={{ color: '#4b5563' }}>—</span>
                )}
              </div>

              {/* Slot number */}
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                color: '#4b5563',
                fontSize: 13,
              }}>
                {idx + 1}
              </div>

              {/* Team 2 Stock */}
              <div style={{ padding: 14, textAlign: 'center' }}>
                {h2 ? (
                  <>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{h2.symbol}</div>
                    <div style={{
                      fontWeight: 700,
                      marginTop: 4,
                      color: h2.gain >= 0 ? '#22c55e' : '#ef4444',
                    }}>
                      {h2.gain >= 0 ? '+' : ''}${formatUSD(h2.gain)}
                    </div>
                  </>
                ) : (
                  <span style={{ color: '#4b5563' }}>—</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Totals */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 50px 1fr',
          background: 'rgba(255,255,255,0.05)',
        }}>
          <div style={{ padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1 }}>TOTAL</div>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              marginTop: 4,
              color: team1Total >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {team1Total >= 0 ? '+' : ''}${formatUSD(team1Total)}
            </div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)' }} />
          <div style={{ padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 1 }}>TOTAL</div>
            <div style={{
              fontSize: 18,
              fontWeight: 800,
              marginTop: 4,
              color: team2Total >= 0 ? '#22c55e' : '#ef4444',
            }}>
              {team2Total >= 0 ? '+' : ''}${formatUSD(team2Total)}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="error" style={{ marginTop: 16 }}>{error}</div>
      )}
    </div>
  );
}
