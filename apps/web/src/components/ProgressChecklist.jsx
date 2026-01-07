import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Progress checklist component for showing user setup progress.
 * Displays a list of tasks with their completion status.
 *
 * @param {string} title - Optional title for the checklist
 * @param {Array} items - Array of { id, label, completed, link? }
 * @param {boolean} showProgress - Show progress bar and percentage
 * @param {boolean} compact - Compact mode for smaller spaces
 */
export default function ProgressChecklist({
  title = 'Getting Started',
  items = [],
  showProgress = true,
  compact = false,
}) {
  const completedCount = items.filter(item => item.completed).length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const isComplete = completedCount === totalCount;

  if (totalCount === 0) return null;

  return (
    <div
      style={{
        background: isComplete
          ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(22, 163, 74, 0.05) 100%)'
          : 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(37, 99, 235, 0.05) 100%)',
        border: `1px solid ${isComplete ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`,
        borderRadius: 12,
        padding: compact ? 12 : 16,
      }}
    >
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: showProgress ? 12 : 8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: compact ? 16 : 20 }}>
            {isComplete ? '🎉' : '📋'}
          </span>
          <span style={{
            color: '#e5e7eb',
            fontWeight: 600,
            fontSize: compact ? 13 : 14,
          }}>
            {title}
          </span>
        </div>
        <span style={{
          color: isComplete ? '#22c55e' : '#3b82f6',
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
        }}>
          {completedCount}/{totalCount}
        </span>
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div style={{
          background: '#1f2937',
          height: 6,
          borderRadius: 3,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          <div
            style={{
              width: `${progressPercent}%`,
              height: '100%',
              background: isComplete
                ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                : 'linear-gradient(90deg, #3b82f6, #2563eb)',
              borderRadius: 3,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      )}

      {/* Checklist items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 6 : 8 }}>
        {items.map((item) => (
          <ChecklistItem
            key={item.id}
            label={item.label}
            completed={item.completed}
            link={item.link}
            compact={compact}
          />
        ))}
      </div>

      {/* Completion message */}
      {isComplete && (
        <div style={{
          marginTop: 12,
          padding: '8px 12px',
          background: 'rgba(34, 197, 94, 0.15)',
          borderRadius: 8,
          textAlign: 'center',
        }}>
          <span style={{ color: '#22c55e', fontSize: 13, fontWeight: 500 }}>
            All done! You're ready to compete.
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Individual checklist item
 */
function ChecklistItem({ label, completed, link, compact }) {
  const content = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: compact ? '6px 8px' : '8px 10px',
        background: completed ? 'rgba(34, 197, 94, 0.08)' : 'rgba(255, 255, 255, 0.03)',
        borderRadius: 8,
        transition: 'background 0.2s ease',
        cursor: link && !completed ? 'pointer' : 'default',
      }}
    >
      {/* Checkbox */}
      <div
        style={{
          width: compact ? 18 : 20,
          height: compact ? 18 : 20,
          borderRadius: '50%',
          border: completed ? 'none' : '2px solid #4b5563',
          background: completed ? '#22c55e' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          transition: 'all 0.2s ease',
        }}
      >
        {completed && (
          <svg
            width={compact ? 10 : 12}
            height={compact ? 10 : 12}
            viewBox="0 0 12 12"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </div>

      {/* Label */}
      <span
        style={{
          color: completed ? '#9ca3af' : '#e5e7eb',
          fontSize: compact ? 13 : 14,
          textDecoration: completed ? 'line-through' : 'none',
          flex: 1,
        }}
      >
        {label}
      </span>

      {/* Arrow for incomplete items with links */}
      {!completed && link && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6b7280"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </div>
  );

  if (link && !completed) {
    return (
      <Link to={link} style={{ textDecoration: 'none' }}>
        {content}
      </Link>
    );
  }

  return content;
}

/**
 * Hook to determine checklist items based on user state
 */
export function useSetupProgress({ hasLeagues, hasHoldings, hasAlpaca }) {
  const items = [
    {
      id: 'account',
      label: 'Create your account',
      completed: true, // If they're seeing this, they've signed up
    },
    {
      id: 'alpaca',
      label: 'Connect Alpaca for trading',
      completed: !!hasAlpaca,
      link: '/profile',
    },
    {
      id: 'league',
      label: 'Join or create a league',
      completed: !!hasLeagues,
      link: '/leagues',
    },
    {
      id: 'draft',
      label: 'Draft your first stock',
      completed: !!hasHoldings,
      link: '/draft',
    },
  ];

  return items;
}
