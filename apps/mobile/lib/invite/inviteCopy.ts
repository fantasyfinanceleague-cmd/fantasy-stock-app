/**
 * The invite refusals' words (the Planner's, 2026-10-14; Giorgio's B arrival ruling), in ONE place and
 * with no imports, so the signed-out arrival (arrivalView.ts), Join's refusal copy (lib/join/
 * joinPreview.ts) and the tests all read the same lines. The web page uses the same lines.
 *
 * Mapping, checked against previewJoinReason (supabase/functions/preview-league/reason.ts):
 *   league_full       → full
 *   draft_started     → closed (an open draft room counts as started there)
 *   season_completed  → closed
 *   invite_expired    → dead (a used, expired or revoked link) ; a link that finds no league is dead too
 *   already_member    → never signed out (no session to be a member of)
 */
export const INVITE_COPY = {
  full: (name: string) => `${name} is full. Ask whoever invited you if they can make room.`,
  closed: (name: string) => `${name} isn't taking new players right now.`,
  dead: "This invite link doesn't work anymore. Ask for a new one.",
} as const;
