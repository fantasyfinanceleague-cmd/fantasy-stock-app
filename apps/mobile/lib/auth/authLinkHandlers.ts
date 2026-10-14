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
// session behind that the link did not earn.

import { decideConfirmLink, isSignupExchange, parseConfirmLink } from './confirmLink';
import { redirectTypeOf } from './authLink';
import { isRecoveryExchange, parseRecoveryLink } from '../recoveryLink';

export interface ExchangeResult {
  data: { session: object | null; user: { id: string } | null };
  error: { code?: string } | null;
}

export interface AuthLinkDeps {
  /** Confirmation links do nothing in the dev fixture (no real session exists there). */
  confirmEnabled: boolean;
  getSession(): Promise<{ data: { session: object | null } }>;
  exchangeCodeForSession(code: string): Promise<ExchangeResult>;
  /** Local scope only (bound in app/_layout.tsx): leaves THIS device's session, never the account's other devices. */
  signOut(): Promise<{ error: { code?: string } | null }>;
  /** Whether a password-recovery form is open right now (lib/auth/recoverySession.ts). */
  isRecoveryActive(): boolean;
  removePushToken(userId: string): Promise<void>;
  setEmailJustConfirmed(value: boolean): void;
  setRecoverySession(value: boolean): void;
  replaceRoute(path: string): void;
  warn(message: string, code: string): void;
  /** createLinkDedupe(): the same link is handled once. */
  dedupe: { firstTime(key: string): boolean };
}

export type AuthLinkOutcome =
  | 'none' // not an auth link at all
  | 'duplicate' // already handled
  | 'confirm-ignored' // error / empty link, a session already exists, or the dev fixture
  | 'confirm-failed' // the exchange was refused (another device, spent, expired, forged)
  | 'confirm-wrong-type' // a recovery code on the confirm path: signed back out
  | 'confirm-signed-in'
  | 'recovery-ignored' // a dead / junk reset link while a genuine reset is open: the open form is left alone
  | 'recovery-invalid' // fail closed: the invalid screen, no recovery session
  | 'recovery-form';

export function createAuthLinkHandler(deps: AuthLinkDeps): (url: string) => Promise<AuthLinkOutcome> {
  async function signOutAccount(userId: string | undefined): Promise<void> {
    if (userId) await deps.removePushToken(userId).catch(() => {});
    // signOut resolves { error } and keeps the local session on a failure; a refusal must not leave one behind
    // silently, so say so (the caller still reports the refusal).
    const { error } = await deps.signOut();
    if (error) deps.warn('[auth] could not sign out the refused session', error.code ?? '');
  }

  async function confirm(parsed: ReturnType<typeof parseConfirmLink>): Promise<AuthLinkOutcome> {
    if (!deps.confirmEnabled) return 'confirm-ignored';
    // Checked BEFORE the exchange: an existing session is never replaced, and the verifier isn't spent.
    const { data } = await deps.getSession();
    const action = decideConfirmLink(parsed, !!data.session);
    if (action.kind !== 'exchange') return 'confirm-ignored';
    const { data: ex, error } = await deps.exchangeCodeForSession(action.code);
    if (error || !ex.session) {
      deps.warn('[auth] confirmation link could not sign in', error?.code ?? '');
      return 'confirm-failed';
    }
    // A password-recovery code is not an email confirmation: leave that session again.
    if (!isSignupExchange(redirectTypeOf(ex))) {
      deps.warn('[auth] confirmation link carried a recovery code; signing out', '');
      await signOutAccount(ex.user?.id);
      return 'confirm-wrong-type';
    }
    deps.setEmailJustConfirmed(true); // W4's Pick a username draws "✓ EMAIL CONFIRMED"
    return 'confirm-signed-in';
  }

  async function recover(parsed: ReturnType<typeof parseRecoveryLink>): Promise<AuthLinkOutcome> {
    const invalid = (): AuthLinkOutcome => {
      deps.setRecoverySession(false);
      deps.replaceRoute('/reset-password?status=invalid');
      return 'recovery-invalid';
    };
    // An expired / used link, a link with no code, or an old-style fragment link from a pre-PKCE build. If a
    // genuine reset is already open, a dead or crafted link must not close it under the person.
    if (parsed.kind !== 'code') return deps.isRecoveryActive() ? 'recovery-ignored' : invalid();
    // No existing-session guard here, as before: a reset is how someone who lost their password gets back in.
    const { data: ex, error } = await deps.exchangeCodeForSession(parsed.code);
    if (error || !ex.session) {
      // A forged / spent / other-device code. If a genuine reset is open, a junk code (a web page can fire
      // one) must not close it; otherwise fail closed.
      return deps.isRecoveryActive() ? 'recovery-ignored' : invalid();
    }
    if (!isRecoveryExchange(redirectTypeOf(ex))) {
      // A session that exchanged but is not a recovery one (a confirmation code on this path) must not stay.
      await signOutAccount(ex.user?.id);
      return invalid();
    }
    // Mark this session as a recovery session: reset-password.tsx's form keys off this flag, not "is there
    // any session at all", so a user who lands there some other way while signed in for an unrelated
    // reason never sees the form. Cleared on Cancel or success.
    deps.setRecoverySession(true);
    deps.replaceRoute('/reset-password');
    return 'recovery-form';
  }

  return async function handle(url: string): Promise<AuthLinkOutcome> {
    const confirmParsed = parseConfirmLink(url);
    if (confirmParsed.kind !== 'none') {
      // Mark BEFORE awaiting: the two cold-start deliveries race, and a code is single use.
      if (!deps.dedupe.firstTime(url)) return 'duplicate';
      return confirm(confirmParsed);
    }
    const recoveryParsed = parseRecoveryLink(url);
    if (recoveryParsed.kind !== 'none') {
      if (!deps.dedupe.firstTime(url)) return 'duplicate';
      return recover(recoveryParsed);
    }
    return 'none';
  };
}
