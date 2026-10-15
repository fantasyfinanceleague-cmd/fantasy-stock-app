// Onboarding W2 (PKCE) — the two nonce stores are gone (lib/recoveryNonce.ts, lib/auth/confirmNonce.ts);
// this clears what they left in AsyncStorage on an upgraded device. Harmless leftovers (a nonce with
// nothing to match), but there is no reason to keep them. Best effort, never throws.

export const LEGACY_AUTH_KEYS: readonly string[] = ['fantasy-recovery-nonce', 'fantasy-confirm-nonce'];

export async function removeLegacyAuthKeys(
  storage: { removeItem(key: string): Promise<void> } | null | undefined
): Promise<void> {
  if (!storage) return;
  for (const key of LEGACY_AUTH_KEYS) {
    try {
      await storage.removeItem(key);
    } catch {
      // Best effort.
    }
  }
}
