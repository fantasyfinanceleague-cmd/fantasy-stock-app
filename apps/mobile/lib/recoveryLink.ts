// Pure parsing for the Supabase password-recovery deep link, now the PKCE one:
//
//   fantasystockapp://reset-password?flow=pkce&code=<one-time code>
//
// Extracted from app/_layout.tsx's deep-link handler so the URL-shape logic is hermetically
// testable without React Native or expo-linking. The handler still owns the exchange
// (supabase.auth.exchangeCodeForSession) and the recovery flag; this module only decides what the URL
// is telling us (shared mechanics in lib/auth/authLink.ts).
//
// SECURITY (F2, deep-link session fixation, now closed by PKCE instead of a nonce): the old link
// carried session TOKENS in its fragment, so a crafted link with an attacker's tokens could swap the
// victim into the attacker's account; a per-request nonce (a module since removed) was bound
// to the link to stop that. The new link carries only a one-time code, and
// supabase.auth.exchangeCodeForSession succeeds only together with the code verifier THIS device
// stored when it asked for the reset, so a forged, replayed or intercepted code fails. The code is
// read strictly from the QUERY, never the fragment, and the handler additionally requires the
// exchange to report a PASSWORD_RECOVERY (isRecoveryExchange) before it shows the form, and fails
// closed (the invalid screen) on anything else, including an old-style fragment link from a
// pre-PKCE build.

import { AUTH_LINK_BASES, isDevBuild, linkIsPath, readLinkOutcome, type LinkOutcome } from './auth/authLink';

export const RECOVERY_PATH = 'reset-password';

/**
 * The `redirectTo` for resetPasswordForEmail. The query is deliberate: the Supabase redirect
 * allow-list entry from the F2 runbook may be the narrow `fantasystockapp://reset-password?**`, which
 * a query-less URL would NOT match (GoTrue then falls back to the Site URL and the app never gets the
 * link). `flow=pkce` carries no secret.
 */
export function buildRecoveryRedirect(base: string = AUTH_LINK_BASES[0]): string {
  return `${base}${RECOVERY_PATH}?flow=pkce`;
}

/**
 * True when a path the ROUTER sees names the reset screen, in any shape. Navigation only: +native-intent
 * opens the plain screen so the one-time code never lands in the router's params (which are kept in
 * navigation state); the exchange reads the code from the link itself (app/_layout.tsx). It never signs
 * anyone in, which is why it can be broader than parseRecoveryLink.
 */
export function isRecoveryRoute(path: string | null | undefined): boolean {
  return linkIsPath(path, RECOVERY_PATH, true);
}

export type RecoveryLinkResult = LinkOutcome | { kind: 'none' };

/**
 * Parse a deep-link URL into a recovery outcome. Returns 'none' for any URL that isn't the recovery
 * path at all (a different deep link, a bare open), so callers can leave those completely alone.
 * Exact path match on the registered origins (dev-only shapes follow lib/auth/authLink.ts).
 */
export function parseRecoveryLink(url: string, dev: boolean = isDevBuild()): RecoveryLinkResult {
  if (!url || !linkIsPath(url, RECOVERY_PATH, dev)) return { kind: 'none' };
  return readLinkOutcome(url.trim());
}

/**
 * After the exchange: only a code that supabase-js read as a password recovery (the verifier was stored
 * by resetPasswordForEmail) may open the new-password form. A sign-up confirmation code presented on this
 * path exchanges as a plain session (null), and is refused.
 *
 * supabase-js has spelled this marker two ways: 'PASSWORD_RECOVERY' (auth-js 2.89, the version locked in
 * apps/mobile/package-lock.json) and 'recovery' (auth-js 2.108, which a lockfile refresh could pull in).
 * Both are the recovery marker; accepting only one would make every genuine reset fail the day the library
 * moves. tests-deno/pkce-auth-links.test.ts drives the INSTALLED library to prove its spelling is accepted.
 */
export const RECOVERY_REDIRECT_TYPES: readonly string[] = ['PASSWORD_RECOVERY', 'recovery'];

export function isRecoveryExchange(redirectType: string | null | undefined): boolean {
  return typeof redirectType === 'string' && RECOVERY_REDIRECT_TYPES.includes(redirectType);
}

// ---------------------------------------------------------------------------
// reset-password.tsx's screen-state decision
// ---------------------------------------------------------------------------

export type ResetScreenState = 'verifying' | 'invalid' | 'form';

/**
 * How long reset-password waits with no session and no explicit status
 * before giving up and showing "invalid" rather than spinning forever.
 *
 * This covers a route that opens without the link handler ever seeing a
 * recovery link (a restored navigation state, a hand-typed path). In
 * those cases app/_layout.tsx never calls router.replace with a
 * `status`, so nothing but a timeout moves the screen off "verifying".
 */
export const RESET_VERIFY_TIMEOUT_MS = 8000;

/**
 * Pure decision for which of reset-password's three states to show.
 * `status` is the `status` search param (only 'invalid' is meaningful);
 * `isRecovery` is lib/auth/recoverySession.ts's recovery-session flag, NOT "does
 * useAuth() report any user" — a signed-in user who reaches this screen
 * some other way, without a valid recovery link, must not see the form
 * just because they happen to have an unrelated session. `elapsedMs` is
 * how long the screen has been mounted without either one settling.
 *
 * Precedence, in order: an explicit invalid status always wins (even over
 * a recovery session — e.g. a stale link tapped after the reset already
 * completed elsewhere); the recovery flag, once set, wins over an elapsed
 * timeout (so a setSession that resolves right at the timeout boundary
 * still reaches the form); only then does the timeout apply. A user who
 * is signed in WITHOUT a valid recovery link (isRecovery false) falls all
 * the way through to the timeout, same as someone with no session at all.
 */
export function resetScreenState({
  status,
  isRecovery,
  elapsedMs,
}: {
  status: string | null | undefined;
  isRecovery: boolean;
  elapsedMs: number;
}): ResetScreenState {
  if (status === 'invalid') {
    return 'invalid';
  }
  if (isRecovery) {
    return 'form';
  }
  if (elapsedMs >= RESET_VERIFY_TIMEOUT_MS) {
    return 'invalid';
  }
  return 'verifying';
}
