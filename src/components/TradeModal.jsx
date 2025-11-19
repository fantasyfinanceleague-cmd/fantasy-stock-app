// src/components/TradeModal.jsx
import React, { useState, useEffect } from 'react';
import { supabase } from '../supabase/supabaseClient';
import { prettyName } from '../utils/formatting';

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
  initialSymbol = '',
  initialAction = 'buy' // 'buy' or 'sell'
}) {
  const [action, setAction] = useState(initialAction);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState(null);
  const [companyName, setCompanyName] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setAction(initialAction);
      setSymbol(initialSymbol);
      setQuantity(1);
      setError('');
      setQuote(null);
      setCompanyName('');
    }
  }, [show, initialAction, initialSymbol]);

  // Fetch quote when symbol changes
  useEffect(() => {
    if (!symbol || symbol.length < 1) {
      setQuote(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const sym = symbol.trim().toUpperCase();

        // Fetch quote from edge function
        const { data, error: quoteError } = await supabase.functions.invoke('quote', {
          body: { symbol: sym }
        });

        if (quoteError) throw quoteError;
        if (data?.error) throw new Error(data.error);

        const price = Number(
          data?.price ??
          data?.quote?.ap ??
          data?.quote?.bp ??
          data?.trade?.p ??
          data?.bar?.c
        );

        if (!Number.isFinite(price) || price <= 0) {
          setQuote(null);
          return;
        }

        setQuote({ symbol: sym, price });

        // Fetch company name
        const { data: nameData } = await supabase.functions.invoke('symbol-name', {
          body: { symbol: sym }
        });
        if (nameData?.name) {
          setCompanyName(nameData.name);
        }
      } catch (err) {
        setQuote(null);
        setCompanyName('');
      }
    }, 500); // Debounce

    return () => clearTimeout(timer);
  }, [symbol]);

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
    setError('');

    if (!quote) {
      setError('Please enter a valid symbol');
      return;
    }

    if (!canAfford) {
      setError(`Insufficient funds. You have $${availableCash.toFixed(2)} available.`);
      return;
    }

    if (!hasEnoughShares) {
      setError(`You only own ${ownedQuantity} shares of ${symbol.toUpperCase()}`);
      return;
    }

    setLoading(true);

    try {
      // Insert trade into database
      const { error: tradeError } = await supabase
        .from('trades')
        .insert({
          league_id: leagueId,
          user_id: userId,
          symbol: symbol.toUpperCase(),
          action: action,
          quantity: quantity,
          price: currentPrice,
          total_value: totalValue
        });

      if (tradeError) throw tradeError;

      // Call parent callback to refresh data
      if (onTradeComplete) {
        await onTradeComplete();
      }

      onClose();
    } catch (err) {
      setError(err.message || 'Failed to execute trade');
    } finally {
      setLoading(false);
    }
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

          {/* Symbol Input */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 6, fontSize: 14, color: '#e5e7eb' }}>
              Stock Symbol
            </label>
            <input
              className="modal-input"
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              required
              style={{ textTransform: 'uppercase' }}
            />
            {companyName && (
              <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                {prettyName(companyName)}
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
              disabled={loading || !quote || !canAfford || !hasEnoughShares}
              style={{ flex: 1 }}
            >
              {loading ? 'Processing...' : `${action === 'buy' ? 'Buy' : 'Sell'} ${quantity} Share${quantity !== 1 ? 's' : ''}`}
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
      </div>
    </div>
  );
}
