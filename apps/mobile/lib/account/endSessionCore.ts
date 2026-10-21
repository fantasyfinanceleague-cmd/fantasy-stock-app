// Account deletion (W4) — ending THIS phone's session once the server says the account is gone. Pure and
// dependency-injected so tests-deno can drive every branch.
//
// supabase-js's signOut RESOLVES `{ error }`, it does not throw (CLAUDE.md success-signal #5), and in 2.89 even
// scope:'local' calls /logout: a retryable network error comes back as `{ error }` and leaves the stored session in place.
// The account is deleted, so a session left behind would keep the person "signed in" on the done phase with nothing
// navigating. So the result is READ: on any error (or a throw) the stored session and its code-verifier slot are removed by
// hand and the app is told it is signed out. 401/403/404 from /logout (the user no longer exists) are treated as signed
// out by supabase-js itself and come back with no error.
//
// Then, regardless: the pending takeover and pending invite belong to the person who just left and must not outlive them,
// the per-user active-league choice is theirs alone, and the next person on this phone picks their own Google account.

import { AUTH_STORAGE_KEY, verifierKey } from '../auth/verifierSlot';
import { activeLeagueStorageKey } from '../shell/activeLeague';

export interface EndSessionDeps {
  /** supabase.auth.signOut({ scope: 'local' }): resolves { error }, may throw. */
  signOutLocal(): Promise<{ error?: unknown } | undefined | void>;
  removeItem(key: string): Promise<void>;
  /** Publish "signed out" to the app (the session provider's state and the live session), for when signOut could not. */
  forceSignedOut(): void;
  clearPendingTakeover(): Promise<void>;
  clearPendingInvite(): Promise<void>;
  signOutOfGoogle(): Promise<void>;
  /** The deleted user's id, for the per-user active-league key; null when unknown. */
  userId: string | null;
}

export interface EndSessionResult {
  /** signOut itself failed and the stored session was removed by hand. */
  forced: boolean;
}

async function quiet(f: () => Promise<unknown>): Promise<void> {
  try {
    await f();
  } catch {
    // best effort: the account is gone; nothing here is worth telling the person
  }
}

export async function endSessionCore(deps: EndSessionDeps): Promise<EndSessionResult> {
  let failed = false;
  try {
    const r = await deps.signOutLocal();
    failed = !!(r && typeof r === 'object' && 'error' in r && r.error);
  } catch {
    failed = true;
  }
  if (failed) {
    await quiet(() => deps.removeItem(AUTH_STORAGE_KEY));
    await quiet(() => deps.removeItem(verifierKey()));
    deps.forceSignedOut();
  }
  await quiet(() => deps.clearPendingTakeover());
  await quiet(() => deps.clearPendingInvite());
  if (deps.userId) await quiet(() => deps.removeItem(activeLeagueStorageKey(deps.userId as string)));
  await quiet(() => deps.signOutOfGoogle());
  return { forced: failed };
}
