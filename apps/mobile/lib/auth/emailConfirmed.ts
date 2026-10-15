// Onboarding W2 — "the person just came back from the confirmation link". Set by app/_layout.tsx
// ONLY after the nonce-checked setSession succeeds (lib/auth/confirmLink.ts); W4's Pick a username
// reads it to draw the "✓ EMAIL CONFIRMED" chip (constants/confirmEmailCopy.ts) and clears it when
// the username is kept. An in-memory flag, deliberately not persisted (cf. lib/recoveryNonce.ts's
// recovery-session flag): it describes THIS launch's sign-in, and must not survive a relaunch or a
// sign-out into the next person's session (SessionProvider clears it on SIGNED_OUT).

type Listener = () => void;

let confirmed = false;
const listeners = new Set<Listener>();

export function setEmailJustConfirmed(value: boolean): void {
  if (confirmed === value) return;
  confirmed = value;
  listeners.forEach((l) => l());
}

/** Snapshot getter for useSyncExternalStore. */
export function isEmailJustConfirmed(): boolean {
  return confirmed;
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeEmailJustConfirmed(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
