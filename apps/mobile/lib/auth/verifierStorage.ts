import { Platform } from 'react-native';

import { AUTH_STORAGE_KEY, verifierKey, type VerifierSlot } from './verifierSlot';

// Onboarding W2 (PKCE) — the verifier slot (lib/auth/verifierSlot.ts) bound to the SAME AsyncStorage the
// supabase client persists to (lib/supabase.ts), under the key auth-js uses. Native only, guarded exactly as
// lib/supabase.ts guards it; where there is no storage (web / static render) the slot reads as empty, so the
// link handler refuses (fail closed) and the sign-up / reset snapshots are no-ops.

function storage(): { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> } | null {
  if (Platform.OS === 'web' || typeof window === 'undefined') return null;
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
}

export const verifierSlot: VerifierSlot = {
  async read() {
    try {
      return (await storage()?.getItem(verifierKey(AUTH_STORAGE_KEY))) ?? null;
    } catch {
      return null;
    }
  },
  async write(raw) {
    // A failure REJECTS (no storage, or setItem fails): restoreVerifierIfAbsent catches it and reports `false`,
    // so "restored" is never claimed for a write that did not happen.
    const store = storage();
    if (!store) throw new Error('no storage for the verifier');
    await store.setItem(verifierKey(AUTH_STORAGE_KEY), raw);
  },
};
