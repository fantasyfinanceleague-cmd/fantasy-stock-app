// src/components/TradeModal.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { prettyName } from '../utils/formatting';
import { isMarketOpen, getMarketStatusMessage } from '../utils/marketHours';

/**
 * TradeModal component
 * Modal for buying and selling stocks after the draft completes
 */
export default function TradeModal({
  show,
  onClose,
  onTradeComplete,
  leagueId,
  userId,
  currentHoldings, // array of {symbol, quantity, entry_price}
  availableCash, // remaining budget
  isBudgetMode,
  leagueType = 'duration', // 'duration' or 'matchup'
  initialSymbol = '',
  initialAction = 'buy' // 'buy' or 'sell'
}) {
  // Trading is allowed during market hours (9:30 AM - 4:00 PM ET, Mon-Fri)
  const marketOpen = isMarketOpen();
  const marketStatusMessage = getMarketStatusMessage();
  const [action, setAction] = useState(initialAction);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [searchInput, setSearchInput] = useState(initialSymbol);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);
  const [companyName, setCompanyName] = useState('');

  // Search state
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchTimeoutRef = useRef(null);
  const searchContainerRef = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setAction(initialAction);
      setSymbol(initialSymbol);
      setSearchInput(initialSymbol);
      setQuantity(1);
      setError('');
      setQuote(null);
      setCompanyName('');
      setSearchResults([]);
      setShowSearchResults(false);

      // If opening with an initial symbol, fetch its quote
      if (initialSymbol) {
        (async () => {
          try {
            const upperSym = initialSymbol.trim().toUpperCase();

            // Fetch quote
            const { data, error: quoteError } = await supabase.functions.invoke('quote', {
              body: { symbol: upperSym }
            });

            if (!quoteError && !data?.error) {
              const price = Number(
                data?.price ??
                data?.quote?.ap ??
                data?.quote?.bp ??
                data?.trade?.p ??
                data?.bar?.c
              );

              if (Number.isFinite(price) && price > 0) {
                setQuote({ symbol: upperSym, price });
              }
            }

            // Fetch company name
            const { data: nameData } = await supabase.functions.invoke('symbol-name', {
              body: { symbol: upperSym }
            });
            if (nameData?.name) {
              setCompanyName(nameData.name);
            }
          } catch (err) {
            console.error('Error fetching initial quote:', err);
          }
        })();
      }
    }
  }, [show, initialAction, initialSymbol]);

  // Search for symbols as user types (debounced)
  useEffect(() => {
    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // If no input or input matches selected symbol, don't search
    if (!searchInput || searchInput.length < 1) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    // If user has selected a symbol and input matches, don't search
    if (symbol && searchInput.toUpperCase() === symbol.toUpperCase()) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }

    setSearchLoading(true);
    setShowSearchResults(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const { data, error: searchError } = await supabase.functions.invoke('symbols-search', {
          body: { q: searchInput, limit: 8, includePrices: true }
        });

        if (searchError) throw searchError;

        setSearchResults(data?.items || []);
      } catch (err) {
        console.error('Search error:', err);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchInput, symbol]);

  // Handle selecting a search result
  const handleSelectResult = useCallback((result) => {
    setSymbol(result.symbol);
    setSearchInput(result.symbol);
    setCompanyName(result.name);
    setShowSearchResults(false);
    setSearchResults([]);

    // Use price from search if available, otherwise fetch
    if (result.price && Number.isFinite(result.price) && result.price > 0) {
      setQuote({ symbol: result.symbol, price: result.price });
    } else {
      // Fetch quote for the symbol
      (async () => {
        try {
          const { data, error: quoteError } = await supabase.functions.invoke('quote', {
            body: { symbol: result.symbol }
          });

          if (!quoteError && !data?.error) {
            const price = Number(
              data?.price ??
              data?.quote?.ap ??
              data?.quote?.bp ??
              data?.trade?.p ??
              data?.bar?.c
            );

            if (Number.isFinite(price) && price > 0) {
              setQuote({ symbol: result.symbol, price });
            }
          }
        } catch (err) {
          console.error('Error fetching quote:', err);
        }
      })();
    }
  }, []);

  // Handle search input changes
  const handleSearchInputChange = useCallback((e) => {
    const upper = e.target.value.toUpperCase();
    setSearchInput(upper);
    // Clear selected symbol when user starts typing something different
    if (symbol && upper !== symbol) {
      setSymbol('');
      setQuote(null);
      setCompanyName('');
    }
  }, [symbol]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setShowSearchResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Calculate trade details
  const currentPrice = quote?.price || 0;
  const totalValue = currentPrice * quantity;
  const holding = currentHoldings.find(h => h.symbol?.toUpperCase() === symbol.toUpperCase());
  const ownedQuantity = holding?.quantity || 0;

  // Validation
  const canAfford = !isBudgetMode || (action === 'sell' || totalValue <= availableCash);
  const hasEnoughShares = action === 'buy' || ownedQuantity >= quantity;

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Trade submission is disabled between Phase 1 (broker removal) and Phase 3
    // (in-house simulator fills). The place-order edge function has been removed;
    // no ledger writes happen here until Phase 3 wires the app-key fill path.
    // See DR-001 / SIMULATOR_MIGRATION_SPEC.
    setError('Trading is temporarily unavailable while we upgrade to the in-house simulator.');
  };

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
          width: 'min(520px, 92vw)',
          padding: 24,
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

        <h2 style={{ marginTop: 0 }}>Trade Stock</h2>

        {!marketOpen ? (
          <div style={{
            padding: 20,
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 8,
            textAlign: 'center'
          }}>
            <p style={{ margin: '0 0 12px 0', color: '#fbbf24', fontWeight: 600 }}>
              Market Closed
            </p>
            <p className="muted" style={{ margin: '0 0 8px 0', fontSize: 14 }}>
              {marketStatusMessage}
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Trading is available during market hours: <strong>9:30 AM - 4:00 PM ET, Monday - Friday</strong>
            </p>
          </div>
        ) : (
        <form onSubmit={handleSubmit}>
          {/* Buy/Sell Toggle */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={() => setAction('buy')}
                className="btn"
                style={{
                  flex: 1,
                  backgroundColor: action === 'buy' ? '#10b981' : '#374151',
                  borderColor: action === 'buy' ? '#10b981' : '#4b5563'
                }}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => setAction('sell')}
                className="btn"
                style={{
                  flex: 1,
                  backgroundColor: action === 'sell' ? '#ef4444' : '#374151',
                  borderColor: action === 'sell' ? '#ef4444' : '#4b5563'
                }}
              >
                Sell
              </button>
            </div>
          </div>

          {/* Symbol Search Input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#e5e7eb' }}>
              Search Stock
            </label>
            <div ref={searchContainerRef} style={{ position: 'relative' }}>
              <input
                className="modal-input"
                type="text"
                value={searchInput}
                onChange={handleSearchInputChange}
                onFocus={() => {
                  if (searchInput && searchInput !== symbol) {
                    setShowSearchResults(true);
                  }
                }}
                placeholder="Search by ticker or name..."
                style={{ textTransform: 'uppercase' }}
              />
              {searchLoading && (
                <div style={{
                  position: 'absolute',
                  right: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#9ca3af',
                  fontSize: 12
                }}>
                  Loading...
                </div>
              )}

              {/* Search Results Dropdown */}
              {showSearchResults && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderTop: 'none',
                  borderRadius: '0 0 8px 8px',
                  maxHeight: 280,
                  overflowY: 'auto',
                  zIndex: 100,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                }}>
                  {searchResults.map((result) => (
                    <div
                      key={result.symbol}
                      onClick={() => handleSelectResult(result)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 14px',
                        borderBottom: '1px solid #374151',
                        cursor: 'pointer',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#374151'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{result.symbol}</div>
                        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                          {prettyName(result.name)}
                        </div>
                      </div>
                      {result.price ? (
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb' }}>
                          ${result.price.toFixed(2)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {/* No results message */}
              {showSearchResults && !searchLoading && searchInput.length >= 1 && searchResults.length === 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  backgroundColor: '#1f2937',
                  border: '1px solid #374151',
                  borderTop: 'none',
                  borderRadius: '0 0 8px 8px',
                  padding: 16,
                  zIndex: 100,
                  textAlign: 'center',
                  color: '#9ca3af',
                  fontSize: 14
                }}>
                  No matching stocks found
                </div>
              )}
            </div>

            {/* Selected stock info */}
            {symbol && companyName && (
              <div style={{
                marginTop: 10,
                padding: 12,
                backgroundColor: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: 8
              }}>
                <div style={{ fontWeight: 700, color: '#22c55e', fontSize: 15 }}>{symbol}</div>
                <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
                  {prettyName(companyName)}
                </div>
              </div>
            )}
          </div>

          {/* Quantity Input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#e5e7eb' }}>
              Quantity
            </label>
            <input
              className="modal-input"
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              required
            />
            {action === 'sell' && holding && (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                You own {ownedQuantity} shares
              </div>
            )}
          </div>

          {/* Price Info */}
          {quote && (
            <div style={{
              marginBottom: 16,
              padding: 12,
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: 8
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="muted">Current Price:</span>
                <span>${currentPrice.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 600 }}>Total {action === 'buy' ? 'Cost' : 'Proceeds'}:</span>
                <span style={{ fontWeight: 600, color: action === 'buy' ? '#ef4444' : '#10b981' }}>
                  ${totalValue.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Budget Info */}
          {isBudgetMode && action === 'buy' && (
            <div className="muted" style={{ marginBottom: 16, fontSize: 13 }}>
              Available Cash: <strong>${availableCash.toFixed(2)}</strong>
            </div>
          )}

          {/* Trading temporarily disabled (Phase 1 → Phase 3 interim) */}
          <div style={{
            padding: 12,
            marginBottom: 16,
            backgroundColor: 'rgba(251, 191, 36, 0.1)',
            border: '1px solid rgba(251, 191, 36, 0.3)',
            borderRadius: 8,
            color: '#fbbf24',
            fontSize: 14
          }}>
            Trading is temporarily unavailable while we upgrade to the in-house simulator.
          </div>

          {/* Error Message */}
          {error && (
            <div style={{
              padding: 12,
              marginBottom: 16,
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 8,
              color: '#f87171',
              fontSize: 14
            }}>
              {error}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="submit"
              className="btn primary"
              disabled
              style={{ flex: 1 }}
            >
              Trading Unavailable
            </button>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}
