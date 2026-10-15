// Onboarding W2 — the pure half of Sign in with Apple / Google (lib/auth/socialSignIn.ts is the
// native half). Pure so tests-deno can pin every branch.

/** What a social sign-in attempt came to. `error` is never shown as-is (lib/authErrors.ts maps it). */
export type SocialSignInResult =
  | { kind: 'signedIn' }
  /** The person closed Apple's / Google's sheet, or a second tap hit one already open: say nothing. */
  | { kind: 'cancelled' }
  /** This build can't offer it (no native module, not configured, unsupported OS). */
  | { kind: 'unavailable' }
  | { kind: 'error'; error: { message: string; code?: string } };

/** expo-apple-authentication's code for the person dismissing Apple's sheet. */
export const APPLE_CANCEL_CODE = 'ERR_REQUEST_CANCELED';

export function isAppleCancel(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === APPLE_CANCEL_CODE;
}

/**
 * @react-native-google-signin's cancel and in-progress codes come from the NATIVE module's
 * constants (their values differ by platform), so the caller passes them in.
 */
export function isGoogleCancel(error: unknown, codes: { cancelled: unknown; inProgress: unknown }): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === undefined || code === null) return false;
  return code === codes.cancelled || code === codes.inProgress;
}

/** Normalises anything thrown into the `{ message, code }` shape the mapper reads. */
export function toAuthError(error: unknown): { message: string; code?: string } {
  const e = error as { message?: unknown; code?: unknown } | null;
  return {
    message: typeof e?.message === 'string' ? e.message : '',
    code: typeof e?.code === 'string' ? e.code : undefined,
  };
}
