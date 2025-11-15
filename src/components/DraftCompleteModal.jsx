// src/components/DraftCompleteModal.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import { prettyName } from '../utils/formatting';

/**
 * DraftCompleteModal component
 * Modal shown when the draft is complete
 */
export default function DraftCompleteModal({
  show,
  onClose,
  leagueName,
  portfolio,
  symbolToName,
  USER_ID,
}) {
  if (!show) return null;

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
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
          width: 'min(720px, 92vw)',
          padding: 20,
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            fontSize: 22,
            cursor: 'pointer'
          }}
        >
          ×
        </button>

        <h2 style={{ marginTop: 0 }}>Draft Complete</h2>
        <p className="muted" style={{ marginTop: 4 }}>
          Here's your team for <strong>{leagueName}</strong>.
        </p>

        <div style={{ marginTop: 12, maxHeight: 360, overflowY: 'auto' }}>
          {portfolio
            .filter(p => p.user_id === USER_ID)
            .sort((a, b) => a.pick_number - b.pick_number)
            .map((p) => {
              const sym = p.symbol?.toUpperCase();
              const rawName = symbolToName[sym] || p.company_name || '';
              const name = rawName ? prettyName(rawName) : '';
              return (
                <div key={`${p.round}-${p.pick_number}-${p.symbol}`} className="list-row">
                  <span>
                    <strong>R{p.round} • #{p.pick_number}</strong> — {sym}
                    {name ? ` — ${name}` : ''}
                  </span>
                  <span>${Number(p.entry_price).toFixed(2)}</span>
                </div>
              );
            })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <Link className="btn primary" to="/portfolio">View Portfolio</Link>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
