// src/pages/TradeHistory.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName } from '../utils/formatting';

export default function TradeHistory() {
  const authUser = useAuthUser();
  const USER_ID = authUser?.id;

  const [loading, setLoading] = useState(true);
  const [leagues, setLeagues] = useState([]);
  const [leagueId, setLeagueId] = useState(localStorage.getItem('activeLeagueId') || '');
  const [league, setLeague] = useState(null);
  const [trades, setTrades] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // 'all', 'mine', 'buys', 'sells'

  // Load leagues where user is a member
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
          setTrades([]);
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
        setLeague((lg || []).find(x => x.id === chosen) || null);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [USER_ID]);

  // Load trades for the selected league
  useEffect(() => {
    if (!authUser?.id || !leagueId) {
      setTrades([]);
      return;
    }
    (async () => {
      try {
        setLoading(true);
        setError('');

        const { data: tradesData, error: tradesErr } = await supabase
          .from('trades')
          .select('*')
          .eq('league_id', leagueId)
          .order('created_at', { ascending: false });

        if (tradesErr) throw tradesErr;
        setTrades(tradesData || []);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [USER_ID, leagueId]);

  // Filter trades
  const filteredTrades = trades.filter(trade => {
    if (filter === 'mine') return trade.user_id === USER_ID;
    if (filter === 'buys') return trade.action === 'buy';
    if (filter === 'sells') return trade.action === 'sell';
    return true; // 'all'
  });

  if (!USER_ID) {
    return (
      <div className="page">
        <div className="card">
          <h3>Sign in to view trade history</h3>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card">
          <p className="muted">Loading trade history...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Error</h3>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 style={{ color: '#fff', margin: 0 }}>Trade History</h2>

        {/* League Selector */}
        {leagues.length > 1 && (
          <select
            className="modal-input"
            value={leagueId}
            onChange={(e) => {
              setLeagueId(e.target.value);
              localStorage.setItem('activeLeagueId', e.target.value);
              const selectedLeague = leagues.find(l => l.id === e.target.value);
              setLeague(selectedLeague || null);
            }}
            style={{ maxWidth: 300 }}
          >
            {leagues.map(l => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>
            {league?.name || 'Trade History'}
          </h3>

          {/* Filter Buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className={`btn ${filter === 'all' ? 'primary' : ''}`}
              onClick={() => setFilter('all')}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              All
            </button>
            <button
              className={`btn ${filter === 'mine' ? 'primary' : ''}`}
              onClick={() => setFilter('mine')}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              My Trades
            </button>
            <button
              className={`btn ${filter === 'buys' ? 'primary' : ''}`}
              onClick={() => setFilter('buys')}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              Buys
            </button>
            <button
              className={`btn ${filter === 'sells' ? 'primary' : ''}`}
              onClick={() => setFilter('sells')}
              style={{ fontSize: 13, padding: '6px 12px' }}
            >
              Sells
            </button>
          </div>
        </div>

        {filteredTrades.length === 0 ? (
          <p className="muted">No trades yet. Start trading to see your history here!</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #374151' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Action</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Symbol</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Quantity</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Price</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>Total</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>User</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.map((trade) => {
                  const isMine = trade.user_id === USER_ID;
                  const isBuy = trade.action === 'buy';

                  return (
                    <tr
                      key={trade.id}
                      style={{
                        borderBottom: '1px solid #374151',
                        backgroundColor: isMine ? 'rgba(59, 130, 246, 0.05)' : 'transparent'
                      }}
                    >
                      <td style={{ padding: '12px', fontSize: 14, color: '#e5e7eb' }}>
                        {new Date(trade.created_at).toLocaleDateString()} {new Date(trade.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px', fontSize: 14 }}>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: 4,
                            fontSize: 12,
                            fontWeight: 600,
                            backgroundColor: isBuy ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: isBuy ? '#10b981' : '#ef4444'
                          }}
                        >
                          {isBuy ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontSize: 14, color: '#e5e7eb', fontWeight: 600 }}>
                        {trade.symbol}
                      </td>
                      <td style={{ padding: '12px', fontSize: 14, color: '#e5e7eb', textAlign: 'right' }}>
                        {trade.quantity}
                      </td>
                      <td style={{ padding: '12px', fontSize: 14, color: '#e5e7eb', textAlign: 'right' }}>
                        ${Number(trade.price).toFixed(2)}
                      </td>
                      <td style={{ padding: '12px', fontSize: 14, textAlign: 'right', fontWeight: 600 }}>
                        <span style={{ color: isBuy ? '#ef4444' : '#10b981' }}>
                          ${Number(trade.total_value).toFixed(2)}
                        </span>
                      </td>
                      <td style={{ padding: '12px', fontSize: 14, color: '#9ca3af' }}>
                        {isMine ? 'You' : trade.user_id.substring(0, 8)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
