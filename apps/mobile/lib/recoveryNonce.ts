// Per-request nonce binding for the password-recovery deep link (fixes F2:
// deep-link session fixation / login CSRF).
//
// The deep-link handler in app/_layout.tsx used to call supabase.auth.setSession
// with access_token/refresh_token taken straight from ANY reset-password link,
// with nothing tying the link to a reset THIS device requested. An attacker's
// crafted link carrying the attacker's own tokens could therefore silently swap
// the victim's app into the attacker's account.
//
// Fix: forgot-password.tsx generates a per-request, unpredictable nonce, stores
// it single-use, and passes it in resetPasswordForEmail's redirectTo as `?rn=`.
// The genuine Supabase recovery email redirects to
//   fantasystockapp://reset-password?rn=<nonce>#access_token=...
// so the real link carries the nonce; an attacker cannot know the victim
// device's nonce. _layout.tsx requires an exact, single-use, fail-closed match
// before setSession. A timestamp-only marker was rejected in review because it
// proves "a reset was requested here", not "THIS link is the one we requested",
// leaving the reset-in-progress phishing window open — the nonce closes it.
//
// Randomness comes from expo-crypto's getRandomBytes (a native CSPRNG, the same
// source lib/inviteCode.ts uses); React Native / Hermes has no global
// crypto.getRandomValues without a polyfill, and this app bundles none.

import { getRandomBytes } from 'expo-crypto';

const STORAGE_KEY = 'fantasy-recovery-nonce';
const TTL_MS = 60 * 60 * 1000; // 1 hour — a recovery link opened here is fresh
const NONCE_BYTES = 32; // 256 bits

// Only touch AsyncStorage in native environments (mirrors lib/supabase.ts, which
// guards the require to avoid issues during static web rendering).
function getStorage(): any {
  if (typeof window === 'undefined') return undefined;
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return undefined;
  }
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// Length-checked constant-time string compare, so a wrong nonce cannot be
// distinguished from a right one by timing.
function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/** Generate a 256-bit hex nonce from the native CSPRNG. */
export function generateRecoveryNonce(): string {
  return toHex(getRandomBytes(NONCE_BYTES));
}

/**
 * Persist the nonce for a pending recovery. Returns false (fail closed) if
 * storage is unavailable or the write fails, so the caller can abort rather
 * than send a link it can never verify.
 */
export async function storeRecoveryNonce(nonce: string): Promise<boolean> {
  const storage = getStorage();
  if (!storage) return false;
  try {
    await storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ nonce, createdAt: Date.now() })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Read-then-delete the stored nonce (single use, no replay) and return true only
 * if a fresh (<= TTL) stored nonce exactly matches `inbound`. Missing, mismatched,
 * stale, malformed, or a storage failure all return false — fail closed.
 */
export async function verifyAndConsumeRecoveryNonce(
  inbound: string | null | undefined
): Promise<boolean> {
  if (!inbound) return false;
  const storage = getStorage();
  if (!storage) return false;

  let raw: string | null = null;
  try {
    raw = await storage.getItem(STORAGE_KEY);
    // Consume unconditionally (single use) — delete even on the accept path so a
    // replayed link cannot re-authenticate.
    await storage.removeItem(STORAGE_KEY);
  } catch {
    return false;
  }

  if (!raw) return false;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.nonce !== 'string') return false;
    if (typeof parsed.createdAt !== 'number') return false;
    if (Date.now() - parsed.createdAt > TTL_MS) return false;
    return constantTimeEqual(parsed.nonce, inbound);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recovery-session flag
// ---------------------------------------------------------------------------
//
// Whether the CURRENT supabase auth session (if any) was established via a
// nonce-verified password-recovery link, as opposed to an ordinary sign-in.
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

/** Set by app/_layout.tsx right after a nonce-verified setSession succeeds. */
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
