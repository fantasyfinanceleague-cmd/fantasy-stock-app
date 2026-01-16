// src/components/WeekNavigator.jsx
import React from 'react';

/**
 * WeekNavigator component
 * Arrow-based navigation for browsing matchup weeks
 *
 * @param {number} currentWeek - The league's current week
 * @param {number} selectedWeek - The currently selected/viewed week
 * @param {number} totalWeeks - Total weeks in the season (optional)
 * @param {Function} onWeekChange - Callback when week changes
 * @param {boolean} disabled - Disable all navigation
 */
export default function WeekNavigator({
  currentWeek,
  selectedWeek,
  totalWeeks,
  onWeekChange,
  disabled = false
}) {
  const canGoPrev = selectedWeek > 1 && !disabled;
  const canGoNext = selectedWeek < currentWeek && !disabled;
  const isViewingCurrent = selectedWeek === currentWeek;
  const isViewingPast = selectedWeek < currentWeek;

  const handlePrev = () => {
    if (canGoPrev) {
      onWeekChange(selectedWeek - 1);
    }
  };

  const handleNext = () => {
    if (canGoNext) {
      onWeekChange(selectedWeek + 1);
    }
  };

  // Arrow button style
  const arrowButtonStyle = (enabled) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    border: 'none',
    background: enabled ? 'rgba(59, 130, 246, 0.15)' : 'rgba(107, 114, 128, 0.1)',
    color: enabled ? '#60a5fa' : '#4b5563',
    cursor: enabled ? 'pointer' : 'not-allowed',
    transition: 'all 0.2s ease',
    opacity: enabled ? 1 : 0.5
  });

  // Badge styles
  const getBadgeStyle = () => {
    if (isViewingCurrent) {
      return {
        background: 'rgba(59, 130, 246, 0.15)',
        color: '#60a5fa',
        border: '1px solid rgba(59, 130, 246, 0.3)',
        text: 'Current'
      };
    }
    if (isViewingPast) {
      return {
        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        color: '#fff',
        border: 'none',
        text: 'Final'
      };
    }
    return null;
  };

  const badge = getBadgeStyle();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: 'rgba(17, 24, 39, 0.6)',
        borderRadius: 12,
        border: '1px solid rgba(75, 85, 99, 0.3)'
      }}
    >
      {/* Previous arrow */}
      <button
        onClick={handlePrev}
        disabled={!canGoPrev}
        style={arrowButtonStyle(canGoPrev)}
        aria-label="Previous week"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12.5 15L7.5 10L12.5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Week display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 140,
          justifyContent: 'center'
        }}
      >
        <span
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: '#fff'
          }}
        >
          Week {selectedWeek}
        </span>

        {/* Status badge */}
        {badge && (
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: badge.background,
              color: badge.color,
              border: badge.border
            }}
          >
            {badge.text}
          </span>
        )}
      </div>

      {/* Next arrow */}
      <button
        onClick={handleNext}
        disabled={!canGoNext}
        style={arrowButtonStyle(canGoNext)}
        aria-label="Next week"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M7.5 5L12.5 10L7.5 15"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Total weeks indicator (optional) */}
      {totalWeeks && (
        <span
          style={{
            fontSize: 12,
            color: '#9ca3af',
            marginLeft: 4
          }}
        >
          of {totalWeeks}
        </span>
      )}
    </div>
  );
}
