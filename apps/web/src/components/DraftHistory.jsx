// src/components/DraftHistory.jsx
import { useEffect } from 'react';
import { prettyName } from '../utils/formatting';

/**
 * DraftHistory component
 * Shows the draft picks for a selected round with slots for each player
 */
export default function DraftHistory({
  selectedRound,
  setSelectedRound,
  totalRounds,
  portfolio,
  symbolToName,
  getDisplayName,
  USER_ID,
  memberCount = 4,
  currentRound = 1,
}) {
  // Auto-switch to current round when it changes
  useEffect(() => {
    if (currentRound <= totalRounds && currentRound !== selectedRound) {
      setSelectedRound(currentRound);
    }
  }, [currentRound, totalRounds, setSelectedRound]);

  const picksThisRound = portfolio
    .filter(p => p.round === selectedRound)
    .sort((a, b) => a.pick_number - b.pick_number);

  // Create array of slots for this round
  const slots = Array.from({ length: memberCount }, (_, idx) => {
    const pick = picksThisRound[idx];
    return pick || null;
  });

  return (
    <div className="draft-board">
      <div className="draft-board-header">
        <h3>Round {selectedRound}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={selectedRound}
            onChange={(e) => setSelectedRound(Number(e.target.value))}
            className="round-select"
          >
            {Array.from({ length: totalRounds }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Round {i + 1} {i + 1 === currentRound ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="draft-board-grid">
        {slots.map((pick, idx) => {
          if (pick) {
            const sym = pick.symbol?.toUpperCase();
            const name = prettyName(symbolToName?.[sym] || pick.company_name || '');
            const price = Number(pick.entry_price);
            const pickerName = pick.user_id?.startsWith('bot-')
              ? pick.user_id
              : (getDisplayName ? getDisplayName(pick.user_id, USER_ID) : pick.user_id?.substring(0, 8));
            const isMyPick = pick.user_id === USER_ID;

            return (
              <div
                key={`${pick.round}-${pick.pick_number}-${idx}`}
                className={`draft-board-slot filled ${isMyPick ? 'my-pick' : ''}`}
              >
                <span className="slot-pick">#{pick.pick_number}</span>
                <span className="slot-stock-info">
                  <span className="slot-symbol">{sym}</span>
                  {name && <span className="slot-name">{name}</span>}
                </span>
                <span className="slot-picker">{pickerName}</span>
                <span className="slot-price">${isNaN(price) ? '—' : price.toFixed(2)}</span>
              </div>
            );
          }

          return (
            <div key={`empty-${idx}`} className="draft-board-slot empty">
              <span className="slot-pick">#{(selectedRound - 1) * memberCount + idx + 1}</span>
              <span className="slot-empty">Waiting...</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
