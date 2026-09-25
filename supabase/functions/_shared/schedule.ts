/**
 * Pure season-schedule planning — the server-side port of
 * apps/web/src/utils/scheduleGenerator.js (generateSchedule,
 * getNextDayMarketOpen, getMarketClose) plus DraftPage.jsx `completeDraft`'s
 * league-date rules.
 *
 * WHY THIS EXISTS: matchups, initial league_standings and
 * leagues.league_start_date/league_end_date used to be written ONLY by the web
 * client at draft completion. The web app is paused and mobile never wrote them,
 * so a mobile-drafted league got no schedule — and every weekly job
 * (snapshot-week-start/end, process-week-results) selects from `matchups`, so
 * such a league was never snapshotted or scored. validate-and-record-pick now
 * plans the season here and writes it atomically through the
 * finalize_league_draft RPC.
 *
 * Hermetic: no DB, no Deno runtime APIs, and `now` is an input — so the same
 * roster + settings + instant always yields the same plan. See schedule.test.ts.
 *
 * FIDELITY: pairings and dates are a faithful port, pinned by golden tests
 * captured from the web generator. Deliberately preserved quirks:
 *   - Times are FIXED UTC year-round: market open 14:30Z, close 21:00Z (correct
 *     for EST; during EDT they are 10:30 / 17:00 ET). The Monday snapshot cron
 *     and the Friday 21:15Z scoring cron are keyed to the same fixed UTC clock.
 *   - NO market-holiday awareness. A week whose Tuesday or Friday is a holiday
 *     keeps its nominal window; snapshot-week-start's Monday/Tuesday holiday
 *     handling is keyed on current_week, not on these dates.
 *   - Duration leagues start the NEXT CALENDAR DAY and end duration_days later,
 *     neither snapped to a trading day (a Friday draft starts on a Saturday).
 *
 * Roster order is the canonical draft order (computeDraftOrder: commissioner
 * first, rest sorted ascending) so the schedule is a pure function of league
 * membership, not of whichever order a query returned rows in.
 */
import { computeDraftOrder } from './draft-validation.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_H = 14, OPEN_M = 30; // 9:30 ET (EST) as fixed UTC
const CLOSE_H = 21; // 16:00 ET (EST) as fixed UTC
const TUESDAY = 2;
const DEFAULT_DURATION_DAYS = 30; // DraftPage: league?.duration_days || 30

/** One regular-season matchup row, shaped for the matchups table. A bye is
 * team2_user_id = null with the real player in team1 (web convention;
 * process-week-results treats `!team2_user_id && !is_playoff` as a bye). */
export interface MatchupRow {
  week_number: number;
  team1_user_id: string;
  team2_user_id: string | null;
  week_start: string; // ISO-8601 UTC
  week_end: string; // ISO-8601 UTC
}

export interface SeasonInput {
  leagueType: string; // leagues.league_type: 'matchup' | 'duration'
  commissionerId: string | null;
  memberIds: string[]; // league_members.user_id, any order
  numWeeks: number | null; // leagues.num_weeks
  durationDays: number | null; // leagues.duration_days
  now: Date; // draft-completion instant
}

export type SeasonPlan =
  | {
    ok: true;
    roster: string[]; // canonical order
    leagueStart: string; // ISO
    leagueEnd: string; // ISO
    matchups: MatchupRow[]; // [] for duration leagues
  }
  | { ok: false; reason: 'no_members' | 'too_few_members' | 'invalid_num_weeks' | 'unknown_league_type' };

/** UTC midnight of `d`'s calendar day, as epoch ms. */
function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Week `week` (1-indexed) window: the first Tuesday STRICTLY after `base`'s
 * UTC day (a Tuesday rolls a full week), plus (week-1) weeks, 14:30Z; ends that
 * Friday 21:00Z. Port of getWeekStartTuesday + getWeekEndFriday. */
export function weekWindow(base: Date, week: number): { start: Date; end: Date } {
  let untilTue = (TUESDAY - base.getUTCDay() + 7) % 7;
  if (untilTue === 0) untilTue = 7;
  const tue = utcDay(base) + (untilTue + (week - 1) * 7) * DAY_MS;
  return {
    start: new Date(tue + (OPEN_H * 60 + OPEN_M) * 60 * 1000),
    end: new Date(tue + 3 * DAY_MS + CLOSE_H * 60 * 60 * 1000),
  };
}

/** Next calendar day's market open (14:30Z). Port of getNextDayMarketOpen. */
export function nextDayMarketOpen(now: Date): Date {
  return new Date(utcDay(now) + DAY_MS + (OPEN_H * 60 + OPEN_M) * 60 * 1000);
}

/** Market close (21:00Z) on `d`'s UTC day. Port of getMarketClose. */
export function marketCloseOn(d: Date): Date {
  return new Date(utcDay(d) + CLOSE_H * 60 * 60 * 1000);
}

/** Round-robin pairings via the circle method (port of generateSchedule's
 * pairing half). Odd rosters get a BYE seat; the real player of a bye pairing
 * lands in team1 with team2 = null. Week w uses rotation (w-1) % (n-1), so a
 * season longer than n-1 weeks cycles through the same round-robin again. */
export function roundRobinPairings(
  roster: string[],
  numWeeks: number,
): Array<{ week: number; team1: string; team2: string | null }> {
  // null, not the web's 'BYE' string, so the seat can never collide with (or
  // leak out as) a real user id.
  const BYE = null;
  const seats: (string | null)[] = [...roster];
  if (seats.length % 2 !== 0) seats.push(BYE);
  const n = seats.length;
  const out: Array<{ week: number; team1: string; team2: string | null }> = [];

  for (let week = 1; week <= numWeeks; week++) {
    const rotation = (week - 1) % (n - 1);
    const rotated = [seats[0]];
    for (let i = 1; i < n; i++) rotated.push(seats[((i - 1 + rotation) % (n - 1)) + 1]);

    for (let i = 0; i < n / 2; i++) {
      const a = rotated[i], b = rotated[n - 1 - i];
      if (a === BYE) out.push({ week, team1: b as string, team2: null });
      else out.push({ week, team1: a, team2: b });
    }
  }
  return out;
}

/** Plan a league's season at draft completion (DraftPage completeDraft rules).
 *  - matchup:  round-robin schedule; league window = week 1 start .. last week end.
 *              num_weeks null/0 falls back to (members - 1), as the web did.
 *  - duration: no matchups; next-day open .. +duration_days at market close. */
export function planSeason(input: SeasonInput): SeasonPlan {
  const roster = computeDraftOrder(input.commissionerId, [...new Set(input.memberIds)]);
  if (roster.length === 0) return { ok: false, reason: 'no_members' };

  if (input.leagueType === 'duration') {
    const start = nextDayMarketOpen(input.now);
    const days = input.durationDays || DEFAULT_DURATION_DAYS;
    const end = marketCloseOn(new Date(start.getTime() + days * DAY_MS));
    return { ok: true, roster, leagueStart: start.toISOString(), leagueEnd: end.toISOString(), matchups: [] };
  }

  if (input.leagueType !== 'matchup') return { ok: false, reason: 'unknown_league_type' };
  // The web would emit a degenerate all-bye season for a solo roster; refuse
  // instead — a one-member matchup league has nothing to score.
  if (roster.length < 2) return { ok: false, reason: 'too_few_members' };

  const numWeeks = input.numWeeks || roster.length - 1;
  if (!Number.isInteger(numWeeks) || numWeeks < 1) return { ok: false, reason: 'invalid_num_weeks' };

  const matchups: MatchupRow[] = roundRobinPairings(roster, numWeeks).map((p) => {
    const w = weekWindow(input.now, p.week);
    return {
      week_number: p.week,
      team1_user_id: p.team1,
      team2_user_id: p.team2,
      week_start: w.start.toISOString(),
      week_end: w.end.toISOString(),
    };
  });

  return {
    ok: true,
    roster,
    leagueStart: weekWindow(input.now, 1).start.toISOString(),
    leagueEnd: weekWindow(input.now, numWeeks).end.toISOString(),
    matchups,
  };
}
