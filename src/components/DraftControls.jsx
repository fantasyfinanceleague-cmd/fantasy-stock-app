// src/components/DraftControls.jsx
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { prettyName } from '../utils/formatting';

// ---- Suggestion flow management ----
let suggestAbortCtrl = null;
let suggestTimer = null;

function clearSuggestionFlow(setSuggestions) {
  if (suggestTimer) {
    clearTimeout(suggestTimer);
    suggestTimer = null;
  }
  if (suggestAbortCtrl) {
    try { suggestAbortCtrl.abort(); } catch { /* noop */ }
    suggestAbortCtrl = null;
  }
  setSuggestions([]);
}

/**
 * DraftControls component
 * Handles stock search, quote lookup, and drafting
 */
export default function DraftControls({
  isDraftComplete,
  draftCap,
  leagueName,
  symbol,
  setSymbol,
  quote,
  setQuote,
  errorMsg,
  setErrorMsg,
  symbolToName,
  setSymbolToName,
  portfolio,
  currentPicker,
  USER_ID,
  isBudgetMode,
  budgetRemaining,
  getQuote,
  draftStock,
}) {
  const [suggestions, setSuggestions] = useState([]);

  // Clear quote when symbol cleared
  useEffect(() => {
    if (!symbol.trim()) {
      setQuote(null);
      setErrorMsg('');
      clearSuggestionFlow(setSuggestions);
    }
  }, [symbol, setQuote, setErrorMsg]);

  // Cleanup suggestions/timers on unmount
  useEffect(() => {
    return () => clearSuggestionFlow(setSuggestions);
  }, []);

  async function fetchSuggestions(q) {
    const { data, error } = await supabase.functions.invoke('symbols-search', { body: { q } });
    if (!error && data?.items) setSuggestions(data.items);
    else setSuggestions([]);
  }

  if (isDraftComplete) {
    return (
      <div className="draft-box">
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>🏁 Draft complete</h3>
        <p className="muted" style={{ margin: 0 }}>
          All {draftCap} picks are in for <strong>{leagueName}</strong>.
          You can review the history below or go back to Leagues.
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
        <input
          type="text"
          value={symbol}
          onChange={(e) => {
            const v = e.target.value;
            setSymbol(v);
            if (v.trim() === '') {
              clearSuggestionFlow(setSuggestions);
              return;
            }
            fetchSuggestions(v);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setSuggestions([]); }}
          onBlur={() => { setTimeout(() => clearSuggestionFlow(setSuggestions), 120); }}
          placeholder="Enter company or symbol (e.g. AAPL, Nvidia)"
          className="modal-input"
        />

        {Array.isArray(suggestions) && suggestions.length > 0 && (
          <ul className="dropdown-list">
            {suggestions.map((item) => (
              <li
                key={`${item.symbol}-${item.name}`}
                className="dropdown-item"
                onMouseDown={() => {
                  setSymbol(item.symbol);
                  setSuggestions([]);
                  setSymbolToName((prev) => ({ ...prev, [item.symbol.toUpperCase()]: item.name }));
                  setQuote(null);
                }}
              >
                <strong>{item.symbol}</strong> — {item.name}
                {item.price != null && (
                  <span style={{ marginLeft: 'auto', color: '#10b981', fontWeight: 600 }}>
                    ${Number(item.price).toFixed(2)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 12, marginBottom: 8 }}>
        <button onClick={getQuote} className="modal-button btn-confirm" style={{ width: 'auto', padding: '10px 16px' }}>
          Get Quote
        </button>
      </div>

      {errorMsg && <p className="text-red-500">{errorMsg}</p>}

      {quote && (
        <div style={{ marginTop: 24 }}>
          <div className="draft-box">
            <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: 6 }}>
              {String(symbol).toUpperCase()} — {prettyName(symbolToName[String(symbol).toUpperCase()] || 'Company Name')}
            </div>
            <div style={{ fontSize: '1rem', marginBottom: 14 }}>
              Current Price: ${Number(quote.c).toFixed(2)}
            </div>

            {(() => {
              const upper = String(symbol).toUpperCase();
              const alreadyDrafted = portfolio.some(p => p.symbol === upper);
              const draftedByMe = portfolio.some(p => p.symbol === upper && p.user_id === USER_ID);
              const draftedByOther = alreadyDrafted && !draftedByMe;

              let tooltipMessage = '';
              let disabled = false;

              if (draftedByMe) {
                tooltipMessage = '✅ You already drafted this stock.';
                disabled = true;
              } else if (draftedByOther) {
                tooltipMessage = '❌ This stock has already been drafted by another user.';
                disabled = true;
              } else if (USER_ID !== currentPicker) {
                tooltipMessage = '⏳ Not your turn to draft.';
                disabled = true;
              } else if (isBudgetMode && Number(quote.c) > budgetRemaining) {
                tooltipMessage = '⚠️ Over your remaining budget.';
                disabled = true;
              }

              return (
                <div>
                  <button
                    onClick={draftStock}
                    disabled={disabled}
                    className={`modal-button ${disabled ? 'btn-disabled' : 'btn-confirm'}`}
                    style={{ width: 'auto', padding: '10px 16px' }}
                    title={tooltipMessage}
                  >
                    Draft to My Team
                  </button>
                  {tooltipMessage && (
                    <div style={{ marginTop: 8, fontSize: '0.9rem', color: '#9ca3af' }}>
                      {tooltipMessage}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}
