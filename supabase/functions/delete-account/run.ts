/**
 * delete-account run.ts — the whole request's decision logic with its I/O
 * injected, so every exit is tested hermetically (run.test.ts). No Deno APIs, no
 * network, no DB. index.ts wires the real clients.
 *
 * ORDER (docs/plans/2026-10-21-account-deletion.md §"The function"), with one
 * deliberate refinement:
 *   1. prove it      the proof's subject must be the caller (JWT); its session is
 *                    discarded. 5 failed proofs an hour -> rate_limited.
 *   2. Apple code    exchanged for a refresh token BEFORE the ledger opens. An
 *                    Apple 4xx is bad_proof, and it must precede ANY state change,
 *                    the ledger included: a ledger row at 'requested' is a
 *                    commitment the heal pass finishes, so opening it and then
 *                    answering bad_proof would delete an account whose response
 *                    said nothing happened (CLAUDE.md: the verdict's scope must
 *                    match the evidence's).
 *   3. open ledger   stage 'requested' (never moved backwards on a retry).
 *   4. Apple revoke  done -> 'done'; Apple down -> token to vault, 'pending', and
 *                    CONTINUE: Apple being down must not block a deletion.
 *   5. scrub, 6. auth delete, 7. ok only at stage 'done'.
 *
 * The user id comes ONLY from the verified JWT (`caller`), never from the body.
 *
 * HTTP: refusals the person can act on (bad_proof, apple_proof_required) are 200
 * with ok:false, the leave-league / draft-control convention, so supabase-js
 * hands the client the body. Server faults are 500 and carry the ledger stage.
 */

import {
  type AppleSettleResult,
  type DbError,
  type FinishDeps,
  finishDeletion,
  safeCode,
} from '../_shared/account-deletion.ts';
import type { OpenedLedger } from '../_shared/account-deletion-db.ts';
import type { AppleCallResult, AppleExchangeResult } from '../_shared/apple-revoke.ts';
import { unverifiedJwtClaims, unverifiedJwtSub } from '../_shared/jwt-claims.ts';

export { unverifiedJwtSub };

/**
 * The caller as run.ts needs it, from the user GoTrue VERIFIED (index.ts: getUser(jwt)). Identities, and so
 * the proof order, come from here and from nowhere the client controls. A user with no usable identity list
 * simply has none (the password allow-list then refuses it).
 */
// deno-lint-ignore no-explicit-any
export function toCaller(user: any): Caller {
  // deno-lint-ignore no-explicit-any
  const identities = (Array.isArray(user?.identities) ? user.identities : []).map((i: any) => ({
    provider: String(i?.provider ?? ''),
    sub: typeof i?.identity_data?.sub === 'string' ? i.identity_data.sub : (typeof i?.id === 'string' ? i.id : null),
  }));
  return { id: String(user?.id), email: typeof user?.email === 'string' && user.email ? user.email : null, identities };
}

export const PROOF_FAILURE_LIMIT = 5;
/**
 * An id token older than this is refused before it reaches GoTrue. The proof is a
 * step-up check against a stolen session, so a token captured earlier must not
 * count; the window covers the Apple/Google sheet plus the "Are you sure?" alert.
 * `iat` is read unverified (a pre-filter only): GoTrue verifies the signature.
 */
export const ID_TOKEN_MAX_AGE_S = 600;

export type Proof =
  | { kind: 'password'; password: string }
  | { kind: 'apple'; identityToken: string; authorizationCode: string; nonce: string }
  | { kind: 'google'; idToken: string; nonce: string | null };

export interface CallerIdentity {
  provider: string;
  /** The provider's subject (identity_data.sub, or the identity's provider id). */
  sub: string | null;
}

export interface Caller {
  id: string;
  email: string | null;
  identities: CallerIdentity[];
}

const MAX_FIELD = 8192;
const str = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD ? v : null);

/** Strict: a malformed body is a 400, never a guessed default. */
export function parseDeleteRequest(body: unknown): Proof | null {
  const p = (body as { proof?: unknown } | null)?.proof as Record<string, unknown> | undefined;
  if (!p || typeof p !== 'object') return null;
  if (p.kind === 'password') {
    const password = str(p.password);
    return password ? { kind: 'password', password } : null;
  }
  if (p.kind === 'apple') {
    const identityToken = str(p.identityToken);
    const authorizationCode = str(p.authorizationCode);
    const nonce = str(p.nonce);
    return identityToken && authorizationCode && nonce
      ? { kind: 'apple', identityToken, authorizationCode, nonce }
      : null;
  }
  if (p.kind === 'google') {
    const idToken = str(p.idToken);
    if (!idToken) return null;
    if (p.nonce !== undefined && p.nonce !== null && !str(p.nonce)) return null;
    return { kind: 'google', idToken, nonce: str(p.nonce) };
  }
  return null;
}

/**
 * What a proof sign-in came to. 'refused' = the credential was wrong (counts as a
 * failed proof). 'unavailable' = GoTrue itself failed (5xx, 429, network): that
 * says nothing about the person, so it must neither be called bad_proof nor burn
 * their hourly budget (CLAUDE.md case 5: the verdict's scope matches the evidence's).
 */
export type ProofAttempt =
  | { kind: 'ok'; session: ProofSession }
  | { kind: 'refused' }
  | { kind: 'unavailable' };

/** A sign-in the proof made; `discard` revokes its session (best effort). */
export interface ProofSession {
  userId: string | null;
  discard(): Promise<void>;
}

export interface DeleteDeps extends FinishDeps {
  /** Per-minute user + ip limiter (fail-open, the join/leave pattern). */
  rateLimitOk(userId: string): Promise<boolean>;
  /** Failed proofs this hour; null = the counter could not be read (fail closed). */
  proofFailureCount(userId: string): Promise<number | null>;
  bumpProofFailure(userId: string): Promise<void>;
  signInWithPassword(email: string, password: string): Promise<ProofAttempt>;
  signInWithIdToken(provider: 'apple' | 'google', token: string, nonce: string | null): Promise<ProofAttempt>;
  /** epoch milliseconds (injected so token freshness is testable). */
  now(): number;
  /** false when an APPLE_* secret is missing. */
  appleConfigured: boolean;
  exchangeAppleCode(code: string): Promise<AppleExchangeResult>;
  revokeAppleToken(refreshToken: string): Promise<AppleCallResult>;
  /** rpc account_deletion_open: never moves the stage backwards; keeps a settled revoke. */
  openLedger(userId: string, hasApple: boolean): Promise<{ row: OpenedLedger | null; error: DbError | null }>;
  /** rpc account_deletion_stash_apple_token: vault secret + 'pending', one transaction. */
  stashAppleToken(userId: string, refreshToken: string): Promise<AppleSettleResult>;
  /** rpc account_deletion_apple_revoked: drops any vault entry + 'done'. */
  appleRevoked(userId: string): Promise<AppleSettleResult>;
  /** rpc account_deletion_apple_unrevoked: drops any vault entry + 'unrevoked'. */
  appleUnrevoked(userId: string): Promise<AppleSettleResult>;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

const res = (status: number, body: Record<string, unknown>): HttpResult => ({ status, body });
const refuse = (reason: string) => res(200, { ok: false, reason });
const fault = (reason: string, stage: string | null) => res(500, { ok: false, reason, stage });
/** A 500 that names the step and the error CODE in the logs (never a token or a message body). */
function stepFault(step: string, e: DbError | null, stage: string | null): HttpResult {
  console.error(`delete-account: ${step} failed`, safeCode(e));
  return fault('unhandled', stage);
}

/** Step 1. 'ok' only when the proof's verified user id is the caller's. */
async function prove(deps: DeleteDeps, caller: Caller, proof: Proof): Promise<'ok' | 'bad' | 'expired' | 'unavailable'> {
  let attempt: ProofAttempt;
  if (proof.kind === 'password') {
    if (!caller.email) return 'bad';
    attempt = await deps.signInWithPassword(caller.email, proof.password);
  } else {
    const provider = proof.kind;
    const token = proof.kind === 'apple' ? proof.identityToken : proof.idToken;
    const claims = unverifiedJwtClaims(token);
    const claimed = typeof claims?.sub === 'string' ? claims.sub : null;
    const mine = caller.identities.some((i) => i.provider === provider && i.sub !== null && i.sub === claimed);
    if (!mine) return 'bad'; // never reaches GoTrue: no orphan account is created
    const iat = typeof claims?.iat === 'number' ? claims.iat : null;
    if (iat === null) return 'bad'; // undated: not a token a provider issued
    // Stale: a distinct, NON-counting refusal. A person who sat on the "Are you sure?"
    // alert too long is not an oracle probe, and must not burn their hourly budget or
    // read as a wrong password.
    if (deps.now() / 1000 - iat > ID_TOKEN_MAX_AGE_S) return 'expired';
    attempt = await deps.signInWithIdToken(provider, token, proof.nonce);
  }
  if (attempt.kind === 'unavailable') return 'unavailable';
  if (attempt.kind === 'refused') return 'bad';
  // The proof's session is not the caller's to keep. Discard it whatever the result.
  await attempt.session.discard();
  return attempt.session.userId === caller.id ? 'ok' : 'bad';
}

export async function runDeleteAccount(
  deps: DeleteDeps,
  caller: Caller | null,
  body: unknown,
): Promise<HttpResult> {
  if (!caller) return res(401, { ok: false, reason: 'not_authenticated' });
  if (!(await deps.rateLimitOk(caller.id))) return res(429, { ok: false, reason: 'rate_limited' });

  const proof = parseDeleteRequest(body);
  if (!proof) return res(400, { ok: false, reason: 'bad_request' });

  // The proof limiter guards a password oracle, so it fails CLOSED.
  const failures = await deps.proofFailureCount(caller.id);
  if (failures === null) return fault('unhandled', null);
  if (failures >= PROOF_FAILURE_LIMIT) return res(429, { ok: false, reason: 'rate_limited' });

  // Apple requires the revoke, and only a fresh Apple sign-in yields the code it
  // needs, so an Apple-linked account must prove with Apple on EVERY request, a
  // retry included (the plan: "a retry needs a new Apple sign-in"). The ledger is
  // deliberately not read to skip this: revoking a second token is harmless, while
  // trusting a stale ledger state could skip a revoke Apple requires.
  const needApple = caller.identities.some((i) => i.provider === 'apple');
  if (needApple && proof.kind !== 'apple') return refuse('apple_proof_required');
  // THE PROOF ORDER IS ENFORCED HERE, not left to the client (plan decision 10): Apple identity -> an Apple
  // proof; ELSE Google identity -> a Google proof; a PASSWORD proof only when the account has NEITHER.
  // Without this a Google-only account could prove with kind:'password', and a stolen session can set a new
  // password (updateUser({password}) needs no current one), so it could then delete a Google account.
  // Checked before the proof is attempted, so a refusal costs nothing and changes nothing.
  const needGoogle = !needApple && caller.identities.some((i) => i.provider === 'google');
  if (needGoogle && proof.kind !== 'google') return refuse('google_proof_required');
  // A password proof is an ALLOW-LIST, not "anything that is not Apple or Google": it needs at least one
  // identity and EVERY identity to be an email one. An account with no identities, or with a provider this
  // app does not use (github, facebook, custom:*), is refused rather than waved through by default.
  if (proof.kind === 'password' && !(caller.identities.length > 0 && caller.identities.every((i) => i.provider === 'email'))) {
    return refuse('proof_not_supported');
  }
  if (needApple && !deps.appleConfigured) {
    console.error('delete-account: an APPLE_* secret is not set; refusing before any change');
    return fault('server_config_error', null);
  }

  const proved = await prove(deps, caller, proof);
  if (proved === 'unavailable') return res(503, { ok: false, reason: 'try_again' });
  if (proved === 'expired') return refuse('proof_expired');
  if (proved === 'bad') {
    await deps.bumpProofFailure(caller.id);
    return refuse('bad_proof');
  }

  // Step 2: the Apple exchange, still before any state change.
  let refreshToken: string | null = null;
  if (needApple && proof.kind === 'apple') {
    let x = await deps.exchangeAppleCode(proof.authorizationCode);
    // One quick retry, but ONLY when Apple answered with a 5xx or 429 (it did not take
    // the code). A timeout/network error (status null) may have consumed the
    // single-use code, and so may a 200 that lacked a refresh token (status 200): a
    // retry would fail invalid_grant and charge the person a bad proof.
    if (x.kind === 'unavailable' && x.status !== null && (x.status >= 500 || x.status === 429)) {
      x = await deps.exchangeAppleCode(proof.authorizationCode);
    }
    if (x.kind === 'rejected') {
      await deps.bumpProofFailure(caller.id);
      return refuse('bad_proof');
    }
    if (x.kind === 'config') {
      console.error('delete-account: Apple rejected our client secret (invalid_client); refusing before any change');
      return fault('server_config_error', null);
    }
    if (x.kind === 'ok') {
      // Bind the code to the identity proved: the refresh token must belong to the
      // caller's own Apple user, or we would revoke (and record as revoked) someone
      // else's grant. A response with no id_token cannot be bound: refuse it.
      const appleSub = caller.identities.find((i) => i.provider === 'apple')?.sub ?? null;
      if (x.sub === null || appleSub === null || x.sub !== appleSub) {
        console.error('delete-account: the Apple code was not issued to the caller\'s Apple user');
        await deps.bumpProofFailure(caller.id);
        return refuse('bad_proof');
      }
      refreshToken = x.refreshToken;
    }
  }

  // Step 3: open the ledger. From here on, the deletion is committed: if this
  // request dies, the heal pass finishes it. 'required' is written for an Apple
  // account until its revoke settles, so a request that dies here is not mistaken
  // for "no Apple" (the heal settles a stale 'required' as 'unrevoked').
  const opened = await deps.openLedger(caller.id, needApple);
  if (opened.error || !opened.row) return stepFault('ledger open', opened.error, null);
  const stage = opened.row.stage;
  // What is reported as apple_revoke is ALWAYS the ledger's own value (from open, then from each settle's
  // reply), never a local guess: a refused settle ('backward': an earlier attempt already settled it) leaves
  // the ledger at its terminal value, and saying anything else would make the response disagree with it.
  let appleOutcome: string = opened.row.apple_revoke;

  // Step 4: settle the Apple revoke.
  if (needApple) {
    let settled: AppleSettleResult | null = null;
    let step = 'apple settle';
    if (refreshToken) {
      const r = await deps.revokeAppleToken(refreshToken);
      if (r.kind === 'ok' || r.kind === 'rejected') {
        // 'rejected' (a 4xx on the revoke) means this token cannot be revoked and a
        // retry will not change that: settle it as unrevoked rather than keep a
        // token in vault that every heal pass would fail on.
        step = 'apple settle';
        settled = r.kind === 'ok' ? await deps.appleRevoked(caller.id) : await deps.appleUnrevoked(caller.id);
      } else {
        // Apple is down (or our config blipped): keep the token in vault, 'pending'.
        step = 'apple stash';
        settled = await deps.stashAppleToken(caller.id, refreshToken);
      }
    } else if (opened.row.apple_revoke !== 'pending') {
      // Apple was unreachable for the exchange and nothing is vaulted: there is no token to keep, and the
      // code expires in minutes, so no later pass could use it.
      step = 'apple settle';
      settled = await deps.appleUnrevoked(caller.id);
    }
    // else: the exchange failed THIS time, but an earlier attempt already stashed a refresh token (the ledger is
    // 'pending'). That token is still owed a revoke and the heal retries it from vault; settling 'unrevoked' now
    // would DROP it. Leave the ledger alone: apple_revoke stays what it holds ('pending').

    if (settled) {
      if (settled.error) return stepFault(step, settled.error, stage);
      // 'backward' = an earlier attempt already settled it, so the ledger holds a TERMINAL value (done | unrevoked),
      // which is then the truth. Any other value with a refusal (e.g. 'none') is not that case.
      const terminalBackward = settled.reason === 'backward' &&
        (settled.apple_revoke === 'done' || settled.apple_revoke === 'unrevoked');
      if ((settled.ok || terminalBackward) && settled.apple_revoke) {
        appleOutcome = settled.apple_revoke;
      } else {
        // no_ledger, or a reply we cannot read: the ledger and this request disagree. Fail, never report.
        console.error(`delete-account: ${step} refused`, settled.reason ?? 'unexpected');
        return fault('unhandled', stage);
      }
    }
  }

  // Steps 5-6.
  const done = await finishDeletion(deps, caller.id, stage);
  if (!done.ok) return fault(done.reason, done.stage);
  // apple_revoke is reported next to ok, never folded into it.
  return res(200, { ok: true, stage: 'done', apple_revoke: appleOutcome });
}
