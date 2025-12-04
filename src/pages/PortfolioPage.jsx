// src/pages/PortfolioPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName } from '../utils/formatting';
import { fetchCompanyName, fetchQuotesInBatch } from '../utils/stockData';
import TradeModal from '../components/TradeModal';

export default function PortfolioPage() {
  // ✅ Call hooks only inside the component
  const authUser = useAuthUser();
  const USER_ID = authUser?.id ?? 'test-user';

  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const [league, setLeague] = useState(null);

  const [positions, setPositions] = useState([]);       // your holdings from drafts
  const [trades, setTrades] = useState([]);             // all trades for this user in this league
  const [symbolToName, setSymbolToName] = useState({}); // { AAPL: 'Apple Inc' }
  const [error, setError] = useState('');

  // Trade modal state
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [tradeAction, setTradeAction] = useState('buy');
  const [tradeSymbol, setTradeSymbol] = useState('');

  // Load leagues where user is a member, then hydrate meta
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
        if (ids.length === 0) {
          setLeagues([]);
          setLeagueId('');
          setLeague(null);
          setPositions([]);
          return;
        }

        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name, budget_mode, budget_amount')
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
        setLeague((lg || []).find(x => x.id === chosen) || null);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [USER_ID]); // re-run when auth becomes available

  // When league changes, load positions (draft picks) for me
  useEffect(() => {
    if (!authUser?.id || !leagueId) {
      setLeague(null);
      setPositions([]);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError('');

        if (!league || league?.id !== leagueId) {
          const { data: lg, error: lgErr } = await supabase
            .from('leagues')
            .select('id, name, budget_mode, budget_amount')
            .eq('id', leagueId)
            .single();
          if (lgErr) throw lgErr;
          setLeague(lg);
        }

        const { data: picks, error: pErr } = await supabase
          .from('drafts')
          .select('id, symbol, entry_price, quantity, round, pick_number, created_at')
          .eq('league_id', leagueId)
          .eq('user_id', USER_ID)
          .order('pick_number', { ascending: true });

        if (pErr) throw pErr;
        setPositions(picks || []);

        // Load trades (only if authenticated - trades table requires UUID)
        if (authUser?.id) {
          const { data: tradesData, error: tErr } = await supabase
            .from('trades')
            .select('*')
            .eq('league_id', leagueId)
            .eq('user_id', USER_ID)
            .order('created_at', { ascending: true });

          if (tErr) throw tErr;
          setTrades(tradesData || []);
        } else {
          setTrades([]);
        }

        const unique = [...new Set((picks || []).map(p => p.symbol?.toUpperCase()))];
        for (const s of unique) {
          if (!s || symbolToName[s]) continue;
          fetchCompanyName(s).then(name => {
            if (name) setSymbolToName(prev => ({ ...prev, [s]: name }));
          });
        }
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [leagueId, USER_ID]); // depend on both

  // Calculate actual holdings: draft picks + buy trades - sell trades
  const actualHoldings = useMemo(() => {
    const holdingsMap = {}; // { AAPL: { symbol, quantity, avgEntry, totalCost } }

    // Start with draft picks
    positions.forEach(pick => {
      const sym = pick.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = {
          symbol: sym,
          quantity: 0,
          totalCost: 0,
          company_name: pick.company_name
        };
      }

      const qty = Number(pick.quantity || 1);
      const price = Number(pick.entry_price);
      holdingsMap[sym].quantity += qty;
      holdingsMap[sym].totalCost += price * qty;
    });

    // Apply trades
    trades.forEach(trade => {
      const sym = trade.symbol?.toUpperCase();
      if (!sym) return;

      if (!holdingsMap[sym]) {
        holdingsMap[sym] = {
          symbol: sym,
          quantity: 0,
          totalCost: 0
        };
      }

      const qty = Number(trade.quantity);
      const price = Number(trade.price);

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
    });

    // Filter out positions with 0 or negative quantity
    const holdings = Object.values(holdingsMap)
      .filter(h => h.quantity > 0)
      .map(h => ({
        ...h,
        entry_price: h.quantity > 0 ? h.totalCost / h.quantity : 0
      }));

    return holdings;
  }, [positions, trades]);

  // Calculate total cash spent (for budget calculation)
  const totalCashSpent = useMemo(() => {
    let spent = 0;

    // Draft picks cost money
    positions.forEach(pick => {
      const qty = Number(pick.quantity || 1);
      const price = Number(pick.entry_price);
      spent += price * qty;
    });

    // Buy trades cost money, sell trades return money
    trades.forEach(trade => {
      const amount = Number(trade.total_value);
      if (trade.action === 'buy') {
        spent += amount;
      } else if (trade.action === 'sell') {
        spent -= amount;
      }
    });

    return spent;
  }, [positions, trades]);

  // State for prices and refresh
  const [prices, setPrices] = useState({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  // Manual refresh function
  const refreshPrices = async () => {
    const symbols = [...new Set(actualHoldings.map(h => h.symbol?.toUpperCase()))].filter(Boolean);
    if (!symbols.length) return;

    setIsRefreshing(true);
    try {
      const results = await fetchQuotesInBatch(symbols);
      setPrices(prev => ({ ...prev, ...results }));
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching prices:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  // metrics (calculated after prices are available)
  const totalCurrentValue = useMemo(() => {
    return actualHoldings.reduce((sum, h) => {
      const sym = h.symbol?.toUpperCase();
      const live = prices[sym];
      const px = Number.isFinite(live) ? live : Number(h.entry_price);
      const qty = Number(h.quantity || 0) || 0;
      return sum + px * qty;
    }, 0);
  }, [actualHoldings, prices]);

  const budgetRemaining = useMemo(() => {
    if (!league || league.budget_mode !== 'budget') return null;
    const cap = Number(league.budget_amount || 0);
    return Math.max(cap - totalCashSpent, 0);
  }, [league, totalCashSpent]);

  const totalHoldings = actualHoldings.length;

  const handleLeagueChange = (e) => {
    const id = e.target.value;
    setLeagueId(id);
    localStorage.setItem('activeLeagueId', id);
  };

  // Render states (after all hooks have been called)
  if (!USER_ID) {
    return (
      <div className="page">
        <div className="card"><p className="muted">Please sign in to view your portfolio.</p></div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card"><p className="muted">Loading portfolio…</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Portfolio Unavailable</h3>
          <p className="muted">Error: {error}</p>
          <Link className="btn" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Header controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ color: '#fff', margin: 0 }}>Portfolio Management</h2>
          <p className="muted" style={{ marginTop: 6 }}>
            Manage your stock holdings and execute trades within your league
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <label htmlFor="leagueSelect" className="muted" style={{ display: 'block', marginBottom: 4 }}>
              Select League
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

          <button
            className="btn primary"
            onClick={() => {
              setTradeAction('buy');
              setTradeSymbol('');
              setShowTradeModal(true);
            }}
            style={{ whiteSpace: 'nowrap' }}
          >
            Buy Stock
          </button>

          <button className="btn" onClick={refreshPrices} disabled={isRefreshing || !actualHoldings.length}>
            {isRefreshing ? 'Refreshing…' : 'Refresh Prices'}
          </button>

          {lastUpdate && (
            <span className="muted" style={{ fontSize: 13 }}>
              Last updated: {lastUpdate.toLocaleTimeString()}
            </span>
          )}

          <Link className="btn" to="/trade-history">Trade History</Link>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div className="card">
          <div className="muted">Total Portfolio Value</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>
            ${totalCurrentValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="card">
          <div className="muted">Budget Remaining</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>
            {budgetRemaining == null ? '—' : `$${budgetRemaining.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
          </div>
        </div>

        <div className="card">
          <div className="muted">Total Stocks Owned</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>
            {totalHoldings}
          </div>
        </div>
      </div>

      {/* Current Holdings */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0, marginBottom: 8 }}>Current Holdings</h3>

        <div className="table-wrap">
          <table className="holdings-table">
            <colgroup>
              <col className="col-symbol" />
              <col className="col-company" />
              <col className="col-qty" />
              <col className="col-entry" />
              <col className="col-last" />
              <col className="col-pl" />
              <col className="col-plp" />
              <col style={{ width: '140px' }} />
            </colgroup>

            <thead>
              <tr>
                <th>Symbol</th>
                <th>Company</th>
                <th className="numeric">Qty</th>
                <th className="numeric">Avg Entry</th>
                <th className="numeric">Last</th>
                <th className="numeric">P/L $</th>
                <th className="numeric">P/L %</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>
              {actualHoldings.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#9ca3af', padding: '20px 12px' }}>
                    No holdings yet. Click "Buy Stock" to get started!
                  </td>
                </tr>
              )}

              {actualHoldings.map((h) => {
                const sym = h.symbol?.toUpperCase();
                const qty = Number(h.quantity ?? 1);
                const entry = Number(h.entry_price);
                const last = prices[sym] ?? null;
                const pl = (last != null && Number.isFinite(entry)) ? (last - entry) * qty : null;
                const plp = (last != null && Number.isFinite(entry) && entry !== 0)
                  ? ((last / entry) - 1) * 100
                  : null;

                return (
                  <tr key={`${sym}-${Math.random()}`}>
                    <td>{sym}</td>
                    <td>{prettyName(symbolToName[sym] || h.company_name || '—')}</td>
                    <td className="numeric">{Number.isFinite(qty) ? qty : '—'}</td>
                    <td className="numeric">{Number.isFinite(entry) ? `$${entry.toFixed(2)}` : '—'}</td>
                    <td className="numeric">{Number.isFinite(last) ? `$${last.toFixed(2)}` : '—'}</td>
                    <td className="numeric">{Number.isFinite(pl) ? `$${pl.toFixed(2)}` : '—'}</td>
                    <td className="numeric">
                      {Number.isFinite(plp) ? `${plp.toFixed(2)}%` : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn"
                          onClick={() => {
                            setTradeAction('buy');
                            setTradeSymbol(sym);
                            setShowTradeModal(true);
                          }}
                          style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            backgroundColor: '#10b981',
                            borderColor: '#10b981'
                          }}
                        >
                          Buy
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setTradeAction('sell');
                            setTradeSymbol(sym);
                            setShowTradeModal(true);
                          }}
                          style={{
                            fontSize: 12,
                            padding: '4px 8px',
                            backgroundColor: '#ef4444',
                            borderColor: '#ef4444'
                          }}
                        >
                          Sell
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Trade Modal */}
      <TradeModal
        show={showTradeModal}
        onClose={() => setShowTradeModal(false)}
        onTradeComplete={async () => {
          // Reload positions and trades
          const { data: picks } = await supabase
            .from('drafts')
            .select('id, symbol, entry_price, quantity, round, pick_number, created_at')
            .eq('league_id', leagueId)
            .eq('user_id', USER_ID)
            .order('pick_number', { ascending: true });
          setPositions(picks || []);

          // Only load trades if authenticated
          if (authUser?.id) {
            const { data: tradesData } = await supabase
              .from('trades')
              .select('*')
              .eq('league_id', leagueId)
              .eq('user_id', USER_ID)
              .order('created_at', { ascending: true });
            setTrades(tradesData || []);
          }

          // Refresh prices
          refreshPrices();
        }}
        leagueId={leagueId}
        userId={USER_ID}
        currentHoldings={actualHoldings}
        availableCash={budgetRemaining ?? 0}
        isBudgetMode={league?.budget_mode === 'budget'}
        initialSymbol={tradeSymbol}
        initialAction={tradeAction}
      />
    </div>
  );
}
