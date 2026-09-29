/**
 * The cron/operator apikey guard, extracted VERBATIM from the functions that
 * already carry it inline (snapshot-week-start, snapshot-week-end,
 * process-week-results, refresh-symbols, refresh-market-calendar — byte-
 * identical `constantTimeEqual` / `isAuthorized` in each). New cron-only
 * functions import it from here instead of adding a sixth copy; the existing
 * five are deliberately NOT switched over in the same change (each would need
 * its own redeploy + byte-verification, CLAUDE.md), so they remain the
 * reference this file must keep matching.
 *
 * Contract: verify_jwt=false at the gateway, so this check is the ENTIRE auth
 * boundary. Compares the `apikey` header to SB_SECRET_KEY_CRON in constant
 * time; FAILS CLOSED when the secret is unset or empty.
 */

// Constant-time compare to avoid leaking the expected key via timing.
export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i++) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export function isAuthorized(req: Request): boolean {
  const expectedKey = Deno.env.get('SB_SECRET_KEY_CRON');
  if (!expectedKey || expectedKey.length === 0) {
    console.error('SB_SECRET_KEY_CRON not configured — rejecting all requests');
    return false; // fail closed
  }
  const providedKey = req.headers.get('apikey') ?? '';
  return constantTimeEqual(providedKey, expectedKey);
}
