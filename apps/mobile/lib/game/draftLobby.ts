/**
 * draftLobby (3c): the lobby's rules. Your snake picks (the board's "You pick
 * 4th, then 13th, 20th…"), the uneven-bye split (the board's byeNotice), and
 * the start blockers as copy. The copy keeps the existing app strings
 * (verbatim) and, for a blocker this build does not know, one honest generic
 * line rather than a guessed reason.
 */

/** Your overall pick numbers, in order: a snake over `seat` (1-based) of `managers`. */
export function mySnakePicks(seat: number, managers: number, rounds: number): number[] {
  const picks: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    const within = round % 2 === 1 ? seat : managers + 1 - seat; // odd rounds run forward, even reversed
    picks.push((round - 1) * managers + within);
  }
  return picks;
}

/** The lobby's "Draft order set {when} ET, an hour before the draft" line, or null when it
 * would name nothing true. The order only moves forward (open → finalized → locked; the DB
 * trigger refuses any step back), and a postponement at the 'start' stage clears the draft time
 * after the room opened, so a finalized order with NO draft time is reachable: then "an hour
 * before the draft" names a draft that has no time, and the line is hidden (checklist §5,
 * labels in their emptiest state; no new copy). The order itself still shows. */
export function orderSetLine(line: string | null, draftDate: string | null): string | null {
  return draftDate ? line : null;
}

/** The waiting card's "3 of 4 managers" progress, only while it still counts toward the
 * minimum: with the league full enough (scheduled, the order not set until T−1h) it read
 * "6 of 4 managers" (W4 gate capture; checklist §5, labels that read as nonsense). */
export function managersProgressShown(memberCount: number, minMembers: number): boolean {
  return memberCount < minMembers;
}

/** Odd manager counts that don't divide the weeks evenly get a 1–2 (or 2–3) split. */
export function byeSplit(managers: number, weeks: number): { lo: number; hi: number } | null {
  if (managers % 2 === 0) return null;
  if (weeks % managers === 0) return null;
  return { lo: Math.floor(weeks / managers), hi: Math.ceil(weeks / managers) };
}

export type StartBlocker =
  | { code: 'not_enough_members'; have: number; need: number }
  | { code: 'playoff_teams_exceeds_members'; playoffTeams: number; members: number }
  | { code: string };

/** The start blocker's copy. Existing strings are verbatim; an unknown code gets
 * one honest generic line, never a made-up reason. */
export function startBlockerCopy(b: StartBlocker): string {
  if (b.code === 'not_enough_members' && 'have' in b) {
    const more = b.need - b.have;
    return `A draft needs at least ${b.need} managers. ${b.have} are in, so invite ${more} more to start.`;
  }
  if (b.code === 'playoff_teams_exceeds_members' && 'playoffTeams' in b) {
    return `${b.playoffTeams} playoff teams, but ${b.members} managers are in. Lower the playoff teams to start.`;
  }
  return "The draft can't start yet.";
}

/** The uneven-bye heads-up (board copy, verbatim): "With 7 managers and 10 weeks,
 * byes won't be even: some get 2, some get 1." Null when the byes are even. */
export function byeNoticeCopy(managers: number, weeks: number): string | null {
  const split = byeSplit(managers, weeks);
  if (split === null) return null;
  return `With ${managers} managers and ${weeks} weeks, byes won't be even: some get ${split.hi}, some get ${split.lo}.`;
}

/** The playoff-teams stepper's range (board: "Up to 6, one per manager."): at
 * least 2 teams, at most one per manager. */
export function playoffStepperBounds(managers: number): { min: number; max: number } {
  return { min: 2, max: Math.max(2, managers) };
}

/** The value after one step, held inside the bounds: the stepper never leaves them. */
export function stepPlayoffTeams(value: number, direction: 1 | -1, managers: number): number {
  const { min, max } = playoffStepperBounds(managers);
  return Math.min(max, Math.max(min, value + direction));
}
