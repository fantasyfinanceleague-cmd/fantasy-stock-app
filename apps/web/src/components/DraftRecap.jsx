// src/components/DraftRecap.jsx
import React, { useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { prettyName } from '../utils/formatting';
import { useUserProfiles } from '../context/UserProfilesContext';

/**
 * DraftRecap component
 * Inline recap shown on the draft page when the draft is complete
 */
export default function DraftRecap({
  leagueName,
  portfolio,
  symbolToName,
  USER_ID,
  memberIds = [],
  leagueBudget = 0,
  isBudgetMode = false,
}) {
  // Use shared user profiles context
  const { fetchProfiles, getDisplayName } = useUserProfiles();

  // Fetch profiles for all users in the draft
  useEffect(() => {
    if (portfolio && portfolio.length > 0) {
      const userIds = [...new Set(portfolio.map(p => p.user_id).filter(Boolean))];
      fetchProfiles(userIds);
    }
  }, [portfolio, fetchProfiles]);

  // Calculate all stats
  const stats = useMemo(() => {
    if (!portfolio || portfolio.length === 0) return null;

    // My picks
    const myPicks = portfolio.filter(p => p.user_id === USER_ID);
    const myTotal = myPicks.reduce((sum, p) => sum + Number(p.entry_price || 0), 0);
    const myAvg = myPicks.length > 0 ? myTotal / myPicks.length : 0;
    const myMostExpensive = myPicks.reduce((max, p) =>
      Number(p.entry_price) > Number(max?.entry_price || 0) ? p : max, myPicks[0]);
    const myCheapest = myPicks.reduce((min, p) =>
      Number(p.entry_price) < Number(min?.entry_price || Infinity) ? p : min, myPicks[0]);

    // Per-player stats
    const playerStats = {};
    portfolio.forEach(p => {
      const uid = p.user_id;
      if (!playerStats[uid]) {
        playerStats[uid] = { picks: [], total: 0 };
      }
      playerStats[uid].picks.push(p);
      playerStats[uid].total += Number(p.entry_price || 0);
    });

    // League standings by total value
    const standings = Object.entries(playerStats)
      .map(([uid, data]) => ({
        user_id: uid,
        total: data.total,
        count: data.picks.length,
        avg: data.picks.length > 0 ? data.total / data.picks.length : 0,
      }))
      .sort((a, b) => b.total - a.total);

    // Find my rank
    const myRank = standings.findIndex(s => s.user_id === USER_ID) + 1;

    // Superlatives
    const highestRoller = standings[0]; // Most total spent
    const budgetHunter = [...standings].sort((a, b) => a.avg - b.avg)[0]; // Lowest avg

    const allPicks = [...portfolio];
    const topPick = allPicks.reduce((max, p) =>
      Number(p.entry_price) > Number(max?.entry_price || 0) ? p : max, allPicks[0]);
    const bargainFind = allPicks.reduce((min, p) =>
      Number(p.entry_price) < Number(min?.entry_price || Infinity) ? p : min, allPicks[0]);

    // First and last picks
    const firstPick = allPicks.reduce((first, p) =>
      Number(p.pick_number) < Number(first?.pick_number || Infinity) ? p : first, allPicks[0]);
    const lastPick = allPicks.reduce((last, p) =>
      Number(p.pick_number) > Number(last?.pick_number || 0) ? p : last, allPicks[0]);

    return {
      myPicks,
      myTotal,
      myAvg,
      myMostExpensive,
      myCheapest,
      myRank,
      standings,
      highestRoller,
      budgetHunter,
      topPick,
      bargainFind,
      firstPick,
      lastPick,
      totalPlayers: standings.length,
    };
  }, [portfolio, USER_ID]);

  if (!stats) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40 }}>
        <p className="muted">No draft data available.</p>
      </div>
    );
  }


  return (
    <div>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🏆</div>
        <h1 style={{ margin: 0, fontSize: '2rem', color: '#fff' }}>Draft Complete!</h1>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: '1.1rem' }}>
          <strong>{leagueName}</strong> • {new Date().toLocaleDateString()}
        </p>
      </div>

      {/* Your Team Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 14,
        marginBottom: 28
      }}>
        <div className="card" style={{ padding: 20, textAlign: 'center', background: '#111827' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Portfolio Value</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#10b981' }}>
            ${stats.myTotal.toFixed(2)}
          </div>
        </div>
        <div className="card" style={{ padding: 20, textAlign: 'center', background: '#111827' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Your Rank</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: '#f59e0b' }}>
            #{stats.myRank} <span style={{ fontSize: 16, color: '#9ca3af' }}>of {stats.totalPlayers}</span>
          </div>
        </div>
        <div className="card" style={{ padding: 20, textAlign: 'center', background: '#111827' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Stocks Drafted</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {stats.myPicks.length}
          </div>
        </div>
        <div className="card" style={{ padding: 20, textAlign: 'center', background: '#111827' }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Avg Pick Price</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            ${stats.myAvg.toFixed(2)}
          </div>
        </div>
        {isBudgetMode && (
          <div className="card" style={{ padding: 20, textAlign: 'center', background: '#111827' }}>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Budget Left</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: '#60a5fa' }}>
              ${Math.max(leagueBudget - stats.myTotal, 0).toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Two Column Layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24, marginBottom: 28 }}>
        {/* Your Picks */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#111827' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#e5e7eb' }}>Your Picks</h3>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {stats.myPicks
              .sort((a, b) => a.pick_number - b.pick_number)
              .map((p) => {
                const sym = p.symbol?.toUpperCase();
                const rawName = symbolToName[sym] || p.company_name || '';
                const name = rawName ? prettyName(rawName) : '';
                const isHighest = p === stats.myMostExpensive;
                const isLowest = p === stats.myCheapest;
                return (
                  <div
                    key={`${p.round}-${p.pick_number}-${p.symbol}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 20px',
                      borderBottom: '1px solid #1f2937',
                      background: isHighest ? 'rgba(16, 185, 129, 0.1)' : isLowest ? 'rgba(96, 165, 250, 0.1)' : 'transparent',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {sym}
                        {isHighest && <span style={{ marginLeft: 8, fontSize: 12, color: '#10b981' }}>💰 Top</span>}
                        {isLowest && <span style={{ marginLeft: 8, fontSize: 12, color: '#60a5fa' }}>🔥 Value</span>}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>
                        R{p.round} • Pick #{p.pick_number} {name && `• ${name}`}
                      </div>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>${Number(p.entry_price).toFixed(2)}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* League Standings */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', background: '#111827' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f2937' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#e5e7eb' }}>League Standings</h3>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            {stats.standings.map((s, idx) => {
              const isMe = s.user_id === USER_ID;
              return (
                <div
                  key={s.user_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 20px',
                    borderBottom: '1px solid #1f2937',
                    background: isMe ? 'rgba(245, 158, 11, 0.15)' : 'transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: idx === 0 ? '#f59e0b' : idx === 1 ? '#9ca3af' : idx === 2 ? '#b45309' : '#374151',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: 14,
                      color: idx < 3 ? '#000' : '#fff',
                    }}>
                      {idx + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: isMe ? 700 : 500, fontSize: 15 }}>
                        {getDisplayName(s.user_id, USER_ID)}
                      </div>
                      <div className="muted" style={{ fontSize: 13 }}>{s.count} picks</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600, fontSize: 15 }}>${s.total.toFixed(2)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>avg ${s.avg.toFixed(2)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Draft Awards */}
      <div className="card" style={{ padding: 20, background: '#111827', marginBottom: 28 }}>
        <h3 style={{ margin: '0 0 16px', fontSize: '1.1rem', color: '#e5e7eb' }}>Draft Awards</h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14
        }}>
          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>💎</span>
              <span className="muted" style={{ fontSize: 13 }}>Highest Roller</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {getDisplayName(stats.highestRoller?.user_id, USER_ID)}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>${stats.highestRoller?.total.toFixed(2)} total</div>
          </div>

          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>🎯</span>
              <span className="muted" style={{ fontSize: 13 }}>Budget Hunter</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {getDisplayName(stats.budgetHunter?.user_id, USER_ID)}
            </div>
            <div className="muted" style={{ fontSize: 13 }}>${stats.budgetHunter?.avg.toFixed(2)} avg</div>
          </div>

          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>🚀</span>
              <span className="muted" style={{ fontSize: 13 }}>Top Pick</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{stats.topPick?.symbol}</div>
            <div className="muted" style={{ fontSize: 13 }}>${Number(stats.topPick?.entry_price).toFixed(2)}</div>
          </div>

          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>🔥</span>
              <span className="muted" style={{ fontSize: 13 }}>Bargain Find</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{stats.bargainFind?.symbol}</div>
            <div className="muted" style={{ fontSize: 13 }}>${Number(stats.bargainFind?.entry_price).toFixed(2)}</div>
          </div>

          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>1️⃣</span>
              <span className="muted" style={{ fontSize: 13 }}>First Pick</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{stats.firstPick?.symbol}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              by {getDisplayName(stats.firstPick?.user_id, USER_ID)}
            </div>
          </div>

          <div style={{ padding: 14, background: '#1f2937', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>🏁</span>
              <span className="muted" style={{ fontSize: 13 }}>Last Pick</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{stats.lastPick?.symbol}</div>
            <div className="muted" style={{ fontSize: 13 }}>
              by {getDisplayName(stats.lastPick?.user_id, USER_ID)}
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
        <Link className="btn primary" to="/portfolio" style={{ minWidth: 160, padding: '12px 24px' }}>
          View Portfolio
        </Link>
        <Link className="btn" to="/leaderboard" style={{ minWidth: 160, padding: '12px 24px' }}>
          View Leaderboard
        </Link>
        <Link className="btn" to="/leagues" style={{ minWidth: 160, padding: '12px 24px' }}>
          Back to Leagues
        </Link>
      </div>
    </div>
  );
}
