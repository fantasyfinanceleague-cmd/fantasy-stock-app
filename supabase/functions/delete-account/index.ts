// delete-account: a player deletes their own account, immediately.
// Plan: docs/plans/2026-10-21-account-deletion.md (§"The function"); rules:
// docs/PRODUCT_RULES.md "Account deletion". Every decision lives in run.ts
// (hermetically tested); this file only wires the real clients.
//
// Body: { proof: { kind: 'password', password }
//              | { kind: 'apple', identityToken, authorizationCode, nonce }
//              | { kind: 'google', idToken, nonce? } }
// Response: { ok: true, stage: 'done', apple_revoke } | { ok: false, reason, stage? }
//
// Auth: gateway verify_jwt=true plus in-code getUser() (the leave-league pattern).
// The user id comes ONLY from the verified JWT, never from the body.
//
// Why a service-role edge function and not a client-called RPC: the freeze
// release treats any auth.uid() IS NOT NULL caller as a user session and would
// refuse the commissioner succession mid-season, and auth.admin.deleteUser needs
// the secret key.
//
// SECRETS: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_BUNDLE_ID are read
// here and passed to _shared/apple-revoke.ts. None is ever logged. Neither is the
// password, an id token, the authorization code or the Apple refresh token.
//
// SUCCESS SIGNALS (CLAUDE.md): .rpc() and the query builders resolve to { error }
// on a Postgres error; they don't throw. Every call below returns its error to
// run.ts, which checks it.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { makeLedgerDeps } from '../_shared/account-deletion-db.ts';
import { appleConfigFromEnv, exchangeAppleCode, revokeAppleToken } from '../_shared/apple-revoke.ts';
import { type DeleteDeps, type ProofAttempt, runDeleteAccount, toCaller } from './run.ts';

// No CORS headers on purpose. Deletion is in-app only (plan decision 15), so no
// browser origin ever needs to call this, and the most destructive endpoint in the
// app should not reflect arbitrary origins. A browser's preflight gets a bare 204
// with no Access-Control-Allow-Origin, so a cross-origin page cannot call it.

// deno-lint-ignore no-explicit-any
type Admin = any;

const PROOF_BUCKET = 'delete-account-proof';
const PROOF_WINDOW_S = 3600;

// ---- Fail-open rate limit: per-user (10/min) + per-IP (30/min) --------------
async function rateLimitOk(admin: Admin, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'delete-account', p_subject: `user:${userId}`, p_limit: 10 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'delete-account', p_subject: `ip:${ip}`, p_limit: 30 }));
    }
    const results = await Promise.all(calls);
    // deno-lint-ignore no-explicit-any
    return results.every((r: any) => r.data !== false);
  } catch {
    return true; // FAIL-OPEN
  }
}

/**
 * Failed proofs in the current hour, read from the limiter's own table so a
 * SUCCESSFUL proof costs nothing (check_and_bump_rate_limit always bumps). The
 * window start is computed exactly as the RPC does: floor(epoch / 3600) * 3600.
 * null = unreadable; run.ts fails closed on it. Concurrent failures can overshoot
 * the 5 by however many land in the same instant; the 10/min limiter bounds that.
 */
async function proofFailureCount(admin: Admin, userId: string): Promise<number | null> {
  const windowStart = new Date(Math.floor(Date.now() / 1000 / PROOF_WINDOW_S) * PROOF_WINDOW_S * 1000).toISOString();
  try {
    const { data, error } = await admin
      .from('rate_limit_counters')
      .select('hits')
      .eq('bucket', PROOF_BUCKET)
      .eq('subject', `user:${userId}`)
      .eq('window_start', windowStart)
      .maybeSingle();
    if (error) {
      console.error('proof counter read failed', error.code ?? '');
      return null;
    }
    return typeof data?.hits === 'number' ? data.hits : 0;
  } catch {
    return null;
  }
}

async function bumpProofFailure(admin: Admin, userId: string): Promise<void> {
  try {
    const { error } = await admin.rpc('check_and_bump_rate_limit', {
      p_bucket: PROOF_BUCKET,
      p_subject: `user:${userId}`,
      p_limit: 5,
      p_window_seconds: PROOF_WINDOW_S,
    });
    if (error) console.error('proof counter bump failed', error.code ?? '');
  } catch (e) {
    console.error('proof counter bump threw', e instanceof Error ? e.name : 'error');
  }
}

Deno.serve(async (req: Request) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;

  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(SUPABASE_URL, SECRET_KEY);
  const apple = appleConfigFromEnv((k) => Deno.env.get(k));

  // A throwaway client per proof: no storage, no refresh timer, nothing shared
  // with the caller's own session.
  const proofClient = () =>
    createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  /**
   * Classify a proof sign-in. Only a credential GoTrue actually refused (a 400 or 401
   * answer: invalid_credentials, a bad or expired token) is 'refused' and counts as a
   * failed proof. A 429, a 5xx or a network failure says nothing about the person:
   * 'unavailable', no bad_proof, no budget burned. GoTrue's own sign-in limit may be
   * keyed on this function's egress IP, so one caller's hammering could otherwise
   * read as another user's wrong password.
   */
  // deno-lint-ignore no-explicit-any
  const asProof = (data: any, error: any): ProofAttempt => {
    if (error) {
      const status = typeof error.status === 'number' ? error.status : null;
      return status === 400 || status === 401 || status === 422 ? { kind: 'refused' } : { kind: 'unavailable' };
    }
    if (!data?.user?.id) return { kind: 'refused' };
    const accessToken: string | undefined = data.session?.access_token;
    return {
      kind: 'ok',
      session: {
        userId: String(data.user.id),
        // Revoke ONLY this session (scope local): the caller's own session must
        // survive, so a failed later step can be retried from the app.
        discard: async () => {
          if (!accessToken) return;
          try {
            const { error: e } = await admin.auth.admin.signOut(accessToken, 'local');
            if (e) console.error('proof session discard failed', e.status ?? '');
          } catch (e) {
            console.error('proof session discard threw', e instanceof Error ? e.name : 'error');
          }
        },
      },
    };
  };

  try {
    // The JWT is passed explicitly rather than inferred from the client's headers.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: auth } = await authed.auth.getUser(jwt);
    const user = auth?.user;
    const caller = user ? toCaller(user) : null;
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    const body = await req.json().catch(() => null);

    const deps: DeleteDeps = {
      ...makeLedgerDeps(admin),
      rateLimitOk: (uid) => rateLimitOk(admin, uid, ip),
      proofFailureCount: (uid) => proofFailureCount(admin, uid),
      bumpProofFailure: (uid) => bumpProofFailure(admin, uid),
      signInWithPassword: async (email, password) => {
        const { data, error } = await proofClient().auth.signInWithPassword({ email, password });
        return asProof(data, error);
      },
      signInWithIdToken: async (provider, token, nonce) => {
        const { data, error } = await proofClient().auth.signInWithIdToken(
          nonce ? { provider, token, nonce } : { provider, token },
        );
        return asProof(data, error);
      },
      now: () => Date.now(),
      appleConfigured: apple !== null,
      exchangeAppleCode: (code) => exchangeAppleCode(apple!, code),
      revokeAppleToken: (token) => revokeAppleToken(apple!, token),
    };

    const result = await runDeleteAccount(deps, caller, body);
    // Outcome only: never the proof, never a token.
    const b = result.body;
    console.log('delete-account', JSON.stringify({
      status: result.status,
      ok: b.ok,
      reason: b.reason ?? null,
      stage: b.stage ?? null,
      apple_revoke: b.apple_revoke ?? null,
    }));
    return json(result.body, result.status);
  } catch (e) {
    console.error('delete-account unhandled', e instanceof Error ? e.name : 'error');
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
