// src/components/TradeNotification.jsx
import React, { useEffect, useState } from 'react';

/**
 * TradeNotification component
 * Shows a toast notification when a new trade occurs
 */
export default function TradeNotification({ trade, onClose, currentUserId }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (trade) {
      setIsVisible(true);
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(onClose, 300); // Wait for fade out animation
      }, 4700);

      return () => clearTimeout(timer);
    }
  }, [trade, onClose]);

  if (!trade) return null;

  const isMine = trade.user_id === currentUserId;
  const isBuy = trade.action === 'buy';

  return (
    <div
      style={{
        position: 'fixed',
        top: 20,
        right: 20,
        zIndex: 9999,
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(-20px)',
        transition: 'all 0.3s ease-in-out',
      }}
    >
      <div
        style={{
          backgroundColor: '#1f2937',
          border: `2px solid ${isBuy ? '#10b981' : '#ef4444'}`,
          borderRadius: 8,
          padding: '16px 20px',
          minWidth: 300,
          maxWidth: 400,
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Icon */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              backgroundColor: isBuy ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 20,
            }}
          >
            {isBuy ? '📈' : '📉'}
          </div>

          {/* Content */}
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#fff', marginBottom: 4 }}>
              {isMine ? 'You' : 'Someone'} {isBuy ? 'bought' : 'sold'} {trade.symbol}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>
              {trade.quantity} shares @ ${Number(trade.price).toFixed(2)}
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: 20,
              padding: 4,
            }}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
