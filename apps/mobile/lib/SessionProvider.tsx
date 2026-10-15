import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setupPushNotifications, removePushToken } from './notifications';
import { isRecoveryHold, setRecoverySession, subscribeRecoverySession } from './auth/recoverySession';
import { verifierSlot } from './auth/verifierStorage';
import { withVerifierKept } from './auth/verifierSlot';
import { setEmailJustConfirmed } from './auth/emailConfirmed';
import { setConfirmFailedNotice } from './auth/confirmFailedNotice';
import { buildConfirmRedirect } from './auth/confirmLink';
import { setLiveSession } from './auth/liveSession';
import { pkceCryptoReady } from './auth/pkceCrypto';
import { confirmationCooldown, RESEND_TOO_SOON } from './auth/resendCooldown';
import { removeLegacyAuthKeys } from './auth/legacyAuthKeys';
import { signInWithApple as nativeAppleSignIn, signInWithGoogle as nativeGoogleSignIn, signOutOfGoogle } from './auth/socialSignIn';
import type { SocialSignInResult } from './auth/socialOutcome';
import { pendingRoute, type AuthPhase } from './shell/pendingRoute';
import {
  FIXTURE_EMAIL,
  FIXTURE_EMAIL_OVERRIDE,
  FIXTURE_NETWORK_MS,
  FIXTURE_SIGNUPS_PAUSED_MESSAGE,
  FIXTURE_USER_ID,
  SHELL_FIXTURE,
  fixtureStartsSignedOut,
  fixtureUsername,
} from './shell/devFixture';

const FIXTURE_USER = { id: FIXTURE_USER_ID, email: FIXTURE_EMAIL_OVERRIDE ?? FIXTURE_EMAIL } as User;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The shape both auth calls resolve to; `error` carries Supabase's own error (message + code). */
export interface AuthResult {
  error: { message: string; code?: string } | null;
}

export type SignUpResult = AuthResult & {
  /** true when the account exists but must confirm its email before signing in. */
  needsConfirmation: boolean;
};

/** supabase-js could not store the PKCE code verifier, so no email was sent (see signUp). */
export const PKCE_STORAGE_UNAVAILABLE = 'pkce_storage_unavailable';
/** This build has no WebCrypto for PKCE (lib/auth/pkceCrypto.ts), so nothing was sent. */
export const PKCE_CRYPTO_UNAVAILABLE = 'pkce_crypto_unavailable';

// Phase 3b-1 — the ONE auth subscription for the whole app.
//
// Before this, useAuth() was a plain hook: every call site (22 of them)
// opened its own supabase.auth.onAuthStateChange subscription and held its
// own copy of the session, so the root layout's guard and the screen under
// it could briefly disagree about who was signed in. The root Stack.Protected
// guard (app/_layout.tsx) needs a single answer, and it also needs one more
// fact the old hook never had: whether the signed-in account still has a
// NULL username, which puts the Pick-a-username screen in front of the tabs.
//
// useAuth() keeps its exact return shape ({ session, user, loading, signOut })
// and now just reads this context, so no call site changes.

export interface SessionContextValue {
  session: Session | null;
  user: User | null;
  /** True until the stored session has been read. */
  loading: boolean;
  /** The caller's user_profiles.username; null when unset (or signed out). */
  username: string | null;
  /** True while a signed-in user's profile has not been read yet. */
  profileLoading: boolean;
  /** The single auth phase the root guard and the deep-link resume key off. */
  authPhase: AuthPhase;
  /** Call after set_username returns 'ok' so the guard flips without a refetch. */
  setUsernameLocal: (username: string) => void;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  /** Email + password sign-up. No username: the pick-username gate asks for it (onboarding W2). */
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signInWithApple: () => Promise<SocialSignInResult>;
  signInWithGoogle: () => Promise<SocialSignInResult>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  // Which user id the current `username` belongs to. Profile state is only
  // trusted when it matches the signed-in user, so a sign-out → sign-in as
  // someone else can't briefly show the previous account's gate decision.
  const [profileFor, setProfileFor] = useState<string | null>(null);
  const notificationsSetup = useRef(false);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (SHELL_FIXTURE) {
      // DEV-only fixture (lib/shell/devFixture.ts): a local fake session.
      // supabase.auth is never touched, so nothing signs in or out for real.
      setUser(fixtureStartsSignedOut(SHELL_FIXTURE) ? null : FIXTURE_USER);
      setLiveSession(fixtureStartsSignedOut(SHELL_FIXTURE) ? null : FIXTURE_USER.id);
      setLoading(false);
      return;
    }

    // The nonce stores are gone (PKCE); clear their leftovers on upgraded devices. Best effort.
    try {
      removeLegacyAuthKeys(require('@react-native-async-storage/async-storage').default);
    } catch {
      // No AsyncStorage (static web render): nothing to clear.
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      userIdRef.current = session?.user?.id ?? null;
      setLiveSession(session?.user?.id ?? null); // synchronous and ahead of the React state (lib/auth/liveSession.ts)
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Register for push notifications on initial load if logged in
      if (session?.user && !notificationsSetup.current) {
        notificationsSetup.current = true;
        setupPushNotifications(session.user.id, false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setLiveSession(session?.user?.id ?? null); // the instant the session appears or ends (lib/auth/liveSession.ts)
        // Use functional updates to avoid unnecessary re-renders
        // that can cause native-stack to reconfigure and dismiss the keyboard
        setSession(prev => prev?.access_token === session?.access_token ? prev : session);
        setUser(prev => {
          const newUser = session?.user ?? null;
          return prev?.id === newUser?.id ? prev : newUser;
        });
        setLoading(false);

        // Register for push notifications on sign in, but not while a password-recovery link is being exchanged
        // or its form is open: supabase-js emits SIGNED_IN inside the code exchange, and the iOS permission
        // prompt must not land on top of the reset form. The effect below runs it when the hold ends.
        if (event === 'SIGNED_IN' && session?.user && !notificationsSetup.current && !isRecoveryHold()) {
          notificationsSetup.current = true;
          setupPushNotifications(session.user.id, false);
        }
        userIdRef.current = session?.user?.id ?? null;

        // Any sign-in ends the "your email is confirmed, sign in" line on Sign in (W4).
        if (event === 'SIGNED_IN') setConfirmFailedNotice(false);

        // Reset flag on sign out
        if (event === 'SIGNED_OUT') {
          notificationsSetup.current = false;
          // Defensive: a recovery session ending any other way than
          // reset-password.tsx's own Cancel/success handlers (e.g. a
          // sign-out elsewhere in the app) must not leave the flag
          // stuck true for whatever session comes next.
          pendingRoute.dropHeld(); // a link kept by a recovery hold ends with the session
          setRecoverySession(false);
          setEmailJustConfirmed(false); // the "just confirmed" chip belongs to one sign-in
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  // Push setup that a recovery hold deferred (see the SIGNED_IN handler above) runs when the hold ends.
  useEffect(() => {
    return subscribeRecoverySession(() => {
      const id = userIdRef.current;
      if (isRecoveryHold() || !id || notificationsSetup.current) return;
      notificationsSetup.current = true;
      setupPushNotifications(id, false);
    });
  }, []);

  const userId = user?.id ?? null;

  const refreshProfile = useCallback(async () => {
    if (!userId) return;
    if (SHELL_FIXTURE) {
      setUsername(fixtureUsername(SHELL_FIXTURE));
      setProfileFor(userId);
      return;
    }
    const { data, error } = await supabase
      .from('user_profiles')
      .select('username')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      // Fail OPEN: the username gate is a first-run nicety, not a security
      // boundary (the server enforces the format and uniqueness on every
      // write). A transient read error must not strand the user on a gate
      // they may not need; the gate reappears on the next successful read.
      console.warn('[session] profile read failed; not gating on username', error.message);
      setUsername('');
    } else {
      setUsername(data?.username ?? null);
    }
    setProfileFor(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setUsername(null);
      setProfileFor(null);
      return;
    }
    refreshProfile();
  }, [userId, refreshProfile]);

  const setUsernameLocal = useCallback(
    (name: string) => {
      setUsername(name);
      setProfileFor(userId);
    },
    [userId]
  );

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (SHELL_FIXTURE) {
      await wait(FIXTURE_NETWORK_MS);
      setUser(FIXTURE_USER);
      setLiveSession(FIXTURE_USER.id);
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? { message: error.message, code: error.code } : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<SignUpResult> => {
    if (SHELL_FIXTURE) {
      await wait(FIXTURE_NETWORK_MS);
      return { error: { message: FIXTURE_SIGNUPS_PAUSED_MESSAGE }, needsConfirmation: false };
    }
    // Email confirmation is ON (plan 2026-10-14): signUp() returns no session, and the email's link is the https
    // universal link https://<domain>/auth/confirm?code=... (lib/auth/confirmLink.ts; it carries no invite code,
    // decision 17), opened by the app when it is installed. Its one-time code only THIS device can exchange: with
    // flowType 'pkce' supabase-js stores a code verifier here before the request and sends its challenge.
    // No username travels any more: the handle_new_user_profile trigger (20261005000001) still creates
    // the profile row (username NULL), and the pick-username gate asks for one.
    //
    // Also "Send again": supabase.auth.resend() sends NO challenge, so its email would come back as an
    // implicit-flow link with tokens in the URL. Repeating signUp() for the same, still-unconfirmed
    // address re-sends the confirmation through the PKCE path (and replaces the verifier, which
    // supersedes the earlier email, as GoTrue's own resend does).
    // Never on the weak fallback (Math.random + the "plain" method) that auth-js uses without a WebCrypto.
    if (!pkceCryptoReady()) return { error: { message: '', code: PKCE_CRYPTO_UNAVAILABLE }, needsConfirmation: false };
    try {
      // The ONE stored verifier is shared with a pending password reset, and auth-js deletes it when this call
      // fails: keep it (lib/auth/verifierSlot.ts). A successful new sign-up supersedes the old flow, on purpose.
      // The floor check, the call and the floor mark all run INSIDE the same critical section as the snapshot,
      // so two overlapping calls (a double tap) cannot both pass the check or restore a stale snapshot.
      const result = await withVerifierKept(
        verifierSlot,
        async () => {
          // The floor for ANY repeat to this address, whoever asks (lib/auth/resendCooldown.ts): a repeat inside
          // GoTrue's interval would fail AND destroy the verifier the first email needs. The existing
          // "Too many attempts" line words it.
          if (confirmationCooldown.remainingMs(email) > 0) return { tooSoon: true as const };
          try {
            const res = await supabase.auth.signUp({
              email,
              password,
              // The https universal link (W3), plain: no invite code in the email (decision 17).
              options: { emailRedirectTo: buildConfirmRedirect() },
            });
            if (!res.error && !res.data?.session) confirmationCooldown.markSent(email);
            return { tooSoon: false as const, res };
          } catch (e) {
            // A throw is either supabase-js's storage write BEFORE the request, or something after it was sent;
            // they cannot be told apart from here. Hold the floor either way: the cost of being wrong is waiting a
            // minute, whereas a repeat after a request that DID go out would hit GoTrue's rate limit and orphan
            // that email.
            confirmationCooldown.markSent(email);
            throw e;
          }
        },
        (r) => r.tooSoon || !!r.res.error
      );
      if (result.tooSoon) return { error: { ...RESEND_TOO_SOON }, needsConfirmation: false };
      const { data, error } = result.res;
      if (error) return { error: { message: error.message, code: error.code }, needsConfirmation: false };
      return { error: null, needsConfirmation: !data?.session };
    } catch {
      return { error: { message: '', code: PKCE_STORAGE_UNAVAILABLE }, needsConfirmation: false };
    }
  }, []);

  // The fixture never opens a native sheet: it answers as the server does today for a NEW
  // account while signups are closed, so the refusal can be captured without an Apple ID.
  const fixtureSocial = useCallback(async (): Promise<SocialSignInResult> => {
    await wait(FIXTURE_NETWORK_MS);
    return { kind: 'error', error: { message: FIXTURE_SIGNUPS_PAUSED_MESSAGE } };
  }, []);

  const signInWithApple = useCallback(
    () => (SHELL_FIXTURE ? fixtureSocial() : nativeAppleSignIn()),
    [fixtureSocial]
  );
  const signInWithGoogle = useCallback(
    () => (SHELL_FIXTURE ? fixtureSocial() : nativeGoogleSignIn()),
    [fixtureSocial]
  );

  const signOut = useCallback(async () => {
    if (SHELL_FIXTURE) {
      setUser(null);
      setSession(null);
      setLiveSession(null);
      return;
    }
    // Remove push token before signing out
    if (userId) {
      await removePushToken(userId);
    }
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      // Still signed in to Supabase: leave Google as it is too, so the two stay in step.
      console.warn('[auth] sign out failed', signOutError.code ?? '');
      return;
    }
    // The next person on this phone picks their own Google account.
    await signOutOfGoogle();
  }, [userId]);

  const profileLoading = !!userId && profileFor !== userId;

  // '' (the fail-open read error above) counts as "has a username".
  const authPhase: AuthPhase = loading || profileLoading
    ? 'unknown'
    : !user
      ? 'signedOut'
      : username === null
        ? 'gated'
        : 'ready';

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      user,
      loading,
      username: username || null,
      profileLoading,
      authPhase,
      setUsernameLocal,
      refreshProfile,
      signIn,
      signUp,
      signInWithApple,
      signInWithGoogle,
      signOut,
    }),
    [session, user, loading, username, profileLoading, authPhase, setUsernameLocal, refreshProfile, signIn, signUp, signInWithApple, signInWithGoogle, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
