/**
 * Hermetic tests for account-deletion-db.ts: what may reach a log or the deletion ledger
 * (account_deletion_fail's last_error, which people read). An error MESSAGE can carry an
 * email, a user id, a token or an Apple payload, so only codes and a closed vocabulary pass.
 *   deno test supabase/functions/_shared/account-deletion-db.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { ledgerErrorText, parseAppleSettle, safeCode } from './account-deletion.ts';
import { makeLedgerDeps } from './account-deletion-db.ts';

const EMAIL = 'person@example.com';
// Assembled at runtime so no key-shaped literal sits in the source (a fake JWT, three dot-joined segments).
const TOKEN = ['eyJ' + 'hbGciOiJFUzI1NiJ9', 'eyJ' + 'zdWIiOiJ4In0', 'sig'].join('.');
const APPLE = 'rt.1234abcd.apple-refresh-token';

// deno-lint-ignore no-explicit-any
const adminWith = (result: { data?: any; error?: any }, calls: Array<[string, any]> = []): any => ({
  rpc: (fn: string, args: unknown) => { calls.push([fn, args]); return Promise.resolve({ data: result.data ?? null, error: result.error ?? null }); },
  auth: { admin: { deleteUser: () => Promise.resolve({ error: result.error ?? null }) } },
});

Deno.test('safeCode: a short identifier passes; a message-like or hostile code collapses to "error"', () => {
  assertEquals(safeCode({ code: '40P01' }), '40P01');
  assertEquals(safeCode({ code: 'user_not_found' }), 'user_not_found');
  assertEquals(safeCode({ status: 500 }), '500');
  const UUID = '11111111-2222-4333-8444-555555555555';
  for (const code of [EMAIL, TOKEN, TOKEN + ' ', APPLE, `user ${EMAIL}`, 'x'.repeat(41), '', 'a b', UUID, UUID.replaceAll('-', ''), 'a'.repeat(32), 'deadbeef'.repeat(4)]) {
    assertEquals(safeCode({ code }), 'error', code);
  }
  assertEquals(safeCode(null), 'error');
});

Deno.test('ledgerErrorText: only "<step>: <code>" shapes pass; an email, token or payload becomes "unexpected"', () => {
  assertEquals(ledgerErrorText('scrub: 40P01'), 'scrub: 40P01');
  assertEquals(ledgerErrorText('auth delete: 500'), 'auth delete: 500');
  assertEquals(ledgerErrorText('scrub: refused'), 'scrub: refused');
  assertEquals(ledgerErrorText('mark done: live_state'), 'mark done: live_state');
  for (const bad of [
    `scrub: ${EMAIL}`, `auth delete: ${TOKEN}`, `scrub: ${APPLE} extra`, `deadlock on user ${EMAIL}`,
    `scrub: 40P01 ${EMAIL}`, '', 'anything else', `apple: ${APPLE}`, 'scrub: ' + 'x'.repeat(60),
    'apple: invalid_grant', 'password: wrong', 'anything: 40P01', 'Scrub: 40P01', 'scrub:  40P01', 'scrub: 40P01\nextra',
    'scrub: 11111111-2222-4333-8444-555555555555', 'auth delete: ' + 'ab12'.repeat(8), 'mark done: ' + EMAIL,
  ]) {
    assertEquals(ledgerErrorText(bad), 'unexpected', bad);
  }
});

Deno.test('recordError: the ledger write carries ONLY the closed vocabulary, whatever the caller passes', async () => {
  const calls: Array<[string, { p_error: string }]> = [];
  const deps = makeLedgerDeps(adminWith({}, calls));
  await deps.recordError('u1', `scrub: ${EMAIL}`);
  await deps.recordError('u1', `${TOKEN} ${APPLE}`);
  await deps.recordError('u1', 'scrub: 40P01');
  assertEquals(calls.map((c) => c[0]), ['account_deletion_fail', 'account_deletion_fail', 'account_deletion_fail']);
  assertEquals(calls.map((c) => c[1].p_error), ['unexpected', 'unexpected', 'scrub: 40P01']);
  const all = JSON.stringify(calls);
  for (const secret of [EMAIL, TOKEN, APPLE]) assertFalse(all.includes(secret));
});

Deno.test('every error that leaves the adapter has NO message (it is dropped at the source)', async () => {
  const noisy = { message: `boom for ${EMAIL} with ${TOKEN}`, code: '40P01', status: 409, details: `Key (id)=(${EMAIL})` };
  const d = makeLedgerDeps(adminWith({ error: noisy }));
  const results = [
    (await d.openLedger('u', false)).error,
    (await d.stashAppleToken('u', APPLE)).error,
    (await d.appleToken('u')).error,
    (await d.appleRevoked('u')).error,
    (await d.appleUnrevoked('u')).error,
    (await d.scrub('u')).error,
    (await d.markDone('u')).error,
    (await d.deleteAuthUser('u')).error,
    (await d.heal()).error,
  ];
  for (const e of results) {
    assert(e, 'the error is still reported');
    assertEquals(Object.keys(e!).sort().filter((k) => k !== 'code' && k !== 'status'), []);
    assertFalse(JSON.stringify(e).includes('@') || JSON.stringify(e).includes('eyJ'));
    assertEquals(e!.code, '40P01');
  }
});

Deno.test('markDone: reports the stage and a WHITELISTED reason (live_state); anything else is null', async () => {
  const mk = (data: unknown) => makeLedgerDeps(adminWith({ data })).markDone('u');
  assertEquals(await mk({ stage: 'done' }), { stage: 'done', reason: null, error: null });
  assertEquals(await mk({ stage: 'scrubbed', reason: 'live_state' }), { stage: 'scrubbed', reason: 'live_state', error: null });
  assertEquals((await mk({ stage: 'scrubbed', reason: `leak ${EMAIL}` })).reason, null);
  assertEquals((await mk(null)).stage, null);
});

Deno.test('openLedger: never trusts a shape (an unexpected stage or revoke state is an error)', async () => {
  const mk = (data: unknown) => makeLedgerDeps(adminWith({ data })).openLedger('u', true);
  assertEquals((await mk({ stage: 'requested', apple_revoke: 'required' })).row, { stage: 'requested', apple_revoke: 'required' });
  for (const bad of [null, {}, { stage: 'weird', apple_revoke: 'none' }, { stage: 'done', apple_revoke: 'weird' }]) {
    const r = await mk(bad);
    assertEquals(r.row, null);
    assert(r.error);
  }
});

// ---- the Apple settle replies (data, not errors) ------------------------------------------------

Deno.test('parseAppleSettle: ok only for status ok WITH a ledger value; a refusal is a refusal with the ledger\'s value', () => {
  assertEquals(parseAppleSettle({ status: 'ok', apple_revoke: 'done' }, null), { error: null, ok: true, reason: null, apple_revoke: 'done' });
  assertEquals(parseAppleSettle({ status: 'ok', apple_revoke: 'pending' }, null).ok, true);
  assertEquals(parseAppleSettle({ status: 'refused', reason: 'backward', apple_revoke: 'unrevoked' }, null),
    { error: null, ok: false, reason: 'backward', apple_revoke: 'unrevoked' });
  assertEquals(parseAppleSettle({ status: 'refused', reason: 'no_ledger' }, null),
    { error: null, ok: false, reason: 'no_ledger', apple_revoke: null });
});

Deno.test('parseAppleSettle: anything else (no status, an unknown reason or value, junk) is "unexpected", never ok', () => {
  for (const bad of [
    null, undefined, 5, 'ok', [], {}, { status: 'ok' }, { status: 'ok', apple_revoke: 'weird' },
    { status: 'maybe', apple_revoke: 'done' }, { status: 'refused', reason: 'surprise', apple_revoke: 'done' },
    { ok: true, apple_revoke: 'done' },
  ]) {
    const r = parseAppleSettle(bad, null);
    assertEquals(r.ok, false, JSON.stringify(bad));
    assertEquals(r.reason, 'unexpected', JSON.stringify(bad));
  }
  // an unknown reason can never be forwarded as 'backward' / 'no_ledger'
  assertEquals(parseAppleSettle({ status: 'ok', reason: 'backward' }, null).reason, 'unexpected');
});

Deno.test('parseAppleSettle: a resolved error wins, and carries no data', () => {
  const e = { code: '40P01' };
  assertEquals(parseAppleSettle({ status: 'ok', apple_revoke: 'done' }, e), { error: e, ok: false, reason: null, apple_revoke: null });
});

Deno.test('the three Apple adapters pass the SQL reply through parseAppleSettle (a refusal surfaces as ok:false)', async () => {
  const refused = { status: 'refused', reason: 'backward', apple_revoke: 'done' };
  const d = makeLedgerDeps(adminWith({ data: refused }));
  for (const r of [await d.stashAppleToken('u', APPLE), await d.appleRevoked('u'), await d.appleUnrevoked('u')]) {
    assertEquals(r, { error: null, ok: false, reason: 'backward', apple_revoke: 'done' });
  }
  const okd = makeLedgerDeps(adminWith({ data: { status: 'ok', apple_revoke: 'done' } }));
  assertEquals((await okd.appleRevoked('u')).ok, true);
});
