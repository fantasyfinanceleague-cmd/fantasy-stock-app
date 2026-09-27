// Pure parsing for the Supabase password-recovery deep link
// (fantasystockapp://reset-password?rn=<nonce>#access_token=...&refresh_token=...&type=recovery).
//
// Extracted from app/_layout.tsx's deep-link handler so the URL-shape logic
// is hermetically testable without React Native or expo-linking. The
// handler still owns nonce verification (lib/recoveryNonce.ts) and the
// actual supabase.auth.setSession call — this module only decides what the
// URL is telling us.
//
// Security-critical rule, unchanged from the original handler: the `rn`
// nonce is read strictly from the QUERY string (the part before '#'), never
// from the fragment. Supabase appends access_token/refresh_token/etc. to the
// fragment, and an attacker who can get a victim to open a URL with an `rn`
// value smuggled into the fragment (rather than the query) must not have it
// treated as if the app itself had put it in the query when generating the
// redirectTo URL. See lib/recoveryNonce.ts for why the nonce exists at all.

export type RecoveryLinkResult =
  | { kind: 'tokens'; accessToken: string; refreshToken: string; nonce: string | null }
  | { kind: 'error'; code: string | null; description: string | null }
  | { kind: 'none' };

/**
 * Parse a deep-link URL into a recovery outcome. Returns 'none' for any URL
 * that isn't a recovery link at all (a different deep link, a bare open),
 * so callers can leave those completely alone.
 */
export function parseRecoveryLink(url: string): RecoveryLinkResult {
  if (!url || (!url.includes('reset-password') && !url.includes('type=recovery'))) {
    return { kind: 'none' };
  }

  const hashIndex = url.indexOf('#');
  if (hashIndex === -1) {
    return { kind: 'none' };
  }

  const hash = url.substring(hashIndex + 1);
  const params = new URLSearchParams(hash);

  // The nonce lives in the query, strictly before '#'. A `?rn=` appearing
  // only in the fragment (after '#') is never read here.
  const queryStart = url.indexOf('?');
  let nonce: string | null = null;
  if (queryStart !== -1 && queryStart < hashIndex) {
    const query = url.substring(queryStart + 1, hashIndex);
    nonce = new URLSearchParams(query).get('rn');
  }

  // Supabase's expired/used/malformed-link redirect carries an error in the
  // fragment instead of tokens, e.g. #error=access_denied&error_code=otp_expired.
  const errorCode = params.get('error_code') || params.get('error');
  if (errorCode) {
    return { kind: 'error', code: errorCode, description: params.get('error_description') };
  }

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    return { kind: 'tokens', accessToken, refreshToken, nonce };
  }

  return { kind: 'none' };
}

// ---------------------------------------------------------------------------
// reset-password.tsx's screen-state decision
// ---------------------------------------------------------------------------

export type ResetScreenState = 'verifying' | 'invalid' | 'form';

/**
 * How long reset-password waits with no session and no explicit status
 * before giving up and showing "invalid" rather than spinning forever.
 *
 * This covers URLs that route to reset-password by PATH but that
 * parseRecoveryLink treats as 'none' — a bare `.../reset-password?rn=N`
 * with no fragment at all, a mail client that truncates the link, or a
 * future PKCE `?code=` redirect this parser doesn't yet recognize. In all
 * of those cases app/_layout.tsx never calls router.replace with a
 * `status`, so nothing but a timeout moves the screen off "verifying".
 */
export const RESET_VERIFY_TIMEOUT_MS = 8000;

/**
 * Pure decision for which of reset-password's three states to show.
 * `status` is the `status` search param (only 'invalid' is meaningful);
 * `isRecovery` is lib/recoveryNonce.ts's recovery-session flag, NOT "does
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
