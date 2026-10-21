/**
 * The claims of a JWT, read WITHOUT verifying the signature. Only ever a
 * pre-filter or a binding check on a token that something else authenticates:
 *   - an id token the caller sends is verified by GoTrue (signInWithIdToken)
 *     afterwards; reading `sub` / `iat` first only keeps a wrong or stale token
 *     away from GoTrue (a sign-in for an unknown subject would CREATE an account);
 *   - Apple's token-endpoint response is read straight off TLS from appleid.apple.com.
 * Never use this to decide who someone IS.
 */
// deno-lint-ignore no-explicit-any
export function unverifiedJwtClaims(jwt: string): Record<string, any> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
    const claims = JSON.parse(atob(b64));
    return claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

export function unverifiedJwtSub(jwt: string): string | null {
  const sub = unverifiedJwtClaims(jwt)?.sub;
  return typeof sub === 'string' && sub ? sub : null;
}
