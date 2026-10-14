import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { digest, getRandomBytes } from 'expo-crypto';
import type { CryptoDigestAlgorithm } from 'expo-crypto';

import { fillWithRandomBytes, installPkceCrypto } from './auth/pkceCrypto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
// Phase 3a: legacy anon key -> new publishable key (anon drop-in replacement).
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Only import AsyncStorage in native environments (not during static rendering)
let storage: any = undefined;
if (Platform.OS !== 'web' && typeof window !== 'undefined') {
  // Dynamic import to avoid issues during static rendering
  storage = require('@react-native-async-storage/async-storage').default;
}

// PKCE needs a global WebCrypto, which Hermes lacks; without this auth-js falls back to Math.random and
// the "plain" challenge method. Must run before the first signUp / resetPasswordForEmail (lib/auth/pkceCrypto.ts).
// If it cannot be installed, sign-up and password reset refuse to run (they check hasWebCrypto) rather than
// let auth-js silently use the weak fallback; nothing throws at import.
if (
  !installPkceCrypto(globalThis, {
    getRandomValues: (array) => fillWithRandomBytes(array, getRandomBytes),
    digest: (algorithm, data) => digest(algorithm as CryptoDigestAlgorithm, data),
  })
) {
  console.error('[auth] PKCE crypto is unavailable on this build; sign-up and password reset are disabled');
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: storage,
    autoRefreshToken: true,
    persistSession: Platform.OS !== 'web' && typeof window !== 'undefined',
    detectSessionInUrl: false,
    // Email links (confirmation, password reset) return a one-time CODE, exchanged on this device with the
    // verifier stored when the flow began (app/_layout.tsx). Replaces tokens-in-the-URL plus a nonce.
    flowType: 'pkce',
    storageKey: 'fantasy-finance-auth',
  },
});
