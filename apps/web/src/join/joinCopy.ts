/**
 * EVERY line the web invite, sign-in and confirm pages show: one module, so
 * the Design Lead's gate reads them in one place. Where a line also exists in
 * the app, it is the app's approved line, verbatim, and a parity test
 * (joinCopy.parity.test.ts) loads the app's own module and fails on any drift
 * (apps/mobile/lib/join/joinPreview.ts, lib/authErrors.ts,
 * constants/confirmEmailCopy.ts, lib/shell/usernameMachine.ts). Change the app
 * first, never here alone. The rest are Giorgio's or the Planner's words,
 * 2026-10-14.
 *
 * NO server text ever reaches a page (house rule): every reason, every auth
 * error and every transport failure maps to a line written here.
 *
 * A string starting with the build-guard marker is NOT approved yet; it
 * renders as written and the production build refuses to finish while one is
 * in the bundle (vite-plugins/universalLinks.ts). None remain here today.
 */
import { brand } from '../brand';

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
  unreachable: "Couldn't reach the league. Check your connection, then try again.",
  rateLimited: 'Too many tries. Wait a moment, then try again.',
  unknownBlock: "You can't join this league right now. Ask your commissioner to check the invite.",
} as const;

/** The approved onboarding web lines. */
export const WEB_COPY = {
  // ── The invite headline (plan Decision 7; W3's contract) ──
  invitedBy: (inviter: string, league: string) => `${inviter} invited you to ${league}`,
  invitedTo: (league: string) => `You're invited to ${league}`,
  /** The fallback when the no-session preview is unavailable (Planner). */
  invitedToGeneric: "You're invited to a league",
  /** A tapped link whose code resolves nowhere, or can't be a code (Planner, d): never the typing line. */
  inviteLinkDead: "This invite link doesn't work anymore. Ask for a new one.",
  openApp: 'Open the app',
  appStoreBadge: 'Download on the App Store',

  // ── Sign in (the board's three options, in its order) ──
  continueApple: 'Continue with Apple',
  continueGoogle: 'Continue with Google',
  useEmail: 'Use email',

  // ── The email form (verbatim from the app's Sign in and Create account) ──
  emailLabel: 'Email address',
  passwordLabel: 'Password',
  createAccount: 'Create account',
  signIn: 'Sign in',
  haveAccount: 'Already have an account?',
  newHere: 'New here?',
  createAnAccount: 'Create an account',
  /** Plain text under the sign-in form, NOT a button or a link (Planner, g). */
  forgotInApp: 'Forgot your password? Reset it in the app.',
  /** The password policy as one sentence, for the weak_password error (the app's PASSWORD_RULE_SENTENCE). */
  passwordRule: 'Use at least 8 characters, with an uppercase letter, a lowercase letter, a number, and a symbol.',
  passwordNeeds: (labels: string[]) => `Your password needs: ${labels.map((l) => l.toLowerCase()).join(', ')}.`,

  // ── Check your email (approved 2026-10-14; the app's confirmEmailCopy) ──
  checkEmailTitle: 'Check your email',
  checkEmailBack: 'Back to sign in',
  resend: "Didn't receive it? Send again",
  confirmedChip: '✓ EMAIL CONFIRMED',
  confirmSentInvite: (email: string, league: string) => `We sent a link to ${email}. Tap it to finish joining ${league}.`,
  confirmSentPlain: (email: string) => `We sent a link to ${email}. Tap it to finish creating your account.`,

  // ── Pick a username (the board's frame, "fine" 2026-10-14; the app's rule messages) ──
  usernameTitle: 'Pick a username',
  usernameSub: 'Shown to your league on standings and matchups',
  usernameLabel: 'Username',
  usernameHelper: 'You can change it later in Profile.',
  keep: 'Keep',
  change: 'Change',
  usernameTaken: 'This username is already taken.',
  usernameNotAllowed: 'Username is not allowed',
  usernameCheckFailed: "Couldn't check right now",
  usernameLength: '3–20 characters',
  usernameCharset: 'Letters, numbers and underscores',

  // ── Done (approved verbatim, plan Decision 10) ──
  youreIn: (league: string) => `You're in ${league}.`,
  getTheApp: 'Get the app to draft and play.',
  alreadyIn: (league: string) => `You're already in ${league}.`,

  // ── Every post-sign-in screen (Planner, f) ──
  notYouSignOut: 'Not you? Sign out',

  // ── /auth/confirm: the app's email link opened on a device without the app (Decision 16) ──
  confirmed: 'Your email is confirmed. Open the app and sign in.',
  confirmedWithInvite: (league: string) => `Your email is confirmed. Open the app and sign in to finish joining ${league}.`,
  confirmError: 'This link has expired. Open the app and sign in to get a new one.',

  // ── /auth/web-callback: the link from an email sent by THIS page, or an OAuth return ──
  /** Opened where this browser's code verifier isn't (another browser or device): Decision 16. */
  confirmedSignIn: 'Your email is confirmed. Sign in with your password.',
  /** An expired or used link on the web path (Planner, e). */
  webLinkExpired: 'This link has expired. Sign in to get a new one.',
  /** The server's signup gate (the app's line, verbatim; brand.name is the product name). */
  signupsPaused: `${brand.name} is not open for new signups yet — check back soon. Existing accounts can still sign in.`,
  generic: 'Something went wrong. Please try again.',
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

/** The app's blockMessage, line for line: a refusal AFTER sign-in, when the counts and draft status are known. */
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
 * A refusal BEFORE sign-in, from the no-session preview (a reason, no counts,
 * no draft status). The Planner's words (b, c, 2026-10-14): full has its own
 * line; every "not taking players" reason (room open, drafting, drafted, season
 * over) is one neutral line that is true for all of them.
 */
export function preSignInBlockMessage(block: JoinBlock, name: string): string {
  switch (block) {
    case 'league_full':
      return `${name} is full. Ask whoever invited you if they can make room.`;
    case 'draft_started':
    case 'draft_in_progress':
    case 'season_completed':
      return `${name} isn't taking new players right now.`;
    default:
      return JOIN_COPY.unknownBlock;
  }
}
