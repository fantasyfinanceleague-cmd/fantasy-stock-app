// src/components/MarketStatusBadge.jsx
import React, { useState, useEffect } from 'react';
import { getMarketStatus } from '../utils/marketHours';

/**
 * MarketStatusBadge component
 * Displays current market status with live updates
 */
export default function MarketStatusBadge({ showTime = false }) {
  const [status, setStatus] = useState(getMarketStatus());
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setStatus(getMarketStatus());
      setCurrentTime(new Date());
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case 'open':
        return { bg: 'rgba(16, 185, 129, 0.2)', border: '#10b981', text: '#10b981' };
      case 'pre-market':
      case 'after-hours':
        return { bg: 'rgba(251, 191, 36, 0.2)', border: '#fbbf24', text: '#fbbf24' };
      default:
        return { bg: 'rgba(107, 114, 128, 0.2)', border: '#6b7280', text: '#9ca3af' };
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'open':
        return 'Market Open';
      case 'pre-market':
        return 'Pre-Market';
      case 'after-hours':
        return 'After Hours';
      default:
        return 'Market Closed';
    }
  };

  const colors = getStatusColor();

  return (
    <>
      <style>{`
        @keyframes marketStatusPulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          backgroundColor: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {/* Pulsing dot for "open" status */}
        {status === 'open' && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: colors.text,
              animation: 'marketStatusPulse 2s ease-in-out infinite',
            }}
          />
        )}
        <span style={{ color: colors.text }}>{getStatusText()}</span>
        {showTime && (
          <span style={{ color: '#9ca3af', marginLeft: 4 }}>
            {currentTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short'
            })}
          </span>
        )}
      </div>
    </>
  );
}
