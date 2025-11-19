// src/components/PriceDisplay.jsx
import React from 'react';

/**
 * PriceDisplay component with real-time update animations
 * Shows price with green/red flash animation when price changes
 *
 * @param {number} price - The price to display
 * @param {string} change - 'up' or 'down' to trigger animation
 * @param {string} prefix - Optional prefix (default: '$')
 * @param {number} decimals - Number of decimal places (default: 2)
 */
export default function PriceDisplay({ price, change, prefix = '$', decimals = 2 }) {
  if (!Number.isFinite(price)) {
    return <span>—</span>;
  }

  const getStyle = () => {
    const baseStyle = {
      transition: 'background-color 0.3s ease',
      padding: '2px 4px',
      borderRadius: 4,
      display: 'inline-block',
    };

    if (change === 'up') {
      return {
        ...baseStyle,
        animation: 'priceFlashUp 0.6s ease-out',
      };
    } else if (change === 'down') {
      return {
        ...baseStyle,
        animation: 'priceFlashDown 0.6s ease-out',
      };
    }

    return baseStyle;
  };

  return (
    <>
      <style>{`
        @keyframes priceFlashUp {
          0% {
            background-color: rgba(16, 185, 129, 0.3);
          }
          100% {
            background-color: transparent;
          }
        }

        @keyframes priceFlashDown {
          0% {
            background-color: rgba(239, 68, 68, 0.3);
          }
          100% {
            background-color: transparent;
          }
        }
      `}</style>
      <span style={getStyle()}>
        {prefix}{price.toFixed(decimals)}
      </span>
    </>
  );
}
