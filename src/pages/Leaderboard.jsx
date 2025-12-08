// src/pages/Leaderboard.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName, formatUSD, formatPercent } from '../utils/formatting';
import { fetchCompanyName } from '../utils/stockData';
import { usePrices } from '../context/PriceContext';

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

  // Use shared price context
  const { prices, loading: pricesLoading, lastUpdate: lastUpdated, fetchPrices } = usePrices();

  // ui
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // peer portfolio modal
  const [peerModalOpen, setPeerModalOpen] = useState(false);
  const [peerUserId, setPeerUserId] = useState('');
  const [peerRows, setPeerRows] = useState([]); // derived rows for modal view

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
          .select('id, name')
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

        // Collect all unique symbols from both drafts and trades
        const draftSymbols = (rows || []).map(p => p.symbol?.toUpperCase());
        const tradeSymbols = (tradeRows || []).map(t => t.symbol?.toUpperCase());
        const uniq = [...new Set([...draftSymbols, ...tradeSymbols])].filter(Boolean);

        // warm names
        for (const s of uniq) {
          if (symbolToName[s]) continue;
          try {
            const name = await fetchCompanyName(s);
            if (name) {
              setSymbolToName(prev => ({ ...prev, [s]: name }));
            }
          } catch { /* ignore */ }
        }

        // Fetch prices using shared context (will use cache if available)
        if (uniq.length > 0) {
          await fetchPrices(uniq);
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
      const { value, pct } = calcUserStats(u);
      return { user_id: u, value, pct };
    });
    // rank by percent gain
    arr.sort((a, b) => b.pct - a.pct);
    return arr;
  }, [allUserIds, prices, picksByUser, tradesByUser]);

  const totalPlayers = allUserIds.length;

  // leader & best performer (same metric here)
  const leader = standings[0] || null;

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
    const header = ['rank', 'user_id', 'value', 'pct_gain'];
    const rows = standings.map((s, idx) => [idx + 1, s.user_id, s.value, s.pct]);
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
    return (
      <div className="page">
        <div className="card"><p className="muted">Loading standings…</p></div>
      </div>
    );
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
          {leader ? (
            <>
              <div style={{ fontSize: 13 }} className="muted">{leader.user_id}</div>
              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 700 }}>{formatUSD(leader.value)}</div>
                <div style={{ color: leader.pct >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                  {formatPercent(leader.pct, true)}
                </div>
              </div>
            </>
          ) : (
            <div className="muted">No data yet.</div>
          )}
        </div>

        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>🚀 Best Performer</div>
          {leader ? (
            <>
              <div style={{ fontSize: 13 }} className="muted">{leader.user_id}</div>
              <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 700 }}>{formatUSD(leader.value)}</div>
                <div style={{ color: leader.pct >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                  {formatPercent(leader.pct, true)}
                </div>
              </div>
            </>
          ) : (
            <div className="muted">No data yet.</div>
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
            {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : null}
          </div>
        </div>

        {standings.length === 0 ? (
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
                    <div>
                      <div style={{ fontWeight: 600 }}>{s.user_id}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{activeLeague?.name || ''}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{formatUSD(s.value)}</div>
                      <div style={{ fontSize: 12, color: s.pct >= 0 ? '#16a34a' : '#dc2626' }}>{formatPercent(s.pct, true)}</div>
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
        )}
      </div>

      {/* Performance Metrics */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ marginTop: 0 }}>Performance Metrics</h3>
          <button className="btn" onClick={exportCSV}>Export Data</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {/* Top Gainers */}
          <div className="card" style={{ background: '#111826' }}>
            <div className="muted" style={{ marginBottom: 8 }}>Top Gaining Stocks This Week</div>
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
    </div>
  );
}
