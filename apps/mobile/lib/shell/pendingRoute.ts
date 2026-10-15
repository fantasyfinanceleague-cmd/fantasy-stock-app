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
  /**
   * Report the new auth phase; returns the path to open now, if any. While `hold` is true (a password-recovery
   * link is being exchanged, or its form is open) the link is KEPT instead of opened, so a replay can't push a
   * screen over the reset form; releaseHold() hands it back once the hold ends.
   */
  authChanged(phase: AuthPhase, hold?: boolean): string | null;
  /** The link kept by a hold, once: call when the hold ends. */
  releaseHold(): string | null;
  /** Forget a kept link without opening it (the reset was cancelled / the person is being signed out). */
  dropHeld(): void;
  peek(): string | null;
}

export function createPendingRoute(): PendingRoute {
  let phase: AuthPhase = 'unknown';
  let target: string | null = null;
  let held: string | null = null;

  return {
    record(raw) {
      if (phase === 'ready') return; // the router opens it directly
      const resolved = resolveResumeTarget(raw);
      if (resolved) target = resolved; // latest valid link wins; a rejected one erases nothing
    },
    authChanged(next, hold = false) {
      const prev = phase;
      phase = next;
      if (next === 'ready') {
        const resume = prev === 'signedOut' || prev === 'gated' ? target : null;
        target = null;
        if (hold && resume) {
          held = resume;
          return null;
        }
        return resume;
      }
      if (next === 'signedOut') held = null; // a cancelled reset ends the held link with the session
      if (next === 'signedOut' && prev === 'ready') target = null; // start clean after sign-out
      return null;
    },
    releaseHold() {
      const out = held;
      held = null;
      return out;
    },
    dropHeld() {
      held = null;
    },
    peek() {
      return target;
    },
  };
}

/** The app-wide instance shared by +native-intent and the root layout. */
export const pendingRoute = createPendingRoute();
