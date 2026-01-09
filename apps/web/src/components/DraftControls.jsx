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

  const upper = String(symbol).toUpperCase();
  const alreadyDrafted = quote ? portfolio.some(p => p.symbol === upper) : false;
  const draftedByMe = quote ? portfolio.some(p => p.symbol === upper && p.user_id === USER_ID) : false;
  const draftedByOther = alreadyDrafted && !draftedByMe;
  const isMyTurn = USER_ID === currentPicker;
  const overBudget = isBudgetMode && quote && Number(quote.c) > budgetRemaining;
  const canDraft = quote && isMyTurn && !alreadyDrafted && !overBudget;

  return (
    <div className="draft-controls-v2">
      {/* Search Section */}
      <div className="search-container">
        <div className="search-input-wrapper-v2">
          <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <path d="M21 21l-4.35-4.35"/>
          </svg>
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
                    getQuote(firstSuggestion.symbol);
                  }
                }
              }
            }}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder="Search by symbol or company name..."
            className="search-input-v2"
          />
          {symbol && (
            <button
              className="search-clear"
              onClick={() => { setSymbol(''); setQuote(null); setSuggestions([]); }}
              type="button"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>

        {/* Suggestions Dropdown */}
        {Array.isArray(suggestions) && suggestions.length > 0 && (
          <div className="suggestions-dropdown">
            {suggestions.map((item) => (
              <button
                key={`${item.symbol}-${item.name}`}
                className="suggestion-item"
                onMouseDown={() => {
                  setSymbol(item.symbol);
                  setSuggestions([]);
                  setSymbolToName((prev) => ({ ...prev, [item.symbol.toUpperCase()]: item.name }));
                  setQuote(null);
                  getQuote(item.symbol);
                }}
              >
                <div className="suggestion-avatar">
                  {item.symbol.charAt(0)}
                </div>
                <div className="suggestion-info">
                  <span className="suggestion-symbol">{item.symbol}</span>
                  <span className="suggestion-name">{item.name}</span>
                </div>
                {item.price != null && (
                  <span className="suggestion-price">${Number(item.price).toFixed(2)}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {errorMsg && <p className="error-message-v2">{errorMsg}</p>}

      {/* Quote Card */}
      {quote && (
        <div className="quote-card">
          <div className="quote-card-header">
            <div className="quote-avatar">
              {upper.charAt(0)}
            </div>
            <div className="quote-info">
              <span className="quote-symbol-v2">{upper}</span>
              <span className="quote-name-v2">{prettyName(symbolToName[upper] || 'Company')}</span>
            </div>
            <div className="quote-price-v2">
              ${Number(quote.c).toFixed(2)}
            </div>
          </div>

          <div className="quote-card-footer">
            {draftedByMe && (
              <div className="quote-status info">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                </svg>
                Already on your team
              </div>
            )}
            {draftedByOther && (
              <div className="quote-status error">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z"/>
                </svg>
                Taken by another player
              </div>
            )}
            {!isMyTurn && !alreadyDrafted && (
              <div className="quote-status warning">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14v-2h2v2h-2zm0-4V7h2v5h-2z"/>
                </svg>
                Wait for your turn
              </div>
            )}
            {overBudget && (
              <div className="quote-status error">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-2h2v2h-2zm0-4V7h2v6h-2z"/>
                </svg>
                Over budget (${budgetRemaining?.toFixed(0)} left)
              </div>
            )}

            <button
              onClick={draftStock}
              disabled={!canDraft}
              className={`draft-button ${canDraft ? 'active' : ''}`}
            >
              {canDraft ? 'Draft to Team' : 'Draft Stock'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
