// src/pages/Dashboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName, formatUSD } from '../utils/formatting';
import { fetchCompanyName, fetchQuotesInBatch } from '../utils/stockData';

export default function Dashboard() {
  const navigate = useNavigate();
  const authUser = useAuthUser();
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
  const [recentPicks, setRecentPicks] = useState([]);
  const [recentTrades, setRecentTrades] = useState([]);

  // If user changes (sign in/out), reset data
  useEffect(() => {
    if (!USER_ID) {
      setLeagues([]);
      setLeagueId('');
      setPositions([]);
      setRecentPicks([]);
      setRecentTrades([]);
      setLoading(false);
    }
  }, [USER_ID]);

  // ---- Load my leagues (only when signed in)
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

        // names (best-effort via Edge Function backed by your `symbols` table)
        const uniq = [...new Set((picks || []).map(p => p.symbol?.toUpperCase()))].filter(Boolean);
        for (const s of uniq) {
          if (symbolToName[s]) continue;
          const name = await fetchCompanyName(s);
          if (name) setSymbolToName(prev => ({ ...prev, [s]: name }));
        }

        // recent activity
        setRecentPicks(
          [...(picks || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5)
        );

        // recent trades
        const { data: trades, error: tErr } = await supabase
          .from('trades')
          .select('*')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false })
          .limit(5);

        if (!tErr) {
          setRecentTrades(trades || []);
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

  // ---- Recalculate standings with live prices
  const standings = useMemo(() => {
    if (!recentPicks.length) return [];

    const byUser = new Map();
    recentPicks.forEach(p => {
      const u = p.user_id;
      const cur = byUser.get(u) || { user_id: u, picks: [] };
      cur.picks.push(p);
      byUser.set(u, cur);
    });

    const table = Array.from(byUser.values()).map(({ user_id, picks }) => {
      let cost = 0;
      let current = 0;
      picks.forEach(p => {
        const qty = Number(p.quantity || 0) || 0;
        const entry = Number(p.entry_price || 0) || 0;
        const live = prices[p.symbol?.toUpperCase()];
        const px = Number.isFinite(live) ? live : entry;
        cost += entry * qty;
        current += px * qty;
      });
      const pctGain = cost > 0 ? ((current - cost) / cost) * 100 : 0;
      return { user_id, cost, current, pctGain };
    }).sort((a, b) => b.pctGain - a.pctGain);

    return table;
  }, [recentPicks, prices]);

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
    return (
      <div className="page">
        <div className="card"><p className="muted">Loading dashboard…</p></div>
      </div>
    );
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
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ color: '#fff', margin: 0 }}>Welcome Back to Fantasy Stock League</h2>
      </div>

      {/* Row 1 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* My Active Leagues */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>My Active Leagues</h3>
            <Link className="btn" to="/leagues">Create League</Link>
          </div>

          {leagues.length === 0 ? (
            <p className="muted">You’re not in any leagues yet.</p>
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
                    <button className="btn" onClick={() => navigate('/leagues')}>View Details</button>
                    <button className="btn primary" onClick={() => navigate(`/draft/${l.id}`)}>Enter Draft</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Invitations placeholder */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>League Invitations</h3>
          <p className="muted" style={{ margin: 0 }}>No invitations.</p>
        </div>

        {/* Portfolio Performance */}
        <div className="card">
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Portfolio Performance</h3>
          <div className="muted" style={{ marginBottom: 6 }}>
            {activeLeague ? activeLeague.name : 'Select a League'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="muted">Portfolio Value</div>
            <div style={{ textAlign: 'right', fontWeight: 700 }}>{formatUSD(myPortfolioValue)}</div>
            <div className="muted">Rank</div>
            <div style={{ textAlign: 'right', fontWeight: 700 }}>{myRank ? `#${myRank}` : '—'}</div>
          </div>
          <Link className="btn primary" to="/portfolio">View Portfolio</Link>
        </div>
      </div>

      {/* Row 2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 12, marginBottom: 14 }}>
        {/* Top Performing */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ marginTop: 0 }}>Top Performing Stocks</h3>
            <Link className="btn" to="/portfolio">View Market Data</Link>
          </div>

          {topPerformers.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No holdings yet.</p>
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
                    <div className="muted" style={{ fontSize: 12 }}>{s.user_id}</div>
                  </div>
                  {/* Show percent gain instead of USD total */}
                  <div style={{ fontWeight: 700 }}>
                    {Number.isFinite(s.pctGain) ? `${s.pctGain.toFixed(2)}%` : '—'}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
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
                      {p.user_id === USER_ID ? 'You' : p.user_id.substring(0, 8)} drafted <strong>{p.symbol}</strong>
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
                        {isMine ? 'You' : t.user_id.substring(0, 8)}{' '}
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
