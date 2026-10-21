/**
 * Hermetic tests for delete-account's decision logic (run.ts). The world is an
 * in-memory ledger plus fakes for GoTrue, Apple and the RPCs, and every call is
 * recorded so a test can assert ORDER and ABSENCE ("nothing changed on bad_proof").
 *
 *   deno test supabase/functions/delete-account/run.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import type { AppleRevoke, AppleSettleResult, DbError, Stage } from '../_shared/account-deletion.ts';
import type { AppleCallResult, AppleExchangeResult } from '../_shared/apple-revoke.ts';
import {
  type Caller,
  type DeleteDeps,
  parseDeleteRequest,
  type ProofAttempt,
  type ProofSession,
  runDeleteAccount,
  toCaller,
  unverifiedJwtSub,
} from './run.ts';

const UID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const NOW_MS = Date.parse('2026-10-21T12:00:00Z');
const NOW_S = NOW_MS / 1000;

/** An unsigned JWT-shaped token (run.ts only pre-reads sub and iat; GoTrue verifies). */
function idToken(sub: string, iat: number | null = NOW_S - 30): string {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'RS256' })}.${enc({ sub, iss: 'x', ...(iat === null ? {} : { iat }) })}.sig`;
}

const emailCaller: Caller = { id: UID, email: 'a@example.com', identities: [{ provider: 'email', sub: UID }] };
const appleCaller: Caller = { id: UID, email: 'x@privaterelay.appleid.com', identities: [{ provider: 'apple', sub: 'apple-sub-1' }] };
const googleCaller: Caller = { id: UID, email: 'g@example.com', identities: [{ provider: 'google', sub: 'google-sub-1' }] };

const PASSWORD = { proof: { kind: 'password', password: 'right' } };
const APPLE = { proof: { kind: 'apple', identityToken: idToken('apple-sub-1'), authorizationCode: 'code-1', nonce: 'n' } };
const GOOGLE = { proof: { kind: 'google', idToken: idToken('google-sub-1') } };

class World implements DeleteDeps {
  calls: string[] = [];
  ledger = new Map<string, { stage: Stage; apple_revoke: AppleRevoke }>();
  failures = 0;
  authUsers = new Set([UID]);
  vault = new Map<string, string>();
  discarded = 0;

  // knobs
  rateOk = true;
  failureReadBroken = false;
  passwordOk = true;
  idTokenUser: string | null = UID;
  appleConfigured = true;
  exchange: AppleExchangeResult[] = [{ kind: 'ok', refreshToken: 'rt-1', sub: 'apple-sub-1' }];
  gotrue: 'ok' | 'refused' | 'unavailable' = 'ok';
  revoke: AppleCallResult = { kind: 'ok' };
  scrubError: DbError | null = null;
  authDeleteError: DbError | null = null;
  markDoneBroken = false;
  openBroken = false;

  private session(userId: string | null): ProofSession {
    return { userId, discard: () => { this.discarded++; this.calls.push('discard'); return Promise.resolve(); } };
  }
  private touch(uid: string, patch: Partial<{ stage: Stage; apple_revoke: AppleRevoke }>) {
    const r = this.ledger.get(uid);
    if (r) this.ledger.set(uid, { ...r, ...patch });
    return !!r;
  }
  seed(stage: Stage, apple: AppleRevoke = 'none') {
    this.ledger.set(UID, { stage, apple_revoke: apple });
  }

  rateLimitOk() { return Promise.resolve(this.rateOk); }
  proofFailureCount() { return Promise.resolve(this.failureReadBroken ? null : this.failures); }
  bumpProofFailure() { this.failures++; this.calls.push('bump'); return Promise.resolve(); }
  now() { return NOW_MS; }
  private attempt(userId: string | null, ok: boolean): ProofAttempt {
    if (this.gotrue === 'unavailable') return { kind: 'unavailable' };
    if (this.gotrue === 'refused' || !ok || userId === null) return { kind: 'refused' };
    return { kind: 'ok', session: this.session(userId) };
  }
  signInWithPassword(_e: string, p: string) {
    this.calls.push('signInWithPassword');
    return Promise.resolve(this.attempt(UID, this.passwordOk && p === 'right'));
  }
  signInWithIdToken(provider: string) {
    this.calls.push(`signInWithIdToken:${provider}`);
    return Promise.resolve(this.attempt(this.idTokenUser, this.idTokenUser !== null));
  }
  exchangeAppleCode() {
    this.calls.push('exchange');
    return Promise.resolve(this.exchange.length > 1 ? this.exchange.shift()! : this.exchange[0]);
  }
  revokeAppleToken() { this.calls.push('revoke'); return Promise.resolve(this.revoke); }
  openLedger(uid: string, hasApple: boolean) {
    this.calls.push('openLedger');
    if (this.openBroken) return Promise.resolve({ row: null, error: { message: 'boom' } });
    // account_deletion_open: insert-if-absent; an existing row keeps its stage and revoke.
    if (!this.ledger.has(uid)) this.ledger.set(uid, { stage: 'requested', apple_revoke: hasApple ? 'required' : 'none' });
    return Promise.resolve({ row: { ...this.ledger.get(uid)! }, error: null });
  }
  /**
   * W2's forward-only ledger (20261125000003): settle(outcome) is ok when the ledger already holds that
   * outcome; REFUSED 'backward' (with the ledger's current value) when it holds a different terminal one;
   * otherwise sets it. stash is refused 'backward' once the ledger is past 'pending'. A missing ledger
   * is refused 'no_ledger'. A refusal is DATA, not an error, exactly like the SQL.
   */
  private settle(uid: string, outcome: 'done' | 'unrevoked'): AppleSettleResult {
    const r = this.ledger.get(uid);
    if (!r) return { error: null, ok: false, reason: 'no_ledger', apple_revoke: null };
    if (r.apple_revoke === outcome) { this.vault.delete(`apple_revoke:${uid}`); return { error: null, ok: true, reason: null, apple_revoke: outcome }; }
    if (r.apple_revoke !== 'required' && r.apple_revoke !== 'pending') {
      return { error: null, ok: false, reason: 'backward', apple_revoke: r.apple_revoke };
    }
    this.vault.delete(`apple_revoke:${uid}`);
    r.apple_revoke = outcome;
    return { error: null, ok: true, reason: null, apple_revoke: outcome };
  }
  settleReply: AppleSettleResult | null = null; // force an odd reply (unreadable / no_ledger)
  stashAppleToken(uid: string, token: string): Promise<AppleSettleResult> {
    this.calls.push('stashAppleToken');
    if (this.settleReply) return Promise.resolve(this.settleReply);
    const r = this.ledger.get(uid);
    if (!r) return Promise.resolve({ error: null, ok: false, reason: 'no_ledger', apple_revoke: null });
    if (r.apple_revoke === 'done' || r.apple_revoke === 'unrevoked') {
      return Promise.resolve({ error: null, ok: false, reason: 'backward', apple_revoke: r.apple_revoke });
    }
    this.vault.set(`apple_revoke:${uid}`, token);
    r.apple_revoke = 'pending';
    return Promise.resolve({ error: null, ok: true, reason: null, apple_revoke: 'pending' });
  }
  appleRevoked(uid: string): Promise<AppleSettleResult> {
    this.calls.push('appleRevoked');
    return Promise.resolve(this.settleReply ?? this.settle(uid, 'done'));
  }
  appleUnrevoked(uid: string): Promise<AppleSettleResult> {
    this.calls.push('appleUnrevoked');
    return Promise.resolve(this.settleReply ?? this.settle(uid, 'unrevoked'));
  }
  scrub(uid: string) {
    this.calls.push('scrub');
    if (this.scrubError) return Promise.resolve({ data: null, error: this.scrubError });
    const r = this.ledger.get(uid);
    if (!r) return Promise.resolve({ data: { status: 'refused', reason: 'no_ledger' }, error: null });
    if (r.stage === 'requested') this.touch(uid, { stage: 'scrubbed' });
    return Promise.resolve({ data: { status: 'scrubbed', successions: [], left: [] }, error: null });
  }
  deleteAuthUser(uid: string) {
    this.calls.push('deleteAuthUser');
    if (this.authDeleteError) return Promise.resolve({ error: this.authDeleteError });
    if (!this.authUsers.delete(uid)) return Promise.resolve({ error: { status: 404, code: 'user_not_found' } });
    return Promise.resolve({ error: null });
  }
  markDone(uid: string) {
    this.calls.push('markDone');
    if (this.markDoneBroken) return Promise.resolve({ stage: null, error: { message: 'boom' } });
    // account_deletion_mark_done: only from 'scrubbed', and only once auth.users no longer has the id.
    const r = this.ledger.get(uid);
    if (r?.stage === 'scrubbed' && !this.authUsers.has(uid)) this.touch(uid, { stage: 'done' });
    return Promise.resolve({ stage: this.ledger.get(uid)?.stage ?? null, error: null });
  }
  recordError(_uid: string, m: string) { this.calls.push(`recordError:${m}`); return Promise.resolve(); }
  deliverNotices() { return Promise.resolve(); }

  /** Calls that change state anywhere (ledger, vault, Apple, Postgres, GoTrue). */
  mutations() {
    return this.calls.filter((c) =>
      /^(openLedger|stashAppleToken|appleRevoked|appleUnrevoked|scrub|deleteAuthUser|markDone|revoke)/.test(c)
    );
  }
}

async function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const o = { log: console.log, error: console.error };
  console.log = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, o); }
}
const run = (w: World, caller: Caller | null, body: unknown) => quiet(() => runDeleteAccount(w, caller, body));

// ---- parsing --------------------------------------------------------------------

Deno.test('parse: each proof kind, and anything malformed is null', () => {
  assertEquals(parseDeleteRequest(PASSWORD), { kind: 'password', password: 'right' });
  assertEquals(parseDeleteRequest(APPLE)?.kind, 'apple');
  assertEquals(parseDeleteRequest(GOOGLE), { kind: 'google', idToken: GOOGLE.proof.idToken, nonce: null });
  for (const bad of [
    null, {}, { proof: null }, { proof: { kind: 'magic' } }, { proof: { kind: 'password' } },
    { proof: { kind: 'password', password: '' } }, { proof: { kind: 'password', password: 7 } },
    { proof: { kind: 'apple', identityToken: 't', authorizationCode: 'c' } },
    { proof: { kind: 'google' } }, { proof: { kind: 'google', idToken: 't', nonce: 5 } },
    { proof: { kind: 'password', password: 'x'.repeat(9000) } },
    // the body never names the user: a user_id field changes nothing
  ]) assertEquals(parseDeleteRequest(bad), null, JSON.stringify(bad)?.slice(0, 80));
  assertEquals(parseDeleteRequest({ user_id: OTHER, ...PASSWORD }), { kind: 'password', password: 'right' });
});

Deno.test('unverifiedJwtSub reads sub, and garbage is null', () => {
  assertEquals(unverifiedJwtSub(idToken('abc')), 'abc');
  for (const t of ['', 'x', 'a.b.c', 'a..c']) assertEquals(unverifiedJwtSub(t), null);
});

// ---- happy paths, one per proof kind -------------------------------------------------

Deno.test('password: proof → ledger → scrub → auth delete → done, in that order', async () => {
  const w = new World();
  const r = await run(w, emailCaller, PASSWORD);
  assertEquals(r, { status: 200, body: { ok: true, stage: 'done', apple_revoke: 'none' } });
  assertEquals(w.mutations(), ['openLedger', 'scrub', 'deleteAuthUser', 'markDone']);
  assertEquals(w.ledger.get(UID)?.stage, 'done');
  assertFalse(w.authUsers.has(UID));
  assertEquals(w.discarded, 1, 'the proof session is discarded');
});

Deno.test('apple: exchange happens BEFORE the ledger opens; revoke settles done', async () => {
  const w = new World();
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'done' });
  assertEquals(w.calls.filter((c) => c !== 'discard'), [
    'signInWithIdToken:apple', 'exchange', 'openLedger', 'revoke', 'appleRevoked',
    'scrub', 'deleteAuthUser', 'markDone',
  ]);
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'done');
});

Deno.test('google: proof by id token, no Apple step', async () => {
  const w = new World();
  const r = await run(w, googleCaller, GOOGLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'none' });
  assert(w.calls.includes('signInWithIdToken:google'));
  assertFalse(w.calls.includes('exchange'));
});

// ---- proof refusals: nothing changes ---------------------------------------------

Deno.test('a wrong password → bad_proof, the failure is counted, nothing changes', async () => {
  const w = new World();
  const r = await run(w, emailCaller, { proof: { kind: 'password', password: 'wrong' } });
  assertEquals(r, { status: 200, body: { ok: false, reason: 'bad_proof' } });
  assertEquals(w.failures, 1);
  assertEquals(w.mutations(), []);
  assert(w.authUsers.has(UID));
});

Deno.test('an id token for SOMEONE ELSE is refused before GoTrue (no orphan account)', async () => {
  for (const [caller, body] of [
    [appleCaller, { proof: { ...APPLE.proof, identityToken: idToken('apple-sub-OTHER') } }],
    [googleCaller, { proof: { kind: 'google', idToken: idToken('google-sub-OTHER') } }],
  ] as const) {
    const w = new World();
    const r = await run(w, caller, body);
    assertEquals(r.body, { ok: false, reason: 'bad_proof' });
    assertFalse(w.calls.some((c) => c.startsWith('signInWithIdToken')), 'GoTrue must not see it');
    assertEquals(w.mutations(), []);
  }
});

Deno.test('a verified sign-in that resolves to a DIFFERENT user → bad_proof (mismatch)', async () => {
  const w = new World();
  w.idTokenUser = OTHER; // the pre-read sub matched, GoTrue said otherwise
  const r = await run(w, googleCaller, GOOGLE);
  assertEquals(r.body, { ok: false, reason: 'bad_proof' });
  assertEquals(w.discarded, 1, 'even a mismatched session is discarded');
  assertEquals(w.mutations(), []);
});

Deno.test('a proof kind the account does not have → bad_proof', async () => {
  const w = new World();
  // an email-only account proving with Google: no google identity to match
  assertEquals((await run(w, emailCaller, GOOGLE)).body, { ok: false, reason: 'bad_proof' });
  // an account with no email cannot prove by password
  const w2 = new World();
  assertEquals((await run(w2, { ...emailCaller, email: null }, PASSWORD)).body, { ok: false, reason: 'bad_proof' });
  assertFalse(w2.calls.includes('signInWithPassword'));
});

Deno.test('an Apple-linked account proving by password → apple_proof_required, not counted', async () => {
  const w = new World();
  const linked: Caller = { ...emailCaller, identities: [...emailCaller.identities, { provider: 'apple', sub: 'apple-sub-1' }] };
  const r = await run(w, linked, PASSWORD);
  assertEquals(r.body, { ok: false, reason: 'apple_proof_required' });
  assertEquals(w.failures, 0);
  assertEquals(w.calls, []);
});

Deno.test('missing APPLE_* secrets on an Apple account → server_config_error before any change', async () => {
  const w = new World();
  w.appleConfigured = false;
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.status, 500);
  assertEquals(r.body.reason, 'server_config_error');
  assertEquals(w.calls, []);
});

// ---- the rate limit -----------------------------------------------------------------

Deno.test('rate limit: the 5th failure locks the hour; the 6th try never reaches GoTrue', async () => {
  const w = new World();
  for (let i = 0; i < 5; i++) {
    assertEquals((await run(w, emailCaller, { proof: { kind: 'password', password: 'wrong' } })).body.reason, 'bad_proof');
  }
  const calls = w.calls.length;
  const r = await run(w, emailCaller, PASSWORD); // even the RIGHT password
  assertEquals(r, { status: 429, body: { ok: false, reason: 'rate_limited' } });
  assertEquals(w.calls.length, calls, 'no sign-in attempt after the lock');
});

Deno.test('rate limit: an unreadable failure counter fails CLOSED', async () => {
  const w = new World();
  w.failureReadBroken = true;
  const r = await run(w, emailCaller, PASSWORD);
  assertEquals(r.status, 500);
  assertEquals(w.calls, []);
});

Deno.test('rate limit: the per-minute limiter → 429 before parsing', async () => {
  const w = new World();
  w.rateOk = false;
  assertEquals((await run(w, emailCaller, PASSWORD)).status, 429);
  assertEquals(w.calls, []);
});

Deno.test('no caller → 401; bad body → 400', async () => {
  assertEquals((await run(new World(), null, PASSWORD)).status, 401);
  assertEquals((await run(new World(), emailCaller, { proof: { kind: 'x' } })).status, 400);
});

// ---- the Apple exchange: success / 4xx / 5xx ---------------------------------------

Deno.test('apple 4xx on the exchange → bad_proof and NO state change, ledger included', async () => {
  const w = new World();
  w.exchange = [{ kind: 'rejected', status: 400, error: 'invalid_grant' }];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: false, reason: 'bad_proof' });
  assertEquals(w.mutations(), []);
  assertFalse(w.ledger.has(UID), 'a ledger row here would make the heal delete the account');
  assertEquals(w.failures, 1);
});

Deno.test('apple invalid_client → server_config_error, not the user\'s bad proof, no change', async () => {
  const w = new World();
  w.exchange = [{ kind: 'config', status: 400 }];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body.reason, 'server_config_error');
  assertEquals(w.failures, 0);
  assertEquals(w.mutations(), []);
});

Deno.test('apple 5xx on the exchange (twice) → deletion still completes, apple_revoke unrevoked', async () => {
  const w = new World();
  w.exchange = [{ kind: 'unavailable', status: 503 }, { kind: 'unavailable', status: 503 }];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' });
  assertEquals(w.calls.filter((c) => c === 'exchange').length, 2);
  assertFalse(w.calls.includes('revoke'));
});

Deno.test('apple 5xx once then ok → the quick retry revokes', async () => {
  const w = new World();
  w.exchange = [{ kind: 'unavailable', status: 502 }, { kind: 'ok', refreshToken: 'rt-2', sub: 'apple-sub-1' }];
  assertEquals((await run(w, appleCaller, APPLE)).body.apple_revoke, 'done');
});

Deno.test('apple revoke down → token to vault, ledger pending, deletion CONTINUES; ok stays separate', async () => {
  const w = new World();
  w.revoke = { kind: 'unavailable', status: 500 };
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'pending' });
  assertEquals(w.vault.get(`apple_revoke:${UID}`), 'rt-1');
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'pending');
  assertFalse(w.authUsers.has(UID));
});

// ---- stage resume ---------------------------------------------------------------------

Deno.test('resume: a retry after a scrub failure re-enters at requested and finishes', async () => {
  const w = new World();
  w.scrubError = { message: 'deadlock', code: '40P01' };
  const first = await run(w, emailCaller, PASSWORD);
  assertEquals(first, { status: 500, body: { ok: false, reason: 'scrub_failed', stage: 'requested' } });
  assert(w.authUsers.has(UID), 'no auth delete before the scrub committed');

  w.scrubError = null;
  w.calls = [];
  const second = await run(w, emailCaller, PASSWORD);
  assertEquals(second.body, { ok: true, stage: 'done', apple_revoke: 'none' });
  assertEquals(w.mutations(), ['openLedger', 'scrub', 'deleteAuthUser', 'markDone']);
});

Deno.test('resume: a retry after an auth-delete failure skips the scrub', async () => {
  const w = new World();
  w.authDeleteError = { status: 500, code: 'unexpected_failure' };
  assertEquals((await run(w, emailCaller, PASSWORD)).body, { ok: false, reason: 'auth_delete_failed', stage: 'scrubbed' });
  w.authDeleteError = null;
  w.calls = [];
  assertEquals((await run(w, emailCaller, PASSWORD)).body.ok, true);
  assertEquals(w.mutations(), ['openLedger', 'deleteAuthUser', 'markDone']);
});

Deno.test('resume: the ledger opening never moves a stage backwards', async () => {
  const w = new World();
  w.seed('scrubbed');
  await run(w, emailCaller, PASSWORD);
  assertFalse(w.calls.includes('scrub'));
  assertEquals(w.ledger.get(UID)?.stage, 'done');
});

const linkedCaller: Caller = {
  ...emailCaller,
  identities: [...emailCaller.identities, { provider: 'apple', sub: 'apple-sub-1' }],
};

Deno.test('resume: an Apple-linked account needs an Apple proof on EVERY request, a settled ledger included', async () => {
  const w = new World();
  w.seed('scrubbed', 'pending'); // a previous attempt stashed a token, then died at the auth delete
  assertEquals((await run(w, linkedCaller, PASSWORD)).body, { ok: false, reason: 'apple_proof_required' });
  assertEquals(w.calls, [], 'the refusal changes nothing');
  // With a fresh code the retry revokes (replacing the stale vault entry) and finishes.
  w.vault.set(`apple_revoke:${UID}`, 'stale-token');
  const r = await run(w, linkedCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'done' });
  assertFalse(w.vault.has(`apple_revoke:${UID}`), 'a revoked token leaves vault');
  assertFalse(w.calls.includes('scrub'), 'the stage was kept: no second scrub');
});

Deno.test('resume: a request that died at apple_revoke=required finishes with a fresh Apple proof', async () => {
  const w = new World();
  w.seed('requested', 'required');
  assertEquals((await run(w, linkedCaller, APPLE)).body, { ok: true, stage: 'done', apple_revoke: 'done' });
});

Deno.test('a revoke Apple answers 4xx can never succeed → unrevoked, not parked in vault', async () => {
  const w = new World();
  w.revoke = { kind: 'rejected', status: 400, error: 'invalid_request' };
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' });
  assertEquals(w.vault.size, 0);
});

Deno.test('auth user already gone (404) counts as done', async () => {
  const w = new World();
  w.authUsers.clear();
  assertEquals((await run(w, emailCaller, PASSWORD)).body.ok, true);
});

Deno.test('ok ONLY at done: mark_done erroring → ok:false', async () => {
  const w = new World();
  w.markDoneBroken = true;
  const r = await run(w, emailCaller, PASSWORD);
  assertEquals(r, { status: 500, body: { ok: false, reason: 'ledger_failed', stage: 'scrubbed' } });
});

Deno.test('mark_done refusing (the auth user is still there) → ok:false, never ok', async () => {
  const w = new World();
  // GoTrue claims success but the user remains: the database verifies the effect.
  w.deleteAuthUser = (_uid: string) => { w.calls.push('deleteAuthUser'); return Promise.resolve({ error: null }); };
  const r = await run(w, emailCaller, PASSWORD);
  assertEquals(r, { status: 500, body: { ok: false, reason: 'ledger_failed', stage: 'scrubbed' } });
  assertEquals(w.ledger.get(UID)?.stage, 'scrubbed');
});

Deno.test('a scrub that refuses (no_ledger, any status but scrubbed) is a failure, and is recorded', async () => {
  const w = new World();
  w.scrub = (_uid: string) => {
    w.calls.push('scrub');
    return Promise.resolve({ data: { status: 'refused', reason: 'no_ledger' }, error: null });
  };
  const r = await run(w, emailCaller, PASSWORD);
  assertEquals(r.body, { ok: false, reason: 'scrub_failed', stage: 'requested' });
  assert(w.calls.some((c) => c.startsWith('recordError:scrub: refused')));
  assert(w.authUsers.has(UID));
});

Deno.test('a failed ledger open → 500 and nothing after it runs', async () => {
  const w = new World();
  w.openBroken = true;
  assertEquals((await run(w, emailCaller, PASSWORD)).status, 500);
  assertEquals(w.mutations(), ['openLedger']);
});

// ---- security review fixes (W3 review, 2026-10-21) -------------------------------

Deno.test('a STALE id token → proof_expired: refused before GoTrue, NOT counted, nothing changes', async () => {
  for (const [caller, mk] of [
    [appleCaller, (iat: number | null) => ({ proof: { ...APPLE.proof, identityToken: idToken('apple-sub-1', iat) } })],
    [googleCaller, (iat: number | null) => ({ proof: { kind: 'google', idToken: idToken('google-sub-1', iat) } })],
  ] as const) {
    for (const iat of [NOW_S - 601, NOW_S - 86_400]) {
      const w = new World();
      const r = await run(w, caller, mk(iat));
      assertEquals(r, { status: 200, body: { ok: false, reason: 'proof_expired' } }, `iat=${iat}`);
      assertEquals(w.failures, 0, 'sitting on the alert is not a failed proof');
      assertFalse(w.calls.some((c) => c.startsWith('signInWithIdToken')), 'GoTrue must not see it');
      assertEquals(w.mutations(), []);
    }
    // just inside the window is fine
    const w = new World();
    assertEquals((await run(w, caller, mk(NOW_S - 599))).body.ok, true);
  }
});

Deno.test('an UNDATED id token is a bad_proof (counted): no provider issues one', async () => {
  const w = new World();
  const r = await run(w, googleCaller, { proof: { kind: 'google', idToken: idToken('google-sub-1', null) } });
  assertEquals(r.body, { ok: false, reason: 'bad_proof' });
  assertEquals(w.failures, 1);
  assertEquals(w.mutations(), []);
});

Deno.test('GoTrue unavailable (5xx/429/network) → 503 try_again: NOT bad_proof, budget untouched, nothing changes', async () => {
  for (const [caller, body] of [[emailCaller, PASSWORD], [appleCaller, APPLE], [googleCaller, GOOGLE]] as const) {
    const w = new World();
    w.gotrue = 'unavailable';
    const r = await run(w, caller, body);
    assertEquals(r, { status: 503, body: { ok: false, reason: 'try_again' } });
    assertEquals(w.failures, 0, 'an outage must not burn the 5-an-hour budget');
    assertEquals(w.mutations(), []);
  }
});

Deno.test('GoTrue refusing the credential is still bad_proof and counts', async () => {
  const w = new World();
  w.gotrue = 'refused';
  assertEquals((await run(w, emailCaller, PASSWORD)).body, { ok: false, reason: 'bad_proof' });
  assertEquals(w.failures, 1);
});

Deno.test('the Apple code is bound to the identity: a code issued to ANOTHER Apple user → bad_proof, no change', async () => {
  const w = new World();
  w.exchange = [{ kind: 'ok', refreshToken: 'rt-OTHER', sub: 'apple-sub-VICTIM' }];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: false, reason: 'bad_proof' });
  assertFalse(w.calls.includes('revoke'), 'must never revoke a grant that is not the caller\'s');
  assertEquals(w.mutations(), []);
  assertEquals(w.failures, 1);
});

Deno.test('an exchange response with no id_token cannot be bound → refused, no change', async () => {
  const w = new World();
  w.exchange = [{ kind: 'ok', refreshToken: 'rt-1', sub: null }];
  assertEquals((await run(w, appleCaller, APPLE)).body, { ok: false, reason: 'bad_proof' });
  assertEquals(w.mutations(), []);
});

Deno.test('exchange retry: only after a 5xx Apple answered, never after a timeout (the code may be spent)', async () => {
  const w = new World();
  w.exchange = [{ kind: 'unavailable', status: null }, { kind: 'ok', refreshToken: 'rt-2', sub: 'apple-sub-1' }];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(w.calls.filter((c) => c === 'exchange').length, 1, 'no retry on a timeout');
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' });
});

Deno.test('exchange retry: not after a 200 that lacked a refresh token (the code may be spent), yes after a 429', async () => {
  const spent = new World();
  spent.exchange = [{ kind: 'unavailable', status: 200 }, { kind: 'ok', refreshToken: 'rt-2', sub: 'apple-sub-1' }];
  await run(spent, appleCaller, APPLE);
  assertEquals(spent.calls.filter((c) => c === 'exchange').length, 1);

  const limited = new World();
  limited.exchange = [{ kind: 'unavailable', status: 429 }, { kind: 'ok', refreshToken: 'rt-2', sub: 'apple-sub-1' }];
  assertEquals((await run(limited, appleCaller, APPLE)).body.apple_revoke, 'done');
  assertEquals(limited.calls.filter((c) => c === 'exchange').length, 2);
});

Deno.test('an email or token inside an error never reaches a log or the recorded last_error', async () => {
  const w = new World();
  w.scrubError = { message: 'user a@example.com token eyJabc.def.ghi failed', code: 'a@example.com' };
  const lines: string[] = [];
  const o = { error: console.error, log: console.log };
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = () => {};
  try { await runDeleteAccount(w, emailCaller, PASSWORD); } finally { Object.assign(console, o); }
  const recorded = w.calls.filter((c) => c.startsWith('recordError:')).join('\n');
  for (const text of [lines.join('\n'), recorded]) {
    assertFalse(text.includes('@'), text);
    assertFalse(text.includes('eyJ'), text);
  }
  assertEquals(recorded, 'recordError:scrub: error');
});

Deno.test('step failures log the error CODE only, never a message that could carry an id', async () => {
  const w = new World();
  w.scrubError = { message: `deadlock on user ${UID}`, code: '40P01' };
  const lines: string[] = [];
  const o = { error: console.error, log: console.log };
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = () => {};
  try { await runDeleteAccount(w, emailCaller, PASSWORD); } finally { Object.assign(console, o); }
  const recorded = w.calls.filter((c) => c.startsWith('recordError:')).join('\n');
  for (const text of [lines.join('\n'), recorded]) assertFalse(text.includes(UID), 'no user id in logs or last_error');
  assert(recorded.includes('40P01'));
});

// ---- the proof order is enforced by the SERVER (plan decision 10) ----------------------------

const googleOnly: Caller = { id: UID, email: 'g@example.com', identities: [{ provider: 'google', sub: 'google-sub-1' }] };
const googleAndEmail: Caller = {
  id: UID, email: 'g@example.com',
  identities: [{ provider: 'email', sub: UID }, { provider: 'google', sub: 'google-sub-1' }],
};
const appleAndGoogle: Caller = {
  id: UID, email: 'x@example.com',
  identities: [{ provider: 'apple', sub: 'apple-sub-1' }, { provider: 'google', sub: 'google-sub-1' }],
};

Deno.test('a Google account CANNOT prove by password (a stolen session can set one): google_proof_required, nothing counted or changed', async () => {
  for (const caller of [googleOnly, googleAndEmail]) {
    const w = new World();
    const r = await run(w, caller, PASSWORD);
    assertEquals(r, { status: 200, body: { ok: false, reason: 'google_proof_required' } });
    assertEquals(w.calls, [], 'refused before any sign-in attempt');
    assertEquals(w.failures, 0);
    assert(w.authUsers.has(UID));
  }
});

Deno.test('a Google account proves with Google, and only Google', async () => {
  const w = new World();
  assertEquals((await run(w, googleOnly, GOOGLE)).body.ok, true);
  // an Apple proof for an account with no Apple identity is also not a Google proof
  const w2 = new World();
  const apple = { proof: { kind: 'apple', identityToken: idToken('apple-sub-1'), authorizationCode: 'c', nonce: 'n' } };
  assertEquals((await run(w2, googleOnly, apple)).body, { ok: false, reason: 'google_proof_required' });
  assertEquals(w2.calls, []);
});

Deno.test('an Apple identity outranks Google: Apple is required, and a Google proof is refused with apple_proof_required', async () => {
  const w = new World();
  assertEquals((await run(w, appleAndGoogle, GOOGLE)).body, { ok: false, reason: 'apple_proof_required' });
  assertEquals((await run(w, appleAndGoogle, PASSWORD)).body, { ok: false, reason: 'apple_proof_required' });
  assertEquals(w.calls, []);
  const w2 = new World();
  assertEquals((await run(w2, appleAndGoogle, APPLE)).body.ok, true);
});

Deno.test('a password proof is accepted ONLY when the account has neither Apple nor Google', async () => {
  assertEquals((await run(new World(), emailCaller, PASSWORD)).body.ok, true);
  for (const caller of [googleOnly, googleAndEmail, appleAndGoogle, appleCaller]) {
    const r = await run(new World(), caller, PASSWORD);
    assertEquals(r.body.ok, false);
    assert(r.body.reason === 'google_proof_required' || r.body.reason === 'apple_proof_required');
  }
});

// ---- a refused Apple settle is a REFUSAL, never a success (the ledger is the truth) -------------

Deno.test('THE LOSS PATH: attempt 1 settled unrevoked then the scrub failed; on the retry the revoke 5xxs, the stash is REFUSED (backward) and the response reports the LEDGER\'s value, not "pending"', async () => {
  const w = new World();
  // attempt 1: Apple unreachable for the exchange (twice) -> unrevoked; then the scrub fails
  w.exchange = [{ kind: 'unavailable', status: 503 }, { kind: 'unavailable', status: 503 }];
  w.scrubError = { message: 'deadlock', code: '40P01' };
  assertEquals((await run(w, appleCaller, APPLE)).body, { ok: false, reason: 'scrub_failed', stage: 'requested' });
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'unrevoked');
  // attempt 2: the exchange works, the revoke 5xxs, so the code stashes the token...
  w.scrubError = null;
  w.exchange = [{ kind: 'ok', refreshToken: 'rt-2', sub: 'apple-sub-1' }];
  w.revoke = { kind: 'unavailable', status: 500 };
  const r = await run(w, appleCaller, APPLE);
  assert(w.calls.includes('stashAppleToken'));
  // ... the SQL refuses it (the ledger is already terminal), and the response says what the LEDGER says
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' });
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'unrevoked');
  assertEquals(w.vault.size, 0, 'nothing was stashed, so nothing may be reported as pending');
});

Deno.test('the reported apple_revoke is the ledger\'s reply even when Apple said ok but the ledger already holds another terminal value', async () => {
  const w = new World();
  w.seed('requested', 'unrevoked'); // an earlier attempt settled it
  const r = await run(w, appleCaller, APPLE); // this time the exchange and the revoke both work
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' }, 'never the local "done"');
});

Deno.test('a settle refused no_ledger, or answered in a shape we cannot read, is a FAULT: nothing is reported, the deletion is not claimed', async () => {
  for (const reply of [
    { error: null, ok: false, reason: 'no_ledger', apple_revoke: null },
    { error: null, ok: false, reason: 'unexpected', apple_revoke: null },
    { error: null, ok: true, reason: null, apple_revoke: null }, // "ok" with no value is not a value
    // a no_ledger refusal that ALSO carries a ledger value is still a refusal: only 'backward' may be reported
    { error: null, ok: false, reason: 'no_ledger', apple_revoke: 'done' },
    { error: null, ok: false, reason: 'unexpected', apple_revoke: 'done' },
  ] as AppleSettleResult[]) {
    const w = new World();
    w.settleReply = reply;
    const r = await run(w, appleCaller, APPLE);
    assertEquals(r.status, 500, JSON.stringify(reply));
    assertEquals(r.body.reason, 'unhandled');
    assertFalse(w.calls.includes('scrub'), 'the scrub does not run behind an unreadable settle');
  }
});

Deno.test('a settle that RESOLVED with an error is a fault, and it is the ERROR path that reports it (its code is logged)', async () => {
  const w = new World();
  w.settleReply = { error: { code: 'XX000' }, ok: false, reason: null, apple_revoke: null };
  const lines: string[] = [];
  const o = { error: console.error, log: console.log };
  console.error = (...a: unknown[]) => lines.push(a.map(String).join(' '));
  console.log = () => {};
  let r;
  try { r = await runDeleteAccount(w, appleCaller, APPLE); } finally { Object.assign(console, o); }
  assertEquals(r.status, 500);
  assert(lines.some((l) => l.includes('apple settle failed') && l.includes('XX000')), lines.join(' | '));
  assertFalse(lines.some((l) => l.includes('refused')), 'an error is not reported as a refusal');
});

// ---- the password proof is an ALLOW-LIST ---------------------------------------------------------

Deno.test('a password proof needs at least one identity and ONLY email identities: anything else is proof_not_supported, uncounted and unchanged', async () => {
  const mk = (identities: Caller['identities']): Caller => ({ id: UID, email: 'a@example.com', identities });
  for (const identities of [
    [],                                                                   // no identities at all (anonymous / unreadable list)
    [{ provider: 'github', sub: 'g1' }],                                  // a provider this app does not use
    [{ provider: 'email', sub: UID }, { provider: 'github', sub: 'g1' }], // email PLUS an unknown provider
    [{ provider: 'custom:acme', sub: 'c1' }],
    [{ provider: '', sub: null }],
  ]) {
    const w = new World();
    const r = await run(w, mk(identities), PASSWORD);
    assertEquals(r, { status: 200, body: { ok: false, reason: 'proof_not_supported' } }, JSON.stringify(identities));
    assertEquals(w.calls, [], 'refused before any sign-in');
    assertEquals(w.failures, 0);
  }
  // the only accepted shape
  assertEquals((await run(new World(), mk([{ provider: 'email', sub: UID }]), PASSWORD)).body.ok, true);
  assertEquals((await run(new World(), mk([{ provider: 'email', sub: UID }, { provider: 'email', sub: UID }]), PASSWORD)).body.ok, true);
});

Deno.test('toCaller: identities come from the verified user; a missing, empty or odd list is safe', () => {
  assertEquals(
    toCaller({
      id: UID, email: 'a@example.com',
      identities: [
        { provider: 'google', id: 'row-id', identity_data: { sub: 'google-sub-1' } },
        { provider: 'apple', id: 'apple-row' },            // no identity_data: falls back to the row id
        { provider: 'email', id: UID, identity_data: { sub: 5 } }, // a non-string sub is not used
        null,
      ],
    }),
    {
      id: UID, email: 'a@example.com',
      identities: [
        { provider: 'google', sub: 'google-sub-1' },
        { provider: 'apple', sub: 'apple-row' },
        { provider: 'email', sub: UID },
        { provider: '', sub: null },
      ],
    },
  );
  assertEquals(toCaller({ id: UID }), { id: UID, email: null, identities: [] });
  assertEquals(toCaller({ id: UID, email: '', identities: 'nope' }), { id: UID, email: null, identities: [] });
  assertEquals(toCaller({ id: UID, email: 5, identities: null }).email, null);
  // an empty list means the password allow-list refuses it (above): no identity is never "email only"
});

// ---- Apple settle edges ---------------------------------------------------------------------------

Deno.test('a vaulted token is NOT dropped when the exchange is down on a retry: the ledger stays pending and the heal retries it', async () => {
  const w = new World();
  // attempt 1: exchange ok, revoke 5xx -> the token is stashed ('pending', in vault); then the scrub fails
  w.revoke = { kind: 'unavailable', status: 500 };
  w.scrubError = { message: 'deadlock', code: '40P01' };
  assertEquals((await run(w, appleCaller, APPLE)).body, { ok: false, reason: 'scrub_failed', stage: 'requested' });
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'pending');
  assertEquals(w.vault.get(`apple_revoke:${UID}`), 'rt-1');
  // attempt 2: Apple's exchange is down (twice), so there is no fresh token
  w.scrubError = null;
  w.exchange = [{ kind: 'unavailable', status: 503 }, { kind: 'unavailable', status: 503 }];
  w.calls = [];
  const r = await run(w, appleCaller, APPLE);
  assertEquals(r.body, { ok: true, stage: 'done', apple_revoke: 'pending' }, 'what the ledger holds');
  assertFalse(w.calls.includes('appleUnrevoked'), 'settling unrevoked would DROP the token the heal can still revoke');
  assertEquals(w.ledger.get(UID)?.apple_revoke, 'pending');
  assertEquals(w.vault.get(`apple_revoke:${UID}`), 'rt-1', 'the vaulted token survives');
});

Deno.test("…but with NOTHING vaulted (ledger 'required') an exchange outage still settles unrevoked, as before", async () => {
  const w = new World();
  w.exchange = [{ kind: 'unavailable', status: 503 }, { kind: 'unavailable', status: 503 }];
  assertEquals((await run(w, appleCaller, APPLE)).body, { ok: true, stage: 'done', apple_revoke: 'unrevoked' });
  assert(w.calls.includes('appleUnrevoked'));
});

Deno.test("'backward' is only the earlier attempt's TERMINAL value: backward with 'none' (or any non-terminal value) is a fault", async () => {
  for (const apple_revoke of ['none', 'required', 'pending', null] as const) {
    const w = new World();
    w.settleReply = { error: null, ok: false, reason: 'backward', apple_revoke };
    const r = await run(w, appleCaller, APPLE);
    assertEquals(r.status, 500, String(apple_revoke));
    assertFalse(w.calls.includes('scrub'));
  }
  for (const apple_revoke of ['done', 'unrevoked'] as const) {
    const w = new World();
    w.settleReply = { error: null, ok: false, reason: 'backward', apple_revoke };
    const r = await run(w, appleCaller, APPLE);
    assertEquals(r.body, { ok: true, stage: 'done', apple_revoke });
  }
});

Deno.test('no_ledger on EVERY settle path (revoked, unrevoked after a 4xx, unrevoked after an outage, stash) is a fault before the scrub', async () => {
  const noLedger: AppleSettleResult = { error: null, ok: false, reason: 'no_ledger', apple_revoke: null };
  const scenarios: Array<[string, (w: World) => void, string]> = [
    ['revoke ok -> appleRevoked', () => {}, 'appleRevoked'],
    ['revoke 4xx -> appleUnrevoked', (w) => { w.revoke = { kind: 'rejected', status: 400, error: 'invalid_request' }; }, 'appleUnrevoked'],
    ['revoke down -> stashAppleToken', (w) => { w.revoke = { kind: 'unavailable', status: 500 }; }, 'stashAppleToken'],
    ['exchange down -> appleUnrevoked', (w) => { w.exchange = [{ kind: 'unavailable', status: 503 }, { kind: 'unavailable', status: 503 }]; }, 'appleUnrevoked'],
  ];
  for (const [name, setup, expectedCall] of scenarios) {
    const w = new World();
    setup(w);
    w.settleReply = noLedger;
    const r = await run(w, appleCaller, APPLE);
    assertEquals(r.status, 500, name);
    assert(w.calls.includes(expectedCall), `${name}: expected ${expectedCall}, got ${w.calls.join(',')}`);
    assertFalse(w.calls.includes('scrub'), name);
  }
});
