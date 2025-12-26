// src/components/PriceDisplay.jsx
import { useState, useEffect, useRef } from 'react';

/**
 * PriceDisplay component with real-time update animations
 * Shows price with green/red flash animation when price changes
 *
 * @param {number} price - The price to display
 * @param {string} change - 'up' or 'down' to trigger animation (optional - auto-detects if not provided)
 * @param {number} previousPrice - Previous price for auto-detection (optional)
 * @param {string} prefix - Optional prefix (default: '$')
 * @param {number} decimals - Number of decimal places (default: 2)
 * @param {boolean} autoDetect - Auto-detect price changes (default: true)
 */
export default function PriceDisplay({
  price,
  change,
  previousPrice,
  prefix = '$',
  decimals = 2,
  autoDetect = true,
  style = {},
}) {
  const [flashState, setFlashState] = useState(null);
  const prevPriceRef = useRef(price);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (!autoDetect || change) return;

    const prev = previousPrice !== undefined ? previousPrice : prevPriceRef.current;

    if (prev !== undefined && price !== prev && Number.isFinite(price) && Number.isFinite(prev)) {
      const direction = price > prev ? 'up' : 'down';
      setFlashState(direction);

      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      timeoutRef.current = setTimeout(() => {
        setFlashState(null);
      }, 1000);
    }

    prevPriceRef.current = price;

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [price, previousPrice, autoDetect, change]);

  if (!Number.isFinite(price)) {
    return <span style={style}>—</span>;
  }

  const activeChange = change || flashState;

  const getStyle = () => {
    const baseStyle = {
      transition: 'background-color 0.3s ease',
      padding: '2px 4px',
      borderRadius: 4,
      display: 'inline-block',
      ...style,
    };

    if (activeChange === 'up') {
      return {
        ...baseStyle,
        animation: 'priceFlashUp 0.6s ease-out',
      };
    } else if (activeChange === 'down') {
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
      <span style={getStyle()} key={activeChange ? `${activeChange}-${Date.now()}` : 'stable'}>
        {prefix}{price.toFixed(decimals)}
      </span>
    </>
  );
}

/**
 * Price change indicator with optional arrow and color coding
 */
export function PriceChange({
  value,
  format = 'percent',
  showArrow = false,
  showSign = true,
  size = 'medium',
  style = {},
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span style={{ color: '#9ca3af', ...style }}>—</span>;
  }

  const isPositive = value > 0;
  const isNegative = value < 0;
  const color = isPositive ? '#22c55e' : isNegative ? '#ef4444' : '#9ca3af';

  const sizeStyles = {
    small: { fontSize: 12 },
    medium: { fontSize: 14 },
    large: { fontSize: 16 },
  };

  const formatValue = () => {
    const absValue = Math.abs(value);
    let formatted;

    if (format === 'percent') {
      formatted = absValue.toFixed(2) + '%';
    } else if (format === 'currency') {
      formatted = '$' + absValue.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    } else {
      formatted = absValue.toFixed(2);
    }

    if (showSign && value !== 0) {
      return (isPositive ? '+' : '-') + formatted;
    }
    return isNegative ? '-' + formatted : formatted;
  };

  return (
    <span
      style={{
        color,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        ...sizeStyles[size],
        ...style,
      }}
    >
      {showArrow && value !== 0 && (
        <span style={{ fontSize: '0.7em' }}>
          {isPositive ? '▲' : '▼'}
        </span>
      )}
      {formatValue()}
    </span>
  );
}

/**
 * Animated counter that smoothly transitions between values
 */
export function AnimatedValue({
  value,
  format = 'currency',
  duration = 500,
  style = {},
}) {
  const [displayValue, setDisplayValue] = useState(value);
  const animationRef = useRef(null);
  const startTimeRef = useRef(null);
  const startValueRef = useRef(value);

  useEffect(() => {
    if (!Number.isFinite(value) || value === displayValue) return;

    const startValue = displayValue;
    const endValue = value;
    const diff = endValue - startValue;

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    startTimeRef.current = performance.now();
    startValueRef.current = startValue;

    const animate = (currentTime) => {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const currentValue = startValueRef.current + diff * easeOut;

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value, duration]);

  const formatDisplayValue = () => {
    if (!Number.isFinite(displayValue)) return '—';

    switch (format) {
      case 'currency':
        return '$' + displayValue.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
      case 'percent':
        return displayValue.toFixed(2) + '%';
      case 'number':
        return Math.round(displayValue).toLocaleString('en-US');
      default:
        return displayValue.toFixed(2);
    }
  };

  return <span style={style}>{formatDisplayValue()}</span>;
}
