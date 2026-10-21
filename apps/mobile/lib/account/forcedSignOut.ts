// Account deletion (W4) — a tiny publisher the SessionProvider subscribes to, for the one case supabase-js cannot signal:
// the account is deleted, signOut failed on the wire, and the stored session was removed by hand
// (lib/account/endSessionCore.ts). The provider then clears its session/user state exactly as a SIGNED_OUT event would.
// Pure (no React Native imports).

type Listener = () => void;
const listeners = new Set<Listener>();

export function forceSignedOut(): void {
  listeners.forEach((l) => l());
}

export function subscribeForcedSignOut(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
