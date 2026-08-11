// src/pages/Leagues.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useLeagues from '../hooks/useLeagues';
import { useToast } from '../components/Toast';
import EmptyState from '../components/EmptyState';
import { validateLeagueName } from '../utils/contentModeration';
import SlotBuilder from '../components/SlotBuilder';
import {
  STAKE_MODE_OPTIONS,
  DEFAULT_NOTIONAL_PER_SLOT,
  DEFAULT_BUDGET_CAP,
  fetchCategories,
} from '../utils/categoryData';
import { supabase } from '../supabase/supabaseClient';

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
    saveLeagueSlots,
    inviteToLeague,
    leaveLeague,
    deleteLeague,
  } = useLeagues();

  // Tab state
  const [activeTab, setActiveTab] = useState('leagues');

  // Create form state
  const [leagueName, setLeagueName] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [stakeMode, setStakeMode] = useState('fixed_notional');
  const [notionalPerSlot, setNotionalPerSlot] = useState(String(DEFAULT_NOTIONAL_PER_SLOT));
  const [budgetCap, setBudgetCap] = useState(String(DEFAULT_BUDGET_CAP));
  const [slots, setSlots] = useState([]);
  const [categories, setCategories] = useState([]);
  const [participants, setParticipants] = useState(12);
  const [stocksPerTeam, setStocksPerTeam] = useState(6);
  const [leagueType, setLeagueType] = useState('duration');
  const [durationDays, setDurationDays] = useState(30);
  const [numWeeks, setNumWeeks] = useState(11);
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const minWeeks = participants - 1;

  useEffect(() => { fetchCategories().then(setCategories); }, []);

  // Calculate valid playoff options
  const getPlayoffOptions = () => {
    const allOptions = [2, 4, 8];
    return allOptions.filter(o => o < participants);
  };
  const validPlayoffOptions = getPlayoffOptions();

  // Update form state
  const [selectedLeagueForUpdate, setSelectedLeagueForUpdate] = useState('');
  const [updateDraftDate, setUpdateDraftDate] = useState('');
  const [updateStakeMode, setUpdateStakeMode] = useState('');
  const [updateNotional, setUpdateNotional] = useState(String(DEFAULT_NOTIONAL_PER_SLOT));
  const [updateBudgetCap, setUpdateBudgetCap] = useState(String(DEFAULT_BUDGET_CAP));
  const [updateSlots, setUpdateSlots] = useState([]);
  const [updateParticipants, setUpdateParticipants] = useState('');
  const [updateRounds, setUpdateRounds] = useState(6);
  // Legacy 'no-budget' leagues carry stake_mode NULL ("commissioner re-choice
  // pending") — drafting is blocked until a mode is chosen here.
  const stakeModeMissing = selectedUpdateLeagueObj && selectedUpdateLeagueObj.stake_mode == null && updateStakeMode === '';

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
      // stake_mode NULL (legacy 'no-budget' league) intentionally maps to ''
      // so the picker shows "Choose a mode…" instead of silently defaulting.
      setUpdateStakeMode(selectedUpdateLeagueObj.stake_mode ?? '');
      setUpdateNotional(String(selectedUpdateLeagueObj.notional_per_slot ?? DEFAULT_NOTIONAL_PER_SLOT));
      setUpdateBudgetCap(String(selectedUpdateLeagueObj.budget_amount ?? DEFAULT_BUDGET_CAP));
      setUpdateParticipants(selectedUpdateLeagueObj.num_participants ?? '');
      setUpdateRounds(selectedUpdateLeagueObj.num_rounds ?? 6);
      // Existing slot definitions for the builder
      supabase
        .from('league_draft_slots')
        .select('slot_index, slot_count, price_min, price_max, category_id')
        .eq('league_id', selectedUpdateLeagueObj.id)
        .order('slot_index', { ascending: true })
        .then(({ data }) => {
          setUpdateSlots((data || []).map((r) => ({
            slotCount: r.slot_count,
            priceMin: r.price_min ?? '',
            priceMax: r.price_max ?? '',
            categoryId: r.category_id ?? '',
          })));
        });
    }
  }, [selectedUpdateLeagueObj]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!leagueName.trim()) return;

    if (!draftDate) {
      toast.error('Please select a draft date and time');
      return;
    }

    const contentCheck = validateLeagueName(leagueName.trim());
    if (!contentCheck.isValid) {
      toast.error(contentCheck.reason || 'League name is not allowed');
      return;
    }

    if (stakeMode === 'price_tiers' && slots.length === 0) {
      toast.error('Price tiers need at least one slot with a price bracket — add slots below.');
      return;
    }

    const league = await createLeague({
      name: leagueName.trim(),
      draftDate: new Date(draftDate).toISOString(),
      stakeMode,
      notionalPerSlot: Number(notionalPerSlot) || DEFAULT_NOTIONAL_PER_SLOT,
      budgetAmount: stakeMode === 'budget_cap' ? Number(budgetCap) || DEFAULT_BUDGET_CAP : null,
      numParticipants: clampParticipants(participants),
      numRounds: Number(stocksPerTeam),
      leagueType,
      durationDays: leagueType === 'duration' ? Number(durationDays) : 30,
      numWeeks: leagueType === 'matchup' ? Math.max(numWeeks, minWeeks) : null,
      playoffTeams: leagueType === 'matchup' ? playoffTeams : null,
    });

    if (league?.id && slots.length > 0) {
      try {
        await saveLeagueSlots(league.id, slots);
      } catch (err) {
        console.error('Slot save failed:', err);
        toast.error('League created, but saving roster slots failed — edit them in Manage.');
      }
    }

    setLeagueName('');
    setDraftDate('');
    setStakeMode('fixed_notional');
    setNotionalPerSlot(String(DEFAULT_NOTIONAL_PER_SLOT));
    setBudgetCap(String(DEFAULT_BUDGET_CAP));
    setSlots([]);
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

    if (updateStakeMode === 'price_tiers' && updateSlots.length === 0) {
      toast.error('Price tiers need at least one slot with a price bracket.');
      return;
    }

    const patch = {
      draft_date: updateDraftDate ? new Date(updateDraftDate).toISOString() : null,
      num_participants: updateParticipants === '' ? null : clampParticipants(updateParticipants),
      num_rounds: Number(updateRounds),
    };
    // stake_mode only when chosen — '' (legacy NULL league, no choice yet)
    // leaves the column untouched rather than writing a default the
    // commissioner didn't pick. budget_mode / salary_cap_limit: retired,
    // never written here.
    if (updateStakeMode) {
      patch.stake_mode = updateStakeMode;
      patch.notional_per_slot = Number(updateNotional) || DEFAULT_NOTIONAL_PER_SLOT;
      if (updateStakeMode === 'budget_cap') {
        patch.budget_amount = Number(updateBudgetCap) || DEFAULT_BUDGET_CAP;
      }
    }

    await updateLeague(selectedLeagueForUpdate, patch);
    try {
      await saveLeagueSlots(selectedLeagueForUpdate, updateSlots);
    } catch (err) {
      console.error('Slot save failed:', err);
      toast.error('Settings saved, but roster slots failed to save.');
      return;
    }
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

  // Check if league can be deleted (only before draft or after season ends)
  const canDeleteLeague = (lg) => {
    // Can always delete if draft hasn't started
    if (!lg.draft_status || lg.draft_status === 'not_started') {
      return true;
    }

    // Cannot delete during draft
    if (lg.draft_status === 'in_progress') {
      return false;
    }

    // Draft completed - check if season is over
    if (lg.draft_status === 'completed') {
      // For duration leagues, check if end_date has passed
      if (lg.league_type === 'duration' && lg.end_date) {
        return new Date() > new Date(lg.end_date);
      }

      // For matchup leagues, check if current_week > num_weeks (playoffs done)
      // Adding buffer for playoff weeks (max 3 rounds: quarter, semi, finals)
      if (lg.league_type === 'matchup' && lg.num_weeks && lg.current_week) {
        const playoffWeeks = lg.playoff_teams === 8 ? 3 : lg.playoff_teams === 4 ? 2 : 1;
        return lg.current_week > lg.num_weeks + playoffWeeks;
      }

      // If we can't determine, don't allow deletion mid-season
      return false;
    }

    return false;
  };

  const tabStyle = (isActive) => ({
    padding: '12px 24px',
    background: isActive
      ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
      : 'transparent',
    border: 'none',
    borderRadius: 10,
    color: isActive ? '#fff' : '#9ca3af',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontSize: 14,
    boxShadow: isActive ? '0 4px 14px rgba(59, 130, 246, 0.25)' : 'none',
  });

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    background: 'linear-gradient(135deg, rgba(15, 19, 25, 0.9) 0%, rgba(10, 13, 18, 0.95) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    color: '#fff',
    fontSize: 14,
    transition: 'all 0.2s ease',
  };

  const labelStyle = {
    display: 'block',
    marginBottom: 8,
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
  };

  const cardStyle = {
    background: 'linear-gradient(135deg, rgba(26, 29, 36, 0.9) 0%, rgba(18, 21, 26, 0.95) 100%)',
    borderRadius: 16,
    padding: 24,
    border: '1px solid rgba(255, 255, 255, 0.06)',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.2)',
  };

  const leagueCardStyle = {
    background: 'linear-gradient(135deg, rgba(26, 29, 36, 0.9) 0%, rgba(18, 21, 26, 0.95) 100%)',
    borderRadius: 16,
    padding: 20,
    border: '1px solid rgba(255, 255, 255, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    transition: 'all 0.2s ease',
  };

  const buttonPrimaryStyle = {
    padding: '10px 18px',
    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    borderRadius: 8,
    color: '#fff',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
    border: 'none',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(59, 130, 246, 0.25)',
  };

  const buttonSecondaryStyle = {
    padding: '10px 18px',
    background: 'linear-gradient(135deg, rgba(55, 65, 81, 0.9) 0%, rgba(45, 55, 72, 0.95) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 8,
    color: '#fff',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  };

  return (
    <div className="page" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ color: '#6b7280', margin: 0 }}>Manage your fantasy stock leagues</p>
      </div>

      {error && <p style={{ color: '#ef4444', marginBottom: 16 }}>Error: {error}</p>}

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 8,
        marginBottom: 24,
        background: 'linear-gradient(135deg, rgba(26, 31, 46, 0.9) 0%, rgba(18, 22, 32, 0.95) 100%)',
        padding: 6,
        borderRadius: 14,
        width: 'fit-content',
        border: '1px solid rgba(255, 255, 255, 0.06)',
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
                    style={leagueCardStyle}
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
                        style={buttonPrimaryStyle}
                      >
                        View
                      </Link>
                      <button
                        onClick={() => setActiveAndGoDraft(lg)}
                        style={buttonSecondaryStyle}
                      >
                        Draft
                      </button>
                      {lg.role === 'commissioner' ? (
                        <>
                          <button
                            onClick={() => copyInviteForLeague(lg)}
                            style={buttonSecondaryStyle}
                          >
                            Invite
                          </button>
                          <button
                            onClick={() => {
                              if (canDeleteLeague(lg)) {
                                if (confirm(`Delete "${lg.name}"?`)) deleteLeague?.(lg.id);
                              }
                            }}
                            disabled={!canDeleteLeague(lg)}
                            title={!canDeleteLeague(lg) ? 'Cannot delete during active season' : 'Delete league'}
                            style={{
                              padding: '10px 18px',
                              background: canDeleteLeague(lg) ? 'rgba(239, 68, 68, 0.15)' : 'rgba(107, 114, 128, 0.15)',
                              border: '1px solid ' + (canDeleteLeague(lg) ? 'rgba(239, 68, 68, 0.3)' : 'rgba(107, 114, 128, 0.2)'),
                              borderRadius: 8,
                              color: canDeleteLeague(lg) ? '#ef4444' : '#6b7280',
                              fontSize: 13,
                              fontWeight: 500,
                              cursor: canDeleteLeague(lg) ? 'pointer' : 'not-allowed',
                              opacity: canDeleteLeague(lg) ? 1 : 0.6,
                            }}
                          >
                            Delete
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => leaveLeague(lg.id)}
                          style={{
                            padding: '10px 18px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: 8,
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
          <div style={cardStyle}>
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

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>Stake Mode</label>
                <select
                  value={stakeMode}
                  onChange={(e) => setStakeMode(e.target.value)}
                  style={inputStyle}
                >
                  {STAKE_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <small style={{ color: '#6b7280', fontSize: 11, display: 'block', marginTop: 4 }}>
                  {STAKE_MODE_OPTIONS.find((o) => o.value === stakeMode)?.help}
                </small>
              </div>

              {stakeMode === 'fixed_notional' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Stake per Slot ($)</label>
                  <input
                    type="number" min="1" placeholder={String(DEFAULT_NOTIONAL_PER_SLOT)}
                    value={notionalPerSlot}
                    onChange={(e) => setNotionalPerSlot(e.target.value)}
                    style={inputStyle}
                  />
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    Each pick simulates this dollar amount (fractional shares).
                  </small>
                </div>
              )}
              {stakeMode === 'budget_cap' && (
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle}>Budget Cap ($)</label>
                  <input
                    type="number" min="1" placeholder={String(DEFAULT_BUDGET_CAP)}
                    value={budgetCap}
                    onChange={(e) => setBudgetCap(e.target.value)}
                    style={inputStyle}
                  />
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    One share per pick; the sum of your roster's share prices must fit under the cap.
                    Keep it tight — a loose cap never shapes the draft.
                  </small>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle}>
                  Roster Slots {stakeMode === 'price_tiers' ? '(required — price brackets)' : '(optional — category slots)'}
                </label>
                <SlotBuilder
                  slots={slots}
                  onChange={setSlots}
                  categories={categories}
                  leagueSize={clampParticipants(participants)}
                  numRounds={Number(stocksPerTeam)}
                  disabled={false}
                />
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
                  padding: '14px 24px',
                  background: loading || !leagueName.trim()
                    ? 'linear-gradient(135deg, rgba(55, 65, 81, 0.9) 0%, rgba(45, 55, 72, 0.95) 100%)'
                    : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 15,
                  cursor: loading || !leagueName.trim() ? 'not-allowed' : 'pointer',
                  marginTop: 8,
                  boxShadow: loading || !leagueName.trim() ? 'none' : '0 4px 14px rgba(59, 130, 246, 0.25)',
                  transition: 'all 0.2s ease',
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
          <div style={cardStyle}>
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

              {stakeModeMissing && (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  borderRadius: 8,
                  color: '#f87171',
                  fontSize: 13,
                  marginBottom: 12,
                }}>
                  This league has no stake mode yet — drafting is blocked until you choose one below.
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Stake Mode</label>
                <select
                  value={updateStakeMode}
                  onChange={(e) => setUpdateStakeMode(e.target.value)}
                  disabled={isDraftLocked}
                  style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                >
                  <option value="" disabled>Choose a mode…</option>
                  {STAKE_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {updateStakeMode && (
                  <small style={{ color: '#6b7280', fontSize: 11, display: 'block', marginTop: 4 }}>
                    {STAKE_MODE_OPTIONS.find((o) => o.value === updateStakeMode)?.help}
                  </small>
                )}
              </div>

              {updateStakeMode === 'fixed_notional' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Stake per Slot ($)</label>
                  <input
                    type="number" min="1"
                    value={updateNotional}
                    onChange={(e) => setUpdateNotional(e.target.value)}
                    disabled={isDraftLocked}
                    style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                  />
                </div>
              )}
              {updateStakeMode === 'budget_cap' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Budget Cap ($)</label>
                  <input
                    type="number" min="1"
                    value={updateBudgetCap}
                    onChange={(e) => setUpdateBudgetCap(e.target.value)}
                    disabled={isDraftLocked}
                    style={{ ...inputStyle, opacity: isDraftLocked ? 0.5 : 1 }}
                  />
                  <small style={{ color: '#6b7280', fontSize: 11 }}>
                    One share per pick; roster share prices must total under the cap.
                  </small>
                </div>
              )}

              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Roster Slots</label>
                <SlotBuilder
                  slots={updateSlots}
                  onChange={setUpdateSlots}
                  categories={categories}
                  leagueSize={Number(updateParticipants) || selectedUpdateLeagueObj?.num_participants || 8}
                  numRounds={Number(updateRounds) || 6}
                  disabled={isDraftLocked}
                />
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
                  padding: '12px 20px',
                  background: loading || isDraftLocked
                    ? 'linear-gradient(135deg, rgba(55, 65, 81, 0.9) 0%, rgba(45, 55, 72, 0.95) 100%)'
                    : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loading || isDraftLocked ? 'not-allowed' : 'pointer',
                  boxShadow: loading || isDraftLocked ? 'none' : '0 4px 14px rgba(139, 92, 246, 0.25)',
                  transition: 'all 0.2s ease',
                }}
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Invite Members */}
          <div style={cardStyle}>
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
                  padding: '12px 20px',
                  background: loading
                    ? 'linear-gradient(135deg, rgba(55, 65, 81, 0.9) 0%, rgba(45, 55, 72, 0.95) 100%)'
                    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  boxShadow: loading ? 'none' : '0 4px 14px rgba(16, 185, 129, 0.25)',
                  transition: 'all 0.2s ease',
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
                      padding: '12px 14px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: 10,
                      marginBottom: 8,
                      border: '1px solid rgba(255, 255, 255, 0.04)',
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
