// Recovery-session flag. (Was the lower half of lib/recoveryNonce.ts, whose nonce is gone: PKCE binds
// the recovery link to this device instead, see lib/recoveryLink.ts.)
//
// Whether the CURRENT supabase auth session (if any) was established by an EXCHANGED password-recovery
// code (a PASSWORD_RECOVERY exchange), as opposed to an ordinary sign-in.
// reset-password.tsx's form state keys off THIS, not "is there any session
// at all" — a signed-in user who lands on /reset-password some other way
// (a stray deep link, a bookmark, a hand-typed URL) must not see the form
// just because supabase.auth happens to have a session for them. That
// "any row/any session counts" shape is exactly the all-or-nothing-state
// bug family documented in CLAUDE.md; this flag is the per-purpose
// discriminator that avoids it here.
//
// A plain in-memory module variable, deliberately NOT persisted to
// AsyncStorage: it only needs to live for the current recovery attempt in
// this JS runtime and must NOT survive an app relaunch — a flag surviving
// a restart could let an unrelated later session land on the form.
//
// reset-password.tsx subscribes via useSyncExternalStore (React's built-in
// hook for external mutable state) rather than polling or re-deriving from
// useAuth(), since app/_layout.tsx sets this asynchronously, from an effect
// entirely outside reset-password's own render.

type RecoveryFlagListener = () => void;

let recoveryFlag = false;
const recoveryFlagListeners = new Set<RecoveryFlagListener>();

/** Set by app/_layout.tsx right after a PASSWORD_RECOVERY code exchange succeeds. */
export function setRecoverySession(value: boolean): void {
  if (recoveryFlag === value) return;
  recoveryFlag = value;
  recoveryFlagListeners.forEach((listener) => listener());
}

/** Snapshot getter for useSyncExternalStore. */
export function isRecoverySession(): boolean {
  return recoveryFlag;
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeRecoverySession(listener: RecoveryFlagListener): () => void {
  recoveryFlagListeners.add(listener);
  return () => {
    recoveryFlagListeners.delete(listener);
  };
}
