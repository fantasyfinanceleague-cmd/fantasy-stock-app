// The invite-arrival types (Orchestrator contract, 2026-10-14; W4 builds the signed-out arrival screen on them), in a PURE
// module: no React, no storage, no supabase. W4's pure modules (arrivalView.ts, inviteFixture.ts) and their hermetic Deno
// tests import these; the hook that returns them is lib/invite/usePendingInvite.ts, which re-exports them unchanged.

import type { InviteReason } from './invitePreview';

export type { InviteReason };

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
