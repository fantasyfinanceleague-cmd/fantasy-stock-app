// The invite-arrival API the screens read (Orchestrator contract, 2026-10-14; W4 builds the signed-out arrival
// screen on it). The pending invite itself is lib/invite/pendingInvite.ts, bound in pendingInviteStore.ts; this
// is its read-only view, `null` when no invite is pending.
//
// `preview` is the NO-SESSION invite-preview function's answer and nothing more: the league's name, the
// commissioner's username and whether the league can still be joined (Planner: name + inviter + reason only; no
// counts, stakes or dates before sign-in). 'unavailable' covers a 429, a 5xx, a network failure, an unparseable
// body, a reason this app doesn't know, or the function not being deployed: the screen then shows the generic
// "You're invited to a league" (inviteHeadline). A shared network can reach the per-IP miss limit after a few
// typos, so a 429 must read as that generic line, never as an error page.
//
// A signed-out 'not_found' does NOT clear the invite: the definitive clear-with-explanation happens at 'ready',
// inside the auto-join (lib/invite/inviteJoin.ts), so there is one place that decides. There is no retry loop:
// retryPreview() fires only on a user tap.
import { useMemo, useSyncExternalStore } from 'react';

import { screenPreview } from './pendingInvite';
import { pendingInvite } from './pendingInviteStore';
import type { PendingInvite } from './pendingInviteTypes';

// The contract's types live in a pure module (pendingInviteTypes.ts) so hermetic tests can import them; re-exported unchanged.
export type { InvitePreview, InviteReason, PendingInvite } from './pendingInviteTypes';

/** The pending invite, or null. The same object between changes (it is safe as an effect dependency). */
export function usePendingInvite(): PendingInvite | null {
  const snap = useSyncExternalStore(pendingInvite.subscribe, pendingInvite.getSnapshot);
  return useMemo(() => {
    if (!snap.code) return null;
    return {
      code: snap.code,
      leagueName: snap.leagueName,
      preview: screenPreview(snap.preview),
      retryPreview: pendingInvite.retryPreview,
    };
  }, [snap.code, snap.leagueName, snap.preview]);
}
