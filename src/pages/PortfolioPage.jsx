// src/pages/PortfolioPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName } from '../utils/formatting';
import { fetchQuote, fetchCompanyName, fetchQuotesInBatch } from '../utils/stockData';

export default function PortfolioPage() {
  // ✅ Call hooks only inside the component
  const authUser = useAuthUser();
  const USER_ID = authUser?.id ?? 'test-user';

  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const [league, setLeague] = useState(null);

  const [positions, setPositions] = useState([]);       // your holdings from drafts
  const [symbolToName, setSymbolToName] = useState({}); // { AAPL: 'Apple Inc' }
  const [prices, setPrices] = useState({});             // { AAPL: 227.32 }
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Load leagues where user is a member, then hydrate meta
  useEffect(() => {
    if (!USER_ID) return; // wait for session
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
    if (!USER_ID || !leagueId) {
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

  // Refresh quotes (limited concurrency)
  async function refreshQuotes() {
    if (!positions.length) return;
    setRefreshing(true);
    try {
      const syms = [...new Set(positions.map(p => p.symbol?.toUpperCase()))].filter(Boolean);
      const results = await fetchQuotesInBatch(syms);
      if (Object.keys(results).length) setPrices(prev => ({ ...prev, ...results }));
    } finally {
      setRefreshing(false);
    }
  }

  // Smart polling: initial fetch + pause when tab hidden
  useEffect(() => {
    if (!positions.length) return;

    let id = null;
    const start = () => { if (!id) id = setInterval(refreshQuotes, 45_000); };
    const stop = () => { if (id) { clearInterval(id); id = null; } };

    // initial fetch
    refreshQuotes();
    if (!document.hidden) start();

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [positions]);

  // metrics
  const totalCurrentValue = useMemo(() => {
    return positions.reduce((sum, p) => {
      const sym = p.symbol?.toUpperCase();
      const live = prices[sym];
      const px = Number.isFinite(live) ? live : Number(p.entry_price);
      const qty = Number(p.quantity || 0) || 0;
      return sum + px * qty;
    }, 0);
  }, [positions, prices]);

  const totalSpent = useMemo(
    () => positions.reduce((s, p) => s + Number(p.entry_price || 0) * (Number(p.quantity || 0) || 0), 0),
    [positions]
  );

  const budgetRemaining = useMemo(() => {
    if (!league || league.budget_mode !== 'budget') return null;
    const cap = Number(league.budget_amount || 0);
    return Math.max(cap - totalSpent, 0);
  }, [league, totalSpent]);

  const totalHoldings = positions.length;

  const handleLeagueChange = (e) => {
    const id = e.target.value;
    setLeagueId(id);
    localStorage.setItem('activeLeagueId', id);
    setPrices({});
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

          <button className="btn" onClick={refreshQuotes} disabled={refreshing || !positions.length}>
            {refreshing ? 'Refreshing…' : 'Refresh Prices'}
          </button>
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
              {positions.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: '#9ca3af', padding: '20px 12px' }}>
                    No holdings yet.
                  </td>
                </tr>
              )}

              {positions.map((r) => {
                const sym = r.symbol?.toUpperCase();
                const qty = Number(r.quantity ?? 1);
                const entry = Number(r.entry_price);
                const last = prices[sym] ?? null;
                const pl = (last != null && Number.isFinite(entry)) ? (last - entry) * qty : null;
                const plp = (last != null && Number.isFinite(entry) && entry !== 0)
                  ? ((last / entry) - 1) * 100
                  : null;

                return (
                  <tr key={`${sym}-${r.id ?? r.pick_number ?? Math.random()}`}>
                    <td>{sym}</td>
                    <td>{prettyName(symbolToName[sym] || r.company_name || '—')}</td>
                    <td className="numeric">{Number.isFinite(qty) ? qty : '—'}</td>
                    <td className="numeric">{Number.isFinite(entry) ? `$${entry.toFixed(2)}` : '—'}</td>
                    <td className="numeric">{Number.isFinite(last) ? `$${last.toFixed(2)}` : '—'}</td>
                    <td className="numeric">{Number.isFinite(pl) ? `$${pl.toFixed(2)}` : '—'}</td>
                    <td className="numeric">
                      {Number.isFinite(plp) ? `${plp.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
