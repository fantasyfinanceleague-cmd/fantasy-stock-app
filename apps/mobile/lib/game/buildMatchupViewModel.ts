/**
 * buildMatchupViewModel: the live numbers for the Matchup screen (3c).
 * It feeds the SAME inputs Home feeds liveWeekScore (get_home_league's
 * current_week ledgers, quotes, bars), so Matchup's live score is Home's
 * this-week number by construction. It adds the per-stock lineup rows, the
 * race points and the leader. It decides no phase: the caller picks the
 * view from homePhase (matchupPhase.ts).
 */
import { liveWeekScore } from '../home/liveWeekScore';
import { toLiveSnapshots, toLiveTrades, type BarsBySymbol, type GetHomeLeagueResult } from '../home/buildHomeViewModel';
import { lineupRows, type LineupRow } from './lineupLedger';
import { weekRacePoints, type RaceDay, type RacePoint } from './weekRace';
import { leaderOf, type Leader } from './leadChange';

export interface MatchupInput {
  data: GetHomeLeagueResult;
  myUserId: string;
  quote: (symbol: string) => number | null;
  bars: BarsBySymbol;
  /** The matchup week's trading days, in order, with each session's close. */
  days: { date: string; closeAt: Date }[];
  now: Date;
}

export interface SideView {
  userId: string;
  name: string;
  isBot: boolean;
  gain: number;
  pct: number;
  unpriced: string[];
  lineup: LineupRow[];
  race: RacePoint[];
}

export interface MatchupLiveViewModel {
  hasOpponent: boolean;
  me: SideView;
  opp: SideView | null;
  leader: Leader | null;
  /** Absolute dollar gap; null with no opponent. */
  leadDollars: number | null;
}

export function nameOf(data: GetHomeLeagueResult, userId: string): { name: string; isBot: boolean } {
  const row = data.standings.find((s) => s.user_id === userId);
  // A manager with no standings row has no name to show. Don't invent one.
  return { name: row?.display_name ?? '', isBot: row?.is_bot ?? false };
}

/** The day's price for a symbol: its own session's close, or null (no bar). */
function priceOn(bars: BarsBySymbol, symbol: string, date: string): number | null {
  const bar = bars[symbol]?.find((b) => b.date === date);
  return bar ? bar.close : null;
}

function side(input: MatchupInput, userId: string, snapshots: GetHomeLeagueResult['current_week']['my_snapshots'], trades: GetHomeLeagueResult['current_week']['my_trades']): SideView {
  const snaps = toLiveSnapshots(snapshots);
  const tds = toLiveTrades(trades);
  const live = liveWeekScore(snaps, tds, input.quote);
  const race = weekRacePoints(
    snaps,
    tds,
    input.days.map((d) => ({ ...d, price: (s: string) => priceOn(input.bars, s, d.date) })),
  );
  const { name, isBot } = nameOf(input.data, userId);
  return {
    userId,
    name,
    isBot,
    gain: live.gain,
    pct: live.pct,
    unpriced: live.unpriced,
    lineup: lineupRows(live.bySymbol, live.gain),
    race,
  };
}

export function buildMatchupLive(input: MatchupInput): MatchupLiveViewModel {
  const { data, myUserId } = input;
  const cw = data.current_week;
  const matchup = data.matchups.find((m) => m.week_number === cw.week_number) ?? null;
  const oppUserId =
    matchup === null
      ? null
      : matchup.team1_user_id === myUserId
        ? matchup.team2_user_id
        : matchup.team2_user_id === myUserId
          ? matchup.team1_user_id
          : null;

  const me = side(input, myUserId, cw.my_snapshots, cw.my_trades);
  if (oppUserId === null) {
    return { hasOpponent: false, me, opp: null, leader: null, leadDollars: null };
  }
  const opp = side(input, oppUserId, cw.opponent_snapshots, cw.opponent_trades);
  return {
    hasOpponent: true,
    me,
    opp,
    leader: leaderOf(me.gain, opp.gain),
    leadDollars: Math.abs(me.gain - opp.gain),
  };
}

/**
 * The scored week's gains, from the server's matchup row: the authoritative
 * numbers once both post (Matchup final). Null until they do: nothing reads
 * final before it is. My side is team1 or team2, whichever I am.
 */
export function finalGains(data: GetHomeLeagueResult, myUserId: string): { me: number; opp: number } | null {
  const cw = data.current_week;
  const m = data.matchups.find((row) => row.week_number === cw.week_number) ?? null;
  if (!m || m.team1_gain === null) return null;
  if (m.team1_user_id === myUserId) {
    return m.team2_gain === null ? null : { me: m.team1_gain, opp: m.team2_gain };
  }
  if (m.team2_user_id === myUserId) {
    return m.team1_gain === null ? null : { me: m.team2_gain!, opp: m.team1_gain };
  }
  return null;
}
