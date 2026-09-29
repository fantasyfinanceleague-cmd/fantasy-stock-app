/**
 * Playoff shape from the commissioner's playoff team count P (flexible
 * playoffs, Giorgio 2026-09-29): weeks W = ceil(log2 P), first-round byes
 * 2^W − P to the top seeds, and the round names.
 *
 * MIRROR of the server's supabase/functions/_shared/playoff-bracket.ts
 * (playoffShape + playoffRoundLabels) and of the mobile copy
 * apps/mobile/lib/playoffs.ts. apps/mobile/tests-deno/playoffs.test.ts pins
 * all three to each other; change them together.
 *
 * Display only. Bracket structure (which game feeds which) is the server's
 * job and is keyed on matchups.playoff_round_number, never on these labels.
 * Schedules, standings and brackets are generated SERVER-SIDE only
 * (_shared/schedule.ts via finalize_league_draft; process-week-results via
 * start_league_playoffs). Do not re-add client-side matchups/standings
 * inserts (this replaces the old utils/scheduleGenerator.js note).
 */

/** Round names counted back from the final (DECIDED, Giorgio 2026-09-29). */
const ROUND_NAMES_FROM_FINAL = ['Final', 'Semifinals', 'Quarterfinals', 'Round of 16'];

/**
 * The playoff plan for P teams — { teams, weeks, byes, rounds } — or null when
 * P is not an integer >= 2 or the bracket is longer than the named rounds (more
 * than 16 teams, which the 16-manager league cap rules out). A first round that
 * has byes is "Wild card".
 * @param {number | null | undefined} teams
 * @returns {{ teams: number, weeks: number, byes: number, rounds: string[] } | null}
 */
export function playoffPlan(teams) {
  if (typeof teams !== 'number' || !Number.isInteger(teams) || teams < 2) return null;
  let weeks = 0;
  while (2 ** weeks < teams) weeks++;
  if (weeks > ROUND_NAMES_FROM_FINAL.length) return null;
  const byes = 2 ** weeks - teams;
  const rounds = Array.from({ length: weeks }, (_, i) => ROUND_NAMES_FROM_FINAL[weeks - 1 - i]);
  if (byes > 0 && weeks > 1) rounds[0] = 'Wild card';
  return { teams, weeks, byes, rounds };
}

/**
 * One-line summary for the playoff-teams control, verbatim from the design
 * board (KS.playoffLine): "6 teams · 3 weeks of playoffs · the top 2 seeds get
 * first-round byes". Null when P is invalid.
 * @param {number | null | undefined} teams
 * @returns {string | null}
 */
export function playoffLine(teams) {
  const p = playoffPlan(teams);
  if (!p) return null;
  const bye = p.byes === 0
    ? 'no byes'
    : p.byes === 1
    ? 'the top seed gets a first-round bye'
    : `the top ${p.byes} seeds get first-round byes`;
  return `${p.teams} teams · ${p.weeks} ${p.weeks === 1 ? 'week' : 'weeks'} of playoffs · ${bye}`;
}

/**
 * Display label for a playoff WEEK: playoff week r is week num_weeks + r, and
 * its name is playoffPlan(P).rounds[r - 1]. Keyed on structure (week, the
 * regular-season length, P), never on the stored playoff_round code, so the
 * copy is decided in one place. Null for a regular-season week or bad input.
 * @param {number | null | undefined} week
 * @param {number | null | undefined} numWeeks
 * @param {number | null | undefined} playoffTeams
 * @returns {string | null}
 */
export function playoffRoundLabelForWeek(week, numWeeks, playoffTeams) {
  const plan = playoffPlan(playoffTeams);
  if (!plan || typeof week !== 'number' || typeof numWeeks !== 'number') return null;
  return plan.rounds[week - numWeeks - 1] ?? null;
}
