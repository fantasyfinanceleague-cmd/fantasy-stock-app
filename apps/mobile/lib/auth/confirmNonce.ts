// Onboarding W2 — the per-device nonce that binds an email-confirmation link to the sign-up this
// device started (lib/auth/confirmLink.ts explains the threat). The same shape as the recovery
// nonce (lib/recoveryNonce.ts, F2): 256 bits from the native CSPRNG, stored in AsyncStorage,
// checked with a constant-time compare, consumed on EVERY check (single use, so a replayed link
// can't sign in twice), and fail-closed on any storage error. The logic is in confirmNonceCore.ts.
//
// Two differences from the recovery nonce, both deliberate:
// - A separate storage key: a reset and a sign-up can be in flight at once, and neither may
//   consume the other's nonce.
// - "Send again" REUSES a fresh pending nonce, but only for the SAME address (so the first email's
//   link still works after a resend, and a nonce minted for a mistyped address is never reused).
//   TTL 1 h = GoTrue's default link expiry; it is cleared on every sign-in and sign-out.
// It binds the link to a sign-up started on THIS DEVICE, not to a person: it defends against a
// forged link, not against one intercepted in transit (see confirmLink.ts, universal links).

import { getRandomBytes } from 'expo-crypto';

import { createConfirmNonceStore, type NonceStorage } from './confirmNonceCore';

// Only touch AsyncStorage in native environments (mirrors lib/supabase.ts and recoveryNonce.ts).
function getStorage(): NonceStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return undefined;
  }
}

function randomHex(): string {
  const bytes = getRandomBytes(32); // 256 bits
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

const store = createConfirmNonceStore({ storage: getStorage, random: randomHex, now: Date.now });

export const getOrCreateConfirmNonce = store.getOrCreate;
export const verifyAndConsumeConfirmNonce = store.verifyAndConsume;
export const clearConfirmNonce = store.clear;
