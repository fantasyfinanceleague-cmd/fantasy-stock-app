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
//
// It also covers an OPEN DRAFT ROOM (20261123000000; Giorgio, 2026-10-14:
// "once the draft room opens (an hour before) the league is considered
// started. no one can join and the share link cannot work"). Same moment as
// the RPC's _draft_order_is_due(draft_date): isRoomTime, from the shared
// policy whose hour the SQL policy pins. A postponed draft has no draft_date,
// so it stays joinable.

import { isRoomTime } from '../_shared/draft-start-policy.ts';

export interface PreviewLeagueInput {
  /** league_members row for the caller, or null if they are not a member. */
  isExistingMember: boolean;
  seasonStatus: string; // 'active' | 'playoffs' | 'completed'
  draftStatus: string; // 'not_started' | 'in_progress' | 'completed'
  /** leagues.draft_date (ISO). NULL = no time set, or postponed (which clears it). */
  draftDate: string | null;
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

export function previewJoinReason(input: PreviewLeagueInput, now: Date = new Date()): PreviewJoinResult {
  const reason = computeReason(input, now);
  return { joinable: reason === null, reason };
}

function computeReason(input: PreviewLeagueInput, now: Date): PreviewReason {
  if (input.isExistingMember) return 'already_member';
  if (input.seasonStatus === 'completed') return 'season_completed';

  if (input.invite) {
    const expired =
      input.invite.status !== 'pending' ||
      (input.invite.expiresAt !== null && new Date(input.invite.expiresAt) < now);
    if (expired) return 'invite_expired';
  }

  if (input.draftStatus !== 'not_started' || isRoomTime(input.draftDate, now)) return 'draft_started';

  if (input.currentMembers >= input.numParticipants) return 'league_full';

  return null;
}
