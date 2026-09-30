// Phase 3b-1 — WHEN a stored deep link is resumed.
//
// app/+native-intent.tsx records every incoming system link here before the
// router sees it; app/_layout.tsx reports each auth phase change and
// navigates to whatever authChanged() returns.
//
// The one subtle case is a cold start while ALREADY signed in: the link
// arrives while auth is still 'unknown', and the router opens it natively
// once the stack renders. Replaying it would push the screen twice. So a
// link is only replayed when the user reaches 'ready' FROM a state in which
// they could not have opened it themselves ('signedOut' or 'gated').
//
// Pure (no React Native imports) so tests-deno can exercise it hermetically.

import { resolveResumeTarget } from './resumeTarget';

/**
 * unknown   — auth not resolved yet (cold start)
 * signedOut — no session
 * gated     — signed in, but the username gate (pick-username) is showing
 * ready     — signed in with a username: the full app is available
 */
export type AuthPhase = 'unknown' | 'signedOut' | 'gated' | 'ready';

export interface PendingRoute {
  /** Store a raw incoming link, if it is resumable and the user can't open it yet. */
  record(raw: string): void;
  /** Report the new auth phase; returns the path to open now, if any. */
  authChanged(phase: AuthPhase): string | null;
  peek(): string | null;
}

export function createPendingRoute(): PendingRoute {
  let phase: AuthPhase = 'unknown';
  let target: string | null = null;

  return {
    record(raw) {
      if (phase === 'ready') return; // the router opens it directly
      const resolved = resolveResumeTarget(raw);
      if (resolved) target = resolved; // latest valid link wins; a rejected one erases nothing
    },
    authChanged(next) {
      const prev = phase;
      phase = next;
      if (next === 'ready') {
        const resume = prev === 'signedOut' || prev === 'gated' ? target : null;
        target = null;
        return resume;
      }
      if (next === 'signedOut' && prev === 'ready') target = null; // start clean after sign-out
      return null;
    },
    peek() {
      return target;
    },
  };
}

/** The app-wide instance shared by +native-intent and the root layout. */
export const pendingRoute = createPendingRoute();
