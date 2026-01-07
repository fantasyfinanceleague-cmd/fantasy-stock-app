// src/pages/LeagueSetupWizard.jsx
import React, { useState } from 'react';
import '../layout.css';
import { validateLeagueName } from '../utils/contentModeration';

const MIN_TEAMS = 4, MAX_TEAMS = 16;
const MIN_ROUNDS = 6, MAX_ROUNDS = 12;

const DURATION_OPTIONS = [
  { label: '1 Week', days: 7 },
  { label: '1 Month', days: 30 },
  { label: '3 Months', days: 90 },
  { label: '6 Months', days: 180 },
  { label: '1 Year', days: 365 },
];

const LeagueSetupWizard = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [leagueName, setLeagueName] = useState('');
  const [nameError, setNameError] = useState('');
  const [numTeams, setNumTeams] = useState(8);
  const [numRounds, setNumRounds] = useState(8);
  const [leagueType, setLeagueType] = useState('duration');
  const [duration, setDuration] = useState(30);
  const [numWeeks, setNumWeeks] = useState(7);      // default for 8 teams
  const [playoffTeams, setPlayoffTeams] = useState(4); // 2, 4, or 8 teams
  const [budgetMode, setBudgetMode] = useState(null);
  const [budgetAmount, setBudgetAmount] = useState('');

  const minWeeks = numTeams - 1;

  // Calculate valid playoff team options based on league size
  // Playoff teams must be strictly less than total teams (can't have everyone in playoffs)
  const getPlayoffOptions = () => {
    const allOptions = [2, 4, 8];
    const validOptions = allOptions.filter(o => o < numTeams);
    // Always need at least one option - minimum 2 teams for finals
    return validOptions.length > 0 ? validOptions : [2];
  };

  // Update playoffTeams when numTeams changes if current value is invalid
  const validPlayoffOptions = getPlayoffOptions();
  if (!validPlayoffOptions.includes(playoffTeams)) {
    setPlayoffTeams(validPlayoffOptions[validPlayoffOptions.length - 1] || 2);
  }

  const next = () => setStep((s) => s + 1);
  const back = () => setStep((s) => Math.max(1, s - 1));

  const handleFinish = async () => {
    if (budgetMode === 'budget' && (!budgetAmount || isNaN(budgetAmount))) return;

    onComplete({
      leagueName: leagueName.trim(),
      numTeams,
      numRounds,
      leagueType,
      duration: leagueType === 'duration' ? duration : null,
      numWeeks: leagueType === 'matchup' ? Math.max(numWeeks, minWeeks) : null,
      playoffTeams: leagueType === 'matchup' ? playoffTeams : null,
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
              onChange={(e) => {
                setLeagueName(e.target.value);
                setNameError('');
              }}
              placeholder="Enter league name"
              className="modal-input"
            />
            {nameError && (
              <p style={{ color: '#ef4444', fontSize: 14, margin: '8px 0 0' }}>{nameError}</p>
            )}
            <button
              onClick={() => {
                const check = validateLeagueName(leagueName.trim());
                if (!check.isValid) {
                  setNameError(check.reason || 'League name is not allowed');
                  return;
                }
                next();
              }}
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
                // Update numWeeks minimum when teams change
                setNumWeeks(Math.max(numWeeks, v - 1));
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

        {/* STEP 4: League Type */}
        {step === 4 && (
          <>
            <h2 className="modal-title">Step 4: League Type</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              Choose how your league will run:
            </p>
            <div className="modal-options">
              <label className="modal-option">
                <input
                  type="radio"
                  value="duration"
                  checked={leagueType === 'duration'}
                  onChange={() => setLeagueType('duration')}
                />
                <div>
                  <strong>Duration-based</strong>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                    League runs for a set time period. Winner is whoever has the best portfolio performance.
                  </p>
                </div>
              </label>
              <label className="modal-option">
                <input
                  type="radio"
                  value="matchup"
                  checked={leagueType === 'matchup'}
                  onChange={() => setLeagueType('matchup')}
                />
                <div>
                  <strong>Matchup-based (Fantasy Football style)</strong>
                  <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                    Weekly head-to-head matchups. Winner determined by win/loss record.
                  </p>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button onClick={next} className="modal-button btn-primary">
                Continue
              </button>
            </div>
          </>
        )}

        {/* STEP 5: Duration OR Weeks (depending on league type) */}
        {step === 5 && leagueType === 'duration' && (
          <>
            <h2 className="modal-title">Step 5: League Duration</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              How long should the league competition run after the draft completes?
            </p>
            <div className="modal-options">
              {DURATION_OPTIONS.map((opt) => (
                <label key={opt.days} className="modal-option">
                  <input
                    type="radio"
                    value={opt.days}
                    checked={duration === opt.days}
                    onChange={() => setDuration(opt.days)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button onClick={next} className="modal-button btn-primary">
                Continue
              </button>
            </div>
          </>
        )}

        {step === 5 && leagueType === 'matchup' && (
          <>
            <h2 className="modal-title">Step 5: Number of Weeks</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              How many weeks should the season run?
            </p>
            <input
              type="number"
              min={minWeeks}
              value={numWeeks}
              onChange={(e) => setNumWeeks(Math.max(minWeeks, Number(e.target.value) || minWeeks))}
              className="modal-input"
              placeholder={`Minimum ${minWeeks} weeks`}
            />
            <p className="muted" style={{ marginTop: 8, fontSize: '0.85rem' }}>
              Minimum {minWeeks} weeks for round robin (each team plays each other once).
              <br />
              Monday = trade day, Tuesday-Friday = matchup week.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button onClick={next} className="modal-button btn-primary">
                Continue
              </button>
            </div>
          </>
        )}

        {/* STEP 6: Playoff Teams (matchup leagues only) */}
        {step === 6 && leagueType === 'matchup' && (
          <>
            <h2 className="modal-title">Step 6: Playoff Format</h2>
            <p className="muted" style={{ marginTop: 0, marginBottom: 16 }}>
              How many teams make the playoffs?
            </p>
            <div className="modal-options">
              {validPlayoffOptions.map((opt) => {
                const roundsText = opt === 2 ? 'Finals only'
                  : opt === 4 ? 'Semifinals + Finals'
                  : 'Quarters + Semis + Finals';
                return (
                  <label key={opt} className="modal-option">
                    <input
                      type="radio"
                      value={opt}
                      checked={playoffTeams === opt}
                      onChange={() => setPlayoffTeams(opt)}
                    />
                    <div>
                      <strong>{opt} Teams</strong>
                      <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
                        {roundsText}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: '0.8rem' }}>
              Top {playoffTeams} teams by record advance to playoffs at the end of the regular season.
              Ties broken by head-to-head record, then total points.
            </p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button onClick={back} className="modal-button" style={{ background: '#374151', color: '#fff' }}>
                Back
              </button>
              <button onClick={next} className="modal-button btn-primary">
                Continue
              </button>
            </div>
          </>
        )}

        {/* STEP 6 (duration) / 7 (matchup): Draft Mode / Budget */}
        {((step === 6 && leagueType === 'duration') || (step === 7 && leagueType === 'matchup')) && (
          <>
            <h2 className="modal-title">Step {leagueType === 'matchup' ? '7' : '6'}: Choose Draft Mode</h2>
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
