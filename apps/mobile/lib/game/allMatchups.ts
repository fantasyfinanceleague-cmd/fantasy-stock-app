/**
 * allMatchups (3c): every game of the week, for the League-segment list on
 * Matchup. A live game is scored the same way as Matchup: liveWeekScore on
 * each manager's own ledger, with the same quotes. A posted game shows the
 * server's gains (final). A bye is one side. Names come from the standings,
 * never invented; a bot is marked by is_bot.
 */
import { liveWeekScore } from '../home/liveWeekScore';
import { toLiveSnapshots, toLiveTrades, type HomeLedgerRow } from '../home/buildHomeViewModel';

export interface AllMatchupsInput {
  myUserId: string;
  week: number;
  matchups: {
    team1_user_id: string | null;
    team2_user_id: string | null;
    team1_gain: number | null;
    team2_gain: number | null;
    winner_user_id: string | null;
    is_tie: boolean;
    is_playoff: boolean;
  }[];
  /** Every manager's snapshot rows this week (user_id added to each). */
  snapshots: (HomeLedgerRow & { user_id: string })[];
  /** Every manager's trades in the week's window (user_id added to each). */
  trades: (HomeLedgerRow & { user_id: string })[];
  quote: (symbol: string) => number | null;
  names: { user_id: string; display_name: string; is_bot: boolean }[];
}

export interface AllMatchupSide {
  userId: string;
  name: string;
  isBot: boolean;
  gain: number;
  pct: number | null;
}

export interface AllMatchupRow {
  a: AllMatchupSide;
  /** Null for a bye. */
  b: AllMatchupSide | null;
  /** True when this game involves the caller. */
  mine: boolean;
  /** True once the server has posted both gains (or the bye's one gain). */
  final: boolean;
}

function nameOf(names: AllMatchupsInput['names'], userId: string) {
  const n = names.find((x) => x.user_id === userId);
  return { name: n?.display_name ?? '', isBot: n?.is_bot ?? false };
}

function sideLive(input: AllMatchupsInput, userId: string): AllMatchupSide {
  const snaps = input.snapshots.filter((s) => s.user_id === userId);
  const trades = input.trades.filter((t) => t.user_id === userId);
  const live = liveWeekScore(toLiveSnapshots(snaps), toLiveTrades(trades), input.quote);
  const { name, isBot } = nameOf(input.names, userId);
  return { userId, name, isBot, gain: live.gain, pct: live.pct };
}

export function buildAllMatchups(input: AllMatchupsInput): AllMatchupRow[] {
  // A row with no team 1 is skipped, never thrown on: one odd row must not
  // take the whole screen down.
  return input.matchups.flatMap((m): AllMatchupRow[] => {
    const t1 = m.team1_user_id;
    if (t1 === null) return [];
    const t2 = m.team2_user_id;
    const bye = t2 === null;
    const posted = m.team1_gain !== null && (bye || m.team2_gain !== null);
    const mine = t1 === input.myUserId || t2 === input.myUserId;
    if (posted) {
      const a: AllMatchupSide = { userId: t1, ...nameOf(input.names, t1), gain: m.team1_gain!, pct: null };
      const b: AllMatchupSide | null = bye ? null : { userId: t2!, ...nameOf(input.names, t2!), gain: m.team2_gain!, pct: null };
      return [{ a, b, mine, final: true }];
    }
    return [{ a: sideLive(input, t1), b: bye ? null : sideLive(input, t2!), mine, final: false }];
  });
}
