// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName, formatUSD } from '../utils/formatting';
import { fetchQuotesInBatch, fetchCompanyNamesInBatch } from '../utils/stockData';
import { getHolidaysInRange } from '../utils/marketHolidays';
import { getPlayoffRoundName } from '../utils/scheduleGenerator';
import { PageLoader } from '../components/LoadingSpinner';
import { useUserProfiles } from '../context/UserProfilesContext';
import EmptyState from '../components/EmptyState';
import { SkeletonDashboard } from '../components/Skeleton';
import OnboardingModal, { hasCompletedOnboarding } from '../components/OnboardingModal';
import ProgressChecklist, { useSetupProgress } from '../components/ProgressChecklist';
import ApiStatus from '../components/ApiStatus';

export default function Dashboard() {
  const navigate = useNavigate();
  const authUser = useAuthUser();
  const { fetchProfiles, getDisplayName, getAvatar } = useUserProfiles();
  // keep a fallback for now so your draft keeps working if not signed in
  const USER_ID = authUser?.id ?? 'test-user';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Leagues
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const activeLeague = useMemo(() => leagues.find(l => l.id === leagueId) || null, [leagues, leagueId]);

  // Holdings (selected league)
  const [positions, setPositions] = useState([]);   // my rows from drafts
  const [symbolToName, setSymbolToName] = useState({});

  // Recent league activity + standings preview
  const [allPicks, setAllPicks] = useState([]);       // all picks for standings
  const [allTrades, setAllTrades] = useState([]);     // all trades for standings
  const [recentPicks, setRecentPicks] = useState([]); // last 5 for display
  const [recentTrades, setRecentTrades] = useState([]);

  // Current matchup state (for matchup leagues)
  const [currentMatchup, setCurrentMatchup] = useState(null);
  const [opponentName, setOpponentName] = useState('');
  const [weekSnapshots, setWeekSnapshots] = useState({}); // { `${userId}-${symbol}`: { quantity, weekStartPrice } }
  const [hasWeekSnapshots, setHasWeekSnapshots] = useState(false);

  // ---- Load my leagues (only when signed in)
  useEffect(() => {
    // Don't run with test-user fallback - wait for real auth
    if (!authUser?.id) {
      setLoading(false);
      setLeagues([]);
      setLeagueId('');
      setPositions([]);
      setAllPicks([]);
      setAllTrades([]);
      setRecentPicks([]);
      setRecentTrades([]);
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
          setPositions([]);
          setRecentPicks([]);
          return;
        }

        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name, draft_date, budget_mode, budget_amount, league_type, current_week')
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

  // ---- When league changes: load holdings, names, activity, standings (only when signed in)
  useEffect(() => {
    if (!authUser?.id || !leagueId) {
      setPositions([]);
      setAllPicks([]);
      setAllTrades([]);
      setRecentPicks([]);
      setRecentTrades([]);
      return;
    }

    (async () => {
      try {
        setLoading(true);
        setError('');

        const { data: picks, error: pErr } = await supabase
          .from('drafts')
          .select('id, user_id, symbol, entry_price, quantity, round, pick_number, created_at')
          .eq('league_id', leagueId)
          .order('pick_number', { ascending: true });

        if (pErr) throw pErr;

        // mine
        setPositions((picks || []).filter(p => p.user_id === USER_ID));

        // Load ALL trades for standings calculation
        const { data: allTradesData, error: tErr } = await supabase
          .from('trades')
          .select('*')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: true });

        if (tErr) throw tErr;
        setAllTrades(allTradesData || []);

        // Recent trades (last 5 for display)
        const sortedTrades = [...(allTradesData || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
        setRecentTrades(sortedTrades);

        // Collect all unique symbols from both drafts and trades
        const draftSymbols = (picks || []).map(p => p.symbol?.toUpperCase());
        const tradeSymbols = (allTradesData || []).map(t => t.symbol?.toUpperCase());
        const uniq = [...new Set([...draftSymbols, ...tradeSymbols])].filter(Boolean);

        // Store all picks for standings calculation
        setAllPicks(picks || []);

        // recent activity (last 5)
        const sortedPicks = [...(picks || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
        setRecentPicks(sortedPicks);

        // Fetch user profiles for all user IDs in picks and trades
        const allUserIds = [
          ...new Set([
            ...(picks || []).map(p => p.user_id),
            ...(allTradesData || []).map(t => t.user_id),
          ].filter(Boolean))
        ];

        // Fetch prices, company names, and user profiles in parallel
        if (uniq.length > 0) {
          const [priceData, nameData] = await Promise.all([
            fetchQuotesInBatch(uniq),
            fetchCompanyNamesInBatch(uniq, symbolToName),
          ]);
          setPrices(priceData);
          setSymbolToName(nameData);
        }

        if (allUserIds.length > 0) {
          fetchProfiles(allUserIds);
        }
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [USER_ID, leagueId]);

  // Fetch current matchup for matchup leagues
  useEffect(() => {
    if (!activeLeague || activeLeague.league_type !== 'matchup' || !leagueId || !USER_ID) {
      setCurrentMatchup(null);
      setOpponentName('');
      setWeekSnapshots({});
      setHasWeekSnapshots(false);
      return;
    }

    (async () => {
      try {
        const currentWeek = activeLeague.current_week || 1;

        // Find the matchup where this user is either team1 or team2
        const { data: matchup, error: matchupErr } = await supabase
          .from('matchups')
          .select('*')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek)
          .or(`team1_user_id.eq.${USER_ID},team2_user_id.eq.${USER_ID}`)
          .single();

        if (matchupErr || !matchup) {
          setCurrentMatchup(null);
          setOpponentName('');
          return;
        }

        setCurrentMatchup(matchup);

        // Get opponent's user ID and fetch their profile
        // team2_user_id is null for bye weeks
        const opponentId = matchup.team1_user_id === USER_ID
          ? matchup.team2_user_id
          : matchup.team1_user_id;

        // If opponentId is null, it's a bye week
        if (opponentId) {
          await fetchProfiles([opponentId]);
          setOpponentName(opponentId);
        } else {
          setOpponentName(null); // null indicates bye week
        }

        // Fetch week snapshots for both users
        const userIds = [USER_ID, opponentId].filter(Boolean);
        const { data: snapshots } = await supabase
          .from('week_snapshots')
          .select('user_id, symbol, quantity, week_start_price')
          .eq('league_id', leagueId)
          .eq('week_number', currentWeek)
          .in('user_id', userIds);

        if (snapshots && snapshots.length > 0) {
          const snapshotMap = {};
          for (const s of snapshots) {
            const key = `${s.user_id}-${s.symbol}`;
            snapshotMap[key] = {
              quantity: Number(s.quantity),
              weekStartPrice: Number(s.week_start_price),
            };
          }
          setWeekSnapshots(snapshotMap);
          setHasWeekSnapshots(true);
        } else {
          setWeekSnapshots({});
          setHasWeekSnapshots(false);
        }
      } catch (e) {
        console.error('Failed to fetch matchup:', e);
        setCurrentMatchup(null);
        setOpponentName('');
      }
    })();
  }, [activeLeague, leagueId, USER_ID, fetchProfiles]);

  // Simple state for prices (no real-time polling)
  const [prices, setPrices] = useState({});

  // ---- Group picks and trades by user (same logic as Leaderboard)
  const picksByUser = useMemo(() => {
    const map = new Map();
    for (const p of allPicks) {
      const u = p.user_id;
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(p);
    }
    return map;
  }, [allPicks]);

  const tradesByUser = useMemo(() => {
    const map = new Map();
    for (const t of allTrades) {
      const u = t.user_id;
      if (!map.has(u)) map.set(u, []);
      map.get(u).push(t);
    }
    return map;
  }, [allTrades]);

  // Calculate actual holdings for a user (drafts + buys - sells) - same as Leaderboard
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

  // Calculate weekly matchup gain using week snapshots
  function calcWeeklyGain(userId) {
    if (!hasWeekSnapshots) {
      // Fallback to cumulative gain if no snapshots
      return calcUserStats(userId).gain;
    }

    let totalGain = 0;
    const holdings = calcUserHoldings(userId);

    for (const h of holdings) {
      const snapshotKey = `${userId}-${h.symbol}`;
      const snapshot = weekSnapshots[snapshotKey];

      if (snapshot) {
        const currentPrice = prices[h.symbol];
        if (Number.isFinite(currentPrice)) {
          totalGain += (currentPrice - snapshot.weekStartPrice) * snapshot.quantity;
        }
      }
    }

    return totalGain;
  }

  // Get all unique user IDs
  const standingsUserIds = useMemo(() => {
    const ids = new Set([...picksByUser.keys(), ...tradesByUser.keys()]);
    return Array.from(ids);
  }, [picksByUser, tradesByUser]);

  // ---- Recalculate standings with live prices (ranked by dollar gain like Leaderboard)
  const standings = useMemo(() => {
    const arr = standingsUserIds.map(u => {
      const { value, gain, pct } = calcUserStats(u);
      return { user_id: u, value, gain, pct };
    });
    // rank by total profit (gain), not percent - same as Leaderboard
    arr.sort((a, b) => b.gain - a.gain);
    return arr;
  }, [standingsUserIds, prices, picksByUser, tradesByUser]);

  // ---- My portfolio value + rank
  const myPortfolioValue = useMemo(() => {
    return positions.reduce((sum, p) => {
      const sym = p.symbol?.toUpperCase();
      const live = prices[sym];
      const px = Number.isFinite(live) ? live : Number(p.entry_price || 0);
      const qty = Number(p.quantity || 0) || 0;
      return sum + px * qty;
    }, 0);
  }, [positions, prices]);

  const myRank = useMemo(() => {
    if (!standings.length) return null;
    const idx = standings.findIndex(s => s.user_id === USER_ID);
    return idx >= 0 ? idx + 1 : null;
  }, [standings, USER_ID]);

  // ---- Top performers (mine)
  const topPerformers = useMemo(() => {
    const rows = positions.map(p => {
      const sym = p.symbol?.toUpperCase();
      const entry = Number(p.entry_price || 0);
      const last = prices[sym] ?? entry;
      const qty = Number(p.quantity || 0) || 0;
      const pl = (last - entry) * qty;
      const plp = entry ? ((last / entry) - 1) * 100 : 0;
      return { sym, entry, last, qty, pl, plp, name: symbolToName[sym] || sym };
    });
    return rows.sort((a, b) => b.plp - a.plp).slice(0, 5);
  }, [positions, prices, symbolToName]);

  // ---- Quick stats for my portfolio
  const quickStats = useMemo(() => {
    const myHoldings = calcUserHoldings(USER_ID);
    let totalValue = 0;
    let totalCost = 0;
    let holdingsCount = myHoldings.length;

    for (const h of myHoldings) {
      const qty = Number(h.quantity || 0);
      const avgEntry = h.quantity > 0 ? h.totalCost / h.quantity : 0;
      const live = prices[h.symbol];
      const last = Number.isFinite(live) ? live : avgEntry;

      totalCost += avgEntry * qty;
      totalValue += last * qty;
    }

    const totalGain = totalValue - totalCost;
    const totalGainPct = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;

    return { totalValue, totalCost, totalGain, totalGainPct, holdingsCount };
  }, [USER_ID, picksByUser, tradesByUser, prices]);

  // ---- Market status (US markets: 9:30 AM - 4:00 PM ET, Mon-Fri)
  const marketStatus = useMemo(() => {
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      weekday: 'short'
    });
    const etParts = etFormatter.formatToParts(now);
    const weekday = etParts.find(p => p.type === 'weekday')?.value || '';
    const hour = parseInt(etParts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(etParts.find(p => p.type === 'minute')?.value || '0', 10);
    const timeInMinutes = hour * 60 + minute;

    const isWeekend = weekday === 'Sat' || weekday === 'Sun';
    const marketOpen = 9 * 60 + 30;  // 9:30 AM
    const marketClose = 16 * 60;      // 4:00 PM

    if (isWeekend) {
      return { isOpen: false, status: 'Closed', detail: 'Weekend' };
    }

    if (timeInMinutes < marketOpen) {
      const minsUntilOpen = marketOpen - timeInMinutes;
      const hrs = Math.floor(minsUntilOpen / 60);
      const mins = minsUntilOpen % 60;
      return {
        isOpen: false,
        status: 'Pre-Market',
        detail: `Opens in ${hrs}h ${mins}m`
      };
    }

    if (timeInMinutes >= marketClose) {
      return { isOpen: false, status: 'After Hours', detail: 'Market closed' };
    }

    const minsUntilClose = marketClose - timeInMinutes;
    const hrs = Math.floor(minsUntilClose / 60);
    const mins = minsUntilClose % 60;
    return {
      isOpen: true,
      status: 'Market Open',
      detail: `Closes in ${hrs}h ${mins}m`
    };
  }, []);

  // ---- Check for holidays in current matchup week
  const weekHolidays = useMemo(() => {
    if (!currentMatchup?.week_start || !currentMatchup?.week_end) return [];
    return getHolidaysInRange(
      new Date(currentMatchup.week_start),
      new Date(currentMatchup.week_end)
    );
  }, [currentMatchup]);

  // ---- Check if onboarding should be shown (after initial load)
  useEffect(() => {
    if (!loading && authUser?.id) {
      const completed = hasCompletedOnboarding(authUser.id);
      if (!completed) {
        setShowOnboarding(true);
      }
    }
  }, [loading, authUser?.id]);

  // ---- Progress checklist items
  const setupItems = useSetupProgress({
    hasLeagues: leagues.length > 0,
    hasHoldings: positions.length > 0,
    hasAlpaca: false, // TODO: Check if user has linked Alpaca
  });

  // Check if user is new (no leagues, no holdings)
  const isNewUser = leagues.length === 0 && positions.length === 0;

  // ---- If not signed in: show centered sign-in box and nothing else
  if (!USER_ID) {
    return (
      <div className="page" style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="card" style={{ width: 'min(640px, 92vw)', textAlign: 'center', padding: 28 }}>
          <h2 style={{ marginTop: 0, color: '#fff' }}>Sign in to continue</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Create or join leagues, draft stocks, and track your performance.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16 }}>
            <button
              className="btn primary"
              onClick={() => navigate('/login')}
            >
              Sign in / Create account
            </button>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await supabase.auth.signInWithOAuth({ provider: 'github' });
                } catch { /* ignore */ }
              }}
            >
              Continue with GitHub
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return <SkeletonDashboard />;
  }

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Dashboard Unavailable</h3>
          <p className="muted">Error: {error}</p>
          <Link className="btn" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ paddingTop: 24 }}>
      {/* Onboarding Modal for new users */}
      {showOnboarding && authUser?.id && (
        <OnboardingModal
          userId={authUser.id}
          onComplete={() => setShowOnboarding(false)}
        />
      )}

      {/* Progress Checklist for users who haven't completed all setup steps */}
      {!showOnboarding && isNewUser && (
        <div style={{ marginBottom: 16 }}>
          <ProgressChecklist
            title="Getting Started"
            items={setupItems}
            showProgress={true}
          />
        </div>
      )}

      {/* API Status - shows when stock prices fail to load */}
      <ApiStatus />

      {/* Row 1: Matchup + Market Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* Matchup Preview (for matchup leagues) */}
        {activeLeague?.league_type === 'matchup' && currentMatchup && (() => {
          const isByeWeek = opponentName === null;
          // Use weekly gain from snapshots for matchup display
          const myGain = calcWeeklyGain(USER_ID);

          // Bye week display
          if (isByeWeek) {
            return (
              <div className="card" style={{
                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(22, 163, 74, 0.1) 100%)',
                border: '1px solid rgba(34, 197, 94, 0.2)',
                padding: '14px 16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e5e7eb' }}>
                      Week {currentMatchup.week_number}
                    </div>
                    {weekHolidays.length > 0 && (
                      <span style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 4,
                        backgroundColor: 'rgba(251, 191, 36, 0.15)',
                        color: '#fbbf24',
                        fontWeight: 600
                      }}>
                        Short Week
                      </span>
                    )}
                  </div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {new Date(currentMatchup.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    {' – '}
                    {new Date(currentMatchup.week_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </div>

                {weekHolidays.length > 0 && (
                  <div style={{
                    fontSize: 11,
                    color: '#fbbf24',
                    marginBottom: 10,
                    padding: '6px 10px',
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                    borderRadius: 6,
                    textAlign: 'center'
                  }}>
                    Market closed: {weekHolidays.map(h => h.name).join(', ')}
                  </div>
                )}

                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e', marginBottom: 4 }}>
                    Bye Week
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    No opponent this week — automatic win!
                  </div>
                </div>

                <div style={{ marginTop: 10, textAlign: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    Your P/L: <span style={{ color: myGain >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                      {myGain >= 0 ? '+' : ''}{formatUSD(myGain)}
                    </span>
                  </span>
                </div>
              </div>
            );
          }

          // Normal matchup display (regular season or playoff)
          // Use weekly gain from snapshots for matchup display
          const oppGain = calcWeeklyGain(opponentName);
          const isWinning = myGain > oppGain;
          const isTied = myGain === oppGain;
          const isPlayoff = currentMatchup.is_playoff === true;
          const mySeed = currentMatchup.team1_user_id === USER_ID
            ? currentMatchup.team1_seed
            : currentMatchup.team2_seed;
          const oppSeed = currentMatchup.team1_user_id === USER_ID
            ? currentMatchup.team2_seed
            : currentMatchup.team1_seed;

          return (
            <div className="card" style={{
              background: isPlayoff
                ? 'linear-gradient(135deg, rgba(251, 191, 36, 0.15) 0%, rgba(245, 158, 11, 0.1) 100%)'
                : 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(139, 92, 246, 0.1) 100%)',
              border: isPlayoff
                ? '1px solid rgba(251, 191, 36, 0.3)'
                : '1px solid rgba(59, 130, 246, 0.2)',
              padding: '14px 16px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isPlayoff ? '#fbbf24' : '#e5e7eb' }}>
                    {isPlayoff
                      ? `🏆 ${getPlayoffRoundName(currentMatchup.playoff_round)}`
                      : `Week ${currentMatchup.week_number} Matchup`
                    }
                  </div>
                  {weekHolidays.length > 0 && (
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      backgroundColor: 'rgba(251, 191, 36, 0.15)',
                      color: '#fbbf24',
                      fontWeight: 600
                    }}>
                      Short Week
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 11 }}>
                  {new Date(currentMatchup.week_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {new Date(currentMatchup.week_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>

              {weekHolidays.length > 0 && (
                <div style={{
                  fontSize: 11,
                  color: '#fbbf24',
                  marginBottom: 10,
                  padding: '6px 10px',
                  backgroundColor: 'rgba(251, 191, 36, 0.1)',
                  borderRadius: 6,
                  textAlign: 'center'
                }}>
                  Market closed: {weekHolidays.map(h => h.name).join(', ')}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>{getAvatar(USER_ID)}</div>
                  <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 600, marginBottom: 2 }}>
                    {isPlayoff && mySeed ? `#${mySeed} ` : ''}You
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: myGain >= 0 ? '#22c55e' : '#ef4444' }}>
                    {myGain >= 0 ? '+' : ''}{formatUSD(myGain)}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>VS</div>
                <div style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ fontSize: 28, marginBottom: 4 }}>{getAvatar(opponentName)}</div>
                  <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 600, marginBottom: 2 }}>
                    {isPlayoff && oppSeed ? `#${oppSeed} ` : ''}{getDisplayName(opponentName, USER_ID)}
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: oppGain >= 0 ? '#22c55e' : '#ef4444' }}>
                    {oppGain >= 0 ? '+' : ''}{formatUSD(oppGain)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <span style={{
                  fontSize: 11,
                  color: isTied ? '#fbbf24' : isWinning ? '#22c55e' : '#ef4444',
                  fontWeight: 600
                }}>
                  {isTied ? 'Tied' : isWinning ? 'Winning' : 'Losing'} by {formatUSD(Math.abs(myGain - oppGain))}
                </span>
              </div>
            </div>
          );
        })()}

        {/* Market Status */}
        <div className="card">
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>US Market Status</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: marketStatus.isOpen ? '#22c55e' : '#ef4444',
              boxShadow: marketStatus.isOpen ? '0 0 8px rgba(34, 197, 94, 0.5)' : 'none',
              animation: marketStatus.isOpen ? 'pulse 2s infinite' : 'none'
            }} />
            <div style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>
              {marketStatus.status}
            </div>
          </div>
          <div className="muted" style={{ fontSize: 13 }}>{marketStatus.detail}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            NYSE/NASDAQ: 9:30 AM - 4:00 PM ET
          </div>
        </div>
      </div>

      {/* Row 2: Portfolio Value + Position */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 16 }}>
        {/* Portfolio Value */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Total Portfolio Value</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>
                {formatUSD(quickStats.totalValue)}
              </div>
            </div>
            <div style={{
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              backgroundColor: quickStats.totalGain >= 0 ? 'rgba(22, 163, 74, 0.15)' : 'rgba(220, 38, 38, 0.15)',
              color: quickStats.totalGain >= 0 ? '#22c55e' : '#ef4444'
            }}>
              {quickStats.totalGain >= 0 ? '+' : ''}{quickStats.totalGainPct.toFixed(2)}%
            </div>
          </div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <span className="muted">P/L: </span>
            <span style={{ color: quickStats.totalGain >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
              {quickStats.totalGain >= 0 ? '+' : ''}{formatUSD(quickStats.totalGain)}
            </span>
          </div>
        </div>

        {/* Holdings & Rank */}
        <div className="card">
          <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Your Position</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>
                {myRank ? `#${myRank}` : '—'}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>League Rank</div>
            </div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff' }}>
                {quickStats.holdingsCount}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Holdings</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3: Quick Actions + Standings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        {/* Quick Actions */}
        <div className="card">
          <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>Quick Actions</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <Link className="btn primary" to="/portfolio" style={{ textAlign: 'center' }}>Trade Stocks</Link>
            <Link className="btn" to="/draft" style={{ textAlign: 'center' }}>Enter Draft</Link>
            <Link className="btn" to="/leagues" style={{ textAlign: 'center' }}>Manage Leagues</Link>
          </div>
        </div>

        {/* Right Column - Standings */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>Standings</h3>
            <Link to="/leaderboard" style={{ fontSize: 13, color: '#60a5fa', textDecoration: 'none' }}>
              View All →
            </Link>
          </div>
          {standings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No standings data yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 4 }}>
              {standings.slice(0, 5).map((s, idx) => {
                const isMe = s.user_id === USER_ID;
                return (
                  <div
                    key={s.user_id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '6px 10px',
                      borderRadius: 6,
                      backgroundColor: isMe ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                      border: isMe ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: idx === 0 ? '#fbbf24' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7c32' : '#6b7280',
                        width: 20
                      }}>
                        {idx + 1}
                      </span>
                      <span style={{ fontSize: 18 }}>{getAvatar(s.user_id)}</span>
                      <span style={{ fontSize: 14, fontWeight: isMe ? 600 : 400, color: isMe ? '#60a5fa' : '#e5e7eb' }}>
                        {getDisplayName(s.user_id, USER_ID)}
                      </span>
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: s.gain >= 0 ? '#22c55e' : '#ef4444' }}>
                      {s.gain >= 0 ? '+' : ''}{formatUSD(s.gain)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
