// Onboarding W4 — "your email is confirmed, sign in with your password" (the Planner's ruling, plan
// Decisions row 16). Set by app/_layout.tsx ONLY when W2's auth link handler (lib/auth/
// authLinkHandlers.ts) returns 'confirm-failed': a confirmation link reached THIS phone with a code,
// but the code exchange failed here (a reinstall, a replaced verifier, the link opened in another
// app). GoTrue issues that code only after it has verified the email, so for a genuine link the
// claim is true. Never for 'confirm-ignored' (an error / expired link, an existing session) or
// 'confirm-wrong-type'; and a link opened on another device never reaches this phone, so that case
// stays silent by necessity.
//
// An in-memory flag, deliberately not persisted (cf. lib/auth/emailConfirmed.ts): it describes THIS
// launch's link. Sign in shows it once and clears it on the next sign-in attempt or on dismiss.

import type { AuthLinkOutcome } from './authLinkHandlers';

type Listener = () => void;

let shown = false;
const listeners = new Set<Listener>();

export function setConfirmFailedNotice(value: boolean): void {
  if (shown === value) return;
  shown = value;
  listeners.forEach((l) => l());
}

/** Snapshot getter for useSyncExternalStore. */
export function isConfirmFailedNotice(): boolean {
  return shown;
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeConfirmFailedNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The one outcome that raises the notice. Everything else (including 'confirm-ignored' and 'confirm-wrong-type') leaves it as it was. */
export function raisesConfirmFailedNotice(outcome: AuthLinkOutcome): boolean {
  return outcome === 'confirm-failed';
}

/** The words on Sign in (the Planner's ruling; verbatim). */
export const CONFIRM_FAILED_NOTICE = 'Your email is confirmed. Sign in with your password.';
