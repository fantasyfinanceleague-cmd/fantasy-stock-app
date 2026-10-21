/**
 * The resumable back half of account deletion, shared by delete-account (the
 * user's request) and heal-account-deletions (the hourly cron), so a stage is
 * finished by exactly the same code whichever of them gets there first.
 * Plan: docs/plans/2026-10-21-account-deletion.md (§"The function", §"Heal pass").
 *
 * THE LEDGER (public.account_deletions) is what makes a crash between steps
 * recoverable rather than a half-deleted account (CLAUDE.md: a failed step must be
 * recoverable). It is written ONLY through W2's SECURITY DEFINER functions
 * (account_deletion_open / _mark_done / _fail / the Apple ones), never by a direct
 * table write. Stages only move forward:
 *   requested  the user proved who they are; nothing is scrubbed yet
 *   scrubbed   scrub_deleted_manager committed (it moves the stage itself, in its
 *              own transaction, so "scrubbed" cannot be claimed without it)
 *   done       the auth user is gone; account_deletion_mark_done VERIFIES that
 *              against auth.users before it will say so
 *
 * apple_revoke is a DISCRIMINATOR (CLAUDE.md "Overloaded NULLs are type tags"),
 * NOT NULL: none | required | pending | done | unrevoked.
 *   none       no Apple identity
 *   required   Apple identity, revoke not yet settled (a request died mid-way)
 *   pending    Apple was down; the refresh token is in vault, the heal retries
 *   done       Apple accepted the revoke
 *   unrevoked  no token could be obtained or kept; nothing more can be done
 *
 * SUCCESS SIGNALS (CLAUDE.md #5): supabase-js resolves `.rpc()` to { data, error }
 * and does not throw on a Postgres error, so every dependency returns its error
 * and every caller checks it. `ok` is never inferred from the absence of an error:
 * the scrub must SAY 'scrubbed' and mark_done must SAY 'done'.
 */

export type Stage = 'requested' | 'scrubbed' | 'done';
export type AppleRevoke = 'none' | 'required' | 'pending' | 'done' | 'unrevoked';

/**
 * The most auth users one heal pass will delete, AND the p_limit it asks the SQL for
 * (oldest first), so a real backlog drains in chunks of this size and a longer list can
 * only mean a bug upstream. "Cannot delete an unscrubbed user" rests on
 * heal_account_deletions listing only ids at stage 'scrubbed'; a bug in that list would
 * otherwise hard-delete real users with the service-role key.
 */
export const MAX_AUTH_DELETES_PER_RUN = 25;

export const STAGES: readonly string[] = ['requested', 'scrubbed', 'done'];
export const APPLE_STATES: readonly string[] = ['none', 'required', 'pending', 'done', 'unrevoked'];

export interface DbError {
  /** Deliberately NEVER read for logs or the ledger: a message can carry an id, an email or a token. */
  message?: string;
  code?: string;
  status?: number;
}

/**
 * A short machine code from a database / GoTrue error, or 'error'. This (never a message) is
 * the only thing that may reach a log line or account_deletion_fail's last_error: an error
 * message can interpolate an email, a user id, a token or an Apple payload, and the ledger is
 * a place people read. A code that is not a short identifier collapses to 'error'. No dots: real codes
 * (40P01, user_not_found, 500) have none, and a JWT or an Apple refresh token always does.
 */
export function safeCode(e: DbError | null | undefined): string {
  return codeToken(e?.code) ?? (typeof e?.status === 'number' ? codeToken(String(e.status)) : null) ?? 'error';
}

/**
 * A value that is safe to print or store as an error "code": a short identifier of letters, digits
 * and underscores, which is what real codes look like (40P01, user_not_found, PGRST116, 500,
 * live_state). Shape-based, so it is deliberately strict: no dots (a JWT or Apple refresh token has
 * them), no hyphens (a UUID has them), no @, no spaces, at most 40 characters, and no long run of
 * hex (a hash or key). It cannot prove a value is not an id, only that nothing id-, email- or
 * token-shaped passes.
 */
export function codeToken(v: unknown): string | null {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(v)) return null;
  if (/^[0-9a-fA-F]{20,}$/.test(v)) return null;
  return v;
}

/** A notice scrub_deleted_manager created (commissioner succession, pre-draft leave). */
export interface ScrubNotice {
  id: string;
  kind: 'commissioner_transferred' | 'member_left';
  recipient: string;
  /** may be absent: a notice that cannot deep-link is still better delivered than dropped */
  league_id: string | null;
  league_name: string | null;
}

/**
 * What account_deletion_stash_apple_token / _apple_revoked / _apple_unrevoked came to. These return
 * { status: 'ok', apple_revoke } or { status: 'refused', reason: 'backward' | 'no_ledger' [, apple_revoke] }
 * as DATA, not as an error, so checking only `error` reads a refusal as success: the response would say
 * the revoke settled while the ledger disagrees, and the vault entry would never be dropped. `ok` is true
 * ONLY for status 'ok'; `apple_revoke` is the LEDGER's value, the only thing a caller may report.
 * 'backward' = the ledger already holds a terminal value (done | unrevoked) from an earlier attempt.
 */
export interface AppleSettleResult {
  error: DbError | null;
  ok: boolean;
  reason: 'backward' | 'no_ledger' | 'unexpected' | null;
  apple_revoke: AppleRevoke | null;
}

export function parseAppleSettle(data: unknown, error: DbError | null): AppleSettleResult {
  if (error) return { error, ok: false, reason: null, apple_revoke: null };
  const d: Json = isObj(data) ? data : {};
  const apple = APPLE_STATES.includes(d.apple_revoke) ? (d.apple_revoke as AppleRevoke) : null;
  if (d.status === 'ok' && apple) return { error: null, ok: true, reason: null, apple_revoke: apple };
  const reason = d.status === 'refused' && (d.reason === 'backward' || d.reason === 'no_ledger') ? d.reason : 'unexpected';
  return { error: null, ok: false, reason, apple_revoke: apple };
}

export interface FinishDeps {
  /** rpc scrub_deleted_manager: idempotent; moves the ledger to 'scrubbed'. */
  scrub(userId: string): Promise<{ data: unknown; error: DbError | null }>;
  /** auth.admin.deleteUser (hard delete). */
  deleteAuthUser(userId: string): Promise<{ error: DbError | null }>;
  /**
   * rpc account_deletion_mark_done: 'done' only if the auth user is really gone. A refusal
   * returns the current stage with a `reason`; 'live_state' means rows that should be scrubbed
   * are live again, which the next heal pass clears (it re-scrubs before listing).
   */
  markDone(userId: string): Promise<{ stage: string | null; reason?: string | null; error: DbError | null }>;
  /** Best effort rpc account_deletion_fail (never throws, never fails the step). */
  recordError(userId: string, message: string): Promise<void>;
  /** Best effort push for the notices the scrub created. */
  deliverNotices(notices: ScrubNotice[]): Promise<void>;
}

export type FinishFailure = 'scrub_failed' | 'auth_delete_failed' | 'ledger_failed';
export type FinishResult =
  | { ok: true; stage: 'done' }
  | { ok: false; stage: Stage; reason: FinishFailure };

/**
 * GoTrue answers 404 user_not_found for a user that is already gone. For a delete
 * that is the goal state, so it counts as deleted (the heal relies on this when a
 * previous run deleted the user but died before mark_done). mark_done then
 * verifies the effect, so this never lets a still-present user through.
 */
export function isAuthUserGone(e: DbError | null): boolean {
  return !!e && (e.status === 404 || e.code === 'user_not_found');
}

/**
 * The ONLY shapes of text that may reach account_deletion_fail (the ledger's last_error, which
 * people read): a step name and one short code token. Everything else becomes 'unexpected', so
 * an email, a user id, a token or an Apple payload can never be written there, whoever calls it.
 */
export function ledgerErrorText(message: string): string {
  const m = /^(scrub|auth delete|mark done): (\S+)$/.exec(message);
  return m && codeToken(m[2]) ? message : 'unexpected';
}
/** A short token from a status string the database returned, else 'unexpected'. */
const statusToken = (v: unknown) => codeToken(v) ?? 'unexpected';

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' && v ? v : null);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A uuid string or null: the league id ends up in a push payload, so it is validated, not passed on. */
const uuidOrNull = (v: unknown) => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

/**
 * The notices scrub_deleted_manager created: `successions` (the new commissioner,
 * commissioner_transferred) and `left` (the pre-draft leave's member_left, to the
 * commissioner). An entry with no notice id has nothing to deliver and is skipped.
 */
export function scrubNotices(data: unknown): ScrubNotice[] {
  if (!isObj(data)) return [];
  const out: ScrubNotice[] = [];
  for (const s of Array.isArray(data.successions) ? data.successions : []) {
    if (!isObj(s)) continue;
    const id = text(s.notice_id), recipient = text(s.recipient), league_id = uuidOrNull(s.league_id);
    if (id && recipient) {
      out.push({ id, kind: 'commissioner_transferred', recipient, league_id, league_name: text(s.league_name) });
    }
  }
  for (const l of Array.isArray(data.left) ? data.left : []) {
    if (!isObj(l)) continue;
    const id = text(l.notice_id), recipient = text(l.notify_user_id), league_id = uuidOrNull(l.league_id);
    if (id && recipient) {
      out.push({ id, kind: 'member_left', recipient, league_id, league_name: text(l.league_name) });
    }
  }
  return out;
}

/**
 * The auth-delete half: delete the auth user, then have the database confirm it
 * is gone. Used from stage 'scrubbed' by finishDeletion AND by the heal pass for
 * each id its RPC reports at 'scrubbed'.
 */
export async function finishAuthStage(
  deps: FinishDeps,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: 'auth_delete_failed' | 'ledger_failed' }> {
  const { error } = await deps.deleteAuthUser(userId);
  if (error && !isAuthUserGone(error)) {
    const why = `auth delete: ${safeCode(error)}`;
    console.error('account deletion', why);
    await deps.recordError(userId, why);
    return { ok: false, reason: 'auth_delete_failed' };
  }
  const done = await deps.markDone(userId);
  if (done.error || done.stage !== 'done') {
    // The auth user may be gone while the ledger does not say so, or the database
    // refused because the user is still there. Either way the heal retries.
    // Codes only: a RAISE message could interpolate an id (nothing here may log one).
    console.error(
      'account deletion: mark done',
      done.error ? safeCode(done.error) : `stage=${statusToken(done.stage)}${done.reason ? ` reason=${statusToken(done.reason)}` : ''}`,
    );
    // Say WHY on the ledger row, so a row stuck at 'scrubbed' explains itself without rotating logs.
    await deps.recordError(userId, `mark done: ${done.error ? safeCode(done.error) : statusToken(done.reason ?? 'refused')}`);
    return { ok: false, reason: 'ledger_failed' };
  }
  return { ok: true };
}

/**
 * Run every stage still owed, from `stage` onwards. Each step is idempotent, so a
 * retry or a heal can re-enter at the stage the ledger shows. ok only at 'done'.
 */
export async function finishDeletion(deps: FinishDeps, userId: string, stage: Stage): Promise<FinishResult> {
  let at = stage;

  if (at === 'requested') {
    const { data, error } = await deps.scrub(userId);
    // The RPC must say it scrubbed; a null, a refusal ('no_ledger') or any other
    // body is not evidence.
    if (error || !isObj(data) || data.status !== 'scrubbed') {
      const why = error
        ? `scrub: ${safeCode(error)}`
        : `scrub: ${statusToken(isObj(data) ? data.status : null)}`;
      console.error('account deletion', why);
      await deps.recordError(userId, why);
      return { ok: false, stage: at, reason: 'scrub_failed' };
    }
    at = 'scrubbed';
    await deps.deliverNotices(scrubNotices(data));
  }

  if (at === 'scrubbed') {
    const r = await finishAuthStage(deps, userId);
    if (!r.ok) return { ok: false, stage: at, reason: r.reason };
    at = 'done';
  }

  return at === 'done' ? { ok: true, stage: 'done' } : { ok: false, stage: at, reason: 'ledger_failed' };
}
