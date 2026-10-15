// The invite-arrival API (Orchestrator, 2026-10-14; the contract W3 builds, branch
// feat/onboarding-w3-invite-links). THIS FILE IS A STUB until W3 merges: W3 replaces it whole and
// keeps these exported types, so the arrival screen (components/shell/InviteArrival.tsx) does not
// change. Until then no invite is ever pending, so the arrival route is unreachable in a release.
//
// 'unavailable' covers a 429, a 5xx, a network failure, or the function not deployed. A signed-out
// 'not_found' does NOT clear the invite: the definitive clear-with-explanation happens at 'ready',
// inside W3's auto-join. There is no retry loop; retryPreview() fires only on a user tap.
import type { PreviewLeague } from '../join/joinPreview';

export type InviteReason = 'league_full' | 'draft_started' | 'season_completed';

export type InvitePreview =
  | { kind: 'loading' }
  | {
      kind: 'found';
      name: string;
      inviter: string | null;
      reason: InviteReason | null;
      /**
       * PROPOSED extension (not in the Orchestrator's shape): the league's facts as preview-league
       * returns them, already parsed by lib/join/joinPreview.parsePreviewLeague. With it the arrival
       * shows the plan's Managers / Draft / Stakes / Season rows and the existing refusal copy; without
       * it the rows are left out and a refusal falls back to the shipped "can't join right now" line.
       */
      league?: PreviewLeague | null;
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
