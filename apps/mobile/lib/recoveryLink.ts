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
