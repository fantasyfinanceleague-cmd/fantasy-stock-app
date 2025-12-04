// src/pages/DraftPage.jsx
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName } from '../utils/formatting';
import { fetchCompanyName } from '../utils/stockData';
import DraftControls from '../components/DraftControls';
import DraftHistory from '../components/DraftHistory';
import DraftCompleteModal from '../components/DraftCompleteModal';
import DraftSetupModal from '../components/DraftSetupModal';

// Draft access rules
const MIN_PARTICIPANTS = 4;
const REQUIRE_TIME_IN_PAST = false;

// Popular stocks for bot auto-picks
const BOT_STOCK_POOL = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'JPM', 'V',
  'UNH', 'MA', 'HD', 'PG', 'JNJ', 'MRK', 'ABBV', 'CVX', 'XOM', 'PEP',
  'KO', 'COST', 'AVGO', 'TMO', 'MCD', 'WMT', 'CSCO', 'ACN', 'ABT', 'LLY',
  'DHR', 'NKE', 'ORCL', 'TXN', 'NEE', 'UPS', 'PM', 'MS', 'RTX', 'HON'
];

// ---- Finnhub client-side suggestions ----
const FINNHUB_API_KEY = import.meta.env.VITE_FINNHUB_API_KEY; // set in .env.local

// ---- Name lookup cache/throttle (new) ----
const NAME_CACHE_KEY = 'symbolNameCache_v1';
const NAME_CACHE = (() => {
  try { return JSON.parse(localStorage.getItem(NAME_CACHE_KEY) || '{}'); } catch { return {}; }
})();
function saveNameCache() { try { localStorage.setItem(NAME_CACHE_KEY, JSON.stringify(NAME_CACHE)); } catch { } }

const inflightNameLookups = new Map(); // symbol -> Promise
let nameRateLimitedUntil = 0;           // ms epoch; backoff after 429

// helpful fallbacks for common tickers
const STATIC_NAMES = {
  F: 'FORD MOTOR CO',
  T: 'AT&T INC',
  D: 'DOMINION ENERGY INC',
  V: 'VISA INC-CLASS A SHARES',
  KO: 'COCA-COLA CO',
};

/** Call your Edge Function for a normalized latest price */
async function fetchQuoteViaFunction(symbol) {
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return null;

  const { data, error } = await supabase.functions.invoke('quote', { body: { symbol: sym } });
  if (error) throw new Error('Edge Function returned a non-2xx status code');

  if (data?.error) {
    const status = data?.status ?? data?.quote?.status ?? data?.trade?.status ?? data?.bar?.status;
    throw new Error(`${data.error}${status ? ` (status: ${status})` : ''}`);
  }

  const price = Number(
    data?.price ??
    data?.quote?.ap ??
    data?.quote?.bp ??
    data?.trade?.p ??
    data?.bar?.c
  );

  if (!Number.isFinite(price)) return null;
  return { symbol: data?.symbol || sym, price };
}

export default function DraftPage() {
  const authUser = useAuthUser();
  const navigate = useNavigate();
  // keep a fallback for now so your draft keeps working if not signed in
  const USER_ID = authUser?.id ?? 'test-user';
  const { leagueId: routeLeagueId } = useParams();
  const [leagueId, setLeagueId] = useState(null);
  const [leagues, setLeagues] = useState([]); // All leagues user is a member of

  // gating/meta
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [memberIds, setMemberIds] = useState([]);
  const memberCount = memberIds.length;
  const [league, setLeague] = useState(null);
  const [allowed, setAllowed] = useState(false);

  // draft state
  const [portfolio, setPortfolio] = useState([]); // picks for THIS league
  const [currentRound, setCurrentRound] = useState(1);
  const [currentPickNumber, setCurrentPickNumber] = useState(1);
  const [currentPicker, setCurrentPicker] = useState(null);

  // modal on completion
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [hasShownCompleteModal, setHasShownCompleteModal] = useState(false);

  // auto-draft for bots
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(true);
  const [botPickInProgress, setBotPickInProgress] = useState(false);
  const [realUserIds, setRealUserIds] = useState(new Set()); // IDs that exist in auth.users

  // draft setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [customMinParticipants, setCustomMinParticipants] = useState(MIN_PARTICIPANTS);

  // UI helpers
  const [symbol, setSymbol] = useState('');
  const [quote, setQuote] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedRound, setSelectedRound] = useState(1);

  // names
  const [symbolToName, setSymbolToName] = useState({}); // { AAPL: 'Apple Inc.' }
  const recentPick = portfolio[0];

  // budget
  const isBudgetMode = league?.budget_mode === 'budget';
  const leagueBudget = Number(league?.budget_amount ?? 0);
  const mySpent = useMemo(
    () => portfolio.filter(p => p.user_id === USER_ID).reduce((s, p) => s + Number(p.entry_price || 0), 0),
    [portfolio]
  );
  const budgetRemaining = isBudgetMode ? Math.max(leagueBudget - mySpent, 0) : null;

  // --- turn helper (keeps the "whose turn" math in one place)
  function updateTurn(picks, members, totalRounds) {
    const usersInOrder = members.length || 1;
    const totalPicks = picks.length;
    const draftCap = usersInOrder * totalRounds;

    if (totalPicks >= draftCap) {
      setCurrentPicker(null);
      setCurrentRound(totalRounds);
      setCurrentPickNumber(draftCap);
      return;
    }

    const round = Math.floor(totalPicks / usersInOrder) + 1;
    const pickIndex = totalPicks % usersInOrder;
    const isEven = (round % 2) === 0;
    const pickerIdx = isEven ? (usersInOrder - 1 - pickIndex) : pickIndex;

    setCurrentRound(round);
    setCurrentPickNumber(totalPicks + 1);
    setCurrentPicker(members[pickerIdx] || null);
  }


  // Resolve leagueId from route or localStorage
  useEffect(() => {
    const id = routeLeagueId || localStorage.getItem('activeLeagueId') || null;
    setLeagueId(id);
  }, [routeLeagueId]);

  // Load all leagues user is a member of (for dropdown)
  useEffect(() => {
    if (!USER_ID) return;
    (async () => {
      try {
        const { data: mem, error: memErr } = await supabase
          .from('league_members')
          .select('league_id')
          .eq('user_id', USER_ID);
        if (memErr) throw memErr;

        const ids = (mem || []).map(r => r.league_id);
        if (ids.length === 0) {
          setLeagues([]);
          return;
        }

        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name')
          .in('id', ids)
          .order('name', { ascending: true });
        if (lgErr) throw lgErr;

        setLeagues(lg || []);
      } catch (e) {
        console.error('Failed to load leagues:', e);
      }
    })();
  }, [USER_ID]);

  // Handle league change from dropdown
  const handleLeagueChange = (e) => {
    const id = e.target.value;
    localStorage.setItem('activeLeagueId', id);
    navigate(`/draft/${id}`);
  };

  // Load gating + league meta + members + picks
  useEffect(() => {
    if (!leagueId) {
      setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setError('');
      setAllowed(false);
      try {
        // 1) Load members (NO created_at)
        const { data: mem, error: memErr } = await supabase
          .from('league_members')
          .select('user_id, role')
          .eq('league_id', leagueId);
        if (memErr) throw memErr;

        const rawIds = (mem || []).map(r => r.user_id);
        const iAmMember = rawIds.includes(USER_ID);
        setIsMember(iAmMember);
        if (!iAmMember) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        // 2) League meta (need commissioner_id to order)
        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name, draft_date, num_rounds, num_participants, budget_mode, budget_amount, commissioner_id')
          .eq('id', leagueId)
          .single();
        if (lgErr) throw lgErr;
        setLeague(lg);

        // 3) Draft order: commissioner first, others alphabetical
        const commissionerId = lg?.commissioner_id || null;
        const rest = rawIds.filter(id => id !== commissionerId).sort();
        const orderedIds = commissionerId ? [commissionerId, ...rest] : [...rest];
        setMemberIds(orderedIds);

        // 3b) Check which member IDs are real auth users (for bot detection)
        try {
          const { data: realIds } = await supabase.rpc('get_real_user_ids', { user_ids: orderedIds });
          setRealUserIds(new Set(realIds || []));
        } catch (e) {
          // If function doesn't exist yet, assume only current user is real
          console.warn('get_real_user_ids not available, falling back to current user only');
          setRealUserIds(new Set([USER_ID]));
        }

        // 4) Gate - check requirements but don't early return (allow modal to show)
        const hasDraftDate = !!lg?.draft_date;
        const startsAt = hasDraftDate ? new Date(lg.draft_date) : null;
        const now = new Date();
        const timeOk = !REQUIRE_TIME_IN_PAST || (startsAt && now >= startsAt);

        // Note: enoughMembers check is done in render using customMinParticipants
        if (!hasDraftDate || !timeOk) {
          setAllowed(false);
          setLoading(false);
          return;
        }

        // 5) League picks
        const { data: picks, error: pErr } = await supabase
          .from('drafts')
          .select('id, league_id, user_id, symbol, entry_price, quantity, round, pick_number, created_at')
          .eq('league_id', leagueId)
          .order('pick_number', { ascending: false });
        if (pErr) throw pErr;

        setPortfolio(picks || []);

        // 6) Snake turn (initial)
        updateTurn(picks || [], orderedIds, Number(lg?.num_rounds ?? 6));

        setAllowed(true);
      } catch (e) {
        setError(e.message || String(e));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Keep turn/pick in sync after any portfolio/member/rounds change
  useEffect(() => {
    if (!allowed || !memberIds.length) return;
    updateTurn(
      portfolio,
      memberIds,
      Number(league?.num_rounds ?? 6)
    );
  }, [portfolio, memberIds, allowed, league?.num_rounds]);

  // ---------- Draft completion modal trigger ----------
  const totalRounds = Number(league?.num_rounds ?? 6);
  const draftCap = (memberIds.length || 0) * totalRounds;
  const isDraftComplete = (memberIds.length > 0) && (portfolio.length >= draftCap);

  useEffect(() => {
    if (isDraftComplete && !hasShownCompleteModal) {
      setShowCompleteModal(true);
      setHasShownCompleteModal(true);
    }
  }, [isDraftComplete, hasShownCompleteModal]);

  // ---- Ensure company name for a symbol ----
  async function ensureNameForSymbol(sym) {
    const u = String(sym || '').toUpperCase();
    if (!u || symbolToName[u]) return;
    const name = await fetchCompanyName(u);
    if (name) {
      setSymbolToName(prev => ({ ...prev, [u]: name }));
    }
  }

  useEffect(() => {
    const syms = [...new Set((portfolio || []).map(p => p.symbol?.toUpperCase()))];
    syms.forEach(s => { void ensureNameForSymbol(s); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio]);

  // Backfill names when portfolio changes (rate-limited)
  useEffect(() => {
    const unknown = [...new Set((portfolio || []).map(p => p.symbol))]
      .filter(s => !symbolToName[s] && !NAME_CACHE[s] && !STATIC_NAMES[s])
      .slice(0, 5); // cap per change to avoid 429
    unknown.forEach(sym => { void ensureNameForSymbol(sym); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio]);

  // Quote lookup (Alpaca → Finnhub fallback)
  async function getQuote() {
    try {
      const upper = String(symbol).trim().toUpperCase();
      let q = await fetchQuoteViaFunction(upper);

      if (!q?.price && FINNHUB_API_KEY) {
        try {
          const fr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(upper)}&token=${FINNHUB_API_KEY}`);
          const fj = await fr.json();
          if (Number.isFinite(fj?.c)) {
            q = { symbol: upper, price: Number(fj.c) };
          }
        } catch { /* ignore */ }
      }

      if (!q?.price) {
        setErrorMsg(`No recent data for "${upper}"`);
        setQuote(null);
        return;
      }

      setQuote({ c: q.price });
      setErrorMsg('');
      // opportunistically ensure name for display
      void ensureNameForSymbol(upper);
    } catch (e) {
      setErrorMsg(e.message || 'Error fetching quote');
      setQuote(null);
    }
  }

  // Draft a pick (fantasy only)
  async function draftStock() {
    if (!quote || USER_ID !== currentPicker) return;

    const upper = String(symbol).toUpperCase();
    const price = Number(quote.c);
    if (!Number.isFinite(price)) return;

    if (isBudgetMode && price > budgetRemaining) {
      alert('This stock is over your remaining budget.');
      return;
    }

    // 1) Place paper order via Edge Function
    const { data: placeData, error: placeErr } = await supabase.functions.invoke('place-order', {
      body: {
        symbol: upper,
        qty: 1,
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      },
    });

    if (placeErr || placeData?.error) {
      console.error('place-order failed:', placeErr || placeData);
      alert('Paper order failed (see console). Still drafting for testing.');
    }

    // 2) Save the pick
    const newPickNumber = (portfolio?.length || 0) + 1;
    const payload = {
      league_id: leagueId,
      user_id: USER_ID,
      symbol: upper,
      entry_price: price,
      quantity: 1,
      round: currentRound,
      pick_number: newPickNumber,
      draft_date: new Date().toISOString(),
      alpaca_order_id: placeData?.order?.id ?? null,
    };

    const { data: inserted, error: insErr } = await supabase
      .from('drafts')
      .insert(payload)
      .select('*')
      .single();

    if (insErr) {
      console.error('❌ Supabase insert error:', insErr);
      alert('Failed to draft stock.');
      return;
    }

    setPortfolio(prev => [inserted, ...(prev || [])]);
    setQuote(null);
    setSymbol('');
    setErrorMsg('');
    setCurrentPickNumber(newPickNumber + 1);

    // ensure name is cached for lists
    void ensureNameForSymbol(upper);
  }

  // --- Reset the draft for this league
  async function resetDraftForLeague() {
    if (!leagueId) return;
    if (!confirm('Reset this draft for everyone? This will delete all picks.')) return;

    const { error } = await supabase
      .from('drafts')
      .delete()
      .eq('league_id', leagueId);

    if (error) {
      console.error('Failed to reset draft:', error);
      alert('Could not reset draft (see console). Check RLS/policies.');
      return;
    }

    setPortfolio([]);
    setSymbol('');
    setQuote(null);
    setErrorMsg('');
    setHasShownCompleteModal(false);
    setShowCompleteModal(false);
  }

  // --- Fill league with bots to meet minimum
  async function fillWithBots(count) {
    if (!leagueId || count <= 0) return;

    const botEntries = [];
    for (let i = 1; i <= count; i++) {
      // Find a unique bot name
      let botId = `bot-${i}`;
      let suffix = 1;
      while (memberIds.includes(botId)) {
        botId = `bot-${i}-${suffix++}`;
      }
      botEntries.push({
        league_id: leagueId,
        user_id: botId,
        role: 'member'
      });
    }

    const { error } = await supabase
      .from('league_members')
      .insert(botEntries);

    if (error) {
      console.error('Failed to add bots:', error);
      alert('Could not add bots. Check console for details.');
      return;
    }

    // Refresh the page to reload members
    window.location.reload();
  }

  // --- Change minimum participants for this session
  function changeMinimum(newMin) {
    if (newMin >= 2) {
      setCustomMinParticipants(newMin);
      setShowSetupModal(false);
    }
  }

  // Human count for display
  const humanCount = memberIds.filter(id => realUserIds.has(id)).length;

  // --- Bot auto-draft: pick a random stock for non-human players
  async function botAutoPick(botUserId) {
    if (!leagueId || botPickInProgress) return;
    setBotPickInProgress(true);

    try {
      // Get already-picked symbols in this league to avoid duplicates
      const pickedSymbols = new Set(portfolio.map(p => p.symbol?.toUpperCase()));
      const availableStocks = BOT_STOCK_POOL.filter(s => !pickedSymbols.has(s));

      if (availableStocks.length === 0) {
        console.warn('Bot has no unique stocks left to pick');
        setBotPickInProgress(false);
        return;
      }

      // Pick a random stock
      const randomSymbol = availableStocks[Math.floor(Math.random() * availableStocks.length)];

      // Get quote for the stock
      let price = 100; // fallback price
      try {
        const q = await fetchQuoteViaFunction(randomSymbol);
        if (q?.price) price = q.price;
      } catch {
        // Use fallback price if quote fails
      }

      // Insert the pick
      const newPickNumber = (portfolio?.length || 0) + 1;
      const payload = {
        league_id: leagueId,
        user_id: botUserId,
        symbol: randomSymbol,
        entry_price: price,
        quantity: 1,
        round: currentRound,
        pick_number: newPickNumber,
        draft_date: new Date().toISOString(),
      };

      const { data: inserted, error: insErr } = await supabase
        .from('drafts')
        .insert(payload)
        .select('*')
        .single();

      if (insErr) {
        console.error('Bot pick failed:', insErr);
        setBotPickInProgress(false);
        return;
      }

      setPortfolio(prev => [inserted, ...(prev || [])]);
      void ensureNameForSymbol(randomSymbol);
    } finally {
      setBotPickInProgress(false);
    }
  }

  // --- Effect: Auto-pick for bots when it's their turn
  useEffect(() => {
    if (!autoDraftEnabled || !allowed || !currentPicker || botPickInProgress) return;

    // Check if current picker is a real user (exists in auth.users)
    const isRealUser = realUserIds.has(currentPicker);
    if (isRealUser) return; // Real users pick for themselves

    // Check if draft is complete
    const totalRounds = Number(league?.num_rounds ?? 6);
    const draftCap = memberIds.length * totalRounds;
    if (portfolio.length >= draftCap) return;

    // Small delay so user can see what's happening
    const timer = setTimeout(() => {
      botAutoPick(currentPicker);
    }, 800);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPicker, autoDraftEnabled, allowed, botPickInProgress, portfolio.length, realUserIds]);

  // ----------- UI gating states -----------
  if (!leagueId) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Choose a League</h3>
          <p className="muted">Go to Leagues to create or join a league, then click “Draft”.</p>
          <Link className="btn" to="/leagues">Open Leagues</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="card"><p className="muted">Loading draft…</p></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>Draft Unavailable</h3>
          <p className="muted">Error: {error}</p>
          <Link className="btn" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="page">
        <div className="card">
          <h3 style={{ color: '#e5e7eb', marginTop: 0 }}>You’re not in this league</h3>
          <p className="muted">Join or create a league before you can draft.</p>
          <Link className="btn primary" to="/leagues">Go to Leagues</Link>
        </div>
      </div>
    );
  }

  // Check if we need more members (using customizable minimum)
  const needsMembers = memberCount < customMinParticipants;
  const needsDate = !league?.draft_date;
  const startsAt = league?.draft_date ? new Date(league.draft_date) : null;
  const timeMsg =
    REQUIRE_TIME_IN_PAST && startsAt
      ? `Draft starts at ${startsAt.toLocaleString()}`
      : null;

  if (!allowed || needsMembers) {
    // Show modal for member-related issues, static message for others
    if (needsMembers && !needsDate) {
      return (
        <div className="page">
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
              <div>
                <h2 style={{ color: '#fff', margin: 0, marginBottom: 4 }}>{league?.name || 'League'}</h2>
                <h3 style={{ color: '#e5e7eb', marginTop: 0, fontSize: '1.1rem' }}>Draft Setup Required</h3>
              </div>

              {leagues.length > 1 && (
                <div style={{ minWidth: 220 }}>
                  <label htmlFor="leagueSelect" className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                    Switch League
                  </label>
                  <select
                    id="leagueSelect"
                    value={leagueId || ''}
                    onChange={handleLeagueChange}
                    className="round-select"
                    style={{ width: '100%' }}
                  >
                    {leagues.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <p className="muted" style={{ marginTop: 8 }}>
              League needs at least {customMinParticipants} members to start. Current: {memberCount}.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn primary" onClick={() => setShowSetupModal(true)}>
                Setup Options
              </button>
              <Link className="btn" to="/leagues">Back to Leagues</Link>
            </div>
          </div>

          <DraftSetupModal
            show={showSetupModal}
            onClose={() => setShowSetupModal(false)}
            leagueName={league?.name}
            currentMemberCount={memberCount}
            minRequired={customMinParticipants}
            humanCount={humanCount}
            onFillWithBots={fillWithBots}
            onChangeMinimum={changeMinimum}
          />
        </div>
      );
    }

    // Other issues (no date, time not reached)
    return (
      <div className="page">
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div>
              <h2 style={{ color: '#fff', margin: 0, marginBottom: 4 }}>{league?.name || 'League'}</h2>
              <h3 style={{ color: '#e5e7eb', marginTop: 0, fontSize: '1.1rem' }}>Draft not ready yet</h3>
            </div>

            {leagues.length > 1 && (
              <div style={{ minWidth: 220 }}>
                <label htmlFor="leagueSelect" className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                  Switch League
                </label>
                <select
                  id="leagueSelect"
                  value={leagueId || ''}
                  onChange={handleLeagueChange}
                  className="round-select"
                  style={{ width: '100%' }}
                >
                  {leagues.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <ul className="muted" style={{ marginTop: 8 }}>
            {needsDate && (<li>No draft time has been scheduled yet (set it on the Leagues page).</li>)}
            {timeMsg && (<li>{timeMsg}</li>)}
          </ul>
          <Link className="btn" to="/leagues">Back to Leagues</Link>
        </div>
      </div>
    );
  }

  // ---------- Draft workspace ----------
  const usersInOrder = memberIds.length || 1;

  return (
    <div className="page">
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ color: '#fff', margin: 0 }}>{league?.name || 'Draft'}</h2>
            <p className="muted" style={{ marginTop: 6 }}>
              Rounds: {totalRounds} • Members: {memberCount}
              {league?.draft_date ? <> • Draft time: {new Date(league.draft_date).toLocaleString()}</> : null}
              {league?.budget_mode === 'no-budget'
                ? ' • No budget'
                : league?.budget_mode === 'budget'
                  ? ` • Budget: $${leagueBudget}`
                  : null}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Link className="btn" to="/leagues">Back to Leagues</Link>
              <button className="btn" onClick={resetDraftForLeague}>Reset Draft</button>
            </div>
          </div>

          {leagues.length > 1 && (
            <div style={{ minWidth: 220 }}>
              <label htmlFor="leagueSelect" className="muted" style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
                Switch League
              </label>
              <select
                id="leagueSelect"
                value={leagueId || ''}
                onChange={handleLeagueChange}
                className="round-select"
                style={{ width: '100%' }}
              >
                {leagues.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      <div className="grid-container px-8 py-6">
        {/* LEFT: Pick input */}
        <div className="p-4 bg-[#1c1c1c] rounded-xl text-white">
          <h1 className="draft-left">Stock Draft</h1>
          <p className="text-gray-400 mb-6">Select stocks for your fantasy portfolio during the draft.</p>

          <DraftControls
            isDraftComplete={isDraftComplete}
            draftCap={draftCap}
            leagueName={league?.name}
            symbol={symbol}
            setSymbol={setSymbol}
            quote={quote}
            setQuote={setQuote}
            errorMsg={errorMsg}
            setErrorMsg={setErrorMsg}
            symbolToName={symbolToName}
            setSymbolToName={setSymbolToName}
            portfolio={portfolio}
            currentPicker={currentPicker}
            USER_ID={USER_ID}
            isBudgetMode={isBudgetMode}
            budgetRemaining={budgetRemaining}
            getQuote={getQuote}
            draftStock={draftStock}
          />
        </div>

        {/* MIDDLE: Status / Progress / Recent / History */}
        <div className="draft-center">
          <div className="draft-box">
            <h3 style={{ margin: 0 }}>
              {isDraftComplete
                ? '🏁 Draft complete'
                : botPickInProgress
                  ? '🤖 Bot is picking...'
                  : currentPicker === USER_ID
                    ? '✅ Your Turn'
                    : realUserIds.has(currentPicker)
                      ? '⏳ Waiting for player...'
                      : '⏳ Waiting for bot...'}
            </h3>
            {!isDraftComplete && currentPicker !== USER_ID && !botPickInProgress && (
              <p style={{ marginTop: 8, color: '#9ca3af' }}>
                Current picker: {currentPicker?.substring(0, 12)}...
                {realUserIds.has(currentPicker) ? ' (human)' : ' (bot)'}
              </p>
            )}
            {!isDraftComplete && USER_ID !== currentPicker && (
              <p style={{ marginTop: 4 }}>
                Your turn in {
                  (() => {
                    const totalPicks = portfolio.length;
                    const usersInOrder = memberIds.length;

                    for (let i = 1; i <= usersInOrder * 2; i++) {
                      const nextPickNumber = totalPicks + i;
                      const nextRound = Math.floor(nextPickNumber / usersInOrder) + 1;
                      const pickIndex = nextPickNumber % usersInOrder;
                      const isEvenRound = nextRound % 2 === 0;
                      const pickerIndex = isEvenRound ? usersInOrder - 1 - pickIndex : pickIndex;

                      if (memberIds[pickerIndex] === USER_ID) {
                        return `${i} pick${i === 1 ? '' : 's'}`;
                      }
                    }
                    return '? picks';
                  })()
                }
              </p>
            )}
            {!isDraftComplete && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: '#9ca3af' }}>
                <input
                  type="checkbox"
                  checked={autoDraftEnabled}
                  onChange={(e) => setAutoDraftEnabled(e.target.checked)}
                />
                Auto-draft for bots
              </label>
            )}
          </div>

          <div className="draft-box">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Draft Progress</h3>
            <p style={{ margin: 0 }}>
              Current Pick: {isDraftComplete
                ? '—'
                : `${currentRound}.${(currentPickNumber % (usersInOrder || 1)) || (usersInOrder || 1)}`}
            </p>
            <p style={{ margin: 0 }}>
              Total Picks Made: {portfolio.filter(p => p.user_id === USER_ID).length} / {totalRounds}
            </p>
            <p style={{ margin: 0 }}>
              Budget Remaining: {budgetRemaining == null ? '—' : `$${budgetRemaining.toFixed(2)}`}
            </p>
          </div>
          <div className="draft-box">
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Recent Pick</h3>
            {recentPick ? (
              <div>
                <strong>{recentPick.symbol}</strong>
                {` — ${prettyName(symbolToName[recentPick.symbol?.toUpperCase()] || recentPick.company_name || '')}`}<br />
                Price: ${Number(recentPick.entry_price).toFixed(2)}
              </div>
            ) : (
              <p style={{ margin: 0 }}>No picks yet</p>
            )}
          </div>

          <DraftHistory
            selectedRound={selectedRound}
            setSelectedRound={setSelectedRound}
            totalRounds={totalRounds}
            portfolio={portfolio}
            symbolToName={symbolToName}
          />
        </div>

        {/* RIGHT: Your Drafted Stocks */}
        <div className="draft-box" style={{ maxHeight: 240, overflowY: 'auto' }}>
          <h3 className="text-lg font-semibold mb-2">Your Drafted Stocks</h3>
          {portfolio.filter(p => p.user_id === USER_ID).length > 0 ? (
            <ul>
              {portfolio
                .filter(p => p.user_id === USER_ID)
                .map((stock, idx) => {
                  const sym = stock.symbol?.toUpperCase();
                  const rawName = symbolToName[sym] || stock.company_name || '';
                  return (
                    <li key={idx} className="py-1 border-b border-gray-700">
                      <strong>{sym}</strong>
                      {rawName ? <> — {prettyName(rawName)}</> : null}
                      <br />
                      Entry: ${Number(stock.entry_price).toFixed(2)}
                    </li>
                  );
                })}
            </ul>
          ) : (
            <p className="text-gray-400 text-sm">No drafted stocks yet.</p>
          )}
        </div>
      </div>

      <DraftCompleteModal
        show={isDraftComplete && showCompleteModal}
        onClose={() => setShowCompleteModal(false)}
        leagueName={league?.name}
        portfolio={portfolio}
        symbolToName={symbolToName}
        USER_ID={USER_ID}
      />
    </div>
  );
}
