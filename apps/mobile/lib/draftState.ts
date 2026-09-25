/**
 * Pure draft-phase + start-blocker logic for the mobile draft screen (no React
 * Native imports — plain TS so it is checkable with both `tsc` and `deno
 * check`/`deno test`; see apps/mobile/tests-deno/draftState.test.ts).
 *
 * Extracted for the mobile launch fixes (docs/STATUS.md §4 defect 10): before
 * this, draft.tsx derived "is the draft done" purely from
 * activeLeague.draft_status, with no notion of "every pick is made but the
 * server hasn't finalized yet" — so once the last pick landed, the screen had
 * no current picker AND no finalize control. computeDraftPhase adds that
 * missing 'finalizing' phase between 'drafting' and 'completed'.
 */

export type DraftStatus = 'not_started' | 'in_progress' | 'completed';

export type DraftPhase = 'no_stake_mode' | 'not_started' | 'drafting' | 'finalizing' | 'completed';

export interface DraftPhaseInputs {
  draftStatus: DraftStatus | null | undefined;
  /** activeLeague.stake_mode — null means a legacy league with no mode chosen
   * yet; drafting is blocked regardless of draft_status (matches draft.tsx's
   * existing precedence: the stake-mode gate is checked BEFORE draft_status). */
  stakeMode: string | null | undefined;
  memberCount: number;
  numRounds: number;
  /** drafts rows for this league, INCLUDING SKIP sentinels — same convention
   * as the server (currentTurn/validatePick in
   * supabase/functions/_shared/draft-validation.ts): a SKIP consumes a pick
   * number, so it counts toward completeness. */
  pickCount: number;
}

/**
 * What should the draft screen show? Guards on a COUNT comparison
 * (pickCount >= memberCount * numRounds) — never "does any pick exist" or
 * "is draft_status truthy" alone — per CLAUDE.md's "Guards here are keyed on
 * ALL-OR-NOTHING state and blind to PARTIAL state" note: the previous code had
 * no representation at all for "every pick is made, but the server hasn't
 * flipped draft_status yet" (finalize failed or was never retried), so that
 * state silently fell into the ordinary 'drafting' branch with no current
 * picker and no way to recover.
 *
 * 'completed' is ONLY returned when draft_status itself says so — never
 * inferred from pick counts, matching CLAUDE.md's "verify the EFFECT, not the
 * status" cases: a client must not tell the user the draft is done unless the
 * server actually recorded that.
 */
export function computeDraftPhase(i: DraftPhaseInputs): DraftPhase {
  if (!i.stakeMode) return 'no_stake_mode';
  if (i.draftStatus === 'not_started') return 'not_started';
  if (i.draftStatus === 'completed') return 'completed';

  // Anything else (expected: 'in_progress'; matches draft.tsx's original
  // fallthrough — a null/unrecognized draft_status is not a state the DB
  // CHECK constraint allows, so it is treated the same as 'in_progress'
  // rather than invented as a new phase here).
  const expectedPicks = i.memberCount * i.numRounds;
  if (i.memberCount > 0 && i.numRounds > 0 && i.pickCount >= expectedPicks) {
    return 'finalizing';
  }
  return 'drafting';
}

// ---------------------------------------------------------------------------
// draft-control 'status' blockers -> user-facing copy. Kept as data (the
// blocker shape) + a pure formatter so the mobile UI and any future surface
// (e.g. a web re-launch) render identical copy from the same server response.
// ---------------------------------------------------------------------------

export type StartBlockerCode =
  | 'not_started_state'
  | 'no_stake_mode'
  | 'no_draft_date'
  | 'draft_date_not_reached'
  | 'not_enough_members';

export interface StartBlocker {
  code: StartBlockerCode;
  draftStatus?: DraftStatus;
  draftDate?: string;
  have?: number;
  need?: number;
}

/** Human copy for one draft-control start blocker. Mirrors
 * supabase/functions/draft-control/rules.ts's computeStartBlockers exactly —
 * one code, one message, no guessing at the reason from other league fields. */
export function describeStartBlocker(b: StartBlocker): string {
  switch (b.code) {
    case 'not_started_state':
      return b.draftStatus === 'completed'
        ? 'This draft has already finished.'
        : 'The draft has already started.';
    case 'no_stake_mode':
      return 'Choose a stake mode in League Settings before starting.';
    case 'no_draft_date':
      return 'Set a draft date in League Settings before starting.';
    case 'draft_date_not_reached':
      return b.draftDate
        ? `The draft opens at ${new Date(b.draftDate).toLocaleString()}.`
        : 'The scheduled draft time has not arrived yet.';
    case 'not_enough_members': {
      const have = b.have ?? 0;
      const need = b.need ?? 0;
      const more = Math.max(need - have, 0);
      return `Need ${more} more member${more === 1 ? '' : 's'} to start (have ${have}, need ${need}).`;
    }
    default:
      return 'The draft cannot start yet.';
  }
}
