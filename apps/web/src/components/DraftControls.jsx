// src/components/DraftControls.jsx
import React, { useEffect, useState, useRef } from 'react';
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
  const [lastQuery, setLastQuery] = useState(''); // Track last successful query
  const inputFocusedRef = useRef(false);

  // Clear quote when symbol cleared
  useEffect(() => {
    if (!symbol.trim()) {
      setQuote(null);
      setErrorMsg('');
      clearSuggestionFlow(setSuggestions);
      setLastQuery('');
    }
  }, [symbol, setQuote, setErrorMsg]);

  // Cleanup suggestions/timers on unmount
  useEffect(() => {
    return () => clearSuggestionFlow(setSuggestions);
  }, []);

  async function fetchSuggestions(q) {
    const { data, error } = await supabase.functions.invoke('symbols-search', { body: { q } });
    if (!error && data?.items) {
      setSuggestions(data.items);
      setLastQuery(q);
    } else {
      setSuggestions([]);
    }
  }

  // Re-show suggestions on focus if we have a query
  function handleFocus() {
    inputFocusedRef.current = true;
    const trimmed = symbol.trim();
    if (trimmed && suggestions.length === 0) {
      // Re-fetch suggestions if we have text but no suggestions showing
      fetchSuggestions(trimmed);
    }
  }

  function handleBlur() {
    inputFocusedRef.current = false;
    // Delay clearing so clicks on suggestions register
    setTimeout(() => {
      if (!inputFocusedRef.current) {
        setSuggestions([]);
      }
    }, 200);
  }

  if (isDraftComplete) {
    return (
      <div className="draft-complete-message">
        <span className="complete-icon">🏁</span>
        <div>
          <strong>Draft Complete</strong>
          <p className="muted" style={{ margin: 0 }}>
            All {draftCap} picks are in for {leagueName}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="draft-controls">
      <div className="search-row">
        <div className="search-input-wrapper">
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
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSuggestions([]);
              if (e.key === 'Enter' && symbol.trim()) {
                e.preventDefault();
                if (suggestions.length === 0) {
                  getQuote();
                } else {
                  const firstSuggestion = suggestions[0];
                  if (firstSuggestion) {
                    setSymbol(firstSuggestion.symbol);
                    setSuggestions([]);
                    setSymbolToName((prev) => ({ ...prev, [firstSuggestion.symbol.toUpperCase()]: firstSuggestion.name }));
                    setQuote(null);
                  }
                }
              }
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder="Search stocks (e.g. AAPL, Microsoft)"
            className="draft-search-input"
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
        <button onClick={getQuote} className="btn primary">
          Get Quote
        </button>
      </div>

      {errorMsg && <p className="error-message">{errorMsg}</p>}

      {quote && (
        <div className="quote-result">
          <div className="quote-header">
            <div className="quote-symbol">{String(symbol).toUpperCase()}</div>
            <div className="quote-name">{prettyName(symbolToName[String(symbol).toUpperCase()] || 'Company')}</div>
            <div className="quote-price">${Number(quote.c).toFixed(2)}</div>
          </div>

          {(() => {
            const upper = String(symbol).toUpperCase();
            const alreadyDrafted = portfolio.some(p => p.symbol === upper);
            const draftedByMe = portfolio.some(p => p.symbol === upper && p.user_id === USER_ID);
            const draftedByOther = alreadyDrafted && !draftedByMe;

            let statusMessage = '';
            let statusType = '';
            let disabled = false;

            if (draftedByMe) {
              statusMessage = 'You already drafted this stock';
              statusType = 'info';
              disabled = true;
            } else if (draftedByOther) {
              statusMessage = 'Already drafted by another player';
              statusType = 'error';
              disabled = true;
            } else if (USER_ID !== currentPicker) {
              statusMessage = 'Wait for your turn';
              statusType = 'warning';
              disabled = true;
            } else if (isBudgetMode && Number(quote.c) > budgetRemaining) {
              statusMessage = 'Over your remaining budget';
              statusType = 'error';
              disabled = true;
            }

            return (
              <div className="quote-actions">
                <button
                  onClick={draftStock}
                  disabled={disabled}
                  className={`btn ${disabled ? '' : 'primary'} draft-btn`}
                >
                  Draft Stock
                </button>
                {statusMessage && (
                  <span className={`status-message ${statusType}`}>
                    {statusMessage}
                  </span>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
