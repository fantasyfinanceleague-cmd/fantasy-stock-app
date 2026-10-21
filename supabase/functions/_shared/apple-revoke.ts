/**
 * Sign in with Apple token revocation, for account deletion
 * (docs/plans/2026-10-21-account-deletion.md, step 3).
 *
 * Apple requires an app that offers Sign in with Apple to revoke the user's tokens
 * when the account is deleted. Supabase keeps no Apple refresh token for the native
 * flow, so the only way to revoke is the authorization code from a fresh Apple
 * sign-in in the same request: exchange it at /auth/token for a refresh token,
 * then POST that to /auth/revoke.
 *
 * Both calls authenticate with a client_secret that is an ES256 JWT signed with
 * the team's .p8 key (Apple: "Creating a client secret"). It is minted per call
 * with a 5-minute lifetime; Apple allows up to 6 months, but a short one means a
 * leaked secret is worth nothing by the time anyone could use it.
 *
 * SECRETS: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (the .p8 PEM) and
 * APPLE_BUNDLE_ID are read from env by the caller and passed in. Nothing in this
 * file logs a secret, a token, an authorization code or a response body; it logs
 * only HTTP statuses and Apple's short `error` code (e.g. "invalid_grant").
 *
 * Every outcome is a tagged value, never a throw, so the caller cannot mistake a
 * network failure for "revoked" (CLAUDE.md "Success signals"):
 *   ok          Apple accepted the call.
 *   rejected    Apple answered 4xx: the request itself is wrong (a used or
 *               expired code). Retrying the same request will not help.
 *   config      Apple answered `invalid_client`: OUR secret is wrong (an expired
 *               .p8, a wrong key id). Not the user's fault, so the caller must not
 *               report it as a bad proof.
 *   unavailable Network error, timeout, 429 or 5xx: Apple is down, try later.
 *
 * Google needs no equivalent: Google access ends when the Supabase auth identity
 * is deleted, and Apple's rule is Apple's own.
 */

import { unverifiedJwtSub } from './jwt-claims.ts';

export const APPLE_ISSUER = 'https://appleid.apple.com';
const TOKEN_URL = 'https://appleid.apple.com/auth/token';
const REVOKE_URL = 'https://appleid.apple.com/auth/revoke';
const CLIENT_SECRET_TTL_S = 300;
const APPLE_TIMEOUT_MS = 10_000;

export interface AppleConfig {
  teamId: string;
  keyId: string;
  /** The .p8 file's PEM text (PKCS#8, P-256). */
  privateKey: string;
  /** The app's bundle id: client_id for the native flow, and the secret's sub. */
  clientId: string;
}

/** null when any secret is missing or blank: the caller fails closed. */
export function appleConfigFromEnv(get: (k: string) => string | undefined): AppleConfig | null {
  const teamId = get('APPLE_TEAM_ID')?.trim() ?? '';
  const keyId = get('APPLE_KEY_ID')?.trim() ?? '';
  const privateKey = get('APPLE_PRIVATE_KEY')?.trim() ?? '';
  const clientId = get('APPLE_BUNDLE_ID')?.trim() ?? '';
  if (!teamId || !keyId || !privateKey || !clientId) return null;
  return { teamId, keyId, privateKey, clientId };
}

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

export type AppleCallResult =
  | { kind: 'ok' }
  | { kind: 'rejected'; status: number; error: string | null }
  | { kind: 'config'; status: number }
  | { kind: 'unavailable'; status: number | null };

export type AppleExchangeResult =
  /**
   * `sub` is the Apple user the code was issued to, from the exchange response's own
   * id_token (straight from Apple over TLS). The caller binds it to the identity the
   * person proved, so a code for one Apple user cannot revoke another's grant.
   */
  | { kind: 'ok'; refreshToken: string; sub: string | null }
  | Exclude<AppleCallResult, { kind: 'ok' }>;

// ---- ES256 client secret ------------------------------------------------------

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

/**
 * PEM -> PKCS#8 bytes. A secret set through the CLI or dashboard often arrives with
 * literal "\n" sequences instead of newlines, or on one line; both are accepted.
 */
export function pemToPkcs8(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * The client_secret JWT. WebCrypto's ECDSA signature is IEEE P1363 (r || s, 64
 * bytes), which is exactly the JWS ES256 encoding, so no DER conversion is needed.
 */
export async function makeAppleClientSecret(cfg: AppleConfig, now: Date = new Date()): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(cfg.privateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const iat = Math.floor(now.getTime() / 1000);
  const signingInput = `${b64urlJson({ alg: 'ES256', kid: cfg.keyId })}.${
    b64urlJson({ iss: cfg.teamId, iat, exp: iat + CLIENT_SECRET_TTL_S, aud: APPLE_ISSUER, sub: cfg.clientId })
  }`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

// ---- The two endpoints ------------------------------------------------------

async function postForm(
  fetchFn: FetchFn,
  url: string,
  form: Record<string, string>,
): Promise<{ res: Response; json: Record<string, unknown> | null } | null> {
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(APPLE_TIMEOUT_MS),
    });
    const text = await res.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body: status alone decides */ }
    return { res, json };
  } catch (e) {
    console.error(`apple ${url.endsWith('revoke') ? 'revoke' : 'token'} unreachable:`, e instanceof Error ? e.name : 'error');
    return null;
  }
}

function classify(what: string, r: { res: Response; json: Record<string, unknown> | null } | null): AppleCallResult {
  if (!r) return { kind: 'unavailable', status: null };
  const { res, json } = r;
  if (res.ok) return { kind: 'ok' };
  // Apple's short error code (invalid_grant, invalid_client): anything not shaped like one is dropped,
  // so a body that echoes a token or code can never reach a log line or a returned value.
  const raw = typeof json?.error === 'string' ? json.error : null;
  const error = raw !== null && /^[A-Za-z0-9_]{1,40}$/.test(raw) ? raw : raw === null ? null : 'error';
  console.error(`apple ${what} HTTP ${res.status}`, error ?? '');
  if (res.status >= 500 || res.status === 429) return { kind: 'unavailable', status: res.status };
  if (error === 'invalid_client') return { kind: 'config', status: res.status };
  return { kind: 'rejected', status: res.status, error };
}

/** authorization_code -> refresh token. The code is single-use and lives ~5 minutes. */
export async function exchangeAppleCode(
  cfg: AppleConfig,
  code: string,
  fetchFn: FetchFn = fetch,
  now: Date = new Date(),
): Promise<AppleExchangeResult> {
  const r = await postForm(fetchFn, TOKEN_URL, {
    client_id: cfg.clientId,
    client_secret: await makeAppleClientSecret(cfg, now),
    code,
    grant_type: 'authorization_code',
  });
  const c = classify('token', r);
  if (c.kind !== 'ok') return c;
  const refreshToken = r?.json?.refresh_token;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    // A 200 without the token is not a revocable state; never read it as success.
    console.error('apple token HTTP 200 without a refresh_token');
    return { kind: 'unavailable', status: r!.res.status };
  }
  const idToken = r?.json?.id_token;
  return { kind: 'ok', refreshToken, sub: typeof idToken === 'string' ? unverifiedJwtSub(idToken) : null };
}

/** Revoke a refresh token (which also invalidates its access tokens). */
export async function revokeAppleToken(
  cfg: AppleConfig,
  refreshToken: string,
  fetchFn: FetchFn = fetch,
  now: Date = new Date(),
): Promise<AppleCallResult> {
  const r = await postForm(fetchFn, REVOKE_URL, {
    client_id: cfg.clientId,
    client_secret: await makeAppleClientSecret(cfg, now),
    token: refreshToken,
    token_type_hint: 'refresh_token',
  });
  return classify('revoke', r);
}
