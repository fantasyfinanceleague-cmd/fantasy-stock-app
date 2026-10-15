/**
 * Every line the web invite and confirm pages show.
 *
 * The join refusals are the APPROVED app copy, verbatim, from
 * apps/mobile/lib/join/joinPreview.ts (board "Join a league", #125/#201).
 * joinCopy.parity.test.ts imports that module and fails if any line or any
 * refusal reason drifts. Change the copy there first, never here alone.
 *
 * NO server text ever reaches the page (house rule): every reason and every
 * transport failure maps to a line written here.
 *
 * Strings starting with `__PLACEHOLDER__` are NOT approved yet. They render as
 * written, and the production build refuses to finish while one is in the
 * bundle (vite-plugins/universalLinks.ts), so none can ship by accident.
 */

/** Why a league that exists can't be joined (the app's JoinBlock, same names). */
export type JoinBlock =
  | 'league_full'
  | 'draft_started'
  | 'draft_in_progress'
  | 'already_member'
  | 'invite_expired'
  | 'season_completed'
  | 'left_league'
  | 'unknown';

/** Every block, for the parity test (keep in step with the type). */
export const JOIN_BLOCKS: readonly JoinBlock[] = [
  'league_full',
  'draft_started',
  'draft_in_progress',
  'already_member',
  'invite_expired',
  'season_completed',
  'left_league',
  'unknown',
];

export type JoinErrorKind = 'unreachable' | 'rate_limited';

/** Verbatim from the app's JOIN_COPY (the subset this page uses). */
export const JOIN_COPY = {
  badCode: 'No league has that code. Check it and try again.',
  unreachable: "Couldn't reach the league. Check your connection, then try again.",
  rateLimited: 'Too many tries. Wait a moment, then try again.',
  unknownBlock: "You can't join this league right now. Ask your commissioner to check the invite.",
} as const;

/** Onboarding strings approved for the web pages (plan Decisions 10 and 16, verbatim). */
export const WEB_COPY = {
  /** /auth/confirm on a device without the app (Decision 16). */
  confirmed: 'Your email is confirmed. Open the app and sign in.',
  /** Decision 16, the pending-invite variant. NOT used yet: needs the league NAME from a trusted source (onboarding Q1), never from the URL. */
  confirmedWithInvite: (league: string) => `Your email is confirmed. Open the app and sign in to finish joining ${league}.`,
  /** /auth/confirm when the link is expired or already used (Planner, 2026-10-14, verbatim). */
  confirmError: 'This link has expired. Open the app and sign in to get a new one.',
  /** The invite headline (plan Decision 7). With no inviter, "You're invited to {league}" (W3's contract, relayed 2026-10-14). */
  invitedBy: (inviter: string, league: string) => `${inviter} invited you to ${league}`,
  invitedTo: (league: string) => `You're invited to ${league}`,
  /** The fallback when the preview is unavailable (Planner's fallback, relayed 2026-10-14). */
  invitedToGeneric: "You're invited to a league",
  /** The App Store badge's accessible name (Apple's badge wording). */
  appStoreBadge: 'Download on the App Store',
} as const;

/** Not approved yet: each goes to the Orchestrator as a proposal. */
export const PENDING_COPY = {
  /** The custom-scheme button under the invite (proposed label). */
  openInApp: '__PLACEHOLDER__ Open in the app',
} as const;

export function errorMessage(kind: JoinErrorKind): string {
  return kind === 'rate_limited' ? JOIN_COPY.rateLimited : JOIN_COPY.unreachable;
}

/** The app's coerceBlock: an unknown reason is 'unknown', never the raw string. */
export function coerceBlock(reason: unknown): JoinBlock {
  switch (reason) {
    case 'league_full':
    case 'draft_started':
    case 'already_member':
    case 'invite_expired':
    case 'season_completed':
    case 'left_league':
      return reason;
    default:
      return 'unknown';
  }
}

/** The app's refineBlock: `draft_started` for a draft not yet `completed` reads as in progress. */
export function refineBlock(block: JoinBlock, draftStatus: string | null | undefined): JoinBlock {
  return block === 'draft_started' && draftStatus !== 'completed' ? 'draft_in_progress' : block;
}

/** The app's blockMessage, line for line. */
export function blockMessage(block: JoinBlock, l: { name: string; max: number }): string {
  switch (block) {
    case 'league_full':
      return `${l.name} is full: ${l.max} of ${l.max} managers. Ask your commissioner if they can make room.`;
    case 'draft_started':
      return `${l.name} has already drafted, so it can't take new managers this season.`;
    case 'draft_in_progress':
      return `${l.name} is drafting right now, so it can't take new managers this season.`;
    case 'already_member':
      return `You're already in ${l.name}.`;
    case 'invite_expired':
      return 'This invite has expired. Ask your commissioner for a new code.';
    case 'season_completed':
      return `${l.name}'s season is over. Ask your commissioner whether they're running it back.`;
    case 'left_league':
      return `You left ${l.name} this season, so you can't rejoin it. You can still view it from Your leagues.`;
    default:
      return JOIN_COPY.unknownBlock;
  }
}

/**
 * A refusal BEFORE sign-in. The no-session preview sends a reason but no
 * counts and no draft status, so only lines that are exactly true with just a
 * name are used: the season-over line, and otherwise the app's general
 * "can't join right now" line (the full league_full / drafting lines need the
 * counts and status that arrive after sign-in).
 */
export function preSignInBlockMessage(block: JoinBlock, name: string): string {
  return block === 'season_completed' ? blockMessage(block, { name, max: 0 }) : JOIN_COPY.unknownBlock;
}
