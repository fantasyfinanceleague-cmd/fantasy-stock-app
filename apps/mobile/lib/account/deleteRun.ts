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

import { readFunctionRefusal } from '../functionRefusal';
import { deleteOutcome, type DeleteOutcome, type DeleteRequestBody } from './deleteFlow';

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
  const outcome = deleteOutcome(await readFunctionRefusal(res.data, res.error));
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
  const gone = r.error.code === 'user_not_found' || r.error.code === 'bad_jwt' || r.error.status === 404 || r.error.status === 403;
  return gone ? 'gone' : 'unknown';
}
