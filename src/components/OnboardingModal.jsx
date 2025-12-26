import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from './Button';

const ONBOARDING_KEY = 'stockpile_onboarding_completed';

/**
 * Check if onboarding has been completed for this user
 */
export function hasCompletedOnboarding(userId) {
  if (!userId) return true; // Don't show for unauthenticated users
  const completed = localStorage.getItem(ONBOARDING_KEY);
  if (!completed) return false;
  try {
    const data = JSON.parse(completed);
    return data[userId] === true;
  } catch {
    return false;
  }
}

/**
 * Mark onboarding as completed for a user
 */
export function markOnboardingComplete(userId) {
  if (!userId) return;
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem(ONBOARDING_KEY) || '{}');
  } catch {
    data = {};
  }
  data[userId] = true;
  localStorage.setItem(ONBOARDING_KEY, JSON.stringify(data));
}

/**
 * Multi-step onboarding modal for new users
 * @param {string} userId - User ID for tracking completion
 * @param {function} onComplete - Callback when modal is closed
 * @param {boolean} isHelpMode - If true, acts as a help guide (doesn't mark complete, shows close button)
 */
export default function OnboardingModal({ userId, onComplete, isHelpMode = false }) {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [isVisible, setIsVisible] = useState(true);

  // Close modal and optionally mark complete
  const handleComplete = (destination = null) => {
    // Only mark complete if not in help mode
    if (!isHelpMode && userId) {
      markOnboardingComplete(userId);
    }
    setIsVisible(false);
    if (onComplete) onComplete();
    if (destination) navigate(destination);
  };

  // Close without navigating (for help mode)
  const handleClose = () => {
    setIsVisible(false);
    if (onComplete) onComplete();
  };

  // Skip onboarding
  const handleSkip = () => {
    if (isHelpMode) {
      handleClose();
    } else {
      handleComplete();
    }
  };

  if (!isVisible) return null;

  const steps = [
    // Step 0: Welcome
    {
      icon: '🚀',
      title: 'Welcome to Stockpile!',
      description: 'Compete with friends to build the best stock portfolio. Draft stocks, make trades, and climb the leaderboard.',
      primaryAction: { label: 'Get Started', onClick: () => setStep(1) },
      secondaryAction: null,
    },
    // Step 1: Link Broker
    {
      icon: '🔗',
      title: 'Connect Your Broker',
      description: 'We use Alpaca for paper trading — no real money required. Link your account to enable trading features.',
      primaryAction: { label: 'Link Alpaca Account', onClick: () => handleComplete('/profile') },
      secondaryAction: { label: 'Skip for now', onClick: () => setStep(2) },
      note: 'You can always connect later from your Profile page.',
    },
    // Step 2: Join League
    {
      icon: '🏆',
      title: 'Join a League',
      description: 'Leagues are where the competition happens. Create your own or join an existing one with an invite code.',
      primaryAction: { label: 'Browse Leagues', onClick: () => handleComplete('/leagues') },
      secondaryAction: { label: 'I\'ll do this later', onClick: () => setStep(3) },
    },
    // Step 3: Ready
    {
      icon: '✅',
      title: 'You\'re All Set!',
      description: 'Head to your dashboard to see your leagues, track your portfolio, and start drafting stocks.',
      primaryAction: { label: 'Go to Dashboard', onClick: () => handleComplete('/') },
      secondaryAction: null,
    },
  ];

  const currentStep = steps[step];

  return (
    <div
      onClick={isHelpMode ? handleClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
        cursor: isHelpMode ? 'pointer' : 'default',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          background: 'linear-gradient(145deg, #1a1f2e 0%, #151920 100%)',
          border: '1px solid #2a3040',
          borderRadius: 16,
          padding: 32,
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          animation: 'modalFadeIn 0.3s ease-out',
          cursor: 'default',
        }}
      >
        {/* Close button (always visible in help mode, or on later steps) */}
        {(isHelpMode || step > 0) && (
          <button
            onClick={handleClose}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              background: 'rgba(255, 255, 255, 0.1)',
              border: 'none',
              borderRadius: 8,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#9ca3af',
              fontSize: 18,
              transition: 'background 0.2s',
            }}
            onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.2)'}
            onMouseLeave={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.1)'}
          >
            ×
          </button>
        )}
        {/* Progress indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          {steps.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: idx === step ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: idx <= step ? '#3b82f6' : '#2a3040',
                transition: 'all 0.3s ease',
              }}
            />
          ))}
        </div>

        {/* Icon */}
        <div style={{ textAlign: 'center', fontSize: 56, marginBottom: 16 }}>
          {currentStep.icon}
        </div>

        {/* Title */}
        <h2
          style={{
            color: '#fff',
            fontSize: 24,
            fontWeight: 700,
            textAlign: 'center',
            margin: 0,
            marginBottom: 12,
          }}
        >
          {currentStep.title}
        </h2>

        {/* Description */}
        <p
          style={{
            color: '#9ca3af',
            fontSize: 15,
            textAlign: 'center',
            margin: 0,
            marginBottom: 24,
            lineHeight: 1.6,
          }}
        >
          {currentStep.description}
        </p>

        {/* Note (optional) */}
        {currentStep.note && (
          <p
            style={{
              color: '#6b7280',
              fontSize: 13,
              textAlign: 'center',
              margin: 0,
              marginBottom: 20,
              fontStyle: 'italic',
            }}
          >
            {currentStep.note}
          </p>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Button
            variant="primary"
            fullWidth
            size="large"
            onClick={currentStep.primaryAction.onClick}
          >
            {currentStep.primaryAction.label}
          </Button>

          {currentStep.secondaryAction && (
            <Button
              variant="ghost"
              fullWidth
              onClick={currentStep.secondaryAction.onClick}
              style={{ color: '#6b7280' }}
            >
              {currentStep.secondaryAction.label}
            </Button>
          )}
        </div>

        {/* Skip link (only on step 0) */}
        {step === 0 && (
          <button
            onClick={handleSkip}
            style={{
              display: 'block',
              margin: '20px auto 0',
              background: 'none',
              border: 'none',
              color: '#4b5563',
              fontSize: 13,
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Skip onboarding
          </button>
        )}
      </div>

      <style>{`
        @keyframes modalFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
