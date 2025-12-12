// src/pages/Leagues.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useLeagues from '../hooks/useLeagues';

function SectionHeader({ title, icon = null, right = null }) {
  return (
    <div className="section-header">
      <h3>{title}</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {right}
        {icon ? <div className="section-icon" aria-hidden>{icon}</div> : null}
      </div>
    </div>
  );
}

function toInputDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Leagues() {
  const nav = useNavigate();
  const {
    myLeagues,
    managedLeagues,
    pendingInvites,
    loading,
    error,
    createLeague,
    updateLeague,
    inviteToLeague,
    leaveLeague,
    deleteLeague,
  } = useLeagues();

  // Create
  const [leagueName, setLeagueName] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [budgetMode, setBudgetMode] = useState('budget');      // NEW
  const [salaryCap, setSalaryCap] = useState('100000');
  const [participants, setParticipants] = useState(12);
  const [stocksPerTeam, setStocksPerTeam] = useState(6);       // NEW
  const capDisabled = budgetMode === 'no-budget';              // NEW

  // Update
  const [selectedLeagueForUpdate, setSelectedLeagueForUpdate] = useState('');
  const [updateDraftDate, setUpdateDraftDate] = useState('');
  const [updateBudgetMode, setUpdateBudgetMode] = useState('budget'); // NEW
  const [updateSalaryCap, setUpdateSalaryCap] = useState('');
  const [updateParticipants, setUpdateParticipants] = useState('');
  const [updateRounds, setUpdateRounds] = useState(6);         // NEW
  const capUpdateDisabled = updateBudgetMode === 'no-budget';  // NEW

  // Invite
  const [selectedLeagueForInvite, setSelectedLeagueForInvite] = useState('');
  const [inviteIdentifier, setInviteIdentifier] = useState('');

  // Helpers
  // Helpers
  const clampParticipants = (n) => Math.max(4, Math.min(16, Number(n) || 4));
  const clampRounds = (n) => Math.max(1, Math.min(12, Number(n) || 1)); // <= NEW

  // Search/filter (polish)
  const [filter, setFilter] = useState('');
  const filteredLeagues = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return myLeagues;
    return myLeagues.filter((l) => l.name?.toLowerCase().includes(q));
  }, [myLeagues, filter]);

  const selectedUpdateLeagueObj = useMemo(
    () => managedLeagues.find((l) => l.id === selectedLeagueForUpdate),
    [managedLeagues, selectedLeagueForUpdate]
  );

  // Check if draft has started or completed - disable editing if so
  const isDraftLocked = selectedUpdateLeagueObj?.draft_status === 'in_progress' ||
                        selectedUpdateLeagueObj?.draft_status === 'completed';

  useEffect(() => {
    if (managedLeagues.length) {
      if (!selectedLeagueForUpdate) setSelectedLeagueForUpdate(managedLeagues[0].id);
      if (!selectedLeagueForInvite) setSelectedLeagueForInvite(managedLeagues[0].id);
    }
  }, [managedLeagues, selectedLeagueForInvite, selectedLeagueForUpdate]);

  useEffect(() => {
    if (selectedUpdateLeagueObj) {
      setUpdateDraftDate(toInputDateTime(selectedUpdateLeagueObj.draft_date));
      setUpdateBudgetMode(selectedUpdateLeagueObj.budget_mode ?? 'budget');
      // Use budget_amount if available, otherwise fall back to salary_cap_limit
      setUpdateSalaryCap(selectedUpdateLeagueObj.budget_amount ?? selectedUpdateLeagueObj.salary_cap_limit ?? '');
      setUpdateParticipants(selectedUpdateLeagueObj.num_participants ?? '');
      setUpdateRounds(selectedUpdateLeagueObj.num_rounds ?? 6);
    } else {
      setUpdateDraftDate('');
      setUpdateBudgetMode('budget');
      setUpdateSalaryCap('');
      setUpdateParticipants('');
      setUpdateRounds(6);
    }
  }, [selectedUpdateLeagueObj]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!leagueName.trim()) return;

    await createLeague({
      name: leagueName.trim(),
      draftDate: draftDate ? new Date(draftDate).toISOString() : null,
      budgetMode,
      salaryCapLimit: capDisabled ? null : Number(salaryCap || 0),
      budgetAmount: capDisabled ? null : Number(salaryCap || 0), // Pass budget amount
      numParticipants: clampParticipants(participants),
      numRounds: Number(stocksPerTeam),
    });

    setLeagueName('');
    setDraftDate('');
    setBudgetMode('budget');
    setSalaryCap('100000');
    setParticipants(12);
    setStocksPerTeam(6);
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!selectedLeagueForUpdate) return;

    const budgetAmt = capUpdateDisabled
      ? null
      : (updateSalaryCap === '' ? null : Number(updateSalaryCap));

    const patch = {
      draft_date: updateDraftDate ? new Date(updateDraftDate).toISOString() : null,
      budget_mode: updateBudgetMode,
      salary_cap_limit: budgetAmt,
      budget_amount: budgetAmt, // Also update budget_amount
      num_participants:
        updateParticipants === '' ? null : clampParticipants(updateParticipants),
      num_rounds: Number(updateRounds),
    };
    await updateLeague(selectedLeagueForUpdate, patch);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!selectedLeagueForInvite || !inviteIdentifier.trim()) return;
    const code = await inviteToLeague(selectedLeagueForInvite, inviteIdentifier.trim());
    const link = `${window.location.origin}/join/${code}`;
    await navigator.clipboard?.writeText(link).catch(() => { });
    alert(`Invite created.\nLink copied:\n${link}`);
    setInviteIdentifier('');
  };

  const copyInviteForLeague = async (lg) => {
    const link = `${window.location.origin}/join/${lg.invite_code}`;
    await navigator.clipboard?.writeText(link).catch(() => { });
    alert(`Invite link copied:\n${link}`);
  };

  // in Leagues.jsx
  const setActiveAndGoDraft = (lg) => {
    localStorage.setItem('activeLeagueId', lg.id);   // keep this for convenience
    nav(`/draft/${lg.id}`);                          // ← go straight to /draft/:leagueId
  };

  return (
    <div className="page leagues-page">
      <div className="leagues-container">
        <h1 className="leagues-title">League Management</h1>
        <p className="leagues-sub">Create and manage your fantasy stock leagues</p>
        {error ? <p className="muted">Error: {error}</p> : null}

        {/* Row 1: Create | Update */}
        <div className="leagues-top">
          {/* Create */}
          <div className="card">
            <SectionHeader title="Create New League" icon="🔔" />
            <form className="form" onSubmit={handleCreate}>
              <div className="form-row">
                <label>League Name</label>
                <input
                  type="text"
                  placeholder="Enter league name"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                />
              </div>

              <div className="form-row">
                <label>Draft Date</label>
                <input
                  type="datetime-local"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                />
              </div>

              <div className="form-row inline">
                <div>
                  <label>Budget Mode</label>
                  <select
                    value={budgetMode}
                    onChange={(e) => setBudgetMode(e.target.value)}
                  >
                    <option value="budget">Budget</option>
                    <option value="no-budget">No budget</option>
                  </select>
                </div>

                <div>
                  <label>Salary Cap Limit ($)</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    placeholder="100000"
                    value={salaryCap}
                    onChange={(e) => setSalaryCap(e.target.value)}
                    disabled={capDisabled}
                  />
                  {capDisabled && <small className="muted">Disabled in no-budget mode</small>}
                </div>
              </div>

              <div className="form-row inline">
                <div>
                  <label>Number of Participants</label>
                  <input
                    type="number"
                    min="4"
                    max="16"
                    step="1"
                    value={participants}
                    onChange={(e) => setParticipants(clampParticipants(e.target.value))}
                    onBlur={(e) => setParticipants(clampParticipants(e.target.value))}
                  />
                </div>

                <div>
                  <label>Stocks per Team</label>
                  <input
                    type="number"
                    min="1"
                    max="12"                      // <= NEW
                    step="1"
                    value={stocksPerTeam}
                    onChange={(e) => setStocksPerTeam(clampRounds(e.target.value))}   // <= NEW
                    onBlur={(e) => setStocksPerTeam(clampRounds(e.target.value))}     // <= NEW (extra safety)
                  />

                </div>
              </div>

              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'Creating…' : 'Create League'}
              </button>
            </form>
          </div>

          {/* Update */}
          <div className="card">
            <SectionHeader title="Update League Settings" icon="⚙️" />
            <form className="form" onSubmit={handleUpdate}>
              <div className="form-row">
                <label>Select League</label>
                <select
                  value={selectedLeagueForUpdate}
                  onChange={(e) => setSelectedLeagueForUpdate(e.target.value)}
                >
                  {!managedLeagues.length && <option value="">(No managed leagues)</option>}
                  {managedLeagues.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.draft_status === 'completed' ? ' (Completed)' : l.draft_status === 'in_progress' ? ' (In Progress)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {isDraftLocked && (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(245, 158, 11, 0.1)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 8,
                  color: '#f59e0b',
                  fontSize: '0.9rem',
                  marginBottom: 16
                }}>
                  {selectedUpdateLeagueObj?.draft_status === 'completed'
                    ? '🏁 This league\'s draft has been completed. Settings cannot be changed.'
                    : '⏳ This league\'s draft is in progress. Settings cannot be changed.'}
                </div>
              )}

              <div className="form-row">
                <label>Draft Date</label>
                <input
                  type="datetime-local"
                  value={updateDraftDate}
                  onChange={(e) => setUpdateDraftDate(e.target.value)}
                  disabled={isDraftLocked}
                />
              </div>

              <div className="form-row">
                <label>Budget Mode</label>
                <select
                  value={updateBudgetMode}
                  onChange={(e) => setUpdateBudgetMode(e.target.value)}
                  disabled={isDraftLocked}
                >
                  <option value="budget">Budget</option>
                  <option value="no-budget">No budget</option>
                </select>
              </div>

              <div className="form-row">
                <label>Salary Cap Limit ($)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Type here..."
                  value={updateSalaryCap}
                  onChange={(e) => setUpdateSalaryCap(e.target.value)}
                  disabled={capUpdateDisabled || isDraftLocked}
                />
              </div>

              <div className="form-row">
                <label>Number of Participants</label>
                <input
                  type="number"
                  min="4"
                  max="16"
                  step="1"
                  placeholder="Type here..."
                  value={updateParticipants}
                  onChange={(e) => setUpdateParticipants(clampParticipants(e.target.value))}
                  onBlur={(e) => setUpdateParticipants(clampParticipants(e.target.value))}
                  disabled={isDraftLocked}
                />
              </div>

              <div className="form-row">
                <label>Stocks per Team</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  step="1"
                  value={updateRounds}
                  onChange={(e) => setUpdateRounds(clampRounds(e.target.value))}
                  onBlur={(e) => setUpdateRounds(clampRounds(e.target.value))}
                  disabled={isDraftLocked}
                />
              </div>

              <button className="btn purple" type="submit" disabled={loading || isDraftLocked}>
                {loading ? 'Updating…' : isDraftLocked ? 'Locked' : 'Update Settings'}
              </button>
            </form>
          </div>
        </div>

        {/* Row 2: Invite (full width) */}
        <div className="card invite-actions">
          <SectionHeader title="Invite League Members" icon="👥" />
          <form className="form" onSubmit={handleInvite}>
            <div className="form-row inline">
              <div>
                <label>Select League</label>
                <select
                  value={selectedLeagueForInvite}
                  onChange={(e) => setSelectedLeagueForInvite(e.target.value)}
                >
                  {!managedLeagues.length && <option value="">(No managed leagues)</option>}
                  {managedLeagues.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
                </select>
              </div>
              <div>
                <label>Email/Username</label>
                <input
                  type="text"
                  placeholder="Enter email or username"
                  value={inviteIdentifier}
                  onChange={(e) => setInviteIdentifier(e.target.value)}
                />
              </div>
            </div>
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send Invitation'}
            </button>
          </form>

          {selectedLeagueForInvite && pendingInvites[selectedLeagueForInvite]?.length ? (
            <div className="list" style={{ marginTop: 12 }}>
              {pendingInvites[selectedLeagueForInvite].map((inv) => (
                <div key={inv.code} className="league-row">
                  <div className="meta">
                    Pending: {inv.invited_identifier} • {new Date(inv.created_at).toLocaleString()}
                  </div>
                  <div className="actions">
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => {
                        const link = `${window.location.origin}/join/${inv.code}`;
                        navigator.clipboard?.writeText(link);
                      }}
                    >
                      Copy Link
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Row 3: Your Leagues (full width) */}
        <div className="card">
          <SectionHeader
            title="Your Leagues"
            icon="🏆"
            right={
              <>
                <input
                  type="text"
                  placeholder="Search…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <div className="section-icon">🔎</div>
              </>
            }
          />
          <div className="list">
            {filteredLeagues.length === 0 ? (
              <p className="muted">
                {myLeagues.length
                  ? 'No leagues match your search.'
                  : 'You’re not in any leagues yet. Create one above or join with an invite link.'}
              </p>
            ) : (
              filteredLeagues.map((lg) => (
                <div className="league-row" key={lg.id}>
                  <div>
                    <h4>{lg.name}</h4>
                    <div className="meta">
                      Role: {lg.role} • Participants: {lg.num_participants} • Draft:{' '}
                      {lg.draft_date ? new Date(lg.draft_date).toLocaleString() : 'TBD'}
                    </div>
                  </div>
                  <div className="actions">
                    <Link className="btn ghost" to={`/league/${lg.id}`}>Open</Link>
                    <button className="btn ghost" type="button" onClick={() => setActiveAndGoDraft(lg)}>
                      Draft
                    </button>
                    {lg.role === 'commissioner' ? (
                      <>
                        <button className="btn ghost" type="button" onClick={() => copyInviteForLeague(lg)}>
                          Copy Invite
                        </button>
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={async () => {
                            if (confirm(`Delete "${lg.name}"? Members and invites will also be removed.`)) {
                              await deleteLeague?.(lg.id);
                            }
                          }}
                        >
                          Delete
                        </button>
                      </>
                    ) : (
                      <button className="btn ghost" type="button" onClick={() => leaveLeague(lg.id)}>
                        Leave
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
