import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setupPushNotifications, removePushToken } from './notifications';
import { setRecoverySession } from './recoveryNonce';
import type { AuthPhase } from './shell/pendingRoute';
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
  /** true when the username was refused as taken (the profile's unique index). */
  usernameTaken: boolean;
};

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
  signUp: (email: string, password: string, username: string) => Promise<SignUpResult>;
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

  useEffect(() => {
    if (SHELL_FIXTURE) {
      // DEV-only fixture (lib/shell/devFixture.ts): a local fake session.
      // supabase.auth is never touched, so nothing signs in or out for real.
      setUser(fixtureStartsSignedOut(SHELL_FIXTURE) ? null : FIXTURE_USER);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);

      // Register for push notifications on initial load if logged in
      if (session?.user && !notificationsSetup.current) {
        notificationsSetup.current = true;
        setupPushNotifications(session.user.id);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Use functional updates to avoid unnecessary re-renders
        // that can cause native-stack to reconfigure and dismiss the keyboard
        setSession(prev => prev?.access_token === session?.access_token ? prev : session);
        setUser(prev => {
          const newUser = session?.user ?? null;
          return prev?.id === newUser?.id ? prev : newUser;
        });
        setLoading(false);

        // Register for push notifications on sign in
        if (event === 'SIGNED_IN' && session?.user && !notificationsSetup.current) {
          notificationsSetup.current = true;
          setupPushNotifications(session.user.id);
        }

        // Reset flag on sign out
        if (event === 'SIGNED_OUT') {
          notificationsSetup.current = false;
          // Defensive: a recovery session ending any other way than
          // reset-password.tsx's own Cancel/success handlers (e.g. a
          // sign-out elsewhere in the app) must not leave the flag
          // stuck true for whatever session comes next.
          setRecoverySession(false);
        }
      }
    );

    return () => subscription.unsubscribe();
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
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? { message: error.message, code: error.code } : null };
  }, []);

  const signUp = useCallback(async (email: string, password: string, username: string): Promise<SignUpResult> => {
    if (SHELL_FIXTURE) {
      await wait(FIXTURE_NETWORK_MS);
      return { error: { message: FIXTURE_SIGNUPS_PAUSED_MESSAGE }, needsConfirmation: false, usernameTaken: false };
    }
    // The username travels as auth metadata: with "Confirm email" on, signUp()
    // returns no session, so a client-side profile write would run as anon
    // and be refused by RLS. The handle_new_user_profile trigger
    // (20261005000001) reads this metadata in the same transaction that
    // creates the auth.users row. The upsert after it is the pre-existing
    // (now-redundant) fallback, kept for its 23505 "taken" signal.
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username } } });
    if (error) return { error: { message: error.message, code: error.code }, needsConfirmation: false, usernameTaken: false };
    if (data?.user) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert({ id: data.user.id, username }, { onConflict: 'id' });
      if (profileError?.code === '23505') return { error: null, needsConfirmation: false, usernameTaken: true };
    }
    return { error: null, needsConfirmation: !data?.session, usernameTaken: false };
  }, []);

  const signOut = useCallback(async () => {
    if (SHELL_FIXTURE) {
      setUser(null);
      setSession(null);
      return;
    }
    // Remove push token before signing out
    if (userId) {
      await removePushToken(userId);
    }
    await supabase.auth.signOut();
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
      signOut,
    }),
    [session, user, loading, username, profileLoading, authPhase, setUsernameLocal, refreshProfile, signIn, signUp, signOut]
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
