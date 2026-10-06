import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { useAuth } from './useAuth';
import { getSeasonLabel, getSeasonPhase } from './weekStatus';
import type { SheetLeague } from './shell/leagueSheet';
import { activeLeagueStorageKey, resolveActiveLeagueId } from './shell/activeLeague';
import { FIXTURE_NETWORK_MS, SHELL_FIXTURE, fixtureLeagues } from './shell/devFixture';
import type { ShellFixture } from './shell/devFixture';
import { SEAM_ON } from './game/devSeam';
import { pickLeagueFixture } from './game/devSeamGate';

// The shell fixture, or the board's leagues under the capture seam (3c). Narrowest point:
// only this fetch branch reads it, and the seam is off outside a dev build.
const LEAGUE_FIXTURE = pickLeagueFixture<ShellFixture>(SHELL_FIXTURE, SEAM_ON, 'leagues');
import type { MarketCalendarSession } from './time/marketWeek';

export interface League {
  id: string;
  name: string;
  invite_code: string;
  commissioner_id: string;
  /** Run it back (PR #94): the season this league renews, or null. Optional until the backend is live. */
  previous_league_id?: string | null;
  /** The draft order mode (random | manual | legacy); optional in this type. */
  draft_order_mode?: string | null;
  draft_status: 'not_started' | 'in_progress' | 'completed';
  draft_date: string | null;
  // Written by finalize_league_draft at draft completion, alongside the
  // generated schedule — null until then. See CLAUDE.md's note on
  // schedule.ts/finalize_league_draft_rpc.sql (STATUS §4 defect 1).
  league_start_date: string | null;
  budget_mode: 'budget' | 'no-budget'; // deprecated — stake_mode is authoritative
  stake_mode: 'fixed_notional' | 'price_tiers' | 'budget_cap' | null;
  notional_per_slot: number | null;
  allow_undraftable: boolean;
  budget_amount: number | null;
  salary_cap_limit: number | null;
  num_participants: number;
  num_rounds: number;
  /** 30-90s in 15s steps, default 60 (20261010000000_draft_pick_clock_and_queue.sql). */
  pick_seconds: number;
  league_type: 'duration' | 'matchup';
  duration_days: number | null;
  num_weeks: number | null;
  playoff_teams: number | null;
  current_week: number;
  created_at: string;
  // Season tracking
  current_season_id: string | null;
  season_status: 'active' | 'playoffs' | 'completed';
}

export interface LeagueSeason {
  id: string;
  league_id: string;
  season_number: number;
  champion_user_id: string | null;
  runner_up_user_id: string | null;
  started_at: string;
  completed_at: string | null;
  final_standings: FinalStanding[] | null;
  created_at: string;
}

export interface FinalStanding {
  user_id: string;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
}

interface LeagueContextType {
  leagues: League[];
  loading: boolean;
  activeLeagueId: string | null;
  setActiveLeagueId: (id: string | null) => void;
  activeLeague: League | null;
  /** The league sheet's rows (Phase 3b-1): phase, rank · record, members, champion. Same order as `leagues`. */
  sheetLeagues: SheetLeague[];
  /**
   * get_home_summary's full row per league (Phase 3b-2 Home reads this —
   * NOT a new request: it's the exact call fetchSheetFacts already makes
   * for the pill/sheet, just no longer discarded after deriving
   * SheetLeague's narrower fields).
   */
  homeSummaryByLeague: Map<string, HomeSummaryRow>;
  /** market_session_status()'s row (Phase 3b-2 homePhase's MarketInfo) —
   * same call the sheet's marketOpen flag already makes, exposed in full
   * rather than collapsed to a boolean. Null only while still loading or
   * on a failed read (never fabricated as "open"). */
  market: MarketRow | null;
  /** public.market_calendar rows (20261005000002) — B1 (Design Lead,
   * 2026-09-30): the real Monday-open/Friday-close session bounds
   * buildHomeViewModel needs to reinterpret schedule.ts's fixed-UTC,
   * nominal-Tuesday matchups.week_start/week_end. Empty (never
   * fabricated) on a failed read or while still loading — every caller
   * already falls back to the nominal timestamp when it can't resolve a
   * week from this list. */
  marketCalendar: MarketCalendarSession[];
  refresh: () => Promise<void>;
}

const LeagueContext = createContext<LeagueContextType | undefined>(undefined);

// get_home_summary's columns (20261011000001) — the sheet reads a subset;
// Phase 3b-2 Home reads the rest (the current matchup + my standing).
export interface HomeSummaryRow {
  league_id: string;
  league_name: string;
  league_type: string;
  draft_status: 'not_started' | 'in_progress' | 'completed';
  league_start_date: string | null;
  league_end_date: string | null;
  current_week: number;
  num_weeks: number | null;
  season_status: 'active' | 'playoffs' | 'completed';
  season_number: number | null;
  standings_rank: number | null;
  standings_count: number | null;
  wins: number | string | null;
  losses: number | string | null;
  ties: number | string | null;
  points_for: number | string | null;
  matchup_id: string | null;
  matchup_week_number: number | null;
  matchup_is_playoff: boolean | null;
  matchup_week_start: string | null;
  matchup_week_end: string | null;
  team1_user_id: string | null;
  team1_display_name: string | null;
  team1_is_bot: boolean | null;
  team1_gain: number | string | null;
  team2_user_id: string | null;
  team2_display_name: string | null;
  team2_is_bot: boolean | null;
  team2_gain: number | string | null;
}

// market_session_status()'s row (20261005000002).
export interface MarketRow {
  status: 'open' | 'closed' | 'unknown';
  reason: string;
  session_open_at: string | null;
  session_close_at: string | null;
  next_open_at: string | null;
  next_open_et: string | null;
  coverage_through: string | null;
  as_of: string;
}

/**
 * The sheet's extra facts, in parallel, each degrading to "unknown" on its
 * own. supabase-js resolves a Postgres error as { error } rather than
 * throwing (CLAUDE.md, success-signal #5), so every result's error is
 * checked; an unknown fact renders as an empty meta line, never an invented
 * rank or count (lib/shell/leagueSheet.ts).
 */
async function fetchSheetFacts(userId: string, leagueData: League[]) {
  const ids = leagueData.map((l) => l.id);
  const seasonIds = leagueData.map((l) => l.current_season_id).filter((id): id is string => !!id);

  const [summary, members, seasons, market, calendar] = await Promise.all([
    supabase.rpc('get_home_summary'),
    supabase.from('league_members').select('league_id').in('league_id', ids),
    seasonIds.length
      ? supabase.from('league_seasons').select('id, champion_user_id').in('id', seasonIds)
      : Promise.resolve({ data: [] as { id: string; champion_user_id: string | null }[], error: null }),
    supabase.rpc('market_session_status'),
    supabase.from('market_calendar').select('session_date, open_et, close_et'),
  ]);

  const summaryByLeague = new Map<string, HomeSummaryRow>();
  if (summary.error) console.warn('[leagues] get_home_summary failed', summary.error.message);
  else for (const row of (summary.data ?? []) as HomeSummaryRow[]) summaryByLeague.set(row.league_id, row);

  let memberCounts: Map<string, number> | null = null;
  if (members.error) console.warn('[leagues] member counts failed', members.error.message);
  else {
    memberCounts = new Map();
    for (const m of members.data ?? []) memberCounts.set(m.league_id, (memberCounts.get(m.league_id) ?? 0) + 1);
  }

  const championBySeason = new Map<string, string | null>();
  if (seasons.error) console.warn('[leagues] season results failed', seasons.error.message);
  else for (const s of seasons.data ?? []) championBySeason.set(s.id, s.champion_user_id);

  // 'unknown' (calendar gap) or a failed read shows the league as Closed:
  // claiming "Live" without evidence the market is open would be the lie.
  if (market.error) console.warn('[leagues] market_session_status failed', market.error.message);
  const marketRow = (!market.error ? (market.data as MarketRow[] | null)?.[0] : null) ?? null;
  const marketOpen = marketRow?.status === 'open';

  // B1: an empty array (never fabricated rows) on a failed read — every
  // caller already falls back to the nominal matchups timestamp when it
  // can't resolve a week from this list (marketWeek.ts's resolveWeekWindow).
  if (calendar.error) console.warn('[leagues] market_calendar failed', calendar.error.message);
  const marketCalendar: MarketCalendarSession[] = calendar.error
    ? []
    : ((calendar.data ?? []) as { session_date: string; open_et: string; close_et: string }[]).map((row) => ({
        sessionDate: row.session_date, openEt: row.open_et, closeEt: row.close_et,
      }));

  const sheet = leagueData.map<SheetLeague>((league) => {
    // U1: the phase boundary is T0 (week 1's first calendar open), so pass
    // the calendar this same fetch just read. Every reader of seasonPhase
    // (the sheet, PhaseChip, the trade gate's canTradeInPhase) inherits it.
    const phase = getSeasonPhase(league, new Date(), marketCalendar);
    const row = summaryByLeague.get(league.id);
    return {
      id: league.id,
      name: league.name,
      seasonPhase: phase,
      marketOpen,
      rank: row?.standings_rank ?? null,
      rankCount: row?.standings_count ?? null,
      wins: Number(row?.wins ?? 0),
      losses: Number(row?.losses ?? 0),
      ties: Number(row?.ties ?? 0),
      membersJoined: memberCounts ? memberCounts.get(league.id) ?? 0 : null,
      capacity: league.num_participants,
      isChampion: !!league.current_season_id && championBySeason.get(league.current_season_id) === userId,
      seasonLabel: getSeasonLabel(phase, league, marketCalendar),
      currentWeek: league.current_week,
      numWeeks: league.num_weeks,
      playoffTeams: league.playoff_teams,
      draftDate: league.draft_date,
    };
  });

  return { sheet, summaryByLeague, market: marketRow, marketCalendar };
}

async function readStoredActiveLeague(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(activeLeagueStorageKey(userId));
  } catch {
    return null;
  }
}

export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [sheetLeagues, setSheetLeagues] = useState<SheetLeague[]>([]);
  const [homeSummaryByLeague, setHomeSummaryByLeague] = useState<Map<string, HomeSummaryRow>>(new Map());
  const [market, setMarket] = useState<MarketRow | null>(null);
  const [marketCalendar, setMarketCalendar] = useState<MarketCalendarSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLeagueId, setActiveLeagueIdState] = useState<string | null>(null);
  // The latest choice, readable from inside an in-flight fetch (a pick made
  // while refresh() is awaiting must not be overwritten by its result).
  const activeRef = useRef<string | null>(null);
  const userId = user?.id ?? null;

  // Spec gate 6: the active league persists across relaunch, per user.
  const setActiveLeagueId = useCallback(
    (id: string | null) => {
      activeRef.current = id;
      setActiveLeagueIdState(id);
      if (!userId) return;
      const key = activeLeagueStorageKey(userId);
      (id ? AsyncStorage.setItem(key, id) : AsyncStorage.removeItem(key)).catch(() => {});
    },
    [userId]
  );

  const fetchLeagues = useCallback(async () => {
    if (!userId) return;

    setLoading(true);

    if (LEAGUE_FIXTURE) {
      // DEV-only fixture (lib/shell/devFixture.ts): the board's leagues, no
      // queries — after a realistic delay, so pull-to-refresh (S5) is visible.
      await new Promise((resolve) => setTimeout(resolve, FIXTURE_NETWORK_MS));
      const fixture = fixtureLeagues(LEAGUE_FIXTURE);
      const stored = await readStoredActiveLeague(userId);
      setLeagues(fixture.leagues);
      setSheetLeagues(fixture.sheet);
      const resolved = resolveActiveLeagueId(activeRef.current ?? stored, fixture.sheet);
      if (resolved !== activeRef.current) setActiveLeagueId(resolved);
      setLoading(false);
      return;
    }

    const { data: memberships, error: memberError } = await supabase
      .from('league_members')
      .select('league_id')
      .eq('user_id', userId);

    if (memberError || !memberships || memberships.length === 0) {
      setLeagues([]);
      setSheetLeagues([]);
      setHomeSummaryByLeague(new Map());
      setMarket(null);
      setMarketCalendar([]);
      setLoading(false);
      return;
    }

    const leagueIds = memberships.map((m) => m.league_id);

    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .select('*')
      .in('id', leagueIds)
      .order('created_at', { ascending: false });

    if (leagueError) {
      console.error('Error fetching leagues:', leagueError);
      setLoading(false);
      return;
    }

    const list = (leagueData || []) as League[];
    const [facts, stored] = await Promise.all([fetchSheetFacts(userId, list), readStoredActiveLeague(userId)]);
    const { sheet } = facts;

    setLeagues(list);
    setSheetLeagues(sheet);
    setHomeSummaryByLeague(facts.summaryByLeague);
    setMarket(facts.market);
    setMarketCalendar(facts.marketCalendar);

    // In-session choice first, then the persisted one, then the first live
    // league (lib/shell/activeLeague.ts). A league the user has left falls
    // through to the fallback.
    const resolved = resolveActiveLeagueId(activeRef.current ?? stored, sheet);
    if (resolved !== activeRef.current) setActiveLeagueId(resolved);

    setLoading(false);
  }, [userId, setActiveLeagueId]);

  useEffect(() => {
    if (!userId) {
      setLeagues([]);
      setSheetLeagues([]);
      setHomeSummaryByLeague(new Map());
      setMarket(null);
      setMarketCalendar([]);
      activeRef.current = null;
      setActiveLeagueIdState(null);
      setLoading(false);
      return;
    }

    fetchLeagues();
  }, [userId, fetchLeagues]);

  const activeLeague = leagues.find((l) => l.id === activeLeagueId) || null;

  return (
    <LeagueContext.Provider
      value={{
        leagues,
        loading,
        activeLeagueId,
        setActiveLeagueId,
        activeLeague,
        sheetLeagues,
        homeSummaryByLeague,
        market,
        marketCalendar,
        refresh: fetchLeagues,
      }}
    >
      {children}
    </LeagueContext.Provider>
  );
}

export function useLeagueContext() {
  const context = useContext(LeagueContext);
  if (context === undefined) {
    throw new Error('useLeagueContext must be used within a LeagueProvider');
  }
  return context;
}
