// Onboarding W2 (PKCE) — what the app DOES with the two email return links, as one dependency-injected
// handler so every branch is testable without React Native or a Supabase project (app/_layout.tsx binds
// the real supabase client, router and flags). Parsing and shape rules live in lib/auth/authLink.ts,
// confirmLink.ts and lib/recoveryLink.ts; this module is the decision-and-effect layer on top.
//
//   confirm   fantasystockapp://auth/confirm?code=…                 -> sign in, "email confirmed"
//   recovery  fantasystockapp://reset-password?flow=pkce&code=…     -> the new-password form
//
// Both exchange a one-time code, which succeeds only on the device that stored the code verifier when
// the flow began (flowType 'pkce'). Every other outcome is a refusal, and a refusal never leaves a
// session behind that the link did not earn, NOR destroys the pending flow it was not part of:
//
//   - The stored verifier is READ FIRST (lib/auth/verifierSlot.ts). Absent, or belonging to the other flow,
//     the link is refused WITHOUT an exchange: no session can exist, and auth-js (which deletes the verifier
//     after every attempt) never gets the chance to burn the genuine pending one on a junk code.
//   - If the exchange still fails, the snapshot is put back when auth-js left the slot empty.
//   - A failure on the NETWORK also releases the dedupe mark, so the genuine link can be retried.

import { decideConfirmLink, isSignupExchange, parseConfirmLink } from './confirmLink';
import { redirectTypeOf } from './authLink';
import { classifyVerifier, restoreVerifierIfAbsent, withVerifierLock } from './verifierSlot';
import { isRecoveryExchange, parseRecoveryLink } from '../recoveryLink';

export interface ExchangeResult {
  data: { session: object | null; user: { id: string } | null };
  error: { code?: string; name?: string } | null;
}

export interface AuthLinkDeps {
  /** Confirmation links do nothing in the dev fixture (no real session exists there). */
  confirmEnabled: boolean;
  getSession(): Promise<{ data: { session: object | null } }>;
  exchangeCodeForSession(code: string): Promise<ExchangeResult>;
  /** The raw stored PKCE verifier item (lib/auth/verifierStorage.ts), or null. */
  readVerifier(): Promise<string | null>;
  writeVerifier(raw: string): Promise<void>;
  /** Local scope only (bound in app/_layout.tsx): leaves THIS device's session, never the account's other devices. */
  signOut(): Promise<{ error: { code?: string } | null }>;
  /** Whether a password-recovery form is open right now (lib/auth/recoverySession.ts). */
  isRecoveryActive(): boolean;
  /** Raised before a recovery exchange, dropped on every exit (lib/auth/recoverySession.ts "hold"). */
  setRecoveryInProgress(value: boolean): void;
  removePushToken(userId: string): Promise<void>;
  setEmailJustConfirmed(value: boolean): void;
  setRecoverySession(value: boolean): void;
  replaceRoute(path: string): void;
  warn(message: string, code: string): void;
  /** createLinkDedupe(): the same link is handled once, unless a network failure releases it. */
  dedupe: { firstTime(key: string): boolean; release(key: string): void };
}

export type AuthLinkOutcome =
  | 'none' // not an auth link at all
  | 'duplicate' // already handled
  | 'confirm-ignored' // error / empty link, a session already exists, or the dev fixture
  | 'confirm-failed' // no verifier here, or the exchange was refused (another device, spent, expired, forged)
  | 'confirm-wrong-type' // a recovery verifier is pending / a recovery code arrived on the confirm path
  | 'confirm-signed-in'
  | 'recovery-ignored' // a dead / junk reset link while a genuine reset is open: the open form is left alone
  | 'recovery-invalid' // fail closed: the invalid screen, no recovery session
  | 'recovery-form';

/** auth-js's AuthRetryableFetchError: the request never got a definitive answer, so the code is not spent. */
function isTransportFailure(error: { name?: string } | null): boolean {
  return error?.name === 'AuthRetryableFetchError';
}

export function createAuthLinkHandler(deps: AuthLinkDeps): (url: string) => Promise<AuthLinkOutcome> {
  const slot = { read: deps.readVerifier, write: deps.writeVerifier };

  async function signOutAccount(userId: string | undefined): Promise<void> {
    if (userId) await deps.removePushToken(userId).catch(() => {});
    // signOut resolves { error } and keeps the local session on a failure; a refusal must not leave one behind
    // silently, so say so (the caller still reports the refusal).
    const { error } = await deps.signOut();
    if (error) deps.warn('[auth] could not sign out the refused session', error.code ?? '');
  }

  /** The exchange, with the failure bookkeeping every caller needs. A throw is a transport-level failure. */
  async function exchange(
    url: string,
    code: string,
    snapshot: string
  ): Promise<{ ok: true; result: ExchangeResult } | { ok: false; code: string }> {
    let result: ExchangeResult;
    try {
      result = await deps.exchangeCodeForSession(code);
    } catch {
      await restoreVerifierIfAbsent(slot, snapshot);
      deps.dedupe.release(url);
      return { ok: false, code: 'exchange_threw' };
    }
    if (result.error || !result.data.session) {
      await restoreVerifierIfAbsent(slot, snapshot); // auth-js deleted it; the genuine pending flow still needs it
      if (isTransportFailure(result.error)) deps.dedupe.release(url);
      return { ok: false, code: result.error?.code ?? '' };
    }
    return { ok: true, result };
  }

  async function confirm(url: string, parsed: ReturnType<typeof parseConfirmLink>): Promise<AuthLinkOutcome> {
    if (!deps.confirmEnabled) return 'confirm-ignored';
    // Checked BEFORE the exchange: an existing session is never replaced, and the verifier isn't spent.
    const { data } = await deps.getSession();
    const action = decideConfirmLink(parsed, !!data.session);
    if (action.kind !== 'exchange') return 'confirm-ignored';

    // Read the slot first: no exchange for a code this device cannot have started, or whose pending flow is
    // the OTHER kind (a password reset): nothing is consumed and no session can exist. Read + exchange + restore
    // are ONE critical section (withVerifierLock), so a concurrent sign-up / reset cannot interleave.
    const step = await withVerifierLock(async () => {
      const snapshot = await deps.readVerifier();
      const state = classifyVerifier(snapshot);
      if (state.kind === 'absent' || snapshot === null) {
        deps.warn('[auth] confirmation link: no pending sign-up on this device', '');
        deps.dedupe.release(url); // nothing was spent: a re-tap of the genuine link may try again
        return { kind: 'refused' as const, outcome: 'confirm-failed' as AuthLinkOutcome };
      }
      if (state.kind !== 'signup') {
        deps.warn('[auth] confirmation link: the pending flow is a password reset', '');
        deps.dedupe.release(url);
        return { kind: 'refused' as const, outcome: 'confirm-wrong-type' as AuthLinkOutcome };
      }
      // The first session check ran BEFORE waiting for the lock (a slow sign-up / reset can hold it for a while);
      // somebody may have signed in meanwhile. Check again, right before the exchange, and never replace a session.
      const { data: now } = await deps.getSession();
      if (decideConfirmLink(parsed, !!now.session).kind !== 'exchange') {
        return { kind: 'refused' as const, outcome: 'confirm-ignored' as AuthLinkOutcome };
      }
      return { kind: 'exchanged' as const, got: await exchange(url, action.code, snapshot) };
    });
    if (step.kind === 'refused') return step.outcome;
    const got = step.got;
    if (!got.ok) {
      deps.warn('[auth] confirmation link could not sign in', got.code);
      return 'confirm-failed';
    }
    const ex = got.result;
    // Backstop (the slot check above should make this unreachable): a recovery exchange is not a confirmation.
    if (!isSignupExchange(redirectTypeOf(ex.data))) {
      deps.warn('[auth] confirmation link carried a recovery code; signing out', '');
      await signOutAccount(ex.data.user?.id);
      return 'confirm-wrong-type';
    }
    deps.setEmailJustConfirmed(true); // W4's Pick a username draws "✓ EMAIL CONFIRMED"
    return 'confirm-signed-in';
  }

  async function recover(url: string, parsed: ReturnType<typeof parseRecoveryLink>): Promise<AuthLinkOutcome> {
    const invalid = (): AuthLinkOutcome => {
      deps.setRecoverySession(false);
      deps.replaceRoute('/reset-password?status=invalid');
      return 'recovery-invalid';
    };
    // A genuine reset that is already open must not be closed by a dead, junk or crafted link.
    const refuse = (): AuthLinkOutcome => (deps.isRecoveryActive() ? 'recovery-ignored' : invalid());

    // An expired / used link, a link with no code, or an old-style fragment link from a pre-PKCE build.
    if (parsed.kind !== 'code') return refuse();

    // Read the slot first: only a pending password RESET can be exchanged here. Absent (another device, or the
    // genuine one is spent), a sign-up verifier, or an unknown marker: refused before any session exists. Read +
    // exchange + restore are ONE critical section (withVerifierLock).
    return withVerifierLock(async () => {
      const snapshot = await deps.readVerifier();
      if (snapshot === null || classifyVerifier(snapshot).kind !== 'recovery') {
        deps.dedupe.release(url); // nothing was spent: a re-tap of the genuine link may try again
        return refuse();
      }

      // No existing-session guard here, as before: a reset is how someone who lost their password gets back in.
      // supabase-js emits SIGNED_IN INSIDE the exchange, before the flag below is set: hold pending-route replay and
      // push setup until this settles (lib/auth/recoverySession.ts). The flag takes over on success.
      deps.setRecoveryInProgress(true);
      try {
        const got = await exchange(url, parsed.code, snapshot);
        if (!got.ok) return refuse();
        const ex = got.result;
        if (!isRecoveryExchange(redirectTypeOf(ex.data))) {
          // Backstop (the slot check above should make this unreachable): a session of the wrong type must not stay.
          await signOutAccount(ex.data.user?.id);
          return invalid();
        }
        // Mark this session as a recovery session: reset-password.tsx's form keys off this flag, not "is there
        // any session at all", so a user who lands there some other way while signed in for an unrelated
        // reason never sees the form. Cleared on Cancel or success.
        deps.setRecoverySession(true);
        deps.replaceRoute('/reset-password');
        return 'recovery-form' as AuthLinkOutcome;
      } finally {
        deps.setRecoveryInProgress(false);
      }
    });
  }

  return async function handle(url: string): Promise<AuthLinkOutcome> {
    const confirmParsed = parseConfirmLink(url);
    if (confirmParsed.kind !== 'none') {
      // Mark BEFORE awaiting: the two cold-start deliveries race, and a code is single use.
      if (!deps.dedupe.firstTime(url)) return 'duplicate';
      return confirm(url, confirmParsed);
    }
    const recoveryParsed = parseRecoveryLink(url);
    if (recoveryParsed.kind !== 'none') {
      if (!deps.dedupe.firstTime(url)) return 'duplicate';
      return recover(url, recoveryParsed);
    }
    return 'none';
  };
}
