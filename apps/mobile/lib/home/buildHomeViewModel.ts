/**
 * buildHomeViewModel: the ONE pure function that turns get_home_summary +
 * get_home_league + quotes + bars into everything Home's components
 * render. All decisions route through the Phase 3b-2 pure modules
 * (homePhase, liveWeekScore, seasonGainSeries, todayChange, teamValue,
 * seasonGain) — this module's only job is wiring their inputs from the
 * RPC shapes, never re-deciding anything itself. Pure and hermetic, so
 * it's the one place the "honesty check" (chart endpoint = hero gain,
 * 1W endpoint = this-week score, Friday points = matchups gains) can be
 * asserted as a test, not just eyeballed in production.
 *
 * The `useHomeLeague` hook (React/Supabase — not unit-testable) is a thin
 * shell around this: fetch summary + get_home_league + quote + bars (or
 * the dev fixture), then call this function.
 */

import { homePhase, type HomePhaseInput, type MatchupRow, type PhaseResult, type MarketInfo } from './homePhase';
import { liveWeekScore, type LiveSnapshot, type LiveTrade } from './liveWeekScore';
import { buildSeasonGainSeries, type SeasonWeekInput, type SeasonGainSeriesResult } from './seasonGainSeries';
import { todayChange, type TodayPosition } from './todayChange';
import { teamValue, type StakeMode } from './teamValue';
import { seasonGain } from './seasonGain';

export interface HomeLedgerRow {
  symbol: string;
  entry_price?: number;
  action?: 'buy' | 'sell';
  quantity: number;
  price?: number;
  week_start_price?: number;
  entered_mid_week?: boolean;
  created_at: string;
}

export interface GetHomeLeagueResult {
  my_ledger: { drafts: HomeLedgerRow[]; trades: HomeLedgerRow[] };
  current_week: {
    week_number: number;
    my_snapshots: HomeLedgerRow[];
    my_trades: HomeLedgerRow[];
    opponent_snapshots: HomeLedgerRow[];
    opponent_trades: HomeLedgerRow[];
  };
  matchups: {
    week_number: number; week_start: string; week_end: string; is_playoff: boolean;
    team1_user_id: string | null; team2_user_id: string | null;
    team1_gain: number | null; team2_gain: number | null;
  }[];
  standings: {
    user_id: string; rank: number; wins: number; losses: number; ties: number;
    points_for: number; display_name: string; is_bot: boolean;
  }[];
}

export interface HomeLeagueMeta {
  myUserId: string;
  draftStatus: 'not_started' | 'in_progress' | 'completed';
  leagueStartDate: string | null;
  seasonStatus: 'active' | 'playoffs' | 'completed';
  currentWeek: number;
  numWeeks: number | null;
  playoffTeams: number | null;
  stakeMode: StakeMode;
  notionalPerSlot: number | null;
  numRounds: number | null;
  draftOrderWaiting: boolean;
  hasLaterPlayoffRow: boolean;
  lastPlayoffLoss: boolean;
}

export interface BarsBySymbol {
  [symbol: string]: { date: string; close: number }[];
}

export interface HomeViewModelInput {
  now: Date;
  meta: HomeLeagueMeta;
  market: MarketInfo;
  data: GetHomeLeagueResult;
  quote: (symbol: string) => number | null;
  /** Ascending, per symbol — used for the live week's chart granularity
   * and for `prevClose` (the last close strictly before `now`'s date). */
  bars: BarsBySymbol;
  playoffRoundLabelForWeek: (week: number | null | undefined, numWeeks: number | null | undefined, playoffTeams: number | null | undefined) => string | null;
}

export interface HeroViewModel {
  value: number;
  seasonGainDollars: number;
  seasonGainPct: number;
  today: number | null;
  unpricedValue: string[];
  unpricedToday: string[];
  cashWentNegative: boolean;
}

export interface ThisWeekViewModel {
  you: { gain: number; pct: number; unpriced: string[] };
  opponent: { gain: number; pct: number; unpriced: string[] };
  /** True once BOTH sides' matchups gains are posted — the scores shown
   * are then the authoritative scored values, not a live recompute
   * (which could disagree with the official number by a stale quote). */
  final: boolean;
}

export interface WeeklyResult {
  week: number;
  gain: number;
  /** 'BYE' for a regular-season bye (no result — never a win or a loss). */
  result: 'W' | 'L' | 'T' | 'BYE';
}

export interface HomeViewModel {
  phase: PhaseResult;
  hero: HeroViewModel | null;
  thisWeek: ThisWeekViewModel | null;
  season: SeasonGainSeriesResult | null;
  standings: GetHomeLeagueResult['standings'];
  /** So a caller (index.tsx) can mark which standings row is "you" without
   * re-deriving the caller's id from elsewhere. */
  myUserId: string;
  /** Every already-scored week's result for me — the Season card's W/L
   * chips (spec: "W1...W(N-1) result chips"). Empty when nothing is
   * scored yet. */
  weeklyResults: WeeklyResult[];
}

function toLedger(rows: HomeLedgerRow[]): { symbol: string; entryPrice: number; quantity: number }[] {
  return rows.map((r) => ({ symbol: r.symbol, entryPrice: r.entry_price ?? 0, quantity: r.quantity }));
}
function toTrades(rows: HomeLedgerRow[]): { symbol: string; action: 'buy' | 'sell'; quantity: number; price: number }[] {
  return rows.map((r) => ({ symbol: r.symbol, action: r.action!, quantity: r.quantity, price: r.price ?? 0 }));
}
function toLiveTrades(rows: HomeLedgerRow[]): LiveTrade[] {
  return rows.map((r) => ({ symbol: r.symbol, action: r.action!, quantity: r.quantity, price: r.price ?? 0, createdAt: new Date(r.created_at) }));
}
function toLiveSnapshots(rows: HomeLedgerRow[]): LiveSnapshot[] {
  return rows.map((r) => ({ symbol: r.symbol, quantity: r.quantity, weekStartPrice: r.week_start_price ?? 0, enteredMidWeek: !!r.entered_mid_week }));
}

function matchupRowFor(data: GetHomeLeagueResult, meta: HomeLeagueMeta, week: number): MatchupRow | null {
  const m = data.matchups.find((row) => row.week_number === week);
  if (!m) return null;
  const isMe1 = m.team1_user_id === meta.myUserId;
  const myGain = isMe1 ? m.team1_gain : m.team2_gain;
  const oppGain = isMe1 ? m.team2_gain : m.team1_gain;
  const hasOpponent = isMe1 ? !!m.team2_user_id : !!m.team1_user_id;
  return {
    week: m.week_number, weekStart: m.week_start, weekEnd: m.week_end, isPlayoff: m.is_playoff,
    myGain, opponentGain: oppGain, hasOpponent,
  };
}

function dateOnly(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Yesterday's close for `symbol`: the latest bar strictly before `now`'s date. */
function prevCloseFor(bars: BarsBySymbol, symbol: string, now: Date): number | null {
  const today = dateOnly(now.toISOString());
  const series = bars[symbol];
  if (!series) return null;
  const before = series.filter((b) => b.date < today);
  if (before.length === 0) return null;
  return before[before.length - 1].close;
}

/** Business-day dates (Mon-Fri) from `start` through `end`, inclusive of
 * start's week — used ONLY for a past week's cosmetic ramp (no real bars
 * fetched for it), matching the design board's own DAY_SHAPES approach.
 * An unparseable date (Postgres always serializes timestamptz with a
 * full offset, so this should never fire on real data — but a malformed
 * or missing matchups row must degrade to "no cosmetic points for this
 * week", never a silent Invalid-Date loop, so it's checked explicitly
 * rather than left to `NaN < NaN` evaluating to false by accident). */
function weekdayDates(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const d = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) {
    console.warn(`[home] weekdayDates: unparseable date range (${startIso} .. ${endIso})`);
    return out;
  }
  while (d.getTime() < end.getTime()) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function buildHomeViewModel(input: HomeViewModelInput): HomeViewModel {
  const { now, meta, market, data, quote, bars } = input;

  const current = matchupRowFor(data, meta, meta.currentWeek);
  const previous = matchupRowFor(data, meta, meta.currentWeek - 1);

  const phase = homePhase(
    {
      league: {
        draftStatus: meta.draftStatus, leagueStartDate: meta.leagueStartDate,
        seasonStatus: meta.seasonStatus, currentWeek: meta.currentWeek, numWeeks: meta.numWeeks,
        playoffTeams: meta.playoffTeams,
      },
      current, previous,
      hasLaterPlayoffRow: meta.hasLaterPlayoffRow, lastPlayoffLoss: meta.lastPlayoffLoss,
      draftOrderWaiting: meta.draftOrderWaiting, now, market,
    },
    input.playoffRoundLabelForWeek,
  );

  // Only build the money views once the season has real matchup weeks to
  // reason about (states 6/7/5/8 have no hero/this-week card at all).
  const inSeason = !['pre_draft', 'drafting', 'complete'].includes(phase.kind);
  if (!inSeason) {
    return { phase, hero: null, thisWeek: null, season: null, standings: data.standings, myUserId: meta.myUserId, weeklyResults: [] };
  }

  const myCurrentSnapshots = toLiveSnapshots(data.current_week.my_snapshots);
  const myCurrentTrades = toLiveTrades(data.current_week.my_trades);
  const oppCurrentSnapshots = toLiveSnapshots(data.current_week.opponent_snapshots);
  const oppCurrentTrades = toLiveTrades(data.current_week.opponent_trades);

  const currentRowScored = current && current.myGain !== null && (current.opponentGain !== null || !current.hasOpponent);

  const myLive = liveWeekScore(myCurrentSnapshots, myCurrentTrades, quote);
  const oppLive = liveWeekScore(oppCurrentSnapshots, oppCurrentTrades, quote);

  // Once both sides are scored, the this-week card shows the AUTHORITATIVE
  // matchups gain, never a live recompute from (possibly stale) quotes —
  // "nothing is shown as final before team1_gain/team2_gain are non-null"
  // cuts both ways: once they ARE non-null, that number is the truth.
  const thisWeek: ThisWeekViewModel | null = current?.hasOpponent
    ? currentRowScored
      ? {
          you: { gain: current!.myGain!, pct: 0, unpriced: [] },
          opponent: { gain: current!.opponentGain!, pct: 0, unpriced: [] },
          final: true,
        }
      : {
          you: { gain: myLive.gain, pct: myLive.pct, unpriced: myLive.unpriced },
          opponent: { gain: oppLive.gain, pct: oppLive.pct, unpriced: oppLive.unpriced },
          final: false,
        }
    : null;

  // Season gain = every already-scored week's gain for me, plus the
  // current week's live gain ONLY when it isn't scored yet.
  const scoredWeeklyGains: number[] = [];
  const weeklyResults: WeeklyResult[] = [];
  for (const m of data.matchups) {
    if (m.week_number >= meta.currentWeek) continue;
    const isMe1 = m.team1_user_id === meta.myUserId;
    const g = isMe1 ? m.team1_gain : m.team2_gain;
    const opp = isMe1 ? m.team2_gain : m.team1_gain;
    if (g !== null) {
      scoredWeeklyGains.push(g);
      const hasOpp = isMe1 ? !!m.team2_user_id : !!m.team1_user_id;
      const result: WeeklyResult['result'] = !hasOpp ? 'BYE' : opp === null ? 'BYE' : g > opp ? 'W' : g < opp ? 'L' : 'T';
      weeklyResults.push({ week: m.week_number, gain: g, result });
    }
  }
  const currentWeekLiveGain = currentRowScored ? null : myLive.gain;
  if (currentRowScored && current) {
    scoredWeeklyGains.push(current.myGain!);
  }

  const stake = teamValue({
    stakeMode: meta.stakeMode, notionalPerSlot: meta.notionalPerSlot, numRounds: meta.numRounds,
    drafts: toLedger(data.my_ledger.drafts), trades: toTrades(data.my_ledger.trades), price: quote,
  });

  const { gain: seasonGainDollars, pct: seasonGainPct } = seasonGain(scoredWeeklyGains, currentWeekLiveGain, stake.stake);

  const isTradingDay = !['weekend', 'holiday', 'no_coverage'].includes(market.reason);
  const todaysDateStr = dateOnly(now.toISOString());
  const todaysTrades = toLiveTrades(data.my_ledger.trades).filter((t) => dateOnly(t.createdAt.toISOString()) === todaysDateStr);
  const beforeToday = toLiveTrades(data.my_ledger.trades).filter((t) => dateOnly(t.createdAt.toISOString()) !== todaysDateStr || t.createdAt.getTime() < now.getTime());
  // Net position before today's trades, from the full ledger minus today's activity.
  const positionsBeforeToday: TodayPosition[] = (() => {
    const qty = new Map<string, number>();
    for (const d of data.my_ledger.drafts) qty.set(d.symbol, (qty.get(d.symbol) ?? 0) + d.quantity);
    for (const t of data.my_ledger.trades) {
      if (dateOnly(t.created_at) === todaysDateStr) continue; // exclude today's own trades
      qty.set(t.symbol, (qty.get(t.symbol) ?? 0) + (t.action === 'buy' ? t.quantity : -t.quantity));
    }
    return Array.from(qty.entries()).map(([symbol, quantityBeforeToday]) => ({ symbol, quantityBeforeToday }));
  })();
  const today = todayChange(positionsBeforeToday, todaysTrades, quote, (sym) => prevCloseFor(bars, sym, now), isTradingDay);

  const hero: HeroViewModel = {
    value: stake.value,
    seasonGainDollars, seasonGainPct,
    today: today.total,
    unpricedValue: stake.unpriced,
    unpricedToday: today.unpriced,
    cashWentNegative: stake.cashWentNegative,
  };

  // Season chart: one entry per week 1..currentWeek. Past weeks are drawn
  // cosmetically (no per-week ledger fetched — see seasonGainSeries's
  // hasData doc); the current week uses real granularity from `bars`.
  const weeks: SeasonWeekInput[] = [];
  for (let w = 1; w <= meta.currentWeek; w++) {
    const row = matchupRowFor(data, meta, w);
    const isCurrent = w === meta.currentWeek;
    if (!isCurrent || currentRowScored) {
      const scoredGain = isCurrent ? current!.myGain : row ? (row.hasOpponent === false ? 0 : row.myGain) : 0;
      const days = row ? weekdayDates(row.weekStart, row.weekEnd) : [];
      weeks.push({ week: w, scoredGain: scoredGain ?? 0, snapshots: [], trades: [], tradingDays: days, hasData: false });
    } else {
      // The live current week: real bars from Monday through today.
      const days = Object.values(bars)[0]?.map((b) => b.date).filter((d) => d >= dateOnly(current!.weekStart) && d <= todaysDateStr) ?? [todaysDateStr];
      const closesByDate: Record<string, Record<string, number>> = {};
      for (const [sym, series] of Object.entries(bars)) {
        for (const b of series) {
          if (!days.includes(b.date)) continue;
          closesByDate[b.date] = closesByDate[b.date] ?? {};
          closesByDate[b.date][sym.toUpperCase()] = b.close;
        }
      }
      weeks.push({
        week: w, scoredGain: null, snapshots: myCurrentSnapshots, trades: myCurrentTrades,
        tradingDays: days.length ? days : [todaysDateStr], hasData: true,
      });
      // closesByDate is threaded via the outer buildSeasonGainSeries call below.
      (weeks[weeks.length - 1] as any).__closesByDate = closesByDate;
    }
  }
  const closesByDate = (weeks.find((w: any) => w.__closesByDate) as any)?.__closesByDate ?? {};
  const season = buildSeasonGainSeries({
    weeks, closesByDate, live: currentRowScored ? null : { gain: myLive.gain },
  });

  return { phase, hero, thisWeek, season, standings: data.standings, myUserId: meta.myUserId, weeklyResults };
}
