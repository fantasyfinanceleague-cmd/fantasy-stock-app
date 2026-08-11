// SlotBuilder — commissioner roster-slot editor (Phase 4 item 4, DR-001 draft
// constraint system). A slot = {slotCount, priceMin?, priceMax?, categoryId?};
// no filters = flex. Required for price_tiers (brackets are the anti-skew
// mechanism); optional category slots work in any stake mode.
//
// Feasibility is a WARNING, never a gate: counts run against symbols
// (is_draftable + last_price) which the enrichment cron populates over ~2
// days — partial coverage shows a "lower bound" caveat instead of blocking.
import React, { useEffect, useState } from 'react';
import { countSlotMatches, fetchEnrichmentProgress } from '../utils/categoryData';

const rowStyle = { display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 32px', gap: 8, marginBottom: 8, alignItems: 'center' };
const smallInput = {
  width: '100%', padding: '8px 10px', background: 'rgba(17, 24, 39, 0.6)',
  border: '1px solid rgba(75, 85, 99, 0.4)', borderRadius: 8, color: '#fff', fontSize: 13,
};
const warnStyle = {
  padding: '8px 12px', background: 'rgba(245, 158, 11, 0.1)',
  border: '1px solid rgba(245, 158, 11, 0.3)', borderRadius: 8,
  color: '#f59e0b', fontSize: 12, marginBottom: 8,
};

export default function SlotBuilder({ slots, onChange, categories, leagueSize, numRounds, disabled }) {
  const [warnings, setWarnings] = useState([]);
  const [checking, setChecking] = useState(false);
  const [partialNote, setPartialNote] = useState(false);

  const setSlot = (i, patch) => {
    const next = slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange(next);
  };
  const addSlot = () => onChange([...slots, { slotCount: 1, priceMin: '', priceMax: '', categoryId: '' }]);
  const removeSlot = (i) => onChange(slots.filter((_, idx) => idx !== i));

  // Capacity mismatch is computed locally (no query needed).
  const totalCapacity = slots.reduce((s, r) => s + (Number(r.slotCount) || 0), 0);
  const capacityShort = slots.length > 0 && totalCapacity < numRounds;

  const checkFeasibility = async () => {
    setChecking(true);
    const found = [];
    try {
      const progress = await fetchEnrichmentProgress();
      setPartialNote(progress.partial);
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        const matches = await countSlotMatches({
          priceMin: s.priceMin === '' ? null : Number(s.priceMin),
          priceMax: s.priceMax === '' ? null : Number(s.priceMax),
          categoryId: s.categoryId || null,
        });
        const needed = leagueSize * (Number(s.slotCount) || 1);
        if (matches < needed) {
          found.push(
            `Slot ${i + 1}: only ${matches} draftable stock${matches === 1 ? '' : 's'} match — ` +
            `the league needs at least ${needed} (${leagueSize} teams × ${s.slotCount}).` +
            (progress.partial ? ' Counts are lower bounds while stock data is still loading.' : ''),
          );
        }
      }
    } catch {
      found.push('Could not check availability — try again.');
    }
    setWarnings(found);
    setChecking(false);
  };

  // Reset stale warnings whenever the definition changes.
  useEffect(() => { setWarnings([]); }, [JSON.stringify(slots)]);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr 1fr 32px', gap: 8, marginBottom: 4 }}>
        <small style={{ color: '#6b7280' }}>Count</small>
        <small style={{ color: '#6b7280' }}>Min price ($)</small>
        <small style={{ color: '#6b7280' }}>Max price ($)</small>
        <small style={{ color: '#6b7280' }}>Category</small>
        <span />
      </div>
      {slots.map((s, i) => (
        <div key={i} style={rowStyle}>
          <input
            type="number" min="1" value={s.slotCount} disabled={disabled}
            onChange={(e) => setSlot(i, { slotCount: Math.max(1, Number(e.target.value) || 1) })}
            style={smallInput}
          />
          <input
            type="number" min="0" placeholder="any" value={s.priceMin} disabled={disabled}
            onChange={(e) => setSlot(i, { priceMin: e.target.value })}
            style={smallInput}
          />
          <input
            type="number" min="0" placeholder="any" value={s.priceMax} disabled={disabled}
            onChange={(e) => setSlot(i, { priceMax: e.target.value })}
            style={smallInput}
          />
          <select
            value={s.categoryId} disabled={disabled}
            onChange={(e) => setSlot(i, { categoryId: e.target.value })}
            style={smallInput}
          >
            <option value="">Any (flex)</option>
            {categories.filter((c) => !c.is_misc).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button" onClick={() => removeSlot(i)} disabled={disabled}
            style={{ ...smallInput, cursor: 'pointer', padding: '6px 0', textAlign: 'center' }}
            title="Remove slot"
          >
            ✕
          </button>
        </div>
      ))}

      {capacityShort && (
        <div style={warnStyle}>
          Slots cover {totalCapacity} pick{totalCapacity === 1 ? '' : 's'} per team but the draft has {numRounds} rounds —
          picks beyond slot capacity will be refused. Add slots or reduce rounds.
        </div>
      )}
      {warnings.map((w, i) => <div key={i} style={warnStyle}>{w}</div>)}
      {partialNote && warnings.length === 0 && slots.length > 0 && (
        <div style={{ ...warnStyle, color: '#9ca3af', borderColor: 'rgba(107,114,128,0.3)', background: 'rgba(107,114,128,0.08)' }}>
          Stock classification is still loading — availability counts are lower bounds.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={addSlot} disabled={disabled} style={{ ...smallInput, cursor: 'pointer', width: 'auto', padding: '8px 14px' }}>
          + Add slot
        </button>
        {slots.length > 0 && (
          <button type="button" onClick={checkFeasibility} disabled={disabled || checking} style={{ ...smallInput, cursor: 'pointer', width: 'auto', padding: '8px 14px' }}>
            {checking ? 'Checking…' : 'Check availability'}
          </button>
        )}
      </div>
    </div>
  );
}
