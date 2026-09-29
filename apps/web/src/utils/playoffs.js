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
