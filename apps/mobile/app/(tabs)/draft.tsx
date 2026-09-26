/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Colors } from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import LeagueSwitcher from '@/components/LeagueSwitcher';
import { notifyDraftTurn } from '@/lib/notifications';
import {
  type Category,
  fetchCategories,
  fetchSymbolCategories,
} from '@/lib/categoryData';
import { Button, Card, Screen } from '@/components/ui';
import SymbolSearchField from '@/components/SymbolSearchField';
import { parseQuotePrice, type ShapedSearchResult } from '@/lib/symbolSearch';
import {
  computeDraftPhase,
  describeStartBlocker,
  msUntilStartRecheck,
  computeDraftHeaderState,
  type StartBlocker,
} from '@/lib/draftState';
import { formatShortDateTime } from '@/lib/weekStatus';

interface DraftPick {
  id: string;
  user_id: string;
  symbol: string;
  entry_price: number;
  round: number;
  pick_number: number;
  slot_id?: string | null;
  created_at: string;
  display_name?: string;
}

interface LeagueSlot {
  id: string;
  slot_index: number;
  slot_count: number;
  price_min: number | null;
  price_max: number | null;
  category_id: string | null;
}

interface LeagueMember {
  user_id: string;
  role: string;
  display_name?: string;
}

// Refusal reasons from validate-and-record-pick, mapped to user-facing copy.
const PICK_REFUSAL_MESSAGES: Record<string, string> = {
  not_your_turn: "It's not your turn to pick",
  draft_complete: 'The draft is already complete',
  draft_not_in_progress: 'The draft is not in progress',
  symbol_owned: 'That stock is already owned in this league',
  not_draftable: "That stock isn't in this league's draftable universe",
  no_eligible_slot: 'No open roster slot accepts a stock at this price',
  over_budget: 'That stock is over your remaining budget',
  no_price: 'No recent price available for that stock',
  pick_conflict: 'Someone picked at the same moment — refresh and try again',
  rate_limited: 'Too many picks too quickly — wait a moment and try again',
  draft_not_complete: 'The draft is not finished yet',
  forbidden_target: "You can't pick on that player's behalf",
  not_a_member: "You're not a member of this league",
};

// Refusal reasons from draft-control, mapped to user-facing copy.
const START_REFUSAL_MESSAGES: Record<string, string> = {
  not_commissioner: 'Only the commissioner can start the draft',
  bots_not_allowed: "This league can't add bots yet",
  no_bots_needed: 'This league already has enough members',
  not_started_state: 'The draft has already started',
  bot_id_conflict: 'That just ran on another device — try again',
};

export default function DraftScreen() {
  const { user } = useAuth();
  const { activeLeagueId, activeLeague, refresh: refreshLeagues } = useLeagueContext();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [picks, setPicks] = useState<DraftPick[]>([]);
  const [members, setMembers] = useState<LeagueMember[]>([]);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);

  // Stock search
  const [searchInputText, setSearchInputText] = useState('');
  const [quote, setQuote] = useState<{ symbol: string; price: number } | null>(null);
  const [quoteCats, setQuoteCats] = useState<{ categories: Category[]; classified: boolean } | null>(null);
  const [leagueSlots, setLeagueSlots] = useState<LeagueSlot[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Commissioner start-draft / add-bots (draft-control) state
  const [startStatus, setStartStatus] = useState<{
    can_start: boolean;
    blockers: StartBlocker[];
    is_commissioner: boolean;
    bots_allowed: boolean;
    bots_needed: number;
  } | null>(null);
  const [startStatusLoading, setStartStatusLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [addingBots, setAddingBots] = useState(false);

  // Finalize-heal state (every pick made, server hasn't flipped draft_status)
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [retryingFinalize, setRetryingFinalize] = useState(false);
  const finalizeAttemptedRef = useRef(false);

  // Bot auto-pick: any member's open app fires the next bot's turn — see
  // KNOWN LIMIT in validate-and-record-pick's header comment.
  const [botPickInFlight, setBotPickInFlight] = useState(false);
  const botPickAttemptedForRef = useRef<string | null>(null);

  // Completed draft view state
  const [selectedRound, setSelectedRound] = useState(1);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Derived state
  const numRounds = activeLeague?.num_rounds || 6;
  const totalPicks = draftOrder.length * numRounds;
  const currentPickNumber = picks.length + 1;
  const currentRound = Math.ceil(currentPickNumber / draftOrder.length) || 1;
  const pickInRound = ((currentPickNumber - 1) % draftOrder.length);

  // Snake draft: odd rounds go forward, even rounds go backward
  const isReverseRound = currentRound % 2 === 0;
  const orderForRound = isReverseRound ? [...draftOrder].reverse() : draftOrder;
  const currentPickerIndex = pickInRound;
  const currentPicker = orderForRound[currentPickerIndex];

  const isMyTurn = currentPicker === user?.id;
  const isDraftComplete = picks.length >= totalPicks;
  const isDraftNotStarted = activeLeague?.draft_status === 'not_started';
  const isDraftCompleted = activeLeague?.draft_status === 'completed';
  const isCommissioner = activeLeague?.commissioner_id === user?.id;

  // What should this screen show right now? See lib/draftState.ts — this is
  // the fix for docs/STATUS.md §4 defect 10: 'finalizing' is a phase distinct
  // from both 'drafting' (someone still has a turn) and 'completed' (the
  // server actually flipped draft_status), so the screen never claims
  // completion the server hasn't recorded.
  const draftPhase = computeDraftPhase({
    draftStatus: (activeLeague?.draft_status as 'not_started' | 'in_progress' | 'completed' | undefined) ?? null,
    stakeMode: activeLeague?.stake_mode ?? null,
    memberCount: draftOrder.length,
    numRounds,
    pickCount: picks.length,
  });
  // Symbols already drafted in this league (SKIP rows excluded — they never
  // occupied a symbol) — dims + badges them in the search dropdown instead of
  // letting the user pick a duplicate and find out only after submitting.
  const ownedSymbols = useMemo(
    () => new Set(picks.filter((p) => p.symbol !== 'SKIP').map((p) => p.symbol.toUpperCase())),
    [picks],
  );

  // Budget tracking. stake_mode is authoritative (budget_cap = capped);
  // budget_mode fallback covers the pre-migration transition window only.
  // These client checks are UX mirrors — validate-and-record-pick is the
  // authoritative legality gate.
  const isBudgetMode =
    (activeLeague?.stake_mode ?? (activeLeague?.budget_mode === 'budget' ? 'budget_cap' : null)) === 'budget_cap';
  const leagueBudget = activeLeague?.budget_amount || 100000;
  const mySpent = picks
    .filter(p => p.user_id === user?.id)
    .reduce((sum, p) => sum + (p.entry_price || 0), 0);
  const budgetRemaining = leagueBudget - mySpent;

  // Fetch draft data
  const fetchDraftData = useCallback(async () => {
    if (!activeLeagueId) return;

    try {
      // Fetch members
      const { data: memberData } = await supabase
        .from('league_members')
        .select('user_id, role')
        .eq('league_id', activeLeagueId);

      // Fetch profiles
      const userIds = (memberData || []).map(m => m.user_id).filter(id => !id.startsWith('bot-'));

      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('id, username')
        .in('id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p.username]) || []);

      const membersWithNames = (memberData || []).map(m => ({
        ...m,
        display_name: m.user_id.startsWith('bot-')
          ? `Bot ${m.user_id.replace('bot-', '')}`
          : profileMap.get(m.user_id) || m.user_id.substring(0, 8) + '...'
      }));

      setMembers(membersWithNames);

      // Canonical draft order (must match validate-and-record-pick and web):
      // commissioner first, remaining member ids sorted ascending. Mobile
      // previously ordered by joined_at, which could disagree with web about
      // whose turn it was in a cross-platform league.
      const memberIdList = (memberData || []).map(m => m.user_id);
      const commissionerId = activeLeague?.commissioner_id ?? null;
      const nonCommissioners = memberIdList.filter(id => id !== commissionerId).sort();
      setDraftOrder(
        commissionerId && memberIdList.includes(commissionerId)
          ? [commissionerId, ...nonCommissioners]
          : nonCommissioners
      );

      // Fetch picks
      const { data: pickData } = await supabase
        .from('drafts')
        .select('id, user_id, symbol, entry_price, round, pick_number, slot_id, created_at')
        .eq('league_id', activeLeagueId)
        .order('pick_number', { ascending: true });

      if (pickData) {
        // Add display names to picks using the freshly fetched members
        const picksWithNames = pickData.map(p => {
          const member = membersWithNames.find(m => m.user_id === p.user_id);
          return {
            ...p,
            display_name: p.user_id.startsWith('bot-')
              ? `Bot ${p.user_id.replace('bot-', '')}`
              : member?.display_name || profileMap.get(p.user_id) || p.user_id.substring(0, 8) + '...'
          };
        });
        setPicks(picksWithNames);
      }
    } catch (e) {
      console.error('Failed to fetch draft data:', e);
    } finally {
      setLoading(false);
    }
  }, [activeLeagueId, activeLeague?.commissioner_id]);

  // Initial load and refresh
  useEffect(() => {
    fetchDraftData();
  }, [fetchDraftData]);

  // Phase 4: category names + league slot definitions (display; the server
  // validator is authoritative).
  useEffect(() => { fetchCategories().then(setCategoryList); }, []);
  useEffect(() => {
    if (!activeLeagueId) return;
    supabase
      .from('league_draft_slots')
      .select('id, slot_index, slot_count, price_min, price_max, category_id')
      .eq('league_id', activeLeagueId)
      .order('slot_index', { ascending: true })
      .then(({ data }) => setLeagueSlots((data as LeagueSlot[]) || []));
  }, [activeLeagueId]);
  useEffect(() => {
    let stale = false;
    if (quote?.symbol) {
      fetchSymbolCategories(quote.symbol).then((r) => { if (!stale) setQuoteCats(r); });
    } else {
      setQuoteCats(null);
    }
    return () => { stale = true; };
  }, [quote?.symbol]);

  const categoryNameById = (id: string) => categoryList.find((c) => c.id === id)?.name ?? 'Category';
  const slotLabel = (sl: LeagueSlot) => {
    const parts: string[] = [];
    if (sl.price_min != null || sl.price_max != null) {
      parts.push(`$${sl.price_min ?? 0}–${sl.price_max != null ? `$${sl.price_max}` : '∞'}`);
    }
    if (sl.category_id) parts.push(categoryNameById(sl.category_id));
    return parts.length ? parts.join(' • ') : 'Flex';
  };
  const mySlotFill = (slotId: string) =>
    picks.filter((pk) => pk.user_id === user?.id && pk.slot_id === slotId && pk.symbol !== 'SKIP').length;

  // Real-time subscription for picks
  useEffect(() => {
    if (!activeLeagueId) return;

    const channel = supabase
      .channel(`drafts:${activeLeagueId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'drafts',
          filter: `league_id=eq.${activeLeagueId}`
        },
        (payload) => {
          const newPick = payload.new as DraftPick;
          setPicks(prev => [...prev, {
            ...newPick,
            display_name: newPick.user_id.startsWith('bot-')
              ? `Bot ${newPick.user_id.replace('bot-', '')}`
              : members.find(m => m.user_id === newPick.user_id)?.display_name || newPick.user_id.substring(0, 8) + '...'
          }]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeLeagueId, members]);

  // draft-control 'status' — fetched while the draft hasn't started, so the
  // not-started screen can show why (and, for the commissioner, a working
  // Start Draft / Fill with bots UI). Any member may call this.
  const fetchStartStatus = useCallback(async () => {
    if (!activeLeagueId || !isDraftNotStarted) return;
    setStartStatusLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-control', {
        body: { league_id: activeLeagueId, action: 'status' },
      });
      if (!error && data?.ok) {
        setStartStatus(data);
      }
    } catch (e) {
      console.error('Failed to fetch draft-control status:', e);
    } finally {
      setStartStatusLoading(false);
    }
  }, [activeLeagueId, isDraftNotStarted]);

  // Re-fetch on focus, not just on mount — the draft screen is an href:null
  // tab route so it stays mounted across tab switches, and this callback's
  // identity changes with activeLeagueId, so switching leagues while the
  // screen stays focused re-fetches too. (Fixes: a draft_date_not_reached
  // blocker fetched before the scheduled time used to stick until the
  // active league changed, keeping Start Draft disabled past its own
  // deadline — see the task's bug #1.)
  useFocusEffect(
    useCallback(() => {
      fetchStartStatus();
    }, [fetchStartStatus])
  );

  // Clear stale status immediately on league change so the previous
  // league's blockers can't flash while the new league's fetch is in
  // flight.
  useEffect(() => {
    setStartStatus(null);
  }, [activeLeagueId]);

  // Schedule exactly one re-check just after the draft's scheduled time, so
  // the button flips from disabled to enabled without a manual refresh or a
  // tab switch. Display-only — draft-control re-validates the real time on
  // every Start call regardless of what this timer does. Re-runs (and its
  // cleanup re-clears the previous timeout) whenever startStatus changes or
  // fetchStartStatus's identity changes (i.e. the active league changes),
  // so a stale timer can never fire against a different league.
  useEffect(() => {
    const delay = msUntilStartRecheck(startStatus?.blockers ?? []);
    if (delay === null) return;
    const timer = setTimeout(() => {
      fetchStartStatus();
    }, delay);
    return () => clearTimeout(timer);
  }, [startStatus, fetchStartStatus]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchDraftData(), fetchStartStatus(), refreshLeagues()]);
    setRefreshing(false);
  };

  const handleStartDraft = async () => {
    if (!activeLeagueId) return;
    setStarting(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-control', {
        body: { league_id: activeLeagueId, action: 'start' },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('Error', START_REFUSAL_MESSAGES[data?.reason] || 'Could not start the draft');
        await fetchStartStatus();
        return;
      }
      await refreshLeagues();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to start the draft');
    } finally {
      setStarting(false);
    }
  };

  const handleAddBots = async () => {
    if (!activeLeagueId) return;
    setAddingBots(true);
    try {
      const { data, error } = await supabase.functions.invoke('draft-control', {
        body: { league_id: activeLeagueId, action: 'add_bots' },
      });
      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('Error', START_REFUSAL_MESSAGES[data?.reason] || 'Could not add bots');
        return;
      }
      await Promise.all([fetchDraftData(), fetchStartStatus()]);
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to add bots');
    } finally {
      setAddingBots(false);
    }
  };

  // Finalize-heal: every pick is made but draft_status is still 'in_progress'
  // (the final pick's server-side finalize failed, or was never retried).
  // Any member may retry — the RPC is idempotent (docs/STATUS.md §4 defect 1).
  const triggerFinalize = useCallback(async () => {
    if (!activeLeagueId) return;
    setRetryingFinalize(true);
    try {
      const { data, error } = await supabase.functions.invoke('validate-and-record-pick', {
        body: { league_id: activeLeagueId, action: 'finalize' },
      });
      if (error) throw error;
      if (data?.status_update_error) {
        setFinalizeError(data.status_update_error);
      } else {
        setFinalizeError(null);
      }
      await refreshLeagues();
    } catch (e: any) {
      setFinalizeError(e.message || 'unhandled');
    } finally {
      setRetryingFinalize(false);
    }
  }, [activeLeagueId, refreshLeagues]);

  // Auto-fire the heal ONCE per entry into 'finalizing' — a manual Retry
  // button covers the case where the auto-attempt also fails.
  useEffect(() => {
    if (draftPhase === 'finalizing' && !finalizeAttemptedRef.current) {
      finalizeAttemptedRef.current = true;
      triggerFinalize();
    }
    if (draftPhase !== 'finalizing') {
      finalizeAttemptedRef.current = false;
    }
  }, [draftPhase, triggerFinalize]);

  // Bot auto-pick: fires from ANY member's open app when it's a bot's turn.
  // KNOWN LIMIT (see validate-and-record-pick's header comment): if nobody's
  // app is open on this screen when a bot is up, the draft waits — there is
  // no server-scheduled trigger yet (docs/STATUS.md follow-up).
  useEffect(() => {
    if (draftPhase !== 'drafting' || !currentPicker?.startsWith('bot-') || botPickInFlight) return;
    const attemptKey = `${currentPicker}:${currentPickNumber}`;
    if (botPickAttemptedForRef.current === attemptKey) return;

    const timer = setTimeout(async () => {
      if (!activeLeagueId) return;
      botPickAttemptedForRef.current = attemptKey;
      setBotPickInFlight(true);
      try {
        await supabase.functions.invoke('validate-and-record-pick', {
          body: { league_id: activeLeagueId, for_user_id: currentPicker, action: 'bot_pick' },
        });
        // The realtime subscription below picks up the new row; a failed
        // call just leaves attemptKey set until picks.length changes, at
        // which point a fresh key is computed and it can be retried by
        // whichever app is open then.
      } catch (e) {
        console.error('Bot pick failed:', e);
      } finally {
        setBotPickInFlight(false);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [draftPhase, currentPicker, currentPickNumber, botPickInFlight, activeLeagueId]);

  // Live quote fallback when a search result carries no price (mirrors
  // TradeModal's fetchQuoteForSymbol).
  const fetchLiveQuote = useCallback(async (sym: string): Promise<number | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('quote', { body: { symbol: sym } });
      if (error || data?.error) return null;
      return parseQuotePrice(data);
    } catch {
      return null;
    }
  }, []);

  // Handle picking a stock from the search dropdown (replaces the old
  // exact-ticker TextInput — see components/SymbolSearchField.tsx).
  const handleSelectStock = useCallback(async (result: ShapedSearchResult) => {
    setSearchInputText(result.symbol);
    const applyPrice = (price: number) => {
      if (isBudgetMode && price > budgetRemaining) {
        Alert.alert('Error', `Not enough budget. ${result.symbol} costs $${price.toFixed(2)} but you only have $${budgetRemaining.toFixed(2)} remaining.`);
        return;
      }
      setQuote({ symbol: result.symbol, price });
    };

    if (result.price && Number.isFinite(result.price) && result.price > 0) {
      applyPrice(result.price);
      return;
    }
    setQuoteLoading(true);
    const price = await fetchLiveQuote(result.symbol);
    setQuoteLoading(false);
    if (price == null) {
      Alert.alert('Error', 'Failed to fetch quote');
      return;
    }
    applyPrice(price);
  }, [isBudgetMode, budgetRemaining, fetchLiveQuote]);

  // Submit pick
  const submitPick = async () => {
    if (!quote || !user?.id || !activeLeagueId) return;

    // Double-check it's still my turn
    if (!isMyTurn) {
      Alert.alert('Error', "It's not your turn");
      return;
    }

    setSubmitting(true);

    try {
      // Phase 3 (DR-001): picks go through the server-side legality gate.
      // The function re-prices the fill from the app-key quote path and
      // computes quantity per stake mode — the quote shown here is display.
      const { data, error } = await supabase.functions.invoke('validate-and-record-pick', {
        body: { league_id: activeLeagueId, symbol: quote.symbol },
      });

      if (error) throw error;
      if (!data?.ok) {
        Alert.alert('Error', PICK_REFUSAL_MESSAGES[data?.reason] || 'Pick was refused');
        if (data?.status_update_error) setFinalizeError(data.status_update_error);
        return;
      }

      // Clear search
      setSearchInputText('');
      setQuote(null);

      // Draft-completed status is written server-side by the function. A
      // draft_complete response with a status_update_error means finalize
      // FAILED — draft_status is still 'in_progress', so the render below
      // (via computeDraftPhase) shows the honest "Finalizing…" state instead
      // of a completion alert nothing actually recorded (docs/STATUS.md §4
      // defect 10 — the old code alerted "Draft Complete!" unconditionally).
      if (data.draft_complete) {
        if (data.status_update_error) {
          setFinalizeError(data.status_update_error);
        } else {
          Alert.alert('Draft Complete!', 'The draft has finished. Good luck!');
        }
        await refreshLeagues();
      } else {
        // Notify the next player it's their turn
        const nextPickNumber = currentPickNumber + 1;
        const nextRound = Math.ceil(nextPickNumber / draftOrder.length);
        const nextPickInRound = ((nextPickNumber - 1) % draftOrder.length);
        const isNextRoundReverse = nextRound % 2 === 0;
        const nextOrderForRound = isNextRoundReverse ? [...draftOrder].reverse() : draftOrder;
        const nextPicker = nextOrderForRound[nextPickInRound];

        // Only notify if it's a real user (not a bot) and not the current user
        if (nextPicker && !nextPicker.startsWith('bot-') && nextPicker !== user?.id) {
          notifyDraftTurn(nextPicker, activeLeagueId);
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to submit pick');
    } finally {
      setSubmitting(false);
    }
  };

  const getPickerName = (userId: string) => {
    if (userId.startsWith('bot-')) return `Bot ${userId.replace('bot-', '')}`;
    const member = members.find(m => m.user_id === userId);
    return member?.display_name || userId.substring(0, 8) + '...';
  };

  if (!activeLeagueId || !activeLeague) {
    return (
      <Screen scroll={false}>
        <LeagueSwitcher />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No league selected</Text>
          <Text style={styles.emptySubtitle}>Select a league from Home</Text>
        </View>
      </Screen>
    );
  }

  // Phase 4: legacy leagues with stake_mode NULL are blocked from drafting
  // until the commissioner chooses a mode in League Settings.
  if (activeLeague.stake_mode == null) {
    const isCommish = activeLeague.commissioner_id === user?.id;
    return (
      <Screen scroll={false}>
        <LeagueSwitcher />
        <View style={styles.centered}>
          <Text style={styles.pendingIcon}>⚖️</Text>
          <Text style={styles.emptyTitle}>Choose a Stake Mode</Text>
          <Text style={styles.emptySubtitle}>
            This league has no stake mode yet, so drafting is paused.
          </Text>
          <Text style={styles.hint}>
            {isCommish
              ? 'Open League Settings and pick Equal stakes, Price tiers, or Budget cap.'
              : 'Ask your commissioner to choose a stake mode in League Settings.'}
          </Text>
        </View>
      </Screen>
    );
  }

  if (isDraftNotStarted) {
    const hasDraftDate = activeLeague.draft_date != null;
    const blockers = startStatus?.blockers ?? [];
    const canStart = startStatus?.can_start ?? false;
    const botsNeeded = startStatus?.bots_needed ?? 0;
    // Decided from the server response alone (never re-checked against the
    // current time here) — see computeDraftHeaderState's docstring. Fixes:
    // once the scheduled-time timer above flipped Start Draft to enabled,
    // this screen kept reading "Draft Not Started / Scheduled for <a time
    // now in the past>" — the headline text had no state of its own and
    // never noticed the blocker it was describing was gone.
    const headerState = computeDraftHeaderState(hasDraftDate, canStart, blockers);
    const scheduledText = hasDraftDate ? formatShortDateTime(activeLeague.draft_date as string) : null;

    return (
      <Screen scroll={false}>
        <LeagueSwitcher />
        <ScrollView style={styles.notStartedScroll} contentContainerStyle={styles.centered}>
          <Text style={styles.pendingIcon}>{headerState === 'ready' ? '✅' : '⏰'}</Text>
          <Text style={styles.emptyTitle}>
            {headerState === 'ready' ? 'Ready to draft' : 'Draft Not Started'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {!scheduledText
              ? 'Draft date not set yet'
              : headerState === 'ready'
              ? `Scheduled for ${scheduledText} — start whenever you're ready`
              : `Scheduled for ${scheduledText}`}
          </Text>

          {startStatusLoading && !startStatus ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 12 }} />
          ) : (
            blockers.length > 0 && (
              <View style={styles.blockerList}>
                {blockers.map((b, i) => (
                  <Text key={i} style={styles.blockerText}>• {describeStartBlocker(b)}</Text>
                ))}
              </View>
            )
          )}

          {isCommissioner ? (
            <View style={styles.commishActions}>
              <Button
                title="Edit Draft Date & Settings"
                variant="secondary"
                onPress={() => router.push({ pathname: '/league-settings', params: { leagueId: activeLeagueId } })}
              />
              {startStatus?.bots_allowed && botsNeeded > 0 && (
                <Button
                  title={`Fill with ${botsNeeded} Bot${botsNeeded === 1 ? '' : 's'}`}
                  variant="secondary"
                  onPress={handleAddBots}
                  loading={addingBots}
                  disabled={addingBots}
                />
              )}
              <Button
                title="Start Draft"
                variant="success"
                onPress={handleStartDraft}
                loading={starting}
                disabled={starting || !canStart}
              />
            </View>
          ) : (
            <Text style={styles.hint}>
              Ask your commissioner to start the draft from the app.
            </Text>
          )}
        </ScrollView>
      </Screen>
    );
  }

  if (isDraftCompleted) {
    const myPicks = picks.filter(p => p.user_id === user?.id);
    const myTotalValue = myPicks.reduce((sum, p) => sum + p.entry_price, 0);

    // Calculate team count from actual picks (number of unique users who drafted)
    const uniqueDrafters = [...new Set(picks.map(p => p.user_id))];
    const teamCount = uniqueDrafters.length || members.length;

    // Group picks by user for team rosters
    const teamRosters = members.map(member => ({
      userId: member.user_id,
      displayName: member.display_name || 'Unknown',
      picks: picks.filter(p => p.user_id === member.user_id).sort((a, b) => a.pick_number - b.pick_number),
      totalValue: picks.filter(p => p.user_id === member.user_id).reduce((sum, p) => sum + p.entry_price, 0)
    })).sort((a, b) => b.totalValue - a.totalValue);

    return (
      <Screen refreshing={refreshing} onRefresh={onRefresh}>
        <LeagueSwitcher />

          {/* Completion Header */}
          <View style={styles.completionHeader}>
            <Text style={styles.completionIcon}>🏆</Text>
            <Text style={styles.completionTitle}>Draft Complete!</Text>
          </View>

          {/* Summary Stats */}
          <Card style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{teamCount}</Text>
                <Text style={styles.summaryLabel}>Teams</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{picks.length}</Text>
                <Text style={styles.summaryLabel}>Total Picks</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryValue}>{numRounds}</Text>
                <Text style={styles.summaryLabel}>Rounds</Text>
              </View>
            </View>
          </Card>

          {/* Your Team */}
          <View style={styles.section}>
            <View style={styles.yourTeamHeader}>
              <Text style={styles.sectionTitle}>Your Team</Text>
              <Text style={styles.teamValue}>${myTotalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={styles.yourTeamCard}>
              {myPicks.sort((a, b) => a.pick_number - b.pick_number).map((pick, index) => {
                const calculatedRound = Math.ceil(pick.pick_number / teamCount);
                return (
                  <View key={pick.id} style={[styles.yourPickRow, index < myPicks.length - 1 && styles.yourPickBorder]}>
                    <View style={styles.pickRoundBadge}>
                      <Text style={styles.pickRoundBadgeText}>R{calculatedRound}</Text>
                    </View>
                    <Text style={styles.yourPickSymbol}>{pick.symbol}</Text>
                    <Text style={styles.yourPickPrice}>${pick.entry_price.toFixed(2)}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Draft by Round */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Draft by Round</Text>
            <View style={styles.dropdownContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dropdownScroll}>
                {Array.from({ length: numRounds }, (_, i) => i + 1).map((round) => (
                  <TouchableOpacity
                    key={round}
                    style={[styles.dropdownChip, selectedRound === round && styles.dropdownChipActive]}
                    onPress={() => setSelectedRound(round)}
                  >
                    <Text style={[styles.dropdownChipText, selectedRound === round && styles.dropdownChipTextActive]}>
                      Round {round}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <Card padded={false} style={styles.roundPicksCard}>
              {picks
                .filter(p => {
                  // Calculate round from pick_number instead of using stored round
                  const calculatedRound = Math.ceil(p.pick_number / teamCount);
                  return calculatedRound === selectedRound;
                })
                .sort((a, b) => a.pick_number - b.pick_number)
                .map((pick, index, filteredPicks) => {
                  const pickInRound = index + 1;
                  return (
                    <View key={pick.id} style={[styles.roundPickRow, index < filteredPicks.length - 1 && styles.roundPickBorder]}>
                      <Text style={styles.roundPickOrder}>{pickInRound}</Text>
                      <View style={styles.roundPickInfo}>
                        <Text style={styles.roundPickName}>
                          {pick.display_name || getPickerName(pick.user_id)}
                          {pick.user_id === user?.id && <Text style={styles.youBadge}> (You)</Text>}
                        </Text>
                      </View>
                      <Text style={styles.roundPickSymbol}>{pick.symbol}</Text>
                      <Text style={styles.roundPickPrice}>${pick.entry_price.toFixed(2)}</Text>
                    </View>
                  );
                })}
            </Card>
          </View>

          {/* View Other Teams */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>View Team</Text>
            <View style={styles.dropdownContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.dropdownScroll}>
                {teamRosters.filter(t => t.userId !== user?.id).map((team) => (
                  <TouchableOpacity
                    key={team.userId}
                    style={[styles.dropdownChip, selectedTeamId === team.userId && styles.dropdownChipActive]}
                    onPress={() => setSelectedTeamId(selectedTeamId === team.userId ? null : team.userId)}
                  >
                    <Text style={[styles.dropdownChipText, selectedTeamId === team.userId && styles.dropdownChipTextActive]}>
                      {team.displayName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            {selectedTeamId && (
              <Card padded={false} style={styles.teamDetailCard}>
                {(() => {
                  const team = teamRosters.find(t => t.userId === selectedTeamId);
                  if (!team) return null;
                  return (
                    <>
                      <View style={styles.teamDetailHeader}>
                        <Text style={styles.teamDetailName}>{team.displayName}</Text>
                        <Text style={styles.teamDetailValue}>${team.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
                      </View>
                      {team.picks.sort((a, b) => a.pick_number - b.pick_number).map((pick, index) => {
                        const calculatedRound = Math.ceil(pick.pick_number / teamCount);
                        return (
                          <View key={pick.id} style={[styles.teamDetailRow, index < team.picks.length - 1 && styles.teamDetailBorder]}>
                            <View style={styles.pickRoundBadge}>
                              <Text style={styles.pickRoundBadgeText}>R{calculatedRound}</Text>
                            </View>
                            <Text style={styles.teamDetailSymbol}>{pick.symbol}</Text>
                            <Text style={styles.teamDetailPrice}>${pick.entry_price.toFixed(2)}</Text>
                          </View>
                        );
                      })}
                    </>
                  );
                })()}
              </Card>
            )}
            {!selectedTeamId && (
              <Card style={styles.selectTeamPrompt}>
                <Text style={styles.selectTeamText}>Select a team above to view their picks</Text>
              </Card>
            )}
          </View>
      </Screen>
    );
  }

  // Every pick is made but the server hasn't flipped draft_status to
  // 'completed' yet — see lib/draftState.ts and the finalize-heal effect
  // above. Nobody has "a turn" in this state, so this is the only screen that
  // can trigger the retry (docs/STATUS.md §4 defect 10).
  if (draftPhase === 'finalizing') {
    return (
      <Screen scroll={false}>
        <LeagueSwitcher />
        <View style={styles.centered}>
          {retryingFinalize ? (
            <ActivityIndicator color={Colors.primary} size="large" />
          ) : (
            <Text style={styles.pendingIcon}>⏳</Text>
          )}
          <Text style={styles.emptyTitle}>Finalizing the Season…</Text>
          <Text style={styles.emptySubtitle}>
            Every pick is in — Stockpile is generating your matchup schedule.
          </Text>
          {finalizeError && (
            <>
              <Text style={styles.hint}>
                That took longer than expected ({finalizeError}). Try again below.
              </Text>
              <Button
                title="Retry"
                variant="secondary"
                onPress={triggerFinalize}
                loading={retryingFinalize}
                disabled={retryingFinalize}
                style={{ marginTop: 16 }}
              />
            </>
          )}
        </View>
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      {/* Sticky League Switcher Header */}
      <LeagueSwitcher />

        {loading ? (
          <ActivityIndicator color={Colors.primary} size="large" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Draft Status */}
            <Card style={styles.statusCard}>
              <View style={styles.statusRow}>
                <View style={styles.statusItem}>
                  <Text style={styles.statusLabel}>Round</Text>
                  <Text style={styles.statusValue}>{currentRound}/{numRounds}</Text>
                </View>
                <View style={styles.statusItem}>
                  <Text style={styles.statusLabel}>Pick</Text>
                  <Text style={styles.statusValue}>{currentPickNumber}/{totalPicks}</Text>
                </View>
                {isBudgetMode && (
                  <View style={styles.statusItem}>
                    <Text style={styles.statusLabel}>Budget</Text>
                    <Text style={styles.statusValue}>${budgetRemaining.toLocaleString()}</Text>
                  </View>
                )}
              </View>

              <View style={styles.turnIndicator}>
                {isMyTurn ? (
                  <Text style={styles.yourTurn}>🎯 Your Turn!</Text>
                ) : (
                  <Text style={styles.waitingTurn}>
                    Waiting for {getPickerName(currentPicker || '')}
                  </Text>
                )}
              </View>

              {/* Your roster slots (which are filled / open) */}
              {leagueSlots.length > 0 && (
                <View style={styles.slotPanel}>
                  {leagueSlots.map((sl) => {
                    const filled = mySlotFill(sl.id);
                    const done = filled >= sl.slot_count;
                    return (
                      <View key={sl.id} style={[styles.slotRow, done && styles.slotRowDone]}>
                        <Text style={[styles.slotRowText, done && styles.slotRowTextDone]}>{slotLabel(sl)}</Text>
                        <Text style={[styles.slotRowText, done && styles.slotRowTextDone]}>{filled}/{sl.slot_count}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </Card>

            {/* Stock Search (only show if it's my turn) */}
            {isMyTurn && (
              <View style={styles.searchCard}>
                <Text style={styles.searchTitle}>Search Stock</Text>
                <SymbolSearchField
                  value={searchInputText}
                  onChangeText={setSearchInputText}
                  onSelect={handleSelectStock}
                  selectedSymbol={quote?.symbol ?? ''}
                  placeholder="Search by ticker or name..."
                  ownedSymbols={ownedSymbols}
                  allowUndraftable={activeLeague.allow_undraftable === true}
                  ownedBadgeLabel="ALREADY DRAFTED"
                  extraLoading={quoteLoading}
                />

                {quote && (
                  <View style={styles.quoteCard}>
                    <View style={styles.quoteInfo}>
                      <Text style={styles.quoteSymbol}>{quote.symbol}</Text>
                      <Text style={styles.quotePrice}>${quote.price.toFixed(2)}</Text>
                      {quoteCats && (
                        <View style={styles.badgeRow}>
                          {quoteCats.categories.length > 0 ? (
                            quoteCats.categories.map((c) => (
                              <Text key={c.id} style={styles.categoryBadge}>{c.name}</Text>
                            ))
                          ) : (
                            <Text style={styles.flexBadge}>Unclassified — flex only</Text>
                          )}
                        </View>
                      )}
                    </View>
                    <Button
                      title={`Draft ${quote.symbol}`}
                      onPress={submitPick}
                      disabled={submitting}
                      loading={submitting}
                      variant="success"
                    />
                  </View>
                )}
              </View>
            )}

            {/* Draft Order */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Draft Order (Round {currentRound})</Text>
              {orderForRound.map((userId, idx) => {
                const isCurrent = idx === currentPickerIndex;
                const hasPicked = idx < currentPickerIndex;
                return (
                  <View
                    key={userId}
                    style={[
                      styles.orderRow,
                      isCurrent && styles.orderRowCurrent,
                      hasPicked && styles.orderRowDone
                    ]}
                  >
                    <Text style={styles.orderNumber}>{idx + 1}</Text>
                    <Text style={[styles.orderName, isCurrent && styles.orderNameCurrent]}>
                      {getPickerName(userId)}
                      {userId === user?.id && ' (You)'}
                    </Text>
                    {hasPicked && <Text style={styles.orderCheck}>✓</Text>}
                    {isCurrent && <Text style={styles.orderArrow}>◀</Text>}
                  </View>
                );
              })}
            </View>

            {/* Recent Picks */}
            {picks.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Recent Picks</Text>
                {[...picks].reverse().slice(0, 10).map((pick) => (
                  <View key={pick.id} style={styles.historyRow}>
                    <Text style={styles.historyPick}>#{pick.pick_number}</Text>
                    <Text style={styles.historyName}>{pick.display_name}</Text>
                    <Text style={styles.historySymbol}>{pick.symbol}</Text>
                    <Text style={styles.historyPrice}>${pick.entry_price.toFixed(2)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.primaryLight,
    marginTop: 4,
  },
  pendingIcon: {
    fontSize: 48,
    fontFamily: 'Inter_400Regular',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: 16,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textDark,
    textAlign: 'center',
    marginTop: 8,
  },
  notStartedScroll: {
    flex: 1,
  },
  blockerList: {
    alignSelf: 'stretch',
    marginTop: 12,
    marginBottom: 8,
  },
  blockerText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'left',
    marginBottom: 6,
  },
  commishActions: {
    alignSelf: 'stretch',
    gap: 10,
    marginTop: 16,
  },
  statusCard: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statusItem: {
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  turnIndicator: {
    alignItems: 'center',
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  yourTurn: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.success,
  },
  waitingTurn: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
  },
  searchCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 20,
    borderWidth: 2,
    borderColor: Colors.primary,
    marginBottom: 16,
  },
  searchTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  quoteCard: {
    marginTop: 16,
    padding: 16,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quoteInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  quoteSymbol: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  quotePrice: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.success,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  orderRowCurrent: {
    borderColor: Colors.primary,
    backgroundColor: Colors.cyanLight,
  },
  orderRowDone: {
    opacity: 0.5,
  },
  orderNumber: {
    width: 24,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
  },
  orderName: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
  },
  orderNameCurrent: {
    fontFamily: 'Inter_600SemiBold',
    color: Colors.success,
  },
  orderCheck: {
    color: Colors.success,
    fontFamily: 'Inter_600SemiBold',
  },
  orderArrow: {
    color: Colors.success,
    fontFamily: 'Inter_600SemiBold',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    marginBottom: 6,
  },
  historyPick: {
    width: 36,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  historyName: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
  },
  historySymbol: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primaryLight,
    marginRight: 12,
  },
  historyPrice: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  pickRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: Colors.cardBg,
    borderRadius: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pickSymbol: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  pickRound: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    marginTop: 2,
  },
  pickPrice: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.success,
  },
  // Completion screen styles
  completionHeader: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  completionIcon: {
    fontSize: 56,
    fontFamily: 'Inter_400Regular',
    marginBottom: 12,
  },
  completionTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  completionLeague: {
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.primaryLight,
  },
  summaryCard: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryValue: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  yourTeamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamValue: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.success,
  },
  yourTeamCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    overflow: 'hidden',
  },
  yourPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  yourPickBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickRoundBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginRight: 12,
  },
  pickRoundBadgeText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.white,
  },
  yourPickSymbol: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  yourPickPrice: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  teamCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  teamHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  teamNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  teamRank: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    marginRight: 8,
    width: 28,
  },
  teamName: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  youBadge: {
    color: Colors.primaryLight,
    fontFamily: 'Inter_400Regular',
  },
  teamTotal: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.success,
  },
  teamPicks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  teamPickChip: {
    backgroundColor: Colors.background,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  teamPickText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.primaryLight,
  },
  // Dropdown styles
  dropdownContainer: {
    marginBottom: 12,
  },
  dropdownScroll: {
    flexGrow: 0,
  },
  dropdownChip: {
    backgroundColor: Colors.cardBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dropdownChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dropdownChipText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
  dropdownChipTextActive: {
    color: Colors.white,
    fontFamily: 'Inter_600SemiBold',
  },
  // Round picks styles
  roundPicksCard: {},
  roundPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  roundPickBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  roundPickOrder: {
    width: 24,
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  roundPickInfo: {
    flex: 1,
  },
  roundPickName: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textPrimary,
  },
  roundPickSymbol: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
    color: Colors.primaryLight,
    marginRight: 12,
    minWidth: 50,
    textAlign: 'right',
  },
  roundPickPrice: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
    minWidth: 70,
    textAlign: 'right',
  },
  // Team detail styles
  teamDetailCard: {},
  teamDetailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.bgSurface,
  },
  teamDetailName: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  teamDetailValue: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
    color: Colors.success,
  },
  teamDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
  },
  teamDetailBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  teamDetailSymbol: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  teamDetailPrice: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    fontVariant: ['tabular-nums'],
    color: Colors.textMuted,
  },
  selectTeamPrompt: {
    alignItems: 'center',
  },
  selectTeamText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
  },
  // Phase 4 draft UI
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 },
  categoryBadge: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.primary,
    backgroundColor: Colors.primaryBg,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  flexBadge: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    backgroundColor: Colors.cardBgAlt,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  slotPanel: { marginTop: 10, gap: 4 },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Colors.primaryBg,
  },
  slotRowDone: { backgroundColor: Colors.successBg },
  slotRowText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.primary },
  slotRowTextDone: { color: Colors.success },
});