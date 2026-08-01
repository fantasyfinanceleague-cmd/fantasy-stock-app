// Cryptographically secure invite-code generation for leagues.invite_code.
// Math.random() is NOT a CSPRNG — its V8 state is recoverable, which makes
// invite codes predictable/enumerable, and the invite code is the SOLE
// capability join_league_by_code requires.
//
// React Native does NOT guarantee a global crypto.getRandomValues, and this app
// bundles neither react-native-get-random-values nor a supabase-js polyfill of
// it, so we use expo-crypto's getRandomBytes — a native CSPRNG that is always
// available in this Expo (SDK 54) app once the dependency is installed. This
// keeps the fix identical in behaviour to the web helper without relying on a
// polyfill import ordering.
//
// Alphabet is 32 unambiguous uppercase chars (no 0/O/1/I) and length 10, giving
// 32^10 = 2^50 (~50 bits) of entropy. All-uppercase so codes survive the join
// forms' .toUpperCase() normalization unchanged. Selection uses rejection
// sampling for an exactly uniform, modulo-bias-free distribution.

import { getRandomBytes } from 'expo-crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I
const CODE_LENGTH = 10;

export function generateInviteCode(): string {
  const n = ALPHABET.length; // 32
  // Largest multiple of n that fits in a byte; bytes >= this are rejected so
  // every accepted byte maps to a symbol with equal probability.
  const maxUnbiased = Math.floor(256 / n) * n; // 256 for n=32 -> no rejection, but kept general
  let code = '';
  while (code.length < CODE_LENGTH) {
    // Fetch a small batch to minimise native round-trips; reject biased bytes.
    const bytes = getRandomBytes(CODE_LENGTH);
    for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i++) {
      const byte = bytes[i];
      if (byte >= maxUnbiased) continue; // reject to avoid modulo bias
      code += ALPHABET[byte % n];
    }
  }
  return code;
}
