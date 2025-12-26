import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Reusable button component with built-in loading state.
 * Shows an inline spinner when loading, disables interaction, and prevents double-clicks.
 *
 * @param {string} variant - 'primary' | 'purple' | 'danger' | 'ghost' | default (gray)
 * @param {boolean} loading - Shows spinner and disables button when true
 * @param {boolean} disabled - Disables the button
 * @param {string} to - If provided, renders as a Link instead of button
 * @param {string} loadingText - Optional text to show while loading (defaults to children)
 * @param {boolean} fullWidth - Makes button full width
 * @param {string} size - 'small' | 'medium' | 'large'
 * @param {React.ReactNode} children - Button content
 */
export default function Button({
  variant = 'default',
  loading = false,
  disabled = false,
  to = '',
  loadingText,
  fullWidth = false,
  size = 'medium',
  onClick,
  children,
  style = {},
  className = '',
  type = 'button',
  ...props
}) {
  const isDisabled = disabled || loading;

  // Size styles
  const sizeStyles = {
    small: { height: 32, padding: '0 12px', fontSize: 13 },
    medium: { height: 38, padding: '0 14px', fontSize: 14 },
    large: { height: 44, padding: '0 18px', fontSize: 15 },
  };

  // Variant styles
  const variantStyles = {
    default: {
      background: '#1a202b',
      borderColor: '#2a3040',
      color: '#e7ecf5',
    },
    primary: {
      background: '#2d6dfd',
      borderColor: '#2d6dfd',
      color: '#fff',
    },
    purple: {
      background: '#8657ff',
      borderColor: '#8657ff',
      color: '#fff',
    },
    danger: {
      background: '#b91c1c',
      borderColor: '#b91c1c',
      color: '#fff',
    },
    ghost: {
      background: 'transparent',
      borderColor: 'transparent',
      color: '#e7ecf5',
    },
  };

  const baseStyles = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    border: '1px solid',
    cursor: isDisabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'background-color 0.2s ease, opacity 0.2s ease',
    opacity: isDisabled ? 0.6 : 1,
    width: fullWidth ? '100%' : 'auto',
    ...sizeStyles[size] || sizeStyles.medium,
    ...variantStyles[variant] || variantStyles.default,
    ...style,
  };

  // Spinner component
  const Spinner = () => (
    <span
      style={{
        width: size === 'small' ? 12 : 14,
        height: size === 'small' ? 12 : 14,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTopColor: 'currentColor',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        flexShrink: 0,
      }}
    />
  );

  const content = (
    <>
      {loading && <Spinner />}
      <span>{loading && loadingText ? loadingText : children}</span>
    </>
  );

  // Render as Link if 'to' prop is provided
  if (to && !isDisabled) {
    return (
      <Link
        to={to}
        style={baseStyles}
        className={className}
        {...props}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={baseStyles}
      className={className}
      {...props}
    >
      {content}
    </button>
  );
}

/**
 * Icon button variant - square button for icons
 */
export function IconButton({
  loading = false,
  disabled = false,
  onClick,
  children,
  size = 'medium',
  variant = 'default',
  style = {},
  ...props
}) {
  const isDisabled = disabled || loading;

  const sizeMap = {
    small: 32,
    medium: 38,
    large: 44,
  };

  const px = sizeMap[size] || sizeMap.medium;

  const variantStyles = {
    default: { background: '#1a202b', borderColor: '#2a3040', color: '#e7ecf5' },
    primary: { background: '#2d6dfd', borderColor: '#2d6dfd', color: '#fff' },
    danger: { background: '#b91c1c', borderColor: '#b91c1c', color: '#fff' },
    ghost: { background: 'transparent', borderColor: 'transparent', color: '#e7ecf5' },
  };

  return (
    <button
      onClick={isDisabled ? undefined : onClick}
      disabled={isDisabled}
      style={{
        width: px,
        height: px,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        border: '1px solid',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'background-color 0.2s ease, opacity 0.2s ease',
        opacity: isDisabled ? 0.6 : 1,
        ...variantStyles[variant] || variantStyles.default,
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <span
          style={{
            width: px * 0.4,
            height: px * 0.4,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: 'currentColor',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
      ) : (
        children
      )}
    </button>
  );
}
