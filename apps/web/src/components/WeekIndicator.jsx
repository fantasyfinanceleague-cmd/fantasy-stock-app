// src/components/WeekIndicator.jsx
import React from 'react';
import { getWeekStatus, getCountdownMessage } from '../utils/weekStatus';

/**
 * WeekIndicator component
 * Displays current week number with status badges and countdown
 *
 * @param {Object} league - League object with current_week, num_weeks
 * @param {Object} matchup - Current matchup object (optional)
 * @param {boolean} showCountdown - Whether to show the countdown message
 * @param {string} size - 'small' | 'medium' | 'large'
 */
export default function WeekIndicator({
  league,
  matchup,
  showCountdown = true,
  size = 'medium'
}) {
  if (!league) return null;

  const weekStatus = getWeekStatus(league, matchup);
  const countdownMessage = getCountdownMessage(weekStatus);

  const {
    currentWeek,
    numWeeks,
    status,
    isHoliday,
    holidayName
  } = weekStatus;

  // Size configurations
  const sizes = {
    small: { weekFont: 14, badgeFont: 10, countdownFont: 11, gap: 6 },
    medium: { weekFont: 16, badgeFont: 11, countdownFont: 12, gap: 8 },
    large: { weekFont: 20, badgeFont: 12, countdownFont: 14, gap: 10 }
  };

  const sizeConfig = sizes[size] || sizes.medium;

  // Badge styles based on status
  const getBadgeStyle = () => {
    switch (status) {
      case 'final':
        return {
          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
          color: '#fff',
          text: 'Final'
        };
      case 'active':
        return {
          background: 'rgba(239, 68, 68, 0.15)',
          color: '#ef4444',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          text: 'Live',
          pulse: true
        };
      case 'pending_results':
        return {
          background: 'rgba(59, 130, 246, 0.15)',
          color: '#60a5fa',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          text: 'Pending'
        };
      case 'season_complete':
        return {
          background: 'linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)',
          color: '#451a03',
          text: 'Complete'
        };
      default:
        return null;
    }
  };

  const badgeStyle = getBadgeStyle();

  return (
    <>
      <style>{`
        @keyframes weekLivePulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', gap: sizeConfig.gap }}>
        {/* Week number with badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: sizeConfig.gap }}>
          <span
            style={{
              fontSize: sizeConfig.weekFont,
              fontWeight: 700,
              color: '#fff'
            }}
          >
            Week {currentWeek}
            {numWeeks > 0 && (
              <span style={{ color: '#9ca3af', fontWeight: 400 }}>
                {' '}of {numWeeks}
              </span>
            )}
          </span>

          {/* Status badge */}
          {badgeStyle && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: sizeConfig.badgeFont,
                fontWeight: 600,
                background: badgeStyle.background,
                color: badgeStyle.color,
                border: badgeStyle.border || 'none'
              }}
            >
              {/* Pulsing dot for live status */}
              {badgeStyle.pulse && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: badgeStyle.color,
                    animation: 'weekLivePulse 2s ease-in-out infinite'
                  }}
                />
              )}
              {badgeStyle.text}
            </span>
          )}
        </div>

        {/* Countdown message */}
        {showCountdown && countdownMessage && (
          <div
            style={{
              fontSize: sizeConfig.countdownFont,
              color: isHoliday ? '#fbbf24' : '#9ca3af',
              background: isHoliday ? 'rgba(251, 191, 36, 0.1)' : 'transparent',
              padding: isHoliday ? '4px 8px' : 0,
              borderRadius: 4,
              display: 'inline-block'
            }}
          >
            {countdownMessage}
          </div>
        )}
      </div>
    </>
  );
}
