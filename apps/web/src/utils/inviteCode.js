// Cryptographically secure invite-code generation for leagues.invite_code and
// league_invites.code. Math.random() is NOT a CSPRNG — its V8 state is
// recoverable, which makes invite codes predictable/enumerable, and the invite
// code is the SOLE capability join_league_by_code requires. Use the Web Crypto
// API (globalThis.crypto.getRandomValues), which is present in every browser
// this Vite app targets.
//
// Alphabet is 32 unambiguous uppercase chars (no 0/O/1/I) so codes stay easy to
// read/type and survive the join forms' .toUpperCase() normalization unchanged.
// Length 10 over a 32-symbol alphabet is 32^10 = 2^50 (~50 bits) of entropy.
// Selection uses rejection sampling so the distribution is exactly uniform (no
// modulo bias).

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I
const CODE_LENGTH = 10;

export function generateInviteCode() {
  const n = ALPHABET.length; // 32
  // Largest multiple of n that fits in a byte; bytes >= this are rejected so
  // every accepted byte maps to a symbol with equal probability.
  const maxUnbiased = Math.floor(256 / n) * n; // 256 for n=32 -> no rejection, but kept general
  let code = '';
  const buf = new Uint8Array(1);
  while (code.length < CODE_LENGTH) {
    globalThis.crypto.getRandomValues(buf);
    const byte = buf[0];
    if (byte >= maxUnbiased) continue; // reject to avoid modulo bias
    code += ALPHABET[byte % n];
  }
  return code;
}
