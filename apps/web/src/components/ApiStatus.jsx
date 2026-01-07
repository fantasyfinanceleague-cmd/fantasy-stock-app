// src/components/ApiStatus.jsx
import React, { useState, useEffect } from 'react';
import { usePrices, PRICE_STATUS } from '../context/PriceContext';

export default function ApiStatus() {
  const { statuses, getFailedSymbols, getRateLimitedSymbols, retryFailed, loading } = usePrices();
  const [retrying, setRetrying] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const failedSymbols = getFailedSymbols();
  const rateLimitedSymbols = getRateLimitedSymbols();
  const hasErrors = failedSymbols.length > 0;
  const hasRateLimiting = rateLimitedSymbols.length > 0;

  // Reset dismissed state when errors clear
  useEffect(() => {
    if (!hasErrors && !hasRateLimiting) {
      setDismissed(false);
    }
  }, [hasErrors, hasRateLimiting]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryFailed();
    } finally {
      setRetrying(false);
    }
  };

  // Don't show if no errors or dismissed
  if ((!hasErrors && !hasRateLimiting) || dismissed) {
    return null;
  }

  // Rate limiting banner (higher priority)
  if (hasRateLimiting) {
    return (
      <div style={{
        background: 'rgba(234, 179, 8, 0.1)',
        border: '1px solid rgba(234, 179, 8, 0.3)',
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>⏳</span>
          <div>
            <div style={{ color: '#fbbf24', fontWeight: 500, fontSize: 14 }}>
              Too many requests - please wait
            </div>
            <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
              Stock API rate limit reached. Prices will update automatically in a few moments.
            </div>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid #374151',
            borderRadius: 6,
            color: '#9ca3af',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  // Error banner
  return (
    <div style={{
      background: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 18 }}>⚠️</span>
        <div>
          <div style={{ color: '#f87171', fontWeight: 500, fontSize: 14 }}>
            Unable to load some stock prices
          </div>
          <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
            {failedSymbols.length} stock{failedSymbols.length !== 1 ? 's' : ''} affected: {failedSymbols.slice(0, 5).join(', ')}
            {failedSymbols.length > 5 && ` +${failedSymbols.length - 5} more`}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={handleRetry}
          disabled={retrying || loading}
          style={{
            padding: '6px 12px',
            background: '#3b82f6',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 12,
            fontWeight: 500,
            cursor: retrying || loading ? 'not-allowed' : 'pointer',
            opacity: retrying || loading ? 0.6 : 1,
          }}
        >
          {retrying ? 'Retrying...' : 'Retry'}
        </button>
        <button
          onClick={() => setDismissed(true)}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid #374151',
            borderRadius: 6,
            color: '#9ca3af',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
