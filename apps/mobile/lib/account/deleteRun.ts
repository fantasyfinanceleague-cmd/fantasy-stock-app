// Account deletion (W4) — the request, as one pure, dependency-injected sequence (the inviteJoin.ts pattern): the
// screen only draws the result, so every exit is testable without React Native or a Supabase project.
//
//   body -> invoke delete-account -> read the answer -> (on a failure) re-check whether the account is already gone.
//
// WHY THE RE-CHECK. The server deletes the auth user LAST and answers {ok:true} only then. A request whose answer
// is lost (transport), or whose retry finds the session dead (401 not_authenticated), may have actually completed:
// showing "Couldn't delete your account" and a retry that can never succeed would strand the person on a deleted
// account. So a failure is followed by one read of the session's user: if the server says that user no longer
// exists, the deletion happened and the outcome is `deleted`. An unreadable answer stays `failed` (never guessed).

import { readFunctionRefusal, type FunctionRefusal } from '../functionRefusal';
import type { SocialProofResult } from '../auth/socialOutcome';
import { deleteOutcome, type DeleteOutcome, type DeleteRequestBody } from './deleteFlow';
import type { DeleteProof } from './proofKind';

/**
 * The function's answer. readFunctionRefusal drops a non-2xx body that has no string `reason` (it is "transport"), but a
 * 500 that carries a `stage` means the deletion is COMMITTED whether or not it has a reason, so a non-2xx body is read
 * here first and only the shared reader's contract (reason-bearing bodies) is reproduced for the rest.
 */
export async function readDeleteReply(data: unknown, error: unknown): Promise<FunctionRefusal> {
  const ctx = (error !== null && typeof error === 'object' ? (error as { context?: unknown }).context : null) as
    | { status?: unknown; json?: unknown }
    | null
    | undefined;
  if (error && ctx && typeof ctx.json === 'function') {
    let parsed: unknown = null;
    try {
      parsed = await (ctx.json as () => Promise<unknown>)();
    } catch {
      return { transport: true };
    }
    const body = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    if (!body) return { transport: true };
    const status = typeof ctx.status === 'number' ? ctx.status : null;
    if (typeof body.stage === 'string' && body.stage.length > 0) return { transport: false, status, reason: typeof body.reason === 'string' ? body.reason : 'in_progress', body };
    if (typeof body.reason !== 'string') return { transport: true };
    return { transport: false, status, reason: body.reason, body };
  }
  return readFunctionRefusal(data, error);
}

export type AccountCheck = 'gone' | 'exists' | 'unknown';

export interface DeleteRunDeps {
  invoke(body: DeleteRequestBody): Promise<{ data: unknown; error: unknown }>;
  /** Asks the server whether the signed-in user still exists (a no-cache read; 'gone' only for a definitive answer). */
  checkAccount(): Promise<AccountCheck>;
}

export async function runDelete(body: DeleteRequestBody, deps: DeleteRunDeps): Promise<DeleteOutcome> {
  let res: { data: unknown; error: unknown };
  try {
    res = await deps.invoke(body);
  } catch {
    res = { data: null, error: new Error('network') };
  }
  const outcome = deleteOutcome(await readDeleteReply(res.data, res.error));
  if (outcome.kind !== 'failed') return outcome;
  let check: AccountCheck = 'unknown';
  try {
    check = await deps.checkAccount();
  } catch {
    check = 'unknown';
  }
  return check === 'gone' ? { kind: 'deleted' } : outcome;
}

/** supabase.auth.getUser()'s error, read: a definitive "that user is gone" (a deleted user's JWT is rejected). */
export function accountCheckFromGetUser(r: { data?: { user?: unknown } | null; error?: { status?: number; code?: string } | null }): AccountCheck {
  if (!r.error) return r.data?.user ? 'exists' : 'unknown';
  // ONLY `user_not_found` is a definitive "that user is gone". GoTrue also answers 403 session_not_found (a session revoked
  // elsewhere) and a bad/expired JWT for a LIVE account, so those, and a bare 403/404, stay unknown: claiming "Your account is
  // deleted." for a live account would be worse than saying "try again".
  return r.error.code === 'user_not_found' ? 'gone' : 'unknown';
}

/**
 * The age past which a SOCIAL proof is refreshed before it is sent (W3's contract): Apple's authorizationCode lives
 * about 5 minutes and an id token about 10, and the person may sit on the "Are you sure?" alert. At Delete a proof older
 * than this re-runs the Apple/Google sheet and the request goes out right after. Passwords don't age.
 */
export const PROOF_MAX_AGE_MS = 4 * 60 * 1000;

export interface DeleteFlowDeps extends DeleteRunDeps {
  /** The clock (injected so the age rule is testable). */
  now(): number;
  /** Re-runs the Apple / Google sheet for a fresh proof. */
  reprove(kind: 'apple' | 'google'): Promise<SocialProofResult>;
}

export function proofIsStale(proof: DeleteProof, proofAt: number | null, now: number): boolean {
  if (proof.kind === 'password') return false;
  return proofAt === null || now - proofAt > PROOF_MAX_AGE_MS || now < proofAt;
}

/** A refresh that gave no proof: a closed sheet says nothing; anything else is the plain failure. Nothing was sent either way. */
function noFreshProof(r: SocialProofResult): DeleteOutcome {
  return r.kind === 'proof' ? { kind: 'failed' } : r.kind === 'error' ? { kind: 'failed' } : { kind: 'cancelled' };
}

/**
 * "Delete" on the alert: refresh an aged social proof (sheet, then straight to the request), send, and if the server
 * still says proof_expired (clock skew, a slow phone) refresh ONCE more and resend. A second expiry is returned as
 * `proof_expired` (the screen re-asks), never the generic failure.
 */
export async function runDeleteFlow(body: DeleteRequestBody, proofAt: number | null, deps: DeleteFlowDeps): Promise<DeleteOutcome> {
  let proof = body.proof;
  if (proofIsStale(proof, proofAt, deps.now()) && proof.kind !== 'password') {
    const fresh = await deps.reprove(proof.kind);
    if (fresh.kind !== 'proof') return noFreshProof(fresh);
    proof = fresh.proof;
  }
  const first = await runDelete({ proof }, deps);
  if (first.kind !== 'proof_expired' || proof.kind === 'password') return first;
  const again = await deps.reprove(proof.kind);
  if (again.kind !== 'proof') return noFreshProof(again);
  return runDelete({ proof: again.proof }, deps);
}
