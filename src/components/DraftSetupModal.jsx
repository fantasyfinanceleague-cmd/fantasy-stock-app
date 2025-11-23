// src/components/DraftSetupModal.jsx
import React, { useState } from 'react';

/**
 * DraftSetupModal component
 * Shows options when draft doesn't have enough members
 */
export default function DraftSetupModal({
  show,
  onClose,
  leagueName,
  currentMemberCount,
  minRequired,
  humanCount,
  onFillWithBots,
  onChangeMinimum,
}) {
  const [customMin, setCustomMin] = useState(minRequired);
  const [showMinInput, setShowMinInput] = useState(false);
  const [filling, setFilling] = useState(false);

  if (!show) return null;

  const botsNeeded = minRequired - currentMemberCount;
  const canReduceMin = humanCount >= 2; // Need at least 2 humans for a draft

  async function handleFillWithBots() {
    setFilling(true);
    await onFillWithBots(botsNeeded);
    setFilling(false);
  }

  function handleChangeMinimum() {
    if (customMin >= 2 && customMin <= currentMemberCount) {
      onChangeMinimum(customMin);
    }
  }

  return (
    <div
      className="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000
      }}
    >
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1f2937',
          color: '#fff',
          borderRadius: 12,
          width: 'min(500px, 92vw)',
          padding: 24,
          position: 'relative'
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            background: 'transparent',
            border: 'none',
            color: '#9ca3af',
            fontSize: 22,
            cursor: 'pointer'
          }}
        >
          ×
        </button>

        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Draft Setup</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          <strong>{leagueName}</strong> needs at least {minRequired} members to start.
        </p>

        <div style={{
          background: '#111827',
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
          marginBottom: 20
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="muted">Current members:</span>
            <span>{currentMemberCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="muted">Human players:</span>
            <span>{humanCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span className="muted">Bot players:</span>
            <span>{currentMemberCount - humanCount}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted">Required minimum:</span>
            <span>{minRequired}</span>
          </div>
        </div>

        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Choose an option:</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Option 1: Wait */}
          <button
            className="btn"
            onClick={onClose}
            style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: '12px 16px' }}
          >
            <div>
              <strong>Wait for more players</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                Invite others to join before starting the draft
              </div>
            </div>
          </button>

          {/* Option 2: Fill with bots */}
          {botsNeeded > 0 && (
            <button
              className="btn primary"
              onClick={handleFillWithBots}
              disabled={filling}
              style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: '12px 16px' }}
            >
              <div>
                <strong>{filling ? 'Adding bots...' : `Fill with ${botsNeeded} bot${botsNeeded > 1 ? 's' : ''}`}</strong>
                <div style={{ fontSize: 13, marginTop: 2, opacity: 0.9 }}>
                  Add AI players to reach the minimum and start now
                </div>
              </div>
            </button>
          )}

          {/* Option 3: Change minimum */}
          {canReduceMin && currentMemberCount >= 2 && (
            <div style={{
              border: '1px solid #374151',
              borderRadius: 8,
              padding: 12
            }}>
              {!showMinInput ? (
                <button
                  className="btn"
                  onClick={() => setShowMinInput(true)}
                  style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left', padding: '8px 12px' }}
                >
                  <div>
                    <strong>Change minimum requirement</strong>
                    <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                      Lower the minimum to start with fewer players
                    </div>
                  </div>
                </button>
              ) : (
                <div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
                    New minimum (2 - {currentMemberCount}):
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="number"
                      min={2}
                      max={currentMemberCount}
                      value={customMin}
                      onChange={(e) => setCustomMin(Number(e.target.value))}
                      style={{
                        flex: 1,
                        background: '#111827',
                        border: '1px solid #374151',
                        borderRadius: 6,
                        padding: '8px 12px',
                        color: '#fff'
                      }}
                    />
                    <button
                      className="btn primary"
                      onClick={handleChangeMinimum}
                      disabled={customMin < 2 || customMin > currentMemberCount}
                    >
                      Apply
                    </button>
                    <button
                      className="btn"
                      onClick={() => setShowMinInput(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
