// Onboarding W2 (PKCE) — the ONE stored code verifier, and how the app keeps it from being lost.
//
// supabase-js (auth-js) keeps the PKCE verifier of the flow in progress under `<storageKey>-code-verifier`
// (value JSON-encoded as "<verifier>" for a sign-up, "<verifier>/<MARKER>" for a password reset, MARKER
// being 'PASSWORD_RECOVERY' in 2.89 and 'recovery' in 2.108). It is a SINGLE slot shared by both flows, and
// auth-js DELETES it after every exchange attempt (success or failure) and when signUp / resetPasswordForEmail
// error. So, left alone:
//   - a junk `?code=…` link (a web page can fire one) burns the genuine pending verifier, and the person's
//     real email link then fails;
//   - a FAILED sign-up (weak password, paused signups, a rate limit, a network error ...) destroys the
//     verifier of a pending password reset, and the reverse.
// auth-js ALSO deletes it on every _saveSession (any password / social sign-in, every token refresh) and on
// _removeSession / signOut, so a pending flow dies whenever another session is established on the device.
// That is accepted (it is the same moment the person is signed in as someone else) and is not covered below.
//
// The app therefore (1) reads the slot BEFORE an exchange and refuses without one when it is missing or
// belongs to the other flow, (2) snapshots it around each exchange / sign-up / reset and RESTORES the
// snapshot when the call failed and left the slot empty, and (3) never restores over something newer. A
// SUCCESSFUL new flow superseding the old one is accepted, and is also what GoTrue itself does (a new email
// invalidates the old link).
//
// KNOWN LIMITS (accepted; none needs code):
//   - The delete-then-restore window: auth-js deletes the verifier and we put it back a moment later. If the app
//     is killed in between, the verifier is gone and the person signs in with their password.
//   - A call that SUCCEEDS without sending an email (a reset for an unknown address, or signUp for a registered
//     one) still writes a new verifier and so supersedes the other flow's. Recoverable: "Send again".
//   - An aborted sign-up (the 25 s auth timeout) comes back as an error, not a throw, so the 60 s floor is not
//     held for it; the verifier is restored instead.
//   - The stuck recovery flag after Android back on the reset screen (lib/auth/recoverySession.ts): a device
//     check on the rebuild list.
//
// Pure and storage-injected so tests-deno can drive it, and pinned against the installed GoTrueClient.

/** supabase.createClient's `auth.storageKey`; lib/supabase.ts imports it so the two cannot drift. */
export const AUTH_STORAGE_KEY = 'fantasy-finance-auth';

/** The key auth-js stores the verifier under (GoTrueClient: `${this.storageKey}-code-verifier`). */
export function verifierKey(storageKey: string = AUTH_STORAGE_KEY): string {
  return `${storageKey}-code-verifier`;
}

/** The suffix auth-js appends to a password-reset verifier (both spellings it has used). */
export const RECOVERY_VERIFIER_MARKERS: readonly string[] = ['PASSWORD_RECOVERY', 'recovery'];

export type VerifierState =
  /** Nothing usable stored: another device, already spent, never started, or storage unreadable. */
  | { kind: 'absent' }
  /** A sign-up (email confirmation) verifier. */
  | { kind: 'signup' }
  /** A password-reset verifier. */
  | { kind: 'recovery' }
  /** Something stored with a marker we don't know: treated as neither flow. */
  | { kind: 'unknown' };

/** Classifies the RAW stored string (as AsyncStorage returns it) without needing the flow's secret. */
export function classifyVerifier(raw: string | null | undefined): VerifierState {
  if (typeof raw !== 'string' || raw === '') return { kind: 'absent' };
  let value: unknown = raw;
  try {
    value = JSON.parse(raw); // auth-js JSON-encodes what it stores
  } catch {
    // An unencoded value: use the string itself.
  }
  if (typeof value !== 'string' || value === '') return { kind: 'absent' };
  const slash = value.indexOf('/');
  const verifier = slash === -1 ? value : value.slice(0, slash);
  if (verifier === '') return { kind: 'absent' };
  if (slash === -1) return { kind: 'signup' };
  const marker = value.slice(slash + 1);
  if (marker === '') return { kind: 'signup' };
  return RECOVERY_VERIFIER_MARKERS.includes(marker) ? { kind: 'recovery' } : { kind: 'unknown' };
}

/**
 * ONE queue for everything that reads, writes or lets auth-js delete the slot: every sign-up / reset
 * (withVerifierKept) and every link exchange (lib/auth/authLinkHandlers.ts). Without it two overlapping calls
 * both snapshot the same value, one succeeds and writes a newer verifier, the other fails and auth-js deletes
 * THAT one, and the stale snapshot is restored over it, leaving the delivered email unexchangeable. Inside the
 * lock the snapshot is always the latest value. A rejection never blocks the next caller. Note a hung request
 * holds the queue until the network times out.
 */
let lockTail: Promise<unknown> = Promise.resolve();
export function withVerifierLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lockTail.then(fn);
  lockTail = run.catch(() => undefined);
  return run;
}

export interface VerifierSlot {
  read(): Promise<string | null>;
  write(raw: string): Promise<void>;
}

/**
 * Put `snapshot` back IF the slot is now empty. Never overwrites a newer value (a successful new flow wrote
 * its own verifier), never throws. Returns whether it restored.
 */
export async function restoreVerifierIfAbsent(slot: VerifierSlot, snapshot: string | null): Promise<boolean> {
  if (snapshot === null || snapshot === '') return false;
  try {
    if ((await slot.read()) !== null) return false;
    await slot.write(snapshot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a sign-up / password-reset call while keeping the pending verifier safe: when the call FAILS (an
 * error result or a throw) and auth-js left the slot empty, the snapshot is restored. A success leaves the
 * new flow's verifier in place (it supersedes the old one on purpose).
 */
export function withVerifierKept<T>(
  slot: VerifierSlot,
  call: () => Promise<T>,
  failed: (result: T) => boolean
): Promise<T> {
  // The snapshot is taken INSIDE the lock, so it is the latest value (see withVerifierLock).
  return withVerifierLock(async () => {
    let snapshot: string | null = null;
    try {
      snapshot = await slot.read();
    } catch {
      snapshot = null;
    }
    try {
      const result = await call();
      if (failed(result)) await restoreVerifierIfAbsent(slot, snapshot);
      return result;
    } catch (e) {
      await restoreVerifierIfAbsent(slot, snapshot);
      throw e;
    }
  });
}
