// Onboarding W2 (PKCE) — the WebCrypto surface supabase-js's PKCE flow needs, on Hermes.
//
// With flowType 'pkce', @supabase/auth-js makes a code verifier and a challenge at every signUp /
// resetPasswordForEmail (lib/supabase.ts). It reads a GLOBAL `crypto`:
//   - generatePKCEVerifier: crypto.getRandomValues, else (no `crypto`) Math.random, which is not a CSPRNG;
//   - generatePKCEChallenge: crypto.subtle.digest + TextEncoder, else (no `crypto.subtle`) the
//     challenge IS the verifier (method "plain") and it logs a warning.
// Hermes defines no `crypto`, and neither does Expo's runtime, so without this module PKCE would
// silently run on Math.random with the plain method, which is the weak form PKCE exists to avoid.
// expo-crypto supplies the native CSPRNG and SHA-256; this wires them to the names auth-js reads.
//
// A complete WebCrypto (a browser, Node 19+, Deno) is NEVER replaced. Pure and dependency-injected so
// tests-deno can run auth-js's own helpers against it.

export interface PkceCryptoDeps {
  /** A native CSPRNG (expo-crypto's getRandomValues). */
  getRandomValues: <T extends ArrayBufferView>(array: T) => T;
  /** Native SHA-256 (expo-crypto's digest). */
  digest: (algorithm: 'SHA-256', data: BufferSource) => Promise<ArrayBuffer>;
}

type Target = {
  crypto?: { getRandomValues?: unknown; subtle?: { digest?: unknown } } | undefined;
  TextEncoder?: unknown;
};

/** UTF-8 encoder for engines that lack TextEncoder. auth-js only ever encodes an ASCII verifier. */
export class Utf8TextEncoder {
  readonly encoding = 'utf-8';
  encode(input = ''): Uint8Array {
    const out: number[] = [];
    for (const ch of input) {
      const c = ch.codePointAt(0)!;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
}

/** True when `target.crypto` already has what PKCE needs (so it is left alone). */
export function hasWebCrypto(target: Target): boolean {
  const c = target.crypto;
  return !!c && typeof c.getRandomValues === 'function' && !!c.subtle && typeof c.subtle.digest === 'function';
}

/**
 * Everything auth-js's S256 path reads: a complete WebCrypto AND a TextEncoder (without one it silently
 * degrades to the "plain" method).
 */
export function pkceReady(target: Target): boolean {
  return hasWebCrypto(target) && typeof target.TextEncoder === 'function';
}

/** Whether THIS runtime has what PKCE needs; sign-up and password reset refuse to run without it. */
export function pkceCryptoReady(): boolean {
  return pkceReady(globalThis as unknown as Target);
}

/**
 * Fills the WHOLE typed array from a native byte source (getRandomBytes), so no element is left zero
 * whatever the element width. auth-js keeps the low byte of each Uint32 element of its 56-element array,
 * so a source that filled only the first 56 BYTES would leave most of the verifier as "00".
 */
export function fillWithRandomBytes<T extends ArrayBufferView>(
  array: T,
  getRandomBytes: (byteCount: number) => Uint8Array
): T {
  const bytes = getRandomBytes(array.byteLength);
  if (bytes.byteLength !== array.byteLength) throw new Error('random source returned the wrong number of bytes');
  new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(bytes);
  return array;
}

/**
 * Installs the shim. Returns whether this build is now PKCE-ready: a complete WebCrypto (an existing one
 * counts) and a TextEncoder.
 * Never throws: a non-configurable `crypto` global must not crash the app at import (lib/supabase.ts
 * loads in every screen). The CALLERS of PKCE refuse to run when this is false (hasWebCrypto), so a
 * failed install is loud and closed, never a silent fall back to Math.random + "plain".
 */
export function installPkceCrypto(target: Target, deps: PkceCryptoDeps): boolean {
  if (!hasWebCrypto(target)) {
    const subtle = {
      digest(algorithm: unknown, data: BufferSource): Promise<ArrayBuffer> {
        const name = typeof algorithm === 'string' ? algorithm : (algorithm as { name?: string } | null)?.name;
        if (typeof name !== 'string' || name.toUpperCase() !== 'SHA-256') {
          // Fail closed rather than hash with something else: PKCE here is S256 or nothing.
          return Promise.reject(new Error(`unsupported digest algorithm: ${String(name)}`));
        }
        return deps.digest('SHA-256', data);
      },
    };
    // Extend (not copy) an existing partial crypto, so its prototype methods (randomUUID ...) survive
    // for every other library that reads the global.
    const replacement = Object.create(target.crypto ?? null, {
      getRandomValues: { value: deps.getRandomValues, enumerable: true, configurable: true, writable: true },
      subtle: { value: subtle, enumerable: true, configurable: true, writable: true },
    });
    try {
      Object.defineProperty(target, 'crypto', { value: replacement, configurable: true, writable: true });
    } catch {
      try {
        (target as { crypto?: unknown }).crypto = replacement; // a writable, non-configurable global
      } catch {
        // Locked down: leave it, and report below.
      }
    }
  }
  if (typeof target.TextEncoder === 'undefined') {
    try {
      Object.defineProperty(target, 'TextEncoder', { value: Utf8TextEncoder, configurable: true, writable: true });
    } catch {
      // Best effort: hasWebCrypto below decides whether PKCE may run.
    }
  }
  return pkceReady(target);
}
