// src/components/LoadingSpinner.jsx
import React from 'react';

/**
 * Reusable loading spinner component
 * @param {string} size - 'small' (16px), 'medium' (24px), 'large' (40px)
 * @param {string} color - CSS color for the spinner
 */
export function LoadingSpinner({ size = 'medium', color = '#3b82f6' }) {
  const sizes = {
    small: 16,
    medium: 24,
    large: 40,
  };

  const px = sizes[size] || sizes.medium;

  return (
    <div
      style={{
        width: px,
        height: px,
        border: `${Math.max(2, px / 8)}px solid #1f2937`,
        borderTopColor: color,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }}
    />
  );
}

/**
 * Full-page loading state
 * @param {string} message - Loading message to display
 */
export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="page" style={{
      minHeight: '60vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    }}>
      <LoadingSpinner size="large" />
      <p className="muted" style={{ margin: 0 }}>{message}</p>
    </div>
  );
}

/**
 * Card-level loading state
 * @param {string} message - Loading message to display
 */
export function CardLoader({ message = 'Loading...' }) {
  return (
    <div className="card" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 40,
      gap: 12,
    }}>
      <LoadingSpinner size="medium" />
      <p className="muted" style={{ margin: 0 }}>{message}</p>
    </div>
  );
}

/**
 * Inline loading indicator (for buttons, table cells, etc.)
 * @param {string} text - Optional text to show next to spinner
 */
export function InlineLoader({ text }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <LoadingSpinner size="small" />
      {text && <span className="muted">{text}</span>}
    </span>
  );
}

export default LoadingSpinner;
