// Account deletion (W4) — "Your account is deleted." on Sign in, ONCE (plan decision 11; UX rules 8/9: say what
// happened and where the person lands). The same shape as lib/auth/confirmFailedNotice.ts: an in-memory flag,
// deliberately not persisted, because it describes THIS launch's deletion. Raised right before the local sign-out,
// shown on Sign in, cleared on dismiss or on the next sign-in attempt.

type Listener = () => void;

let shown = false;
const listeners = new Set<Listener>();

export function setDeletedNotice(value: boolean): void {
  if (shown === value) return;
  shown = value;
  listeners.forEach((l) => l());
}

/** Snapshot getter for useSyncExternalStore. */
export function isDeletedNotice(): boolean {
  return shown;
}

/** Subscribe function for useSyncExternalStore. */
export function subscribeDeletedNotice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
