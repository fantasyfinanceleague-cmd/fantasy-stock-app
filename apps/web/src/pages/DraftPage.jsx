// src/pages/DraftPage.jsx
import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase/supabaseClient';
import '../layout.css';
import { useAuthUser } from '../auth/useAuthUser';
import { prettyName } from '../utils/formatting';
import { fetchCompanyName } from '../utils/stockData';
import { generateSchedule, generateInitialStandings, getNextDayMarketOpen, getMarketClose } from '../utils/scheduleGenerator';
import DraftControls from '../components/DraftControls';
import DraftHistory from '../components/DraftHistory';
import DraftRecap from '../components/DraftRecap';
import DraftSetupModal from '../components/DraftSetupModal';
import { PageLoader } from '../components/LoadingSpinner';
import { useUserProfiles } from '../context/UserProfilesContext';
import { useToast } from '../components/Toast';

// Draft access rules
const MIN_PARTICIPANTS = 4;
const REQUIRE_DRAFT_DATE = true; // Enforce draft date before starting

// Popular stocks for bot auto-picks with approximate price tiers
// Organized by rough price range to help bots pick within budget
const BOT_STOCK_POOL_BY_TIER = {
  // Under $50
  cheap: [
    'F', 'T', 'CSCO', 'PFE', 'BAC', 'INTC', 'WFC', 'VZ', 'KO', 'PEP',
    'GM', 'SNAP', 'AAL', 'DAL', 'UAL', 'CCL', 'NCLH', 'RCL', 'UBER', 'LYFT',
    'PLTR', 'SOFI', 'NIO', 'RIVN', 'LCID', 'PLUG', 'FCEL', 'SPCE', 'BB', 'NOK',
    'PARA', 'WBD', 'DISH', 'LUMN', 'PCG', 'ET', 'EPD', 'MRO', 'OXY', 'SWN'
  ],
  // $50-150
  mid: [
    'AAPL', 'MSFT', 'JPM', 'JNJ', 'PG', 'MRK', 'ABBV', 'CVX', 'XOM', 'WMT',
    'DIS', 'NKE', 'MCD', 'HD', 'ABT', 'TXN', 'NEE', 'UPS', 'PM', 'MS',
    'RTX', 'HON', 'ORCL', 'IBM', 'QCOM', 'AMD', 'MU', 'AMAT', 'LRCX', 'ADI',
    'CRM', 'NOW', 'ADBE', 'PYPL', 'SQ', 'SHOP', 'SNOW', 'DDOG', 'ZS', 'CRWD',
    'GS', 'C', 'USB', 'PNC', 'TFC', 'SCHW', 'BLK', 'AXP', 'COF', 'DFS'
  ],
  // $150-400
  expensive: [
    'V', 'MA', 'UNH', 'DHR', 'TMO', 'ACN', 'LLY', 'COST',
    'ISRG', 'REGN', 'VRTX', 'BIIB', 'GILD', 'AMGN', 'BMY', 'ZTS',
    'SPGI', 'MCO', 'ICE', 'CME', 'MSCI', 'FIS', 'GPN', 'ADP'
  ],
  // $400+
  premium: [
    'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK.B', 'AVGO',
    'NFLX', 'COP', 'EOG', 'SLB', 'PSX', 'VLO', 'MPC', 'HES'
  ]
};

// Flat list for backwards compatibility
const BOT_STOCK_POOL = [
  ...BOT_STOCK_POOL_BY_TIER.cheap,
  ...BOT_STOCK_POOL_BY_TIER.mid,
  ...BOT_STOCK_POOL_BY_TIER.expensive,
  ...BOT_STOCK_POOL_BY_TIER.premium
];

// Cache for stock prices (to avoid repeated API calls)
const botPriceCache = new Map(); // symbol -> { price, timestamp }
const PRICE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ---- Finnhub fallback via Edge Function ----

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

  // Handle invocation errors
  if (error) {
    console.error('Quote function error:', error);
    throw new Error('Failed to fetch quote. Please try again.');
  }

  // Handle application-level errors from the edge function
  if (data?.error) {
    const errorType = data.error;
    const message = data.message || data.error;

    // Provide user-friendly error messages
    if (errorType === 'not_authenticated') {
      throw new Error('Please sign in to view quotes.');
    } else if (errorType === 'no_credentials') {
      throw new Error('Please link your Alpaca account in Profile settings.');
    } else if (errorType === 'credentials_invalid') {
      throw new Error('Your Alpaca credentials are invalid. Please update them in Profile settings.');
    } else if (errorType === 'no_price') {
      throw new Error(`No price data available for "${sym}".`);
    }

    throw new Error(message);
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
  const { fetchProfiles, getDisplayName } = useUserProfiles();
  const toast = useToast();
  // keep a fallback for now so your draft keeps working if not signed in
  const USER_ID = authUser?.id ?? 'test-user';
  const { leagueId: routeLeagueId } = useParams();
  const [leagueId, setLeagueId] = useState(null);
  const [leagues, setLeagues] = useState([]); // All leagues user is a member of

  // gating/meta
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isMember, setIsMember] = useState(false);
  const [isCommissioner, setIsCommissioner] = useState(false);
  const [memberIds, setMemberIds] = useState([]);
  const memberCount = memberIds.length;
  const [league, setLeague] = useState(null);
  const [draftStatus, setDraftStatus] = useState('not_started');
  const [allowed, setAllowed] = useState(false);

  // draft state
  const [portfolio, setPortfolio] = useState([]); // picks for THIS league
  const [currentRound, setCurrentRound] = useState(1);
  const [currentPickNumber, setCurrentPickNumber] = useState(1);
  const [currentPicker, setCurrentPicker] = useState(null);


  // auto-draft for bots
  const [autoDraftEnabled, setAutoDraftEnabled] = useState(true);
  const [botPickInProgress, setBotPickInProgress] = useState(false);
  const botPickLockRef = useRef(false); // Immediate lock to prevent race conditions
  const [realUserIds, setRealUserIds] = useState(new Set()); // IDs that exist in auth.users

  // draft setup modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [customMinParticipants, setCustomMinParticipants] = useState(MIN_PARTICIPANTS);

  // Alpaca account linking status
  const [membersWithoutAlpaca, setMembersWithoutAlpaca] = useState([]); // user IDs without linked Alpaca

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
  const leagueBudget = Number(league?.budget_amount ?? league?.salary_cap_limit ?? 0);
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
    // Don't run with test-user fallback - wait for real auth
    if (!authUser?.id) return;
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

    // Don't run with test-user fallback - wait for real auth
    if (!authUser?.id) {
      setLoading(true); // Keep loading while waiting for auth
      return;
    }

    (async () => {
      setLoading(true);
      setError('');
      setAllowed(false);
      try {
        // 1) Load league meta FIRST so we have the name even if user isn't a member
        const { data: lg, error: lgErr } = await supabase
          .from('leagues')
          .select('id, name, draft_date, num_rounds, num_participants, budget_mode, budget_amount, commissioner_id, draft_status, duration_days, league_type, num_weeks')
          .eq('id', leagueId)
          .single();
        if (lgErr) throw lgErr;
        setLeague(lg);
        setDraftStatus(lg.draft_status || 'not_started');
        setIsCommissioner(lg.commissioner_id === USER_ID);

        // 2) Load members
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

        // 3) Draft order: commissioner first, others alphabetical
        const commissionerId = lg?.commissioner_id || null;
        const rest = rawIds.filter(id => id !== commissionerId).sort();
        const orderedIds = commissionerId ? [commissionerId, ...rest] : [...rest];
        setMemberIds(orderedIds);

        // 3b) Check which member IDs are real auth users (for bot detection)
        let realIdsSet = new Set([USER_ID]);
        try {
          const { data: realIds } = await supabase.rpc('get_real_user_ids', { user_ids: orderedIds });
          realIdsSet = new Set(realIds || []);
          setRealUserIds(realIdsSet);
        } catch (e) {
          // If function doesn't exist yet, assume only current user is real
          setRealUserIds(realIdsSet);
        }

        // 3c) Check which real users have linked their Alpaca accounts
        const realUserIdsList = Array.from(realIdsSet);
        if (realUserIdsList.length > 0) {
          const { data: linkedAccounts } = await supabase
            .from('broker_credentials')
            .select('user_id')
            .eq('broker', 'alpaca')
            .in('user_id', realUserIdsList);

          const linkedUserIds = new Set((linkedAccounts || []).map(a => a.user_id));
          const unlinked = realUserIdsList.filter(id => !linkedUserIds.has(id));
          setMembersWithoutAlpaca(unlinked);
        }

        // 4) Gate - check requirements but don't early return (allow modal to show)
        const hasDraftDate = !!lg?.draft_date;
        const startsAt = hasDraftDate ? new Date(lg.draft_date) : null;
        const now = new Date();
        const timeOk = !REQUIRE_DRAFT_DATE || (startsAt && now >= startsAt);

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
  }, [leagueId, USER_ID]);

  // Track if realtime is working
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  // Real-time subscription for league status changes and draft picks
  useEffect(() => {
    if (!leagueId) return;


    const channelName = `draft-room-${leagueId}`;

    // Remove any existing channel with this name first
    const existingChannel = supabase.getChannels().find(ch => ch.topic === `realtime:${channelName}`);
    if (existingChannel) {
      supabase.removeChannel(existingChannel);
    }

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'leagues', filter: `id=eq.${leagueId}` },
        (payload) => {
          if (payload.new.draft_status) {
            setDraftStatus(payload.new.draft_status);
            // When draft starts, automatically allow user to join
            if (payload.new.draft_status === 'in_progress') {
              setAllowed(true);
            }
          }
          // Update league data if other fields changed
          setLeague(prev => ({ ...prev, ...payload.new }));
        }
      )
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'drafts', filter: `league_id=eq.${leagueId}` },
        (payload) => {
          // Add new pick to portfolio (avoid duplicates from own picks)
          setPortfolio(prev => {
            const exists = prev.some(p => p.id === payload.new.id);
            if (exists) return prev;
            const updated = [payload.new, ...prev];
            return updated;
          });

          // Ensure we have the name for the new symbol
          if (payload.new?.symbol) {
            const sym = payload.new.symbol.toUpperCase();
            fetchCompanyName(sym).then(name => {
              if (name) {
                setSymbolToName(prev => ({ ...prev, [sym]: name }));
              }
            });
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeConnected(true);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setRealtimeConnected(false);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  // Fallback polling when realtime is not connected
  useEffect(() => {
    if (!leagueId || realtimeConnected) return;


    const pollInterval = setInterval(async () => {
      try {
        // Poll for league status changes
        const { data: lg } = await supabase
          .from('leagues')
          .select('draft_status')
          .eq('id', leagueId)
          .single();

        if (lg?.draft_status && lg.draft_status !== draftStatus) {
          setDraftStatus(lg.draft_status);
          if (lg.draft_status === 'in_progress') {
            setAllowed(true);
          }
        }

        // Poll for new picks
        const { data: picks } = await supabase
          .from('drafts')
          .select('*')
          .eq('league_id', leagueId)
          .order('pick_number', { ascending: false });

        if (picks && picks.length > portfolio.length) {
          setPortfolio(picks);
          // Fetch names for any new symbols
          const newPicks = picks.slice(0, picks.length - portfolio.length);
          newPicks.forEach(pick => {
            if (pick?.symbol) {
              const sym = pick.symbol.toUpperCase();
              fetchCompanyName(sym).then(name => {
                if (name) {
                  setSymbolToName(prev => ({ ...prev, [sym]: name }));
                }
              });
            }
          });
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [leagueId, realtimeConnected, draftStatus, portfolio.length]);

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

  // Mark draft as completed in database when all picks are made
  // Handle both duration-based and matchup-based leagues
  useEffect(() => {
    if (!isDraftComplete || draftStatus !== 'in_progress') return;

    const completeDraft = async () => {
      const draftCompleteTime = new Date();
      const leagueType = league?.league_type || 'duration';
      let startDate;
      let endDate;

      if (leagueType === 'matchup') {
        // Matchup league: first week starts the following Tuesday at market open
        const numWeeks = league?.num_weeks || (memberIds.length - 1);

        // Generate matchup schedule - this calculates proper Tuesday start dates
        const schedule = generateSchedule(memberIds, numWeeks, draftCompleteTime);

        // Use the first matchup's week start as the league start date
        // (the schedule generator finds the next Tuesday at market open)
        startDate = schedule.length > 0 ? schedule[0].weekStart : getNextDayMarketOpen(draftCompleteTime);

        // End date is the last matchup's week end (Friday market close of final week)
        endDate = schedule.length > 0
          ? schedule[schedule.length - 1].weekEnd
          : new Date(startDate.getTime() + numWeeks * 7 * 24 * 60 * 60 * 1000);

        // Insert matchups
        const matchupRows = schedule.map(m => ({
          league_id: leagueId,
          week_number: m.week,
          team1_user_id: m.team1,
          team2_user_id: m.team2,
          week_start: m.weekStart.toISOString(),
          week_end: m.weekEnd.toISOString(),
        }));

        if (matchupRows.length > 0) {
          const { error: matchupErr } = await supabase
            .from('matchups')
            .insert(matchupRows);
          if (matchupErr) console.error('Failed to insert matchups:', matchupErr);
        }

        // Initialize standings for all members
        const standingsRows = generateInitialStandings(leagueId, memberIds);
        const { error: standingsErr } = await supabase
          .from('league_standings')
          .insert(standingsRows);
        if (standingsErr) console.error('Failed to initialize standings:', standingsErr);
      } else {
        // Duration league: starts next day at market open (9:30 AM ET)
        // If draft completes March 3rd, league starts March 4th at market open
        const durationDays = league?.duration_days || 30;
        startDate = getNextDayMarketOpen(draftCompleteTime);

        // End date is duration_days later at market close (4:00 PM ET)
        const rawEndDate = new Date(startDate.getTime() + durationDays * 24 * 60 * 60 * 1000);
        endDate = getMarketClose(rawEndDate);
      }

      // Update league with completion status and dates
      const { error } = await supabase
        .from('leagues')
        .update({
          draft_status: 'completed',
          league_start_date: startDate.toISOString(),
          league_end_date: endDate.toISOString(),
        })
        .eq('id', leagueId);

      if (error) {
        console.error('Failed to mark draft as completed:', error);
      } else {
        setDraftStatus('completed');
      }
    };

    completeDraft();
  }, [isDraftComplete, draftStatus, leagueId, league?.duration_days, league?.league_type, league?.num_weeks, memberIds]);

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
  // Accepts optional symbolOverride for when called from dropdown selection
  async function getQuote(symbolOverride) {
    try {
      const upper = String(symbolOverride || symbol).trim().toUpperCase();
      let q = await fetchQuoteViaFunction(upper);

      // Fallback to Finnhub via Edge Function if Alpaca didn't return a price
      if (!q?.price) {
        try {
          const { data: fData, error: fErr } = await supabase.functions.invoke('finnhub-quote', {
            body: { symbol: upper }
          });
          if (!fErr && fData?.price) {
            q = { symbol: upper, price: Number(fData.price) };
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
      toast.warning('This stock is over your remaining budget.');
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
      console.error('Paper order failed');
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
      console.error('Supabase insert error:', insErr);
      toast.error('Failed to draft stock.');
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
      toast.error('Could not add bots.');
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

  // Fetch user profiles for display names
  useEffect(() => {
    if (memberIds.length > 0) {
      // Only fetch profiles for real user IDs (not bots)
      const realMemberIds = memberIds.filter(id => !id.startsWith('bot-'));
      if (realMemberIds.length > 0) {
        fetchProfiles(realMemberIds);
      }
    }
  }, [memberIds, fetchProfiles]);

  // Track bots that have failed to pick (to avoid infinite loops)
  const [failedBots, setFailedBots] = useState(new Set());

  // --- Bot auto-draft: pick a random stock for non-human players
  async function botAutoPick(botUserId) {
    // Use ref for immediate lock check (state is async and can cause race conditions)
    if (!leagueId || botPickLockRef.current) return;

    // Skip if this bot has already failed
    if (failedBots.has(botUserId)) {
      return;
    }

    // Immediately lock using ref (synchronous, prevents race conditions)
    botPickLockRef.current = true;
    setBotPickInProgress(true);

    try {
      // IMPORTANT: Fetch fresh picks from database to avoid race conditions
      // React state may be stale if multiple bot picks happen quickly
      const { data: freshPicks, error: picksErr } = await supabase
        .from('drafts')
        .select('id, symbol, user_id, entry_price, pick_number')
        .eq('league_id', leagueId)
        .order('pick_number', { ascending: false });

      if (picksErr) {
        console.error('Failed to fetch fresh picks:', picksErr);
        setBotPickInProgress(false);
        return;
      }

      const currentPicks = freshPicks || [];

      // Get already-picked symbols in this league to avoid duplicates
      const pickedSymbols = new Set(currentPicks.map(p => p.symbol?.toUpperCase()));

      // Calculate bot's remaining budget if in budget mode
      let botBudgetRemaining = Infinity;
      if (isBudgetMode) {
        const botSpent = currentPicks
          .filter(p => p.user_id === botUserId)
          .reduce((sum, p) => sum + Number(p.entry_price || 0), 0);
        botBudgetRemaining = Math.max(leagueBudget - botSpent, 0);


        // If bot has no budget left, mark as failed
        if (botBudgetRemaining <= 0) {
          setFailedBots(prev => new Set([...prev, botUserId]));
          setBotPickInProgress(false);
          return;
        }
      }

      // Use fresh pick count for the new pick number
      const currentPickCount = currentPicks.length;

      // Smart stock selection based on budget
      // First, determine which price tiers the bot can afford
      let stocksToTry = [];

      if (isBudgetMode) {
        // Prioritize stocks based on budget remaining
        if (botBudgetRemaining < 50) {
          // Very low budget - only try cheap stocks
          stocksToTry = [...BOT_STOCK_POOL_BY_TIER.cheap];
        } else if (botBudgetRemaining < 150) {
          // Low budget - cheap first, then mid
          stocksToTry = [...BOT_STOCK_POOL_BY_TIER.cheap, ...BOT_STOCK_POOL_BY_TIER.mid];
        } else if (botBudgetRemaining < 400) {
          // Medium budget - mid first, then cheap, then expensive
          stocksToTry = [...BOT_STOCK_POOL_BY_TIER.mid, ...BOT_STOCK_POOL_BY_TIER.cheap, ...BOT_STOCK_POOL_BY_TIER.expensive];
        } else {
          // High budget - can try anything, prefer variety
          stocksToTry = [...BOT_STOCK_POOL_BY_TIER.mid, ...BOT_STOCK_POOL_BY_TIER.expensive, ...BOT_STOCK_POOL_BY_TIER.cheap, ...BOT_STOCK_POOL_BY_TIER.premium];
        }
      } else {
        // No budget mode - use all stocks
        stocksToTry = [...BOT_STOCK_POOL];
      }

      // Filter out already picked stocks
      const availableStocks = stocksToTry.filter(s => !pickedSymbols.has(s));

      if (availableStocks.length === 0) {
        setFailedBots(prev => new Set([...prev, botUserId]));
        setBotPickInProgress(false);
        return;
      }

      // Shuffle within each priority group for variety
      const shuffledStocks = [...availableStocks].sort(() => Math.random() - 0.5);

      // Try to find an affordable stock
      let selectedSymbol = null;
      let selectedPrice = null;

      for (const candidateSymbol of shuffledStocks) {
        // Check cache first
        const cached = botPriceCache.get(candidateSymbol);
        let price;

        if (cached && (Date.now() - cached.timestamp < PRICE_CACHE_TTL)) {
          price = cached.price;
        } else {
          // Get fresh quote
          try {
            const q = await fetchQuoteViaFunction(candidateSymbol);
            price = q?.price ?? 100;
            // Cache the price
            botPriceCache.set(candidateSymbol, { price, timestamp: Date.now() });
          } catch {
            price = 100; // fallback
          }
        }

        // In budget mode, check if bot can afford this stock
        if (isBudgetMode && price > botBudgetRemaining) {
          continue;
        }

        // Found an affordable stock!
        selectedSymbol = candidateSymbol;
        selectedPrice = price;
        break;
      }

      // If no affordable stock found, mark bot as failed
      if (!selectedSymbol) {
        setFailedBots(prev => new Set([...prev, botUserId]));
        setBotPickInProgress(false);
        return;
      }

      // Insert the pick using fresh pick count from database
      const newPickNumber = currentPickCount + 1;
      const newRound = Math.floor(currentPickCount / memberIds.length) + 1;

      // IMPORTANT: Check if this pick_number already exists to prevent duplicates
      const { data: existingPick } = await supabase
        .from('drafts')
        .select('id')
        .eq('league_id', leagueId)
        .eq('pick_number', newPickNumber)
        .maybeSingle();

      if (existingPick) {
        // Pick already exists - another process beat us, just release lock and let state sync
        console.log(`Pick ${newPickNumber} already exists, skipping duplicate`);
        return;
      }

      const payload = {
        league_id: leagueId,
        user_id: botUserId,
        symbol: selectedSymbol,
        entry_price: selectedPrice,
        quantity: 1,
        round: newRound,
        pick_number: newPickNumber,
        draft_date: new Date().toISOString(),
      };

      const { data: inserted, error: insErr } = await supabase
        .from('drafts')
        .insert(payload)
        .select('*')
        .single();

      if (insErr) {
        // Check if error is due to duplicate pick_number (unique constraint violation)
        if (insErr.code === '23505') {
          console.log(`Pick ${newPickNumber} already inserted by another process`);
          return;
        }
        console.error('Bot pick failed:', insErr);
        // Mark bot as failed to prevent infinite retries
        setFailedBots(prev => new Set([...prev, botUserId]));
        return;
      }

      setPortfolio(prev => [inserted, ...(prev || [])]);
      void ensureNameForSymbol(selectedSymbol);
    } finally {
      // Release both locks
      botPickLockRef.current = false;
      setBotPickInProgress(false);
    }
  }

  // --- Helper: Skip a player's turn (used when bot can't pick)
  async function skipTurn(userId) {
    // Insert a "skip" pick with $0 to advance the draft
    const newPickNumber = (portfolio?.length || 0) + 1;
    const payload = {
      league_id: leagueId,
      user_id: userId,
      symbol: 'SKIP',
      entry_price: 0,
      quantity: 0,
      round: currentRound,
      pick_number: newPickNumber,
      draft_date: new Date().toISOString(),
    };

    const { data: inserted, error: insErr } = await supabase
      .from('drafts')
      .insert(payload)
      .select('*')
      .single();

    if (!insErr && inserted) {
      setPortfolio(prev => [inserted, ...(prev || [])]);
    }
  }

  // --- Effect: Auto-pick for bots when it's their turn
  useEffect(() => {
    // Check both state and ref to prevent race conditions
    if (!autoDraftEnabled || !allowed || !currentPicker || botPickInProgress || botPickLockRef.current) return;

    // Check if current picker is a real user (exists in auth.users)
    const isRealUser = realUserIds.has(currentPicker);
    if (isRealUser) return; // Real users pick for themselves

    // Skip if this bot has failed (can't afford any stocks or other error)
    if (failedBots.has(currentPicker)) {
      // Auto-skip the bot's turn to advance the draft
      const timer = setTimeout(() => {
        skipTurn(currentPicker);
      }, 500);
      return () => clearTimeout(timer);
    }

    // Check if draft is complete
    const totalRounds = Number(league?.num_rounds ?? 6);
    const draftCap = memberIds.length * totalRounds;
    if (portfolio.length >= draftCap) return;

    // Small delay so user can see what's happening
    const timer = setTimeout(() => {
      botAutoPick(currentPicker);
    }, 800);

    return () => clearTimeout(timer);
  }, [currentPicker, autoDraftEnabled, allowed, botPickInProgress, portfolio.length, realUserIds, failedBots, memberIds, league?.num_rounds]);

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
    return <PageLoader message="Loading draft..." />;
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 }}>
            <div>
              <h2 style={{ color: '#fff', margin: 0, marginBottom: 4 }}>{league?.name || 'League'}</h2>
              <h3 style={{ color: '#e5e7eb', marginTop: 0, fontSize: '1.1rem' }}>You're not in this league</h3>
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
  const draftDateReached = !REQUIRE_DRAFT_DATE || (startsAt && new Date() >= startsAt);
  const timeMsg =
    REQUIRE_DRAFT_DATE && startsAt && !draftDateReached
      ? `Draft opens at ${startsAt.toLocaleString()}`
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
              {isCommissioner ? (
                <button className="btn primary" onClick={() => setShowSetupModal(true)}>
                  Setup Options
                </button>
              ) : (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: 8,
                  color: '#60a5fa',
                  fontSize: '0.9rem'
                }}>
                  ⏳ Waiting for commissioner to set up the draft...
                </div>
              )}
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
            userEmail={authUser?.email}
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

  // Check draft status - only show draft UI if draft is in progress
  if (draftStatus === 'not_started') {
    // Draft hasn't started yet
    const draftStartTime = league?.draft_date ? new Date(league.draft_date) : null;
    const canStartDraft = !REQUIRE_DRAFT_DATE || (draftStartTime && new Date() >= draftStartTime);

    const handleStartDraft = async () => {
      if (!canStartDraft) {
        toast.error(`Draft cannot start until ${draftStartTime?.toLocaleString()}`);
        return;
      }
      try {
        const { error } = await supabase
          .from('leagues')
          .update({ draft_status: 'in_progress' })
          .eq('id', leagueId);
        if (error) throw error;
        setDraftStatus('in_progress');
        setAllowed(true);
      } catch (err) {
        console.error('Failed to start draft:', err);
        toast.error('Failed to start draft. Please try again.');
      }
    };

    return (
      <div className="page">
        <div className="draft-pending-container">
          {/* Minimal header */}
          <div className="draft-header-minimal">
            <div className="draft-header-left">
              <Link className="btn" to="/leagues">Back to Leagues</Link>
              {leagues.length > 1 && (
                <select
                  value={leagueId || ''}
                  onChange={handleLeagueChange}
                  className="round-select"
                >
                  {leagues.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="draft-pending-content">
            <div className="draft-pending-icon">
              {canStartDraft ? '🚀' : '⏰'}
            </div>
            <h2 className="draft-pending-title">{league?.name}</h2>
            <p className="draft-pending-subtitle">
              {isCommissioner
                ? (canStartDraft ? 'Ready to Start' : 'Scheduled Draft')
                : 'Waiting for Draft'}
            </p>

            {/* League stats */}
            <div className="draft-pending-stats">
              <div className="pending-stat">
                <span className="pending-stat-value">{memberCount}</span>
                <span className="pending-stat-label">Members</span>
              </div>
              <div className="pending-stat">
                <span className="pending-stat-value">{totalRounds}</span>
                <span className="pending-stat-label">Rounds</span>
              </div>
              {draftStartTime && (
                <div className="pending-stat">
                  <span className="pending-stat-value">{draftStartTime.toLocaleDateString()}</span>
                  <span className="pending-stat-label">{draftStartTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
            </div>

            {/* Status message */}
            {!canStartDraft && draftStartTime && (
              <div className="draft-pending-notice warning">
                Draft opens {draftStartTime.toLocaleString()}
              </div>
            )}

            {/* TBD date message */}
            {!draftStartTime && isCommissioner && (
              <div className="draft-pending-notice warning">
                Draft date not set. Set a date in league settings before starting.
              </div>
            )}
            {!draftStartTime && !isCommissioner && (
              <div className="draft-pending-notice">
                Waiting for commissioner to set a draft date
              </div>
            )}

            {/* Alpaca warning */}
            {membersWithoutAlpaca.length > 0 && (
              <div className="draft-pending-notice error">
                <strong>Alpaca Required</strong>
                <span>
                  {membersWithoutAlpaca.length === 1 && membersWithoutAlpaca[0] === USER_ID
                    ? 'Link your Alpaca account to continue'
                    : `${membersWithoutAlpaca.length} member${membersWithoutAlpaca.length > 1 ? 's' : ''} need to link Alpaca`}
                </span>
                {membersWithoutAlpaca.includes(USER_ID) && (
                  <Link to="/profile" className="btn primary" style={{ marginTop: 8 }}>
                    Link Account
                  </Link>
                )}
              </div>
            )}

            {/* Action button */}
            <div className="draft-pending-actions">
              {isCommissioner ? (
                <button
                  className="btn primary large"
                  onClick={handleStartDraft}
                  disabled={membersWithoutAlpaca.length > 0 || !canStartDraft}
                >
                  {canStartDraft ? 'Start Draft' : (!draftStartTime ? 'Set Draft Date First' : 'Not Available Yet')}
                </button>
              ) : (
                <div className="draft-pending-waiting">
                  Waiting for commissioner to start the draft...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (draftStatus === 'in_progress' && !allowed) {
    // Draft is in progress but user hasn't joined yet
    const handleJoinDraft = () => {
      setAllowed(true);
    };

    return (
      <div className="page">
        <div className="draft-pending-container">
          {/* Minimal header */}
          <div className="draft-header-minimal">
            <div className="draft-header-left">
              <Link className="btn" to="/leagues">Back to Leagues</Link>
              {leagues.length > 1 && (
                <select
                  value={leagueId || ''}
                  onChange={handleLeagueChange}
                  className="round-select"
                >
                  {leagues.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="draft-pending-content">
            <div className="draft-pending-icon live">🔴</div>
            <h2 className="draft-pending-title">{league?.name}</h2>
            <p className="draft-pending-subtitle">Draft in Progress</p>

            <div className="draft-pending-stats">
              <div className="pending-stat">
                <span className="pending-stat-value">{portfolio.length}</span>
                <span className="pending-stat-label">Picks Made</span>
              </div>
              <div className="pending-stat">
                <span className="pending-stat-value">{memberCount}</span>
                <span className="pending-stat-label">Members</span>
              </div>
            </div>

            <div className="draft-pending-actions">
              <button className="btn primary large" onClick={handleJoinDraft}>
                Join Live Draft
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Draft workspace ----------
  return (
    <div className="page">
      {/* Show Draft Recap if complete, otherwise show draft interface */}
      {isDraftComplete ? (
        <div className="draft-recap-container">
          {/* Minimal header for completed draft */}
          <div className="draft-header-minimal">
            <Link className="btn" to="/leagues">Back to Leagues</Link>
            {leagues.length > 1 && (
              <select
                value={leagueId || ''}
                onChange={handleLeagueChange}
                className="round-select"
              >
                {leagues.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </div>
          <DraftRecap
            leagueName={league?.name}
            portfolio={portfolio}
            symbolToName={symbolToName}
            USER_ID={USER_ID}
            memberIds={memberIds}
            leagueBudget={leagueBudget}
            isBudgetMode={isBudgetMode}
          />
        </div>
      ) : (
        <div className="draft-workspace">
          {/* Minimal header for active draft */}
          <div className="draft-header-minimal">
            <div className="draft-header-left">
              <Link className="btn" to="/leagues">Back to Leagues</Link>
              <span className="draft-league-name">{league?.name}</span>
              <span className="draft-league-meta">
                {totalRounds} rounds • {memberCount} members
                {isBudgetMode ? ` • $${leagueBudget} budget` : ''}
              </span>
            </div>
            {leagues.length > 1 && (
              <select
                value={leagueId || ''}
                onChange={handleLeagueChange}
                className="round-select"
              >
                {leagues.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Turn Status Banner */}
          <div className={`draft-turn-banner ${currentPicker === USER_ID ? 'your-turn' : ''}`}>
            <div className="turn-status">
              <span className="turn-indicator">
                {botPickInProgress
                  ? '🤖 Bot is picking...'
                  : currentPicker === USER_ID
                    ? '✅ Your Turn to Draft'
                    : realUserIds.has(currentPicker)
                      ? '⏳ Waiting for player...'
                      : '⏳ Bot is selecting...'}
              </span>
              {currentPicker !== USER_ID && !botPickInProgress && (
                <span className="current-picker">
                  {currentPicker?.startsWith('bot-')
                    ? currentPicker
                    : getDisplayName(currentPicker, USER_ID)}
                </span>
              )}
            </div>
            <div className="turn-meta">
              <span>Round {currentRound} • Pick {currentPickNumber}</span>
              {USER_ID !== currentPicker && (
                <span className="picks-until">
                  Your turn in {
                    (() => {
                      const totalPicks = portfolio.length;
                      const usersInOrderCount = memberIds.length;
                      for (let i = 1; i <= usersInOrderCount * 2; i++) {
                        const nextPickNumber = totalPicks + i;
                        const nextRound = Math.floor(nextPickNumber / usersInOrderCount) + 1;
                        const pickIndex = nextPickNumber % usersInOrderCount;
                        const isEvenRound = nextRound % 2 === 0;
                        const pickerIndex = isEvenRound ? usersInOrderCount - 1 - pickIndex : pickIndex;
                        if (memberIds[pickerIndex] === USER_ID) {
                          return `${i} pick${i === 1 ? '' : 's'}`;
                        }
                      }
                      return '? picks';
                    })()
                  }
                </span>
              )}
            </div>
          </div>

          <div className="draft-main-v2">
            {/* Search and Draft Controls */}
            <div className="draft-search-section">
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

              {/* Progress Stats */}
              <div className="draft-stats">
                <div className="stat-item">
                  <span className="stat-label">Your Picks</span>
                  <span className="stat-value">{portfolio.filter(p => p.user_id === USER_ID).length} / {totalRounds}</span>
                </div>
                {isBudgetMode && (
                  <div className="stat-item">
                    <span className="stat-label">Budget Left</span>
                    <span className="stat-value">${budgetRemaining?.toFixed(2) ?? '—'}</span>
                  </div>
                )}
                <div className="stat-item">
                  <span className="stat-label">Total Picks</span>
                  <span className="stat-value">{portfolio.length} / {draftCap}</span>
                </div>
                {/* Auto-draft toggle inline */}
                <label className="auto-draft-toggle" style={{ marginLeft: 'auto' }}>
                  <input
                    type="checkbox"
                    checked={autoDraftEnabled}
                    onChange={(e) => setAutoDraftEnabled(e.target.checked)}
                  />
                  <span>Auto-draft bots</span>
                </label>
              </div>
            </div>

            {/* Your Stocks and Draft History - Side by Side */}
            <div className="draft-boards">
              {/* Your Drafted Stocks */}
              <div className="draft-board">
                <div className="draft-board-header">
                  <h3>Your Stocks</h3>
                  <span className="draft-board-count">{portfolio.filter(p => p.user_id === USER_ID).length} / {totalRounds}</span>
                </div>
                <div className="draft-board-grid">
                  {Array.from({ length: totalRounds }, (_, roundIdx) => {
                    const myPicks = portfolio.filter(p => p.user_id === USER_ID);
                    const pickForRound = myPicks[roundIdx];
                    const sym = pickForRound?.symbol?.toUpperCase();
                    const name = pickForRound ? prettyName(symbolToName[sym] || pickForRound.company_name || '') : '';

                    return (
                      <div key={roundIdx} className={`draft-board-slot ${pickForRound ? 'filled' : 'empty'}`}>
                        <span className="slot-round">R{roundIdx + 1}</span>
                        {pickForRound ? (
                          <>
                            <span className="slot-stock-info">
                              <span className="slot-symbol">{sym}</span>
                              {name && <span className="slot-name">{name}</span>}
                            </span>
                            <span className="slot-price">${Number(pickForRound.entry_price).toFixed(2)}</span>
                          </>
                        ) : (
                          <span className="slot-empty">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Draft History */}
              <DraftHistory
                selectedRound={selectedRound}
                setSelectedRound={setSelectedRound}
                totalRounds={totalRounds}
                portfolio={portfolio}
                symbolToName={symbolToName}
                getDisplayName={getDisplayName}
                USER_ID={USER_ID}
                memberCount={memberIds.length}
                currentRound={Math.floor(portfolio.length / memberIds.length) + 1}
              />
            </div>

            {/* Recent Pick - Now at bottom */}
            {recentPick && (
              <div className="draft-recent-pick-bar">
                <span className="recent-label">Latest Pick:</span>
                <strong>{recentPick.symbol}</strong>
                <span className="stock-name">{prettyName(symbolToName[recentPick.symbol?.toUpperCase()] || recentPick.company_name || '')}</span>
                <span className="stock-price">${Number(recentPick.entry_price).toFixed(2)}</span>
                <span className="recent-picker">by {recentPick.user_id?.startsWith('bot-') ? recentPick.user_id : getDisplayName(recentPick.user_id, USER_ID)}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
