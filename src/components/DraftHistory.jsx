// src/components/DraftHistory.jsx
import React from 'react';
import { prettyName } from '../utils/formatting';

/**
 * DraftHistory component
 * Shows the draft picks for a selected round
 */
export default function DraftHistory({
  selectedRound,
  setSelectedRound,
  totalRounds,
  portfolio,
  symbolToName,
}) {
  const myPicksThisRound = portfolio.filter(p => p.round === selectedRound);

  return (
    <div className="draft-box scroll-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Draft History</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="roundSelect">Round:</label>
          <select
            id="roundSelect"
            value={selectedRound}
            onChange={(e) => setSelectedRound(Number(e.target.value))}
            className="round-select"
          >
            {Array.from({ length: totalRounds }, (_, i) => (
              <option key={i + 1} value={i + 1}>{i + 1}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        {myPicksThisRound.length === 0 && (
          <p style={{ color: '#9ca3af', margin: 0 }}>No picks yet in this round.</p>
        )}

        {portfolio
          .filter(p => p.round === selectedRound)
          .sort((a, b) => a.pick_number - b.pick_number)
          .map((pick) => {
            const sym = pick.symbol?.toUpperCase();
            const company = prettyName(symbolToName[sym] || pick.company_name || '');
            const price = Number(pick.entry_price);

            return (
              <div
                key={`${pick.round}-${pick.pick_number}-${pick.symbol}-${pick.user_id}`}
                className="list-row"
              >
                <span>
                  <strong>{pick.pick_number}</strong> — {sym}
                  {company ? ` — ${company}` : ''}
                </span>
                <span>{isNaN(price) ? '—' : `$${price.toFixed(2)}`}</span>
              </div>
            );
          })}
      </div>
    </div>
  );
}
