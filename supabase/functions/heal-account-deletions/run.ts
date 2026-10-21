/**
 * heal-account-deletions run.ts — the hourly heal's decisions with its I/O
 * injected (run.test.ts), the refresh-market-calendar/run.ts shape: every path
 * returns a JobRun (HTTP result AND the terminal cron_job_status outcome), which
 * _shared/run-job.ts writes exactly once.
 *
 * WHAT IT FINISHES (docs/plans/2026-10-21-account-deletion.md §"Heal pass"):
 *   heal_account_deletions() (W2's SQL) does the database half: it re-runs the
 *   scrub for ledger rows stuck at 'requested' AND re-scrubs 'scrubbed' rows before
 *   listing them (so a mark_done refusal with reason 'live_state', whose rows went live
 *   again, heals on the next pass), settles stale apple_revoke
 *   'required' rows as 'unrevoked', expires Apple retries that have run too long,
 *   and purges 'done' rows after 7 days. It reports, rather than does, the two
 *   things SQL cannot: the auth user to delete (`auth_delete`: ids at 'scrubbed')
 *   and the Apple revokes to retry (`apple_pending`: ids with a token in vault).
 *   This handler does those, through the SAME finishAuthStage the user's request
 *   uses, and the heal never reaches 'done' any other way: mark_done verifies
 *   auth.users itself.
 *
 * SUCCESS SIGNALS (CLAUDE.md): a 200 means the handler ran, not that everything
 * healed. `ok` is true only when nothing failed, and the cron_job_status outcome
 * is 'failed' (never 'success') whenever any step errored, so an hourly job that
 * heals nothing cannot read as healthy while a row sits stuck. A failure message
 * carries counts only: no ids, no names, no tokens.
 *
 * APPLE: a revoke Apple requires and we could not do is OURS to notice. Every
 * revoke that settles as 'unrevoked' logs one constant line with a hash of the user
 * id (never the id), so it is greppable in the function logs.
 */
import {
  type AppleSettleResult,
  type DbError,
  type FinishDeps,
  finishAuthStage,
  MAX_AUTH_DELETES_PER_RUN,
  scrubNotices,
} from '../_shared/account-deletion.ts';
import type { AppleCallResult } from '../_shared/apple-revoke.ts';
import type { JobRun } from '../_shared/run-job.ts';

export const UNREVOKED_LOG_LINE = 'account deletion: apple revoke unresolved (unrevoked)';
const ATTEMPT = 1;

export interface HealDeps extends FinishDeps {
  /** rpc heal_account_deletions. */
  heal(): Promise<{ data: unknown; error: DbError | null }>;
  /** rpc account_deletion_apple_token. */
  appleToken(userId: string): Promise<{ token: string | null; error: DbError | null }>;
  /** false when an APPLE_* secret is missing: no revoke can be attempted. */
  appleConfigured: boolean;
  revokeAppleToken(refreshToken: string): Promise<AppleCallResult>;
  appleRevoked(userId: string): Promise<AppleSettleResult>;
  appleUnrevoked(userId: string): Promise<AppleSettleResult>;
  /** A short stable hash of a user id, for logs. */
  hashId(userId: string): Promise<string>;
}

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
}

export interface HealCounts {
  scrubbed: number;
  scrub_errors: number;
  auth_deleted: number;
  auth_failed: number;
  apple_revoked: number;
  apple_unrevoked: number;
  apple_retry: number;
  apple_errors: number;
  /** settles the ledger REFUSED as 'backward': a request settled the opposite terminal value first (a benign race) */
  apple_raced: number;
  /** entries of auth_delete NOT acted on because the list was over the bound or held junk */
  auth_refused: number;
  purged: number;
}

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only well-formed uuids survive: the list drives a hard delete, so junk is dropped, not passed on. */
const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : [];

export { MAX_AUTH_DELETES_PER_RUN };

function failedRun(reason: string, http: HttpResult): JobRun<HttpResult> {
  return { outcome: { status: 'failed', attempt: ATTEMPT, message: reason }, response: http };
}

/**
 * heal_account_deletions' result, validated STRICTLY against W2's real shape (20261125000007):
 *   scrubbed         [uuid, ...]   the users it re-scrubbed
 *   scrub_results    [ <scrub_deleted_manager body>, ... ]
 *   scrub_errors     [ { user_id, error }, ... ]   (entries are NEVER logged: they hold an id and text)
 *   auth_delete      [uuid, ...]
 *   apple_pending    [uuid, ...]
 *   apple_unrevoked  [uuid, ...]
 *   purged           integer
 * A field of the wrong type, or a missing one, makes the whole result malformed (the run FAILS),
 * never a quiet zero. This is not hypothetical: an earlier version read `scrub_errors` with a number
 * helper, which turns an array into 0, so a scrub that failed every hour read as "no errors".
 */
export function parseHealResult(r: unknown): Json | null {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const o = r as Json;
  for (const k of ['scrubbed', 'scrub_results', 'scrub_errors', 'auth_delete', 'apple_pending', 'apple_unrevoked']) {
    if (!Array.isArray(o[k])) return null;
  }
  if (!Number.isInteger(o.purged)) return null;
  return o;
}

export async function runHeal(deps: HealDeps): Promise<JobRun<HttpResult>> {
  const { data, error } = await deps.heal();
  const r: Json | null = error ? null : parseHealResult(data);
  if (error || !r) {
    // A failed or malformed heal RPC is not "nothing to heal".
    console.error('heal_account_deletions failed', error?.code ?? 'unexpected result');
    return failedRun(
      `heal_account_deletions failed${error?.code ? ` ${error.code}` : ' (unexpected result)'}`,
      { status: 500, body: { ok: false, reason: 'heal_failed' } },
    );
  }

  const c: HealCounts = {
    scrubbed: r.scrubbed.length,
    scrub_errors: r.scrub_errors.length,
    auth_deleted: 0,
    auth_failed: 0,
    apple_revoked: 0,
    apple_unrevoked: 0,
    apple_retry: 0,
    apple_errors: 0,
    apple_raced: 0,
    auth_refused: 0,
    purged: num(r.purged),
  };

  // Notices created by the scrubs the SQL pass ran itself (a commissioner's
  // succession, a pre-draft leave). heal_account_deletions reports each scrub's result
  // body in `scrub_results`; delivering them here is the only way those pushes happen.
  // Best effort: a push never fails the heal.
  const notices = (Array.isArray(r.scrub_results) ? r.scrub_results : []).flatMap((x: unknown) => scrubNotices(x));
  if (notices.length > 0) await deps.deliverNotices(notices);

  // The delete list drives a HARD delete, so it is judged on the RAW list, not on what
  // survives filtering (a filter-then-conclude check would let 10 good ids through a list
  // of 1000 with 990 junk, and report nothing). Over the bound, or ANY entry that is not a
  // uuid, means the SQL is misbehaving: refuse the whole delete loop and fail the run. A
  // stuck queue is recoverable; a wrongly deleted account is not. Only the delete loop is
  // refused: the Apple lists below are one-shot reports (an apple_unrevoked id is never
  // reported twice), so skipping them would lose them, and the SQL keeps ageing pending
  // rows towards 'unrevoked' meanwhile.
  const rawDelete: unknown[] = Array.isArray(r.auth_delete) ? r.auth_delete : [];
  const toDelete = ids(rawDelete);
  const refuseDeletes = rawDelete.length > MAX_AUTH_DELETES_PER_RUN || toDelete.length !== rawDelete.length;
  if (refuseDeletes) {
    c.auth_refused = rawDelete.length;
    console.error('heal refused the auth_delete list', rawDelete.length, `valid=${toDelete.length}`);
  }

  // The auth half. One failure does not stop the others (per-participant, never
  // all-or-nothing): each id gets its own attempt and its own ledger error.
  for (const id of refuseDeletes ? [] : toDelete) {
    const done = await finishAuthStage(deps, id);
    if (done.ok) c.auth_deleted++;
    else c.auth_failed++;
  }

  // Apple revokes the SQL side already gave up on (stale 'required', expired
  // retries): nothing to do but make them visible.
  const logUnrevoked = async (id: string) => console.error(UNREVOKED_LOG_LINE, await deps.hashId(id));
  for (const id of ids(r.apple_unrevoked)) {
    c.apple_unrevoked++;
    await logUnrevoked(id);
  }

  // A settle the ledger REFUSED. 'backward' with a TERMINAL value is a benign race (delete-account settled the
  // opposite terminal value between this pass listing the row and settling it): the row is settled, so it is
  // counted apart and does not fail the run. Everything else (an error, no_ledger, a reply we cannot read) is a
  // real failure.
  const countRefusal = (r: AppleSettleResult) => {
    if (!r.error && r.reason === 'backward' && (r.apple_revoke === 'done' || r.apple_revoke === 'unrevoked')) c.apple_raced++;
    else c.apple_errors++;
  };

  // The retries.
  for (const id of ids(r.apple_pending)) {
    if (!deps.appleConfigured) {
      c.apple_errors++; // cannot revoke without the secrets; stays pending, visible as a failure
      continue;
    }
    const t = await deps.appleToken(id);
    if (t.error) {
      c.apple_errors++;
      continue;
    }
    if (!t.token) {
      // 'pending' with no vault entry cannot ever be retried: settle it, loudly.
      const u = await deps.appleUnrevoked(id);
      if (u.error || !u.ok) countRefusal(u); // a REFUSED settle (backward / no_ledger) is not a settle
      else {
        c.apple_unrevoked++;
        await logUnrevoked(id);
      }
      continue;
    }
    const rev = await deps.revokeAppleToken(t.token);
    if (rev.kind === 'ok') {
      const v = await deps.appleRevoked(id);
      if (v.error || !v.ok) countRefusal(v); // a REFUSED settle (backward / no_ledger) is not a revoke
      else c.apple_revoked++;
    } else if (rev.kind === 'rejected') {
      // A 4xx on a token we hold will not change on the next pass.
      const u = await deps.appleUnrevoked(id);
      if (u.error || !u.ok) countRefusal(u);
      else {
        c.apple_unrevoked++;
        await logUnrevoked(id);
      }
    } else if (rev.kind === 'config') {
      // invalid_client: OUR .p8 / key id / team id is wrong or expired. Apple requires the
      // revoke, so this is ours to notice: a failure, never a quiet retry that reads as
      // success every hour until the retry window expires. The row stays pending.
      c.apple_errors++;
    } else {
      c.apple_retry++; // Apple down (5xx, 429, network): still pending; the next hour retries
    }
  }

  const failures = c.scrub_errors + c.auth_failed + c.apple_errors + c.auth_refused;
  const work = c.scrubbed + c.auth_deleted + c.apple_revoked + c.apple_unrevoked + c.purged;
  const summary = `scrubbed=${c.scrubbed} auth_deleted=${c.auth_deleted} apple_revoked=${c.apple_revoked} ` +
    `apple_unrevoked=${c.apple_unrevoked} apple_retry=${c.apple_retry} apple_raced=${c.apple_raced} purged=${c.purged}`;
  const body = {
    ok: failures === 0,
    ...(refuseDeletes ? { reason: 'auth_delete_refused' } : {}),
    ...c,
  };

  if (failures > 0) {
    return {
      outcome: {
        status: 'failed',
        attempt: ATTEMPT,
        message: `${summary} scrub_errors=${c.scrub_errors} auth_failed=${c.auth_failed} apple_errors=${c.apple_errors} auth_refused=${c.auth_refused}`,
        work,
      },
      response: { status: 200, body },
    };
  }
  return {
    outcome: { status: 'success', attempt: ATTEMPT, message: summary, work },
    response: { status: 200, body },
  };
}
