// Onboarding W3 (decision 18) — whether a session exists RIGHT NOW, readable from non-React code.
//
// app/+native-intent.tsx records, when an invite link arrives, whether the person was already signed in (a custom-scheme
// link that arrives while signed in must wait for their tap). The layout's auth phase is the wrong source: it LAGS a
// sign-in (the profile read, the sign-in button's quick-motion hold), so a link fired in that window would read "signed
// out". SessionProvider publishes here SYNCHRONOUSLY from supabase's own events (getSession() and onAuthStateChange), the
// instant the session appears or ends, before any React state or phase catches up.
//
//   signedIn: true  a session exists (even if the profile is still loading: phase 'unknown' WITH a session counts)
//             false a definite signed-out
//             null  not known yet (a cold start before getSession() resolves)
//
// Pure (no React Native imports) so tests-deno can load it.

export interface LiveSession {
  signedIn: boolean | null;
  userId: string | null;
}

let live: LiveSession = { signedIn: null, userId: null };

/** Called by SessionProvider on every session change; `userId` is the session's user (null when signed out). */
export function setLiveSession(userId: string | null): void {
  live = userId ? { signedIn: true, userId } : { signedIn: false, userId: null };
}

export function getLiveSession(): LiveSession {
  return live;
}

/** Tests only: back to "not known yet". */
export function resetLiveSession(): void {
  live = { signedIn: null, userId: null };
}
