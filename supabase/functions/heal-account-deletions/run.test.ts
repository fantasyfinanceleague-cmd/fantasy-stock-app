/**
 * Hermetic tests for the heal pass (run.ts). The world is an in-memory ledger plus
 * fakes for W2's SQL (heal_account_deletions, the vault/ledger functions), GoTrue
 * and Apple, so the claims below are verified BY DATA (the ledger reaching 'done',
 * the vault emptying), not by a status string or a response code.
 *
 *   deno test supabase/functions/heal-account-deletions/run.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { type AppleRevoke, type AppleSettleResult, type DbError, scrubNotices, type Stage } from '../_shared/account-deletion.ts';
import { deletionNoticeMessage } from '../_shared/deletion-notices.ts';
import type { AppleCallResult } from '../_shared/apple-revoke.ts';
import { type HealDeps, MAX_AUTH_DELETES_PER_RUN, runHeal, UNREVOKED_LOG_LINE } from './run.ts';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

interface Row { stage: Stage; apple_revoke: AppleRevoke }

class World implements HealDeps {
  ledger = new Map<string, Row>();
  authUsers = new Set<string>();
  vault = new Map<string, string>();
  calls: string[] = [];
  appleConfigured = true;
  revoke: AppleCallResult = { kind: 'ok' };
  authDeleteError: DbError | null = null;
  healError: DbError | null = null;
  scrubErrors = 0;
  /** ids W2's SQL gave up on this pass (stale 'required' etc.) */
  sqlUnrevoked: string[] = [];

  add(id: string, stage: Stage, apple: AppleRevoke = 'none', opts: { authUser?: boolean; vault?: string } = {}) {
    this.ledger.set(id, { stage, apple_revoke: apple });
    if (opts.authUser !== false) this.authUsers.add(id);
    if (opts.vault) this.vault.set(id, opts.vault);
  }

  /**
   * Models heal_account_deletions in W2's REAL shape (20261125000007): scrubbed = [ids],
   * scrub_results = [bodies], scrub_errors = [{ user_id, error }], purged = an integer.
   */
  heal(): Promise<{ data: unknown; error: DbError | null }> {
    this.calls.push('heal');
    if (this.healError) return Promise.resolve({ data: null, error: this.healError });
    const scrubbed: string[] = [];
    for (const [id, r] of this.ledger) if (r.stage === 'requested') { r.stage = 'scrubbed'; scrubbed.push(id); }
    const auth_delete = [...this.ledger].filter(([, r]) => r.stage === 'scrubbed').map(([id]) => id);
    const apple_pending = [...this.ledger].filter(([, r]) => r.apple_revoke === 'pending').map(([id]) => id);
    return Promise.resolve({
      data: {
        scrubbed,
        scrub_results: [],
        // each entry holds a user id and error TEXT (which can carry anything): the handler must never log it
        scrub_errors: Array.from({ length: this.scrubErrors }, () => ({ user_id: A, error: `boom for ${A} a@example.com` })),
        auth_delete,
        apple_pending,
        apple_unrevoked: this.sqlUnrevoked,
        purged: 0,
      },
      error: null,
    });
  }
  appleToken(id: string) {
    this.calls.push(`appleToken:${id}`);
    return Promise.resolve({ token: this.vault.get(id) ?? null, error: null });
  }
  revokeAppleToken(_t: string) { this.calls.push('revoke'); return Promise.resolve(this.revoke); }
  /** a forced reply from the settle functions (a REFUSAL is data, like W2's SQL: { status:'refused', reason }) */
  settleRefusal: AppleSettleResult | null = null;
  private settle(id: string, outcome: 'done' | 'unrevoked'): Promise<AppleSettleResult> {
    if (this.settleRefusal) return Promise.resolve(this.settleRefusal); // refused: the vault entry is NOT dropped
    this.vault.delete(id);
    const r = this.ledger.get(id); if (r) r.apple_revoke = outcome;
    return Promise.resolve({ error: null, ok: true, reason: null, apple_revoke: outcome });
  }
  appleRevoked(id: string) { return this.settle(id, 'done'); }
  appleUnrevoked(id: string) { return this.settle(id, 'unrevoked'); }
  hashId(id: string) { return Promise.resolve(`h-${id.slice(0, 2)}`); }

  // FinishDeps (the heal only uses deleteAuthUser / markDone / recordError)
  scrub() { return Promise.reject(new Error('the heal never calls scrub itself: heal_account_deletions does')); }
  deleteAuthUser(id: string) {
    this.calls.push(`deleteAuthUser:${id}`);
    if (this.authDeleteError) return Promise.resolve({ error: this.authDeleteError });
    if (!this.authUsers.delete(id)) return Promise.resolve({ error: { status: 404, code: 'user_not_found' } });
    return Promise.resolve({ error: null });
  }
  markDone(id: string) {
    const r = this.ledger.get(id);
    if (r?.stage === 'scrubbed' && !this.authUsers.has(id)) r.stage = 'done';
    return Promise.resolve({ stage: r?.stage ?? null, error: null });
  }
  recordError(_id: string, m: string) { this.calls.push(`recordError:${m}`); return Promise.resolve(); }
  delivered: string[] = [];
  deliverNotices(n: { id: string }[]) { this.delivered.push(...n.map((x) => x.id)); return Promise.resolve(); }
}

async function quiet<T>(fn: () => Promise<T>): Promise<{ out: T; errors: string[] }> {
  const errors: string[] = [];
  const o = { log: console.log, error: console.error };
  console.log = () => {};
  console.error = (...a: unknown[]) => errors.push(a.map(String).join(' '));
  try { return { out: await fn(), errors }; } finally { Object.assign(console, o); }
}
const run = async (w: World) => (await quiet(() => runHeal(w))).out;

// ---- every interrupted stage reaches 'done' on the next pass (BY DATA) ----------

Deno.test('a row interrupted at requested, scrubbed, and scrubbed-with-auth-already-gone all reach done', async () => {
  const w = new World();
  w.add(A, 'requested');
  w.add(B, 'scrubbed');
  w.add(C, 'scrubbed', 'none', { authUser: false }); // deleteUser landed, mark_done never ran
  const r = await run(w);
  for (const id of [A, B, C]) assertEquals(w.ledger.get(id)?.stage, 'done', id);
  assertEquals([...w.authUsers], [], 'no auth user is left behind');
  assertEquals(r.outcome.status, 'success');
  assertEquals(r.outcome.work, 1 + 3, 'one scrubbed + three auth deletions');
  assertEquals(r.response.body.ok, true);
});

Deno.test('the second pass finds nothing to do (idempotent) and records success with work 0', async () => {
  const w = new World();
  w.add(A, 'requested');
  await run(w);
  const second = await run(w);
  assertEquals(second.outcome, { status: 'success', attempt: 1, message: second.outcome.message, work: 0 });
  assertEquals(w.ledger.get(A)?.stage, 'done');
});

Deno.test('one failing deletion does not stop the others, and the run is FAILED not success', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  w.add(B, 'scrubbed');
  const del = w.deleteAuthUser.bind(w);
  w.deleteAuthUser = (id: string) => id === A ? Promise.resolve({ error: { status: 500, code: 'unexpected_failure' } }) : del(id);
  const r = await run(w);
  assertEquals(w.ledger.get(B)?.stage, 'done', 'B is not held hostage by A');
  assertEquals(w.ledger.get(A)?.stage, 'scrubbed', 'A stays recoverable, not marked done');
  assertEquals(r.outcome.status, 'failed');
  assert(r.outcome.message!.includes('auth_failed=1'));
  assertEquals(r.response.body.ok, false);
  assert(w.calls.some((c) => c.startsWith('recordError:auth delete')));
});

Deno.test('mark_done refusing because the auth user is still present is a failure, never counted as healed', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  w.deleteAuthUser = (_id: string) => Promise.resolve({ error: null }); // claims success, user remains
  const r = await run(w);
  assertEquals(w.ledger.get(A)?.stage, 'scrubbed');
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.auth_deleted, 0);
});

Deno.test('scrub errors reported by the SQL pass make the run failed', async () => {
  const w = new World();
  w.scrubErrors = 2;
  const r = await run(w);
  assertEquals(r.outcome.status, 'failed');
  assert(r.outcome.message!.includes('scrub_errors=2'));
});

Deno.test('scrub_errors is W2\'s ARRAY: each entry counts as a failure and its text/ids are never logged or put in the job message', async () => {
  const w = new World();
  w.scrubErrors = 3;
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.scrub_errors, 3);
  assert(r.outcome.message!.includes('scrub_errors=3'));
  for (const text of [r.outcome.message!, errors.join('\n'), JSON.stringify(r.response.body)]) {
    assertFalse(text.includes(A), 'no user id');
    assertFalse(text.includes('@'), 'no error text');
  }
});

Deno.test('the scrubbed count is the LENGTH of W2\'s id array, not a number read off it', async () => {
  const w = new World();
  w.add(A, 'requested');
  w.add(B, 'requested');
  const r = await run(w);
  assertEquals(r.response.body.scrubbed, 2);
  assertEquals(r.outcome.work, 2 + 2, 'two scrubbed + two auth deletions');
});

Deno.test('SHAPE DRIFT fails the run loudly, never reads as zero (a number where W2 sends an array, a missing key, a wrong type)', async () => {
  const good = { scrubbed: [], scrub_results: [], scrub_errors: [], auth_delete: [], apple_pending: [], apple_unrevoked: [], purged: 0 };
  assertEquals((await runWith(good)).outcome.status, 'success');
  const drifted: Array<Record<string, unknown>> = [
    { ...good, scrub_errors: 2 },          // the exact bug: a count where an array is sent
    { ...good, scrubbed: 1 },
    { ...good, auth_delete: 'x' },
    { ...good, apple_unrevoked: {} },
    { ...good, scrub_results: null },
    { ...good, purged: '0' },
    { ...good, purged: 1.5 },
    { ...good, purged: undefined },
    { ...good, apple_pending: undefined },
  ];
  for (const d of drifted) {
    const r = await runWith(d);
    assertEquals(r.outcome.status, 'failed', JSON.stringify(d));
    assertEquals(r.response.status, 500);
    assertEquals(r.outcome.message, 'heal_account_deletions failed (unexpected result)');
  }
  for (const nonObject of [null, [], 'ok', 5]) assertEquals((await runWith(nonObject)).outcome.status, 'failed');
});

async function runWith(data: unknown) {
  const w = new World();
  w.heal = () => Promise.resolve({ data, error: null });
  return await run(w);
}

Deno.test('a failed or malformed heal RPC is a 500 failed, never "nothing to heal"', async () => {
  const w = new World();
  w.healError = { code: '42883', message: 'function does not exist' };
  const r = await run(w);
  assertEquals(r.response.status, 500);
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.outcome.message, 'heal_account_deletions failed 42883');
  const w2 = new World();
  w2.heal = () => Promise.resolve({ data: null, error: null });
  assertEquals((await run(w2)).outcome.status, 'failed');
});

// ---- Apple retries ------------------------------------------------------------------

Deno.test('a pending revoke is retried from vault: success settles done and DROPS the vault entry', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  const r = await run(w);
  assertEquals(w.ledger.get(A)?.apple_revoke, 'done');
  assertFalse(w.vault.has(A), 'the refresh token is deleted once revoked');
  assertEquals(r.response.body.apple_revoked, 1);
  assertEquals(r.outcome.status, 'success');
});

Deno.test("a 'backward' refusal with a TERMINAL value is a benign race (counted apart, run NOT failed); it is still never counted as revoked/unrevoked", async () => {
  for (const kind of ['ok', 'rejected'] as const) {
    for (const apple_revoke of ['done', 'unrevoked'] as const) {
      const w = new World();
      w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
      w.revoke = kind === 'ok' ? { kind: 'ok' } : { kind: 'rejected', status: 400, error: 'invalid_grant' };
      w.settleRefusal = { error: null, ok: false, reason: 'backward', apple_revoke };
      const r = await run(w);
      assertEquals(r.response.body.apple_raced, 1, `${kind}/${apple_revoke}`);
      assertEquals(r.response.body.apple_errors, 0, `${kind}/${apple_revoke}`);
      assertEquals(r.response.body.apple_revoked, 0);
      assertEquals(r.response.body.apple_unrevoked, 0);
      assertEquals(r.outcome.status, 'success', 'a race that left the row settled must not fail the run');
    }
  }
});

Deno.test("any OTHER refusal is a real failure: no_ledger, backward with a non-terminal value, an unreadable reply, an error", async () => {
  const refusals: AppleSettleResult[] = [
    { error: null, ok: false, reason: 'no_ledger', apple_revoke: null },
    { error: null, ok: false, reason: 'backward', apple_revoke: 'none' },
    { error: null, ok: false, reason: 'backward', apple_revoke: null },
    { error: null, ok: false, reason: 'unexpected', apple_revoke: null },
    { error: { code: 'XX000' }, ok: false, reason: null, apple_revoke: null },
  ];
  for (const kind of ['ok', 'rejected'] as const) {
    for (const refusal of refusals) {
      const w = new World();
      w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
      w.revoke = kind === 'ok' ? { kind: 'ok' } : { kind: 'rejected', status: 400, error: 'invalid_grant' };
      w.settleRefusal = refusal;
      const r = await run(w);
      assertEquals(r.outcome.status, 'failed', `${kind}/${JSON.stringify(refusal)}`);
      assertEquals(r.response.body.apple_errors, 1);
      assertEquals(r.response.body.apple_raced, 0);
      assertEquals(w.vault.get(A), 'rt-1', 'a refusal leaves the vault entry alone (and visible)');
    }
  }
});

Deno.test('a pending row with no vault token whose settle is REFUSED (no_ledger) is an error, not "unrevoked"', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false });
  w.settleRefusal = { error: null, ok: false, reason: 'no_ledger', apple_revoke: null };
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(r.response.body.apple_errors, 1);
  assertEquals(r.response.body.apple_unrevoked, 0);
  assertFalse(errors.some((e) => e.startsWith(UNREVOKED_LOG_LINE)), 'no "unrevoked" claim for a settle that did not happen');
});

Deno.test('Apple still down: the revoke stays pending with its token, the run is NOT failed (it will retry next hour)', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  w.revoke = { kind: 'unavailable', status: 503 };
  const r = await run(w);
  assertEquals(w.ledger.get(A)?.apple_revoke, 'pending');
  assertEquals(w.vault.get(A), 'rt-1');
  assertEquals(r.response.body.apple_retry, 1);
  assertEquals(r.outcome.status, 'success');
});

Deno.test('Apple answering 4xx on a held token settles unrevoked, drops the token, and logs the constant line with a hash', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  w.revoke = { kind: 'rejected', status: 400, error: 'invalid_grant' };
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(w.ledger.get(A)?.apple_revoke, 'unrevoked');
  assertFalse(w.vault.has(A));
  const line = errors.find((e) => e.startsWith(UNREVOKED_LOG_LINE));
  assert(line, 'a stuck revoke must be visible in the logs');
  assert(line!.endsWith('h-aa'), 'hash only');
  assertFalse(errors.join('\n').includes(A), 'never the user id');
  assertFalse(errors.join('\n').includes('rt-1'), 'never the token');
  assertEquals(r.response.body.apple_unrevoked, 1);
});

Deno.test('Apple invalid_client (OUR .p8 is wrong or expired) is a FAILURE, not a quiet retry; the row and token stay', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  w.revoke = { kind: 'config', status: 400 };
  const r = await run(w);
  assertEquals(r.outcome.status, 'failed', 'an expired key must not read as a healthy hourly run');
  assert(r.outcome.message!.includes('apple_errors=1'));
  assertEquals(w.ledger.get(A)?.apple_revoke, 'pending');
  assertEquals(w.vault.get(A), 'rt-1');
});

Deno.test('a pending row with NO vault entry can never be retried: settled unrevoked, loudly', async () => {
  const w = new World();
  w.add(A, 'done', 'pending', { authUser: false });
  const { errors } = await quiet(() => runHeal(w));
  assertEquals(w.ledger.get(A)?.apple_revoke, 'unrevoked');
  assert(errors.some((e) => e.startsWith(UNREVOKED_LOG_LINE)));
});

Deno.test('revokes the SQL side gave up on (stale required, expired retries) are logged, not silently dropped', async () => {
  const w = new World();
  w.sqlUnrevoked = [B, C];
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(errors.filter((e) => e.startsWith(UNREVOKED_LOG_LINE)).length, 2);
  assertEquals(r.response.body.apple_unrevoked, 2);
});

Deno.test('missing APPLE_* secrets: pending rows are NOT dropped, and the run is failed so someone notices', async () => {
  const w = new World();
  w.appleConfigured = false;
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  const r = await run(w);
  assertEquals(w.ledger.get(A)?.apple_revoke, 'pending');
  assertEquals(w.vault.get(A), 'rt-1');
  assertFalse(w.calls.includes('revoke'));
  assertEquals(r.outcome.status, 'failed');
});

Deno.test('the heal never logs ids or tokens in its job message', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  w.authDeleteError = { status: 500, code: 'x' };
  const r = await run(w);
  const m = r.outcome.message!;
  for (const needle of [A, 'rt-']) assertFalse(m.includes(needle));
});

Deno.test('notices from the scrubs the SQL pass ran are delivered by the heal (nothing else would push them)', async () => {
  const w = new World();
  w.heal = () => Promise.resolve({
    data: {
      scrubbed: [L1, L2], scrub_errors: [], auth_delete: [], apple_pending: [], apple_unrevoked: [], purged: 0,
      scrub_results: [
        { status: 'scrubbed', successions: [{ league_id: 'L1', recipient: 'u2', league_name: 'A', notice_id: 'n1' }], left: [] },
        { status: 'scrubbed', successions: [], left: [{ league_id: 'L2', notify_user_id: 'u3', league_name: 'B', notice_id: 'n2' }] },
        'junk',
      ],
    },
    error: null,
  });
  const r = await run(w);
  assertEquals(w.delivered, ['n1', 'n2']);
  assertEquals(r.outcome.status, 'success');
});

Deno.test("mark_done refusing with 'live_state' leaves the row recoverable: failed this pass, never done, reason logged without ids", async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  w.markDone = (_id: string) => Promise.resolve({ stage: 'scrubbed', reason: 'live_state', error: null });
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(w.ledger.get(A)?.stage, 'scrubbed');
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.auth_failed, 1);
  const line = errors.find((e) => e.startsWith('account deletion: mark done'));
  assert(line?.includes('reason=live_state'), String(line));
  assert(w.calls.includes('recordError:mark done: live_state'), 'the row must say why it is stuck: ' + w.calls.join(' | '));
  assertFalse(errors.join('\n').includes(A));
});

Deno.test('a re-scrub that did something: its notices are delivered, and the user is still deleted this pass', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  const real = w.heal.bind(w);
  w.heal = async () => {
    const out = await real();
    (out.data as Record<string, unknown>).scrub_results = [
      { status: 'scrubbed', successions: [{ league_id: L1, recipient: 'u2', league_name: 'Alpha', notice_id: 'n-resc' }], left: [] },
    ];
    return out;
  };
  const r = await run(w);
  assertEquals(w.delivered, ['n-resc']);
  assertEquals(w.ledger.get(A)?.stage, 'done');
  assertEquals(r.outcome.status, 'success');
});

// ---- the auth-delete list is not taken on the SQL's word alone ------------------------

const manyIds = (n: number) => Array.from({ length: n }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

Deno.test('ANY non-uuid entry makes the whole delete loop refused (judged on the RAW list, not on what survives)', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  const real = w.heal.bind(w);
  w.heal = async () => {
    const out = await real();
    (out.data as { auth_delete: unknown[] }).auth_delete.push('not-a-uuid', '', 42, null, "'; drop table x; --");
    return out;
  };
  const r = await run(w);
  assertEquals(w.calls.filter((c) => c.startsWith('deleteAuthUser:')), [], 'a corrupt list deletes nothing, not even its valid ids');
  assertEquals(w.ledger.get(A)?.stage, 'scrubbed');
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.reason, 'auth_delete_refused');
  assertEquals(r.response.body.auth_refused, 6);
});

Deno.test('a list holding a non-uuid STRING (not just non-strings) refuses the whole delete loop', async () => {
  const w = new World();
  w.add(A, 'scrubbed');
  const real = w.heal.bind(w);
  w.heal = async () => {
    const out = await real();
    (out.data as { auth_delete: unknown[] }).auth_delete.push('not-a-uuid');
    return out;
  };
  const r = await run(w);
  assertEquals(w.calls.filter((c) => c.startsWith('deleteAuthUser:')), []);
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.auth_refused, 2);
});

Deno.test('a list over the per-run bound is refused WHOLE: nothing deleted, the run fails for a human to look', async () => {
  const w = new World();
  const many = manyIds(MAX_AUTH_DELETES_PER_RUN + 1);
  for (const id of many) w.add(id, 'scrubbed');
  const r = await run(w);
  assertEquals(w.calls.filter((c) => c.startsWith('deleteAuthUser:')), [], 'a buggy list must not mass-delete');
  assertEquals(r.outcome.status, 'failed');
  assertEquals(r.response.body.reason, 'auth_delete_refused');
  assertEquals(w.authUsers.size, many.length);
  // exactly at the bound is fine
  const w2 = new World();
  for (const id of many.slice(0, MAX_AUTH_DELETES_PER_RUN)) w2.add(id, 'scrubbed');
  assertEquals((await run(w2)).outcome.status, 'success');
  assertEquals(w2.authUsers.size, 0);
});

Deno.test('a refused delete list does NOT skip the Apple half: retries run, one-shot unrevoked ids are still logged', async () => {
  const w = new World();
  for (const id of manyIds(MAX_AUTH_DELETES_PER_RUN + 1)) w.add(id, 'scrubbed');
  w.add(A, 'done', 'pending', { authUser: false, vault: 'rt-1' });
  w.sqlUnrevoked = [B];
  const { out: r, errors } = await quiet(() => runHeal(w));
  assertEquals(r.outcome.status, 'failed');
  assertEquals(w.ledger.get(A)?.apple_revoke, 'done', 'the pending revoke was still retried');
  assertFalse(w.vault.has(A));
  assert(errors.some((e) => e.startsWith(UNREVOKED_LOG_LINE)), 'the one-shot report was still logged');
  assertEquals(r.response.body.apple_revoked, 1);
});

Deno.test('the heal asks the SQL for at most the per-run bound (so a real backlog drains in chunks)', async () => {
  const { makeLedgerDeps } = await import('../_shared/account-deletion-db.ts');
  const seen: unknown[] = [];
  // deno-lint-ignore no-explicit-any
  const admin: any = { rpc: (fn: string, args: unknown) => { seen.push({ fn, args }); return Promise.resolve({ data: {}, error: null }); } };
  await makeLedgerDeps(admin).heal();
  assertEquals(seen, [{ fn: 'heal_account_deletions', args: { p_limit: MAX_AUTH_DELETES_PER_RUN } }]);
});

// ---- the notice shapes the scrub returns -----------------------------------------

const L1 = '11111111-1111-4111-8111-111111111111';
const L2 = '22222222-2222-4222-8222-222222222222';
const L3 = '33333333-3333-4333-8333-333333333333';

Deno.test('scrubNotices reads successions and left, skips entries with no notice id, and ignores junk', () => {
  const n = scrubNotices({
    status: 'scrubbed',
    successions: [
      { league_id: L1, new_commissioner: 'u2', recipient: 'u2', league_name: 'Alpha', notice_id: 'n1' },
      { league_id: L2, recipient: 'u3', notice_id: null },
      'junk',
    ],
    left: [{ league_id: L3, notice_id: 'n3', notify_user_id: 'u9', league_name: null }],
    leagues_deleted: ['L4'],
    seats_marked: ['L5'],
  });
  assertEquals(n, [
    { id: 'n1', kind: 'commissioner_transferred', recipient: 'u2', league_id: L1, league_name: 'Alpha' },
    { id: 'n3', kind: 'member_left', recipient: 'u9', league_id: L3, league_name: null },
  ]);
  // a league id that is not a uuid is dropped to null, never forwarded into a push payload
  assertEquals(
    scrubNotices({ successions: [{ recipient: 'u2', league_id: 'x"><', notice_id: 'n8' }] })[0].league_id,
    null,
  );
  // a notice with no league id is still delivered (it just cannot deep-link)
  assertEquals(
    scrubNotices({ successions: [{ recipient: 'u2', league_name: 'A', notice_id: 'n9' }] }),
    [{ id: 'n9', kind: 'commissioner_transferred', recipient: 'u2', league_id: null, league_name: 'A' }],
  );
  assertEquals(scrubNotices(null), []);
  assertEquals(scrubNotices({ status: 'scrubbed' }), []);
});

Deno.test('the push copy for a deletion notice survives a missing league id, and never names anyone', () => {
  const base = { id: 'n1', recipient: 'u2', league_id: null, league_name: 'Alpha' } as const;
  const succ = deletionNoticeMessage({ ...base, kind: 'commissioner_transferred' })!;
  assertEquals(succ.data, { type: 'commissioner_transferred', league_id: null });
  assertEquals(succ.body, "You're now the commissioner of Alpha.");
  const left = deletionNoticeMessage({ ...base, kind: 'member_left', league_name: null })!;
  assertEquals(left.title, 'your league');
  assertEquals(left.data, { type: 'member_left', league_id: null });
});
