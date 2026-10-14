// Onboarding W2 — the logic of the confirmation nonce store (lib/auth/confirmNonce.ts wires it to
// AsyncStorage and the native CSPRNG). Dependency-injected so tests-deno can drive every branch
// with an in-memory storage: single use, TTL, constant-time compare, fail-closed on any storage
// error. See confirmNonce.ts for why the store exists and how it differs from the recovery nonce.

export interface NonceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface NonceDeps {
  /** null when storage is unavailable (static web render, module missing). */
  storage: () => NonceStorage | null | undefined;
  /** A fresh unpredictable hex nonce. */
  random: () => string;
  now: () => number;
}

export const CONFIRM_NONCE_KEY = 'fantasy-confirm-nonce';
// GoTrue's confirmation link lives for `mailer_otp_exp` (Supabase default 1 h). A nonce that
// outlives its link only widens the window in which a stray link could be accepted, so it matches.
// If Giorgio raises "Email OTP expiry" in the dashboard, raise this with it.
export const CONFIRM_NONCE_TTL_MS = 60 * 60 * 1000;

/** Length-checked constant-time compare, so a wrong nonce can't be told from a right one by timing. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

interface Stored {
  nonce: string;
  email: string;
  createdAt: number;
}

const normEmail = (e: string) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

/** The stored record, or null when it is missing, malformed or past the TTL. */
function readFresh(raw: string | null, now: number): Stored | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.nonce !== 'string' || typeof parsed.email !== 'string' || typeof parsed.createdAt !== 'number') return null;
    if (now - parsed.createdAt > CONFIRM_NONCE_TTL_MS) return null;
    return parsed as Stored;
  } catch {
    return null;
  }
}

export function createConfirmNonceStore(deps: NonceDeps) {
  return {
    /**
     * The nonce for a confirmation email to `email`: the pending one ONLY if it was minted for the
     * SAME address and is still fresh (a resend, so the first email's link keeps working); else a
     * new one that replaces any other. A nonce minted for a mistyped address is never reused for the
     * corrected one (the stranger who got the first mail would hold a live nonce). null (fail
     * closed) when storage is unavailable or the write fails: no email is sent then.
     */
    async getOrCreate(email: string): Promise<string | null> {
      const storage = deps.storage();
      if (!storage) return null;
      const who = normEmail(email);
      if (!who) return null;
      try {
        const pending = readFresh(await storage.getItem(CONFIRM_NONCE_KEY), deps.now());
        if (pending && pending.email === who) return pending.nonce;
        const nonce = deps.random();
        const record: Stored = { nonce, email: who, createdAt: deps.now() };
        await storage.setItem(CONFIRM_NONCE_KEY, JSON.stringify(record));
        return nonce;
      } catch {
        return null;
      }
    },

    /**
     * True only when a fresh stored nonce exactly matches `inbound`, and then it is deleted (single
     * use: a replayed link fails). A MISMATCH leaves the pending nonce alone, so a junk link can't
     * burn a real sign-up's nonce (256 bits: nothing to brute-force). A stale or malformed record
     * is deleted. Missing, mismatched, stale, malformed or any storage failure (including a failed
     * delete): false.
     */
    async verifyAndConsume(inbound: string | null | undefined): Promise<boolean> {
      if (!inbound) return false;
      const storage = deps.storage();
      if (!storage) return false;
      try {
        const raw = await storage.getItem(CONFIRM_NONCE_KEY);
        if (!raw) return false;
        const stored = readFresh(raw, deps.now());
        if (!stored) {
          await storage.removeItem(CONFIRM_NONCE_KEY);
          return false;
        }
        if (!constantTimeEqual(stored.nonce, inbound)) return false;
        await storage.removeItem(CONFIRM_NONCE_KEY); // a failure throws: not accepted
        return true;
      } catch {
        return false;
      }
    },

    /** Forget any pending nonce: on every sign-in and sign-out, so it never outlives its sign-up. */
    async clear(): Promise<void> {
      const storage = deps.storage();
      if (!storage) return;
      try {
        await storage.removeItem(CONFIRM_NONCE_KEY);
      } catch {
        // Best effort; the TTL still bounds it.
      }
    },
  };
}
