/**
 * The supabase-js side of account deletion, wired once for delete-account and
 * heal-account-deletions. EVERY ledger and vault touch goes through one of W2's
 * SECURITY DEFINER functions (EXECUTE service_role only): there is deliberately no
 * `.from('account_deletions')` here, read or write, so the table's invariants (a
 * stage never moves backwards, mark_done verifies auth.users, the vault entry and
 * its ledger state change in one transaction) live in SQL and cannot be bypassed
 * from this side.
 *
 * Every call destructures and returns `error` (CLAUDE.md "Success signals" #5:
 * supabase-js resolves a Postgres error, it does not throw). `admin` is the
 * SB_SECRET_KEY_INTERNAL client.
 *
 * The Apple refresh token passes through stashAppleToken and appleToken and is
 * never logged or written anywhere but vault.
 */
import {
  APPLE_STATES,
  MAX_AUTH_DELETES_PER_RUN,
  type AppleRevoke,
  type AppleSettleResult,
  type DbError,
  type FinishDeps,
  type Stage,
  ledgerErrorText,
  parseAppleSettle,
  STAGES,
} from './account-deletion.ts';
import { deliverDeletionNotices } from './deletion-notices.ts';

// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * The error as the rest of the code may see it: a code and a status, NEVER the message. An
 * error message can interpolate an email, a user id, a token or an Apple payload, so it is
 * dropped here, at the source, and no log line or ledger write downstream can carry it.
 */
// deno-lint-ignore no-explicit-any
const dbErr = (e: any): DbError | null =>
  e ? { code: typeof e.code === 'string' ? e.code : undefined, status: typeof e.status === 'number' ? e.status : undefined } : null;

/** Reasons account_deletion_mark_done may refuse with; anything else is not forwarded. */
const MARK_DONE_REASONS = ['live_state', 'auth_user_exists', 'not_scrubbed', 'no_ledger'];

export interface OpenedLedger {
  stage: Stage;
  apple_revoke: AppleRevoke;
}

export interface LedgerDeps extends FinishDeps {
  /** account_deletion_open: an upsert that never moves the stage backwards. */
  openLedger(userId: string, hasApple: boolean): Promise<{ row: OpenedLedger | null; error: DbError | null }>;
  /** account_deletion_stash_apple_token: vault + 'pending', one transaction. */
  stashAppleToken(userId: string, refreshToken: string): Promise<AppleSettleResult>;
  /** account_deletion_apple_token: the vaulted refresh token, or null. */
  appleToken(userId: string): Promise<{ token: string | null; error: DbError | null }>;
  /** account_deletion_apple_revoked: drops the vault entry + 'done'. */
  appleRevoked(userId: string): Promise<AppleSettleResult>;
  /** account_deletion_apple_unrevoked: drops the vault entry + 'unrevoked'. */
  appleUnrevoked(userId: string): Promise<AppleSettleResult>;
  /** heal_account_deletions: the heal pass's SQL half. */
  heal(): Promise<{ data: unknown; error: DbError | null }>;
}

export function makeLedgerDeps(admin: Admin): LedgerDeps {
  const call = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    return { data, error: dbErr(error) };
  };

  return {
    async openLedger(userId, hasApple) {
      const { data, error } = await call('account_deletion_open', { p_user_id: userId, p_has_apple: hasApple });
      if (error) return { row: null, error };
      // Never trust a shape: an unexpected body is an error, not a stage.
      if (!data || !STAGES.includes(data.stage) || !APPLE_STATES.includes(data.apple_revoke)) {
        return { row: null, error: { message: 'account_deletion_open: unexpected result' } };
      }
      return { row: { stage: data.stage, apple_revoke: data.apple_revoke }, error: null };
    },

    async stashAppleToken(userId, refreshToken) {
      const { data, error } = await call('account_deletion_stash_apple_token', {
        p_user_id: userId,
        p_refresh_token: refreshToken,
      });
      return parseAppleSettle(data, error);
    },

    async appleToken(userId) {
      const { data, error } = await call('account_deletion_apple_token', { p_user_id: userId });
      const token = typeof data?.token === 'string' && data.token ? data.token : null;
      return { token, error };
    },

    async appleRevoked(userId) {
      const { data, error } = await call('account_deletion_apple_revoked', { p_user_id: userId });
      return parseAppleSettle(data, error);
    },

    async appleUnrevoked(userId) {
      const { data, error } = await call('account_deletion_apple_unrevoked', { p_user_id: userId });
      return parseAppleSettle(data, error);
    },

    scrub: (userId) => call('scrub_deleted_manager', { p_user_id: userId }),

    async deleteAuthUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      return { error: dbErr(error) };
    },

    async markDone(userId) {
      const { data, error } = await call('account_deletion_mark_done', { p_user_id: userId });
      return {
        stage: typeof data?.stage === 'string' ? data.stage : null,
        reason: MARK_DONE_REASONS.includes(data?.reason) ? data.reason : null,
        error,
      };
    },

    async recordError(userId, message) {
      try {
        const { error } = await call('account_deletion_fail', { p_user_id: userId, p_error: ledgerErrorText(message) });
        if (error) console.error('account_deletion_fail failed', error.code ?? '');
      } catch (e) {
        console.error('account_deletion_fail threw', e instanceof Error ? e.name : 'error');
      }
    },

    deliverNotices: (notices) => deliverDeletionNotices(admin, notices),

    // p_limit: the SQL returns at most this many rows per pass (oldest first), matching the
    // handler's own bound, so a real backlog drains in chunks instead of tripping it.
    heal: () => call('heal_account_deletions', { p_limit: MAX_AUTH_DELETES_PER_RUN }),
  };
}
