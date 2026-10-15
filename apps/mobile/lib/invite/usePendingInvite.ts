// The invite-arrival API (Orchestrator, 2026-10-14; the contract W3 builds, branch
// feat/onboarding-w3-invite-links). THIS FILE IS A STUB until W3 merges: W3 replaces it whole and
// keeps these exported types, so the arrival screen (components/shell/InviteArrival.tsx) does not
// change. Until then no invite is ever pending, so the arrival route is unreachable in a release.
//
// 'unavailable' covers a 429, a 5xx, a network failure, or the function not deployed. A signed-out
// 'not_found' does NOT clear the invite: the definitive clear-with-explanation happens at 'ready',
// inside W3's auto-join. Before sign-in the only data is the league's NAME, its INVITER and a refusal
// REASON (Planner: the no-session endpoint returns nothing else); counts, dates and stakes appear after
// sign-in, in the session preview inside auto-join. There is no retry loop; retryPreview() fires only on a user tap.

export type InviteReason = 'league_full' | 'draft_started' | 'season_completed';

export type InvitePreview =
  | { kind: 'loading' }
  | {
      kind: 'found';
      name: string;
      inviter: string | null;
      reason: InviteReason | null;
    }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

export interface PendingInvite {
  code: string;
  leagueName: string | null;
  preview: InvitePreview;
  retryPreview(): void;
}

export function usePendingInvite(): PendingInvite | null {
  return null;
}
