import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Reusable empty state component for when there's no data to display.
 *
 * @param {string} icon - Emoji or icon to display
 * @param {string} title - Main heading
 * @param {string} description - Explanatory text
 * @param {string} actionLabel - Button text (optional)
 * @param {string} actionTo - Link destination (optional)
 * @param {function} onAction - Click handler if not using Link (optional)
 * @param {string} secondaryLabel - Secondary button text (optional)
 * @param {string} secondaryTo - Secondary link destination (optional)
 */
export default function EmptyState({
  icon = '📭',
  title = 'Nothing here yet',
  description = '',
  actionLabel = '',
  actionTo = '',
  onAction = null,
  secondaryLabel = '',
  secondaryTo = '',
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
    }}>
      {/* Icon */}
      <div style={{
        fontSize: 48,
        marginBottom: 16,
        opacity: 0.8,
      }}>
        {icon}
      </div>

      {/* Title */}
      <h3 style={{
        color: '#e5e7eb',
        fontSize: 18,
        fontWeight: 600,
        margin: 0,
        marginBottom: 8,
      }}>
        {title}
      </h3>

      {/* Description */}
      {description && (
        <p style={{
          color: '#9ca3af',
          fontSize: 14,
          margin: 0,
          marginBottom: 20,
          maxWidth: 300,
          lineHeight: 1.5,
        }}>
          {description}
        </p>
      )}

      {/* Action buttons */}
      {(actionLabel || secondaryLabel) && (
        <div style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}>
          {actionLabel && actionTo && (
            <Link
              to={actionTo}
              className="btn primary"
              style={{ textDecoration: 'none' }}
            >
              {actionLabel}
            </Link>
          )}
          {actionLabel && onAction && !actionTo && (
            <button className="btn primary" onClick={onAction}>
              {actionLabel}
            </button>
          )}
          {secondaryLabel && secondaryTo && (
            <Link
              to={secondaryTo}
              className="btn"
              style={{ textDecoration: 'none' }}
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Inline empty state for table rows or smaller containers
 */
export function EmptyStateInline({
  icon = '📭',
  message = 'Nothing here yet',
  actionLabel = '',
  onAction = null,
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 12px',
      color: '#9ca3af',
    }}>
      <span style={{ fontSize: 24, marginBottom: 8 }}>{icon}</span>
      <span style={{ fontSize: 14 }}>{message}</span>
      {actionLabel && onAction && (
        <button
          className="btn"
          onClick={onAction}
          style={{ marginTop: 12, fontSize: 13 }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
