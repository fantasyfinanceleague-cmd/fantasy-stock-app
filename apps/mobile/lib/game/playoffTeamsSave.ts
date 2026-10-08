/**
 * The lobby's playoff-teams stepper save outcome (3c-2; Design Lead ruling).
 * Pure, so the rules tests see it.
 *
 * The LOCK is checked first: once the draft has started the server refuses the
 * change with 42501 (playoff_teams_locked from trg_leagues_freeze_playoff_teams;
 * league_rules_locked from the wider rules freeze). Retrying can't fix a lock,
 * so that line has no "Try again". Anything else that didn't change exactly the
 * one row (another error, or 0 rows from RLS or a stale id, which resolves with
 * no error) is "not saved" and can be retried.
 */
import { updatedOneRow } from './draftDateSave';

/** The existing lock line (League settings' "Locked for the season" message, settingsSave). */
export const PLAYOFF_TEAMS_LOCKED = "The draft has started, so the season setup can't change now. Nothing was saved.";

/** Not saved for any other reason (Design Lead ruling). */
export const PLAYOFF_TEAMS_NOT_SAVED = "Playoff teams weren't saved. Try again.";

const LOCK_PREFIXES = ['playoff_teams_locked', 'league_rules_locked'] as const;

/** True when the update was refused because the league is locked (the draft started). */
export function isLeagueLockError(err: unknown): boolean {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && LOCK_PREFIXES.some((p) => m.startsWith(p));
}

export type PlayoffTeamsSave =
  | { kind: 'saved' }
  | { kind: 'locked'; line: string }
  | { kind: 'not_saved'; line: string };

export function playoffTeamsSaveOutcome(res: { data: unknown; error: unknown }): PlayoffTeamsSave {
  if (isLeagueLockError(res.error)) return { kind: 'locked', line: PLAYOFF_TEAMS_LOCKED };
  if (!updatedOneRow(res)) return { kind: 'not_saved', line: PLAYOFF_TEAMS_NOT_SAVED };
  return { kind: 'saved' };
}
