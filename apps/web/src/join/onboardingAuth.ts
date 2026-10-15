/**
 * The web onboarding's OWN Supabase client, and every call the sign-in flow
 * makes. This is the ONLY file under src/join that imports supabase-js
 * (build-isolation.test.ts pins that), and only the sign-in flow and the web
 * callback import THIS file: /auth/confirm (the app's email link) never does,
 * because it must never exchange a code or create a session.
 *
 * Why a separate client from src/supabase/supabaseClient.js (the paused app's):
 *  - it is implicit-flow with detectSessionInUrl ON and patches global fetch;
 *    this one is PKCE, reads NO URL (a code reaches us only through the
 *    pre-JS scrub in index.html, then exchangeCode below, explicitly), and
 *    patches nothing;
 *  - it has its own storageKey. Two GoTrue clients on one key both auto-refresh,
 *    and refresh-token rotation's reuse detection then REVOKES the session; a
 *    distinct key also means the paused app can never wake up signed in here;
 *  - localStorage, not sessionStorage: the confirmation link usually opens a
 *    NEW tab, and the PKCE code verifier has to be there to meet it.
 *
 * Created lazily, so merely loading the join chunk creates nothing.
 */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLISHABLE_KEY, SUPABASE_URL, webCallbackUrl } from './config';
import { clearPendingInvite, setPendingInvite } from './pendingInvite';
import { confirmationCooldown, RESEND_TOO_SOON } from './resendCooldown';
import { interpretJoin, interpretPreview, type FindOutcome, type JoinOutcome } from './previewData';

export const ONBOARDING_STORAGE_KEY = 'stockpile-onboarding-auth';

let client: SupabaseClient | null | undefined;

/** The onboarding client, or null when this build has no Supabase configuration. */
export function onboardingClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  client =
    SUPABASE_URL && PUBLISHABLE_KEY
      ? createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
          auth: {
            flowType: 'pkce',
            detectSessionInUrl: false,
            persistSession: true,
            autoRefreshToken: true,
            storageKey: ONBOARDING_STORAGE_KEY,
          },
        })
      : null;
  return client;
}

/** An auth failure as the flow handles it: mapped to a line by getAuthErrorMessage, never shown raw. */
export interface AuthFailure {
  message: string;
  code?: string;
}
export interface ActionResult {
  error: AuthFailure | null;
}

const UNAVAILABLE: ActionResult = { error: { message: 'network error' } };

function failure(e: unknown): AuthFailure {
  const o = e !== null && typeof e === 'object' ? (e as { message?: unknown; code?: unknown }) : {};
  return { message: typeof o.message === 'string' ? o.message : '', code: typeof o.code === 'string' ? o.code : undefined };
}

export interface SessionInfo {
  userId: string;
}

/** The signed-in person, or null. A read failure is "not signed in": the sign-in options show. */
export async function currentSession(): Promise<SessionInfo | null> {
  const c = onboardingClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    const session: Session | null = data?.session ?? null;
    return session ? { userId: session.user.id } : null;
  } catch {
    return null;
  }
}

/**
 * Continue with Apple / Google: a full-page redirect to the provider and back
 * to /auth/web-callback. The invite is stored first (and rides on the redirect
 * URL) so the return knows which league. Only the email scope is requested; a
 * name or photo the provider shares is stored by Supabase and never read here
 * (plan Decision 15A).
 */
export async function signInWithProvider(provider: 'apple' | 'google', invite: string): Promise<ActionResult> {
  const c = onboardingClient();
  if (!c) return UNAVAILABLE;
  setPendingInvite(invite);
  try {
    const { error } = await c.auth.signInWithOAuth({
      provider,
      options: { redirectTo: webCallbackUrl(window.location.origin, invite, 'oauth'), scopes: 'email' },
    });
    return { error: error ? failure(error) : null };
  } catch (e) {
    return { error: failure(e) };
  }
}

export type SignUpResult = ActionResult & { needsConfirmation: boolean };

/**
 * Email + password sign-up, no username (the pick-username step asks). Email
 * confirmation is ON, so success normally means "check your email"; the link
 * returns to /auth/web-callback, where THIS browser's verifier exchanges it.
 * "Send again" repeats this call (resend() sends no PKCE challenge); a repeat
 * inside GoTrue's minimum interval is not sent at all, because an errored
 * signUp deletes the verifier the first, still-valid email needs.
 */
export async function signUpWithEmail(email: string, password: string, invite: string): Promise<SignUpResult> {
  const c = onboardingClient();
  if (!c) return { ...UNAVAILABLE, needsConfirmation: false };
  if (confirmationCooldown.remainingMs(email) > 0) return { error: { ...RESEND_TOO_SOON }, needsConfirmation: false };
  setPendingInvite(invite);
  try {
    const { data, error } = await c.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: webCallbackUrl(window.location.origin, invite, 'email') },
    });
    if (error) return { error: failure(error), needsConfirmation: false };
    if (!data?.session) confirmationCooldown.markSent(email);
    return { error: null, needsConfirmation: !data?.session };
  } catch (e) {
    return { error: failure(e), needsConfirmation: false };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<ActionResult> {
  const c = onboardingClient();
  if (!c) return UNAVAILABLE;
  try {
    const { error } = await c.auth.signInWithPassword({ email, password });
    return { error: error ? failure(error) : null };
  } catch (e) {
    return { error: failure(e) };
  }
}

/** The web callback's explicit exchange: the code was taken off the URL before any client existed. */
export async function exchangeCode(code: string): Promise<ActionResult> {
  const c = onboardingClient();
  if (!c) return UNAVAILABLE;
  try {
    const { error } = await c.auth.exchangeCodeForSession(code);
    return { error: error ? failure(error) : null };
  } catch (e) {
    return { error: failure(e) };
  }
}

/**
 * Ends THIS browser's session only (scope local: the phone's session is not
 * revoked) and forgets the invite. Called at every terminal screen: the web's
 * only job is the join, so nothing signed-in lingers on a shared computer.
 */
export async function signOutLocal(): Promise<void> {
  clearPendingInvite();
  const c = onboardingClient();
  if (!c) return;
  try {
    await c.auth.signOut({ scope: 'local' });
  } catch {
    /* the local tokens are cleared even when the call fails */
  }
}

// ── After sign-in ───────────────────────────────────────────────────────

/** The caller's username: a string, null when unset, undefined when the read failed (fail OPEN, like the app). */
export async function readOwnUsername(userId: string): Promise<string | null | undefined> {
  const c = onboardingClient();
  if (!c) return undefined;
  try {
    const { data, error } = await c.from('user_profiles').select('username').eq('id', userId).maybeSingle();
    if (error) return undefined;
    return (data as { username?: string | null } | null)?.username ?? null;
  } catch {
    return undefined;
  }
}

export type ServerStatus = 'available' | 'taken' | 'invalid';

/** check_usernames (max 10); null when the check itself failed. */
export async function checkUsernames(candidates: string[]): Promise<{ username: string; status: ServerStatus }[] | null> {
  const c = onboardingClient();
  if (!c) return null;
  try {
    const { data, error } = await c.rpc('check_usernames', { p_candidates: candidates.slice(0, 10) });
    if (error) return null;
    return (data ?? []) as { username: string; status: ServerStatus }[];
  } catch {
    return null;
  }
}

/** set_username for the caller; null when the outcome is unknown. */
export async function setUsername(name: string): Promise<'ok' | 'taken' | 'invalid' | null> {
  const c = onboardingClient();
  if (!c) return null;
  try {
    const { data, error } = await c.rpc('set_username', { p_username: name });
    if (error) return null;
    return data === 'ok' || data === 'taken' || data === 'invalid' ? data : null;
  } catch {
    return null;
  }
}

/** preview-league WITH the session: the facts and the exact refusal reason. */
export async function previewWithSession(code: string): Promise<FindOutcome> {
  const c = onboardingClient();
  if (!c) return { kind: 'error', error: 'unreachable' };
  try {
    const { data, error } = await c.functions.invoke('preview-league', { body: { code } });
    return interpretPreview(data, error);
  } catch {
    return { kind: 'error', error: 'unreachable' };
  }
}

/** join-league: the only truth for joining (draft state, capacity, season, membership). */
export async function joinWithSession(code: string): Promise<JoinOutcome> {
  const c = onboardingClient();
  if (!c) return { kind: 'error', error: 'unreachable' };
  try {
    const { data, error } = await c.functions.invoke('join-league', { body: { code } });
    return interpretJoin(data, error);
  } catch {
    return { kind: 'error', error: 'unreachable' };
  }
}
