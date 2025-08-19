// src/pages/LeagueSetupWizard.jsx
import React, { useState } from 'react';
import '../layout.css';

const MIN_TEAMS = 4, MAX_TEAMS = 16;
const MIN_ROUNDS = 6, MAX_ROUNDS = 12;

const LeagueSetupWizard = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [leagueName, setLeagueName] = useState('');
  const [numTeams, setNumTeams] = useState(8);       // default in range
  const [numRounds, setNumRounds] = useState(8);     // default in range
  const [budgetMode, setBudgetMode] = useState(null);
  const [budgetAmount, setBudgetAmount] = useState('');

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(1, s - 1));

  const handleFinish = async () => {
    // Validate if budget mode requires amount
    if (budgetMode === 'budget' && (!budgetAmount || isNaN(budgetAmount))) return;

    onComplete({
      leagueName: leagueName.trim(),
      numTeams,
      numRounds,
      budgetMode,
      budgetAmount: budgetMode === 'budget' ? Number(budgetAmount) : null,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        {/* STEP 1: Name */}
        {step === 1 && (
          <>
            <h2 className="modal-title">Step 1: Name Your League</h2>
            <input
              type="text"
              value={leagueName}
              onChange={(e) => setLeagueName(e.target.value)}
              placeholder="Enter league name"
              className="modal-input"
            />
            <button
              onClick={next}
              disabled={leagueName.trim().length < 3}
              className={`modal-button ${leagueName.trim().length >= 3 ? 'btn-primary' : 'btn-disabled'}`}
            >
              Continue
            </button>
          </>
        )}

        {/* STEP 2: Teams */}
        {step === 2 && (
          <>
            <h2 className="modal-title">Step 2: Number of Teams</h2>
            <input
              type="number"
              min={MIN_TEAMS}
              max={MAX_TEAMS}
              value={numTeams}
              onChange={(e) => {
                const v = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, Number(e.target.value)));
                setNumTeams(v);
              }}
              className="modal-input"
              placeholder={`${MIN_TEAMS}-${MAX_TEAMS}`}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button
                onClick={next}
                disabled={!(numTeams >= MIN_TEAMS && numTeams <= MAX_TEAMS)}
                className={`modal-button ${
                  numTeams >= MIN_TEAMS && numTeams <= MAX_TEAMS ? 'btn-primary' : 'btn-disabled'
                }`}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* STEP 3: Rounds */}
        {step === 3 && (
          <>
            <h2 className="modal-title">Step 3: Number of Rounds</h2>
            <input
              type="number"
              min={MIN_ROUNDS}
              max={MAX_ROUNDS}
              value={numRounds}
              onChange={(e) => {
                const v = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, Number(e.target.value)));
                setNumRounds(v);
              }}
              className="modal-input"
              placeholder={`${MIN_ROUNDS}-${MAX_ROUNDS}`}
            />
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button
                onClick={next}
                disabled={!(numRounds >= MIN_ROUNDS && numRounds <= MAX_ROUNDS)}
                className={`modal-button ${
                  numRounds >= MIN_ROUNDS && numRounds <= MAX_ROUNDS ? 'btn-primary' : 'btn-disabled'
                }`}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* STEP 4: Draft Mode / Budget */}
        {step === 4 && (
          <>
            <h2 className="modal-title">Step 4: Choose Draft Mode</h2>
            <div className="modal-options">
              <label className="modal-option">
                <input
                  type="radio"
                  value="budget"
                  checked={budgetMode === 'budget'}
                  onChange={(e) => setBudgetMode(e.target.value)}
                />
                Budgeted Draft
              </label>
              <label className="modal-option">
                <input
                  type="radio"
                  value="no-budget"
                  checked={budgetMode === 'no-budget'}
                  onChange={(e) => setBudgetMode(e.target.value)}
                />
                No Budget
              </label>
            </div>

            {budgetMode === 'budget' && (
              <input
                type="number"
                placeholder="Enter budget amount"
                value={budgetAmount}
                onChange={(e) => setBudgetAmount(e.target.value)}
                className="modal-input"
              />
            )}

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button
                onClick={handleFinish}
                disabled={!budgetMode || (budgetMode === 'budget' && (!budgetAmount || isNaN(budgetAmount)))}
                className={`modal-button ${
                  budgetMode && (budgetMode === 'no-budget' || budgetAmount) ? 'btn-confirm' : 'btn-disabled'
                }`}
              >
                Start Draft
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default LeagueSetupWizard;
