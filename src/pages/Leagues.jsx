// src/pages/Leagues.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useLeagues from '../hooks/useLeagues';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import { validateLeagueName } from '../utils/contentModeration';

function toInputDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Leagues() {
  const nav = useNavigate();
  const toast = useToast();
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

  // Tab state
  const [activeTab, setActiveTab] = useState('leagues');

  // Create form state
  const [leagueName, setLeagueName] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [budgetMode, setBudgetMode] = useState('budget');
  const [salaryCap, setSalaryCap] = useState('100000');
  const [participants, setParticipants] = useState(12);
  const [stocksPerTeam, setStocksPerTeam] = useState(6);
  const [leagueType, setLeagueType] = useState('duration');
  const [durationDays, setDurationDays] = useState(30);
  const [numWeeks, setNumWeeks] = useState(11);
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const capDisabled = budgetMode === 'no-budget';
  const minWeeks = participants - 1;

  // Calculate valid playoff options
  const getPlayoffOptions = () => {
    const allOptions = [2, 4, 8];
    return allOptions.filter(o => o < participants);
  };
  const validPlayoffOptions = getPlayoffOptions();

  // Update form state
  const [selectedLeagueForUpdate, setSelectedLeagueForUpdate] = useState('');
  const [updateDraftDate, setUpdateDraftDate] = useState('');
  const [updateBudgetMode, setUpdateBudgetMode] = useState('budget');
  const [updateSalaryCap, setUpdateSalaryCap] = useState('');
  const [updateParticipants, setUpdateParticipants] = useState('');
  const [updateRounds, setUpdateRounds] = useState(6);
  const capUpdateDisabled = updateBudgetMode === 'no-budget';

  // Invite state
  const [selectedLeagueForInvite, setSelectedLeagueForInvite] = useState('');
  const [inviteIdentifier, setInviteIdentifier] = useState('');

  // Search filter
  const [filter, setFilter] = useState('');

  // Helpers
  const clampParticipants = (n) => Math.max(4, Math.min(16, Number(n) || 4));
  const clampRounds = (n) => Math.max(1, Math.min(12, Number(n) || 1));

  const filteredLeagues = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return myLeagues;
    return myLeagues.filter((l) => l.name?.toLowerCase().includes(q));
  }, [myLeagues, filter]);

  const selectedUpdateLeagueObj = useMemo(
    () => managedLeagues.find((l) => l.id === selectedLeagueForUpdate),
    [managedLeagues, selectedLeagueForUpdate]
  );

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
      setUpdateSalaryCap(selectedUpdateLeagueObj.budget_amount ?? selectedUpdateLeagueObj.salary_cap_limit ?? '');
      setUpdateParticipants(selectedUpdateLeagueObj.num_participants ?? '');
      setUpdateRounds(selectedUpdateLeagueObj.num_rounds ?? 6);
    }
  }, [selectedUpdateLeagueObj]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!leagueName.trim()) return;

    const contentCheck = validateLeagueName(leagueName.trim());
    if (!contentCheck.isValid) {
      toast.error(contentCheck.reason || 'League name is not allowed');
      return;
    }

    await createLeague({
      name: leagueName.trim(),
      draftDate: draftDate ? new Date(draftDate).toISOString() : null,
      budgetMode,
      salaryCapLimit: capDisabled ? null : Number(salaryCap || 0),
      budgetAmount: capDisabled ? null : Number(salaryCap || 0),
      numParticipants: clampParticipants(participants),
      numRounds: Number(stocksPerTeam),
      leagueType,
      durationDays: leagueType === 'duration' ? Number(durationDays) : null,
      numWeeks: leagueType === 'matchup' ? Math.max(numWeeks, minWeeks) : null,
      playoffTeams: leagueType === 'matchup' ? playoffTeams : null,
    });

    setLeagueName('');
    setDraftDate('');
    setBudgetMode('budget');
    setSalaryCap('100000');
    setParticipants(12);
    setStocksPerTeam(6);
    setLeagueType('duration');
    setDurationDays(30);
    setNumWeeks(11);
    setPlayoffTeams(4);
    setActiveTab('leagues');
    toast.success('League created successfully!');
  };

  const handleUpdate = async (e) => {
    e.preventDefault();
    if (!selectedLeagueForUpdate) return;

    const budgetAmt = capUpdateDisabled ? null : (updateSalaryCap === '' ? null : Number(updateSalaryCap));

    await updateLeague(selectedLeagueForUpdate, {
      draft_date: updateDraftDate ? new Date(updateDraftDate).toISOString() : null,
      budget_mode: updateBudgetMode,
      salary_cap_limit: budgetAmt,
      budget_amount: budgetAmt,
      num_participants: updateParticipants === '' ? null : clampParticipants(updateParticipants),
      num_rounds: Number(updateRounds),
    });
    toast.success('League updated!');
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!selectedLeagueForInvite || !inviteIdentifier.trim()) return;
    const code = await inviteToLeague(selectedLeagueForInvite, inviteIdentifier.trim());
    const link = `${window.location.origin}/join/${code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.success('Invite link copied!');
    setInviteIdentifier('');
  };

  const copyInviteForLeague = async (lg) => {
    const link = `${window.location.origin}/join/${lg.invite_code}`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    toast.success('Invite link copied!');
  };

  const setActiveAndGoDraft = (lg) => {
    localStorage.setItem('activeLeagueId', lg.id);
    nav(`/draft/${lg.id}`);
  };

  const getLeagueStatus = (lg) => {
    if (lg.draft_status === 'completed') return { label: 'Active', color: '#16a34a' };
    if (lg.draft_status === 'in_progress') return { label: 'Drafting', color: '#eab308' };
    return { label: 'Pending', color: '#6b7280' };
  };

  const tabStyle = (isActive) => ({
    padding: '12px 24px',
    background: isActive ? '#3b82f6' : 'transparent',
    border: 'none',
    borderRadius: 8,
    color: isActive ? '#fff' : '#9ca3af',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: 14,
  });

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    background: '#111826',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
  };

  const labelStyle = {
    display: 'block',
    marginBottom: 6,
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: 500,
  };

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: '#fff', margin: '0 0 8px', fontSize: 28, fontWeight: 700 }}>Leagues</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Manage your fantasy stock leagues</p>
      </div>

      {error && <p style={{ color: '#ef4444', marginBottom: 16 }}>Error: {error}</p>}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 24,
        background: '#1a1f2e',
        padding: 6,
        borderRadius: 12,
        width: 'fit-content',
      }}>
        <button style={tabStyle(activeTab === 'leagues')} onClick={() => setActiveTab('leagues')}>
          My Leagues
        </button>
        <button style={tabStyle(activeTab === 'create')} onClick={() => setActiveTab('create')}>
          Create New
        </button>
        {managedLeagues.length > 0 && (
          <button style={tabStyle(activeTab === 'manage')} onClick={() => setActiveTab('manage')}>
            Manage
          </button>
        )}
      </div>

      {/* My Leagues Tab */}
      {activeTab === 'leagues' && (
        <div>
          {/* Search */}
          {myLeagues.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Search leagues..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ ...inputStyle, maxWidth: 300 }}
              />
            </div>
          )}

          {/* League Cards */}
          {filteredLeagues.length === 0 ? (
            myLeagues.length ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
                No leagues match your search.
              </div>
            ) : (
              <EmptyState
                icon="🏆"
                title="No Leagues Yet"
                description="Create your first league to start competing with friends."
                action={
                  <button
                    onClick={() => setActiveTab('create')}
                    style={{
                      background: '#3b82f6',
                      border: 'none',
                      borderRadius: 8,
                      padding: '12px 24px',
                      color: '#fff',
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginTop: 16,
                    }}
                  >
                    Create League
                  </button>
                }
              />
            )
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {filteredLeagues.map((lg) => {
                const status = getLeagueStatus(lg);
                return (
                  <div
                    key={lg.id}
                    style={{
                      background: '#1a1f2e',
                      borderRadius: 12,
                      padding: 20,
                      border: '1px solid #2a3040',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 16,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 600 }}>{lg.name}</h3>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: `${status.color}20`,
                          color: status.color,
                        }}>
                          {status.label}
                        </span>
                        {lg.role === 'commissioner' && (
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 600,
                            background: 'rgba(168, 85, 247, 0.2)',
                            color: '#a855f7',
                          }}>
                            Commissioner
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: '#6b7280', fontSize: 13 }}>
                        <span>👥 {lg.num_participants} teams</span>
                        <span>📅 {lg.draft_date ? new Date(lg.draft_date).toLocaleDateString() : 'Draft TBD'}</span>
                        <span>{lg.league_type === 'matchup' ? '🏈 Matchup' : '📊 Duration'}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link
                        to={`/league/${lg.id}`}
                        style={{
                          padding: '8px 16px',
                          background: '#3b82f6',
                          borderRadius: 6,
                          color: '#fff',
                          textDecoration: 'none',
                          fontSize: 13,
                          fontWeight: 500,
                        }}
                      >
                        View
                      </Link>
                      <button
                        onClick={() => setActiveAndGoDraft(lg)}
                        style={{
                          padding: '8px 16px',
                          background: '#374151',
                          border: 'none',
                          borderRadius: 6,
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                      >
                        Draft
                      </button>
                      {lg.role === 'commissioner' ? (
                        <>
                          <button
                            onClick={() => copyInviteForLeague(lg)}
                            style={{
                              padding: '8px 16px',
                              background: '#374151',
                              border: 'none',
                              borderRadius: 6,
                              color: '#fff',
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Invite
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Delete "${lg.name}"?`)) deleteLeague?.(lg.id);
                            }}
                            style={{
                              padding: '8px 16px',
                              background: 'rgba(239, 68, 68, 0.15)',
                              border: 'none',
                              borderRadius: 6,
                              color: '#ef4444',
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => leaveLeague(lg.id)}
                          style={{
                            padding: '8px 16px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: 'none',
                            borderRadius: 6,
                            color: '#ef4444',
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Leave
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Create League Tab */}
      {activeTab === 'create' && (
        <div style={{ maxWidth: 600 }}>
          <div style={{
            background: '#1a1f2e',
            borderRadius: 12,
            padding: 24,
            border: '1px solid #2a3040',
          }}>
            <h2 style={{ margin: '0 0 20px', color: '#fff', fontSize: 20 }}>Create New League</h2>

            <form onSubmit={handleCreate}>
              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>League Name</label>
                <input
                  type="text"
                  placeholder="Enter league name"
                  value={leagueName}
                  onChange={(e) => setLeagueName(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Draft Date & Time</label>
                <input
                  type="datetime-local"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Teams</label>
                  <input
                    type="number"
                    min="4"
                    max="16"
                    value={participants}
                    onChange={(e) => setParticipants(clampParticipants(e.target.value))}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Stocks per Team</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={stocksPerTeam}
                    onChange={(e) => setStocksPerTeam(clampRounds(e.target.value))}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Budget Mode</label>
                  <select
                    value={budgetMode}
                    onChange={(e) => setBudgetMode(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="budget">Budget</option>
                    <option value="no-budget">No Budget</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Salary Cap ($)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="100000"
                    value={salaryCap}
                    onChange={(e) => setSalaryCap(e.target.value)}
                    disabled={capDisabled}
                    style={{ ...inputStyle, opacity: capDisabled ? 0.5 : 1 }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>League Type</label>
                <select
                  value={leagueType}
                  onChange={(e) => setLeagueType(e.target.value)}
                  style={inputStyle}
                >
                  <option value="duration">Duration-based (best portfolio wins)</option>
                  <option value="matchup">Matchup-based (weekly head-to-head)</option>
                </select>
              </div>

              {leagueType === 'duration' ? (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>League Duration</label>
                  <select
                    value={durationDays}
                    onChange={(e) => setDurationDays(Number(e.target.value))}
                    style={inputStyle}
                  >
                    <option value={7}>1 Week</option>
                    <option value={30}>1 Month</option>
                    <option value={90}>3 Months</option>
                    <option value={180}>6 Months</option>
                    <option value={365}>1 Year</option>
                  </select>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div>
                    <label style={labelStyle}>Season Weeks</label>
                    <input
                      type="number"
                      min={minWeeks}
                      value={numWeeks}
                      onChange={(e) => setNumWeeks(Math.max(minWeeks, Number(e.target.value) || minWeeks))}
                      style={inputStyle}
                    />
                    <small style={{ color: '#6b7280', fontSize: 11 }}>Min {minWeeks} for round robin</small>
                  </div>
                  <div>
                    <label style={labelStyle}>Playoff Teams</label>
                    <select
                      value={playoffTeams}
                      onChange={(e) => setPlayoffTeams(Number(e.target.value))}
                      style={inputStyle}
                    >
                      {validPlayoffOptions.map(opt => (
                        <option key={opt} value={opt}>
                          {opt} teams
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !leagueName.trim()}
                style={{
                  width: '100%',
                  padding: '12px 24px',
                  background: loading || !leagueName.trim() ? '#374151' : '#3b82f6',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: loading || !leagueName.trim() ? 'not-allowed' : 'pointer',
                  marginTop: 8,
                }}
              >
                {loading ? 'Creating...' : 'Create League'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Manage Tab */}
      {activeTab === 'manage' && managedLeagues.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 20 }}>
          {/* Update Settings */}
          <div style={{
            background: '#1a1f2e',
            borderRadius: 12,
            padding: 24,
            border: '1px solid #2a3040',
          }}>
            <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 18 }}>⚙️ League Settings</h3>

            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>Select League</label>
              <select
                value={selectedLeagueForUpdate}
                onChange={(e) => setSelectedLeagueForUpdate(e.target.value)}
                style={inputStyle}
              >
                {managedLeagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
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
                fontSize: 13,
                marginBottom: 16,
              }}>
                {selectedUpdateLeagueObj?.draft_status === 'completed'
                  ? '🏁 Draft completed - settings locked'
                  : '⏳ Draft in progress - settings locked'}
              </div>
            )}

            <form onSubmit={handleUpdate}>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Draft Date</label>
                <input
                  type="datetime-local"
                  value={updateDraftDate}
                  onChange={(e) => setUpdateDraftDate(e.target.value)}
                  disabled={isDraftLocked}
                  style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Budget Mode</label>
                  <select
                    value={updateBudgetMode}
                    onChange={(e) => setUpdateBudgetMode(e.target.value)}
                    disabled={isDraftLocked}
                    style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                  >
                    <option value="budget">Budget</option>
                    <option value="no-budget">No Budget</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Salary Cap</label>
                  <input
                    type="number"
                    value={updateSalaryCap}
                    onChange={(e) => setUpdateSalaryCap(e.target.value)}
                    disabled={capUpdateDisabled || isDraftLocked}
                    style={{ ...inputStyle, opacity: capUpdateDisabled || isDraftLocked ? 0.5 : 1 }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={labelStyle}>Teams</label>
                  <input
                    type="number"
                    min="4"
                    max="16"
                    value={updateParticipants}
                    onChange={(e) => setUpdateParticipants(clampParticipants(e.target.value))}
                    disabled={isDraftLocked}
                    style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Stocks/Team</label>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={updateRounds}
                    onChange={(e) => setUpdateRounds(clampRounds(e.target.value))}
                    disabled={isDraftLocked}
                    style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || isDraftLocked}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  background: loading || isDraftLocked ? '#374151' : '#8b5cf6',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loading || isDraftLocked ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Invite Members */}
          <div style={{
            background: '#1a1f2e',
            borderRadius: 12,
            padding: 24,
            border: '1px solid #2a3040',
          }}>
            <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 18 }}>👥 Invite Members</h3>

            <form onSubmit={handleInvite}>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Select League</label>
                <select
                  value={selectedLeagueForInvite}
                  onChange={(e) => setSelectedLeagueForInvite(e.target.value)}
                  style={inputStyle}
                >
                  {managedLeagues.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Email or Username</label>
                <input
                  type="text"
                  placeholder="Enter email or username"
                  value={inviteIdentifier}
                  onChange={(e) => setInviteIdentifier(e.target.value)}
                  style={inputStyle}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '10px 20px',
                  background: loading ? '#374151' : '#16a34a',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Sending...' : 'Send Invite'}
              </button>
            </form>

            {/* Pending Invites */}
            {selectedLeagueForInvite && pendingInvites[selectedLeagueForInvite]?.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 10 }}>Pending Invites</div>
                {pendingInvites[selectedLeagueForInvite].map((inv) => (
                  <div
                    key={inv.code}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: '#111826',
                      borderRadius: 8,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ color: '#e5e7eb', fontSize: 13 }}>{inv.invited_identifier}</span>
                    <button
                      onClick={() => {
                        const link = `${window.location.origin}/join/${inv.code}`;
                        navigator.clipboard?.writeText(link);
                        toast.success('Link copied!');
                      }}
                      style={{
                        padding: '4px 12px',
                        background: '#374151',
                        border: 'none',
                        borderRadius: 4,
                        color: '#fff',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      Copy Link
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
