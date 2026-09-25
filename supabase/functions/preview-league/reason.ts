// Pure reason/joinable logic for preview-league, extracted out of index.ts so
// it is hermetically testable (no DB, no Deno.serve).
//
// Mirrors join_league_by_code's refusal precedence exactly (see
// supabase/migrations/20260930000000_join_league_refuse_mid_draft.sql):
//   already_member > season_completed > invite_expired > draft_started > league_full
//
// draft_started is HARD here (joinable=false), unlike the pre-20260930 preview
// which treated it as soft/display-only. A user should never be shown a Join
// button that the RPC will then refuse.

export interface PreviewLeagueInput {
  /** league_members row for the caller, or null if they are not a member. */
  isExistingMember: boolean;
  seasonStatus: string; // 'active' | 'playoffs' | 'completed'
  draftStatus: string; // 'not_started' | 'in_progress' | 'completed'
  /** Present only when the code resolved via league_invites, not leagues.invite_code. */
  invite: { status: string; expiresAt: string | null } | null;
  currentMembers: number;
  numParticipants: number;
}

export type PreviewReason =
  | 'already_member'
  | 'season_completed'
  | 'invite_expired'
  | 'draft_started'
  | 'league_full'
  | null;

export interface PreviewJoinResult {
  joinable: boolean;
  reason: PreviewReason;
}

export function previewJoinReason(input: PreviewLeagueInput): PreviewJoinResult {
  const reason = computeReason(input);
  return { joinable: reason === null, reason };
}

function computeReason(input: PreviewLeagueInput): PreviewReason {
  if (input.isExistingMember) return 'already_member';
  if (input.seasonStatus === 'completed') return 'season_completed';

  if (input.invite) {
    const expired =
      input.invite.status !== 'pending' ||
      (input.invite.expiresAt !== null && new Date(input.invite.expiresAt) < new Date());
    if (expired) return 'invite_expired';
  }

  if (input.draftStatus !== 'not_started') return 'draft_started';

  if (input.currentMembers >= input.numParticipants) return 'league_full';

  return null;
}
