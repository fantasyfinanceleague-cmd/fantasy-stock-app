// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName, formatUSD } from '../utils/formatting';
import { fetchCompanyName, fetchQuotesInBatch } from '../utils/stockData';
import { PageLoader } from '../components/LoadingSpinner';
import { useUserProfiles } from '../context/UserProfilesContext';
import EmptyState from '../components/EmptyState';
import { SkeletonDashboard } from '../components/Skeleton';

export default function Dashboard() {
  const navigate = useNavigate();
  const authUser = useAuthUser();
  const { fetchProfiles, getDisplayName } = useUserProfiles();
  // keep a fallback for now so your draft keeps working if not signed in
  const USER_ID = authUser?.id ?? 'test-user';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
          .select('id, name, draft_date, budget_mode, budget_amount')
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

        // names (best-effort via Edge Function backed by your `symbols` table)
        for (const s of uniq) {
          if (symbolToName[s]) continue;
          const name = await fetchCompanyName(s);
          if (name) setSymbolToName(prev => ({ ...prev, [s]: name }));
        }

        // Store all picks for standings calculation
        setAllPicks(picks || []);

        // recent activity (last 5)
        const sortedPicks = [...(picks || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
        setRecentPicks(sortedPicks);

        // Fetch prices for all symbols
        if (uniq.length > 0) {
          const priceData = await fetchQuotesInBatch(uniq);
          setPrices(priceData);
        }

        // Fetch user profiles for all user IDs in picks and trades
        const allUserIds = [
          ...new Set([
            ...(picks || []).map(p => p.user_id),
            ...(allTradesData || []).map(t => t.user_id),
          ].filter(Boolean))
        ];
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
      {/* Quick Stats Row */}
      <div className="metrics-row" style={{ marginBottom: 16 }}>
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
          <div style={{ marginTop: 8 }}>
            <Link className="btn primary" to="/leaderboard" style={{ width: '100%' }}>View Leaderboard</Link>
          </div>
        </div>

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

      {/* Row 1 */}
      <div className="dashboard-row-2">
        {/* My Active Leagues */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>My Active Leagues</h3>
            <Link className="btn" to="/leagues">Manage Leagues</Link>
          </div>

          {leagues.length === 0 ? (
            <EmptyState
              icon="🏆"
              title="No Leagues Yet"
              description="Create or join a league to start competing with friends."
              actionLabel="Create a League"
              actionTo="/leagues"
            />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {leagues.map(l => (
                <div key={l.id} className="list-row" style={{ alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{l.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Draft: {l.draft_date ? new Date(l.draft_date).toLocaleString() : 'TBD'}
                      {l.budget_mode === 'budget'
                        ? ` • Cap: $${Number(l.budget_amount || 0).toLocaleString()}`
                        : ' • No budget'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn primary" onClick={() => navigate(`/draft/${l.id}`)}>Enter Draft</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 12 }}>Quick Actions</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            <Link
              to="/portfolio"
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                textDecoration: 'none',
                justifyContent: 'flex-start'
              }}
            >
              <span style={{ fontSize: 18 }}>📈</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600 }}>Trade Stocks</div>
                <div className="muted" style={{ fontSize: 12 }}>Buy or sell from your portfolio</div>
              </div>
            </Link>
            <Link
              to="/draft"
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                textDecoration: 'none',
                justifyContent: 'flex-start'
              }}
            >
              <span style={{ fontSize: 18 }}>🎯</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600 }}>Join Draft</div>
                <div className="muted" style={{ fontSize: 12 }}>Pick stocks for your league</div>
              </div>
            </Link>
            <Link
              to="/leagues"
              className="btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 14px',
                textDecoration: 'none',
                justifyContent: 'flex-start'
              }}
            >
              <span style={{ fontSize: 18 }}>➕</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600 }}>Create League</div>
                <div className="muted" style={{ fontSize: 12 }}>Start a new competition</div>
              </div>
            </Link>
          </div>
        </div>
      </div>

      {/* Row 2 */}
      <div className="dashboard-row-2">
        {/* Top Performing */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ marginTop: 0 }}>Top Performing Stocks</h3>
            <Link className="btn" to="/portfolio">View Market Data</Link>
          </div>

          {topPerformers.length === 0 ? (
            <EmptyState
              icon="📈"
              title="No Holdings Yet"
              description="Draft stocks or make trades to see your top performers here."
              actionLabel="Go to Draft"
              actionTo="/draft"
            />
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {topPerformers.map(tp => {
                const pct = Math.max(-100, Math.min(100, tp.plp));
                const width = Math.abs(pct);
                const isUp = pct >= 0;
                return (
                  <div key={tp.sym} className="card" style={{ background: '#111826', padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ fontWeight: 600 }}>{tp.sym}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{tp.name}</div>
                    </div>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                      {isUp ? '+' : ''}{tp.plp.toFixed(2)}%
                    </div>
                    <div style={{ background: '#222', height: 8, borderRadius: 6, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${width}%`,
                          height: '100%',
                          background: isUp ? '#16a34a' : '#dc2626',
                          transition: 'width 0.25s ease',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Standings Preview */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>League Standings Preview</h3>
          {standings.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No data yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {standings.slice(0, 3).map((s, idx) => (
                <div key={s.user_id} className="list-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>#{idx + 1}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{getDisplayName(s.user_id, USER_ID)}</div>
                  </div>
                  {/* Show dollar gain like Leaderboard */}
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, color: s.gain >= 0 ? '#16a34a' : '#dc2626' }}>
                      {s.gain >= 0 ? '+' : ''}{formatUSD(s.gain)}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{formatUSD(s.value)} total</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <Link className="btn" to="/leaderboard">View All Standings</Link>
          </div>
        </div>
      </div>

      {/* Row 3 */}
      <div className="dashboard-row-2-equal">
        {/* Recent Draft Picks */}
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Recent Draft Picks</h3>
          {recentPicks.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No recent picks.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {recentPicks.map(p => (
                <div key={p.id} className="list-row">
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {getDisplayName(p.user_id, USER_ID)} drafted <strong>{p.symbol}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="muted">{formatUSD(p.entry_price)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Recent Trades</h3>
            <Link className="btn" to="/trade-history" style={{ fontSize: 13, padding: '4px 10px' }}>View All</Link>
          </div>
          {recentTrades.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No trades yet.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {recentTrades.map(t => {
                const isMine = t.user_id === USER_ID;
                const isBuy = t.action === 'buy';
                return (
                  <div key={t.id} className="list-row" style={{ backgroundColor: isMine ? 'rgba(59, 130, 246, 0.05)' : 'transparent' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        {getDisplayName(t.user_id, USER_ID)}{' '}
                        <span style={{ color: isBuy ? '#10b981' : '#ef4444' }}>
                          {isBuy ? 'bought' : 'sold'}
                        </span>{' '}
                        <strong>{t.quantity}</strong> {t.symbol}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {new Date(t.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, color: isBuy ? '#ef4444' : '#10b981' }}>
                      {formatUSD(t.total_value)}
                    </div>
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
