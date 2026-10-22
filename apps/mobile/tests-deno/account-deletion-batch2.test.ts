/**
 * Account deletion, W4 — the security review's batch (Orchestrator, 2026-10-21): ending the session when signOut
 * fails on the wire, only `user_not_found` meaning "gone", spent proofs/passwords, a scheme-origin takeover link
 * waiting for a tap, and the DEV fixture never sending a real request.
 *
 *   cd apps/mobile/tests-deno && deno test -R account-deletion-batch2.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { endSessionCore, type EndSessionDeps } from '../lib/account/endSessionCore.ts';
import { forceSignedOut, subscribeForcedSignOut } from '../lib/account/forcedSignOut.ts';
import { AUTH_STORAGE_KEY, verifierKey } from '../lib/auth/verifierSlot.ts';
import { activeLeagueStorageKey } from '../lib/shell/activeLeague.ts';
import { accountCheckFromGetUser } from '../lib/account/deleteRun.ts';
import { applyOutcome, askConfirm, confirmDelete, initialDeleteState, setProof } from '../lib/account/deleteFlow.ts';
import { FIND_LEAGUE } from '../lib/account/deleteCopy.ts';
import { createPendingTakeover, parsePersistedTakeover } from '../lib/invite/pendingTakeover.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const src = (p: string) => strip(SOURCES[p]);
const CODE = 'QX7P4KM3AB';

// ── P2-a: signOut resolves { error }; the session must still end ────────────

function deps(over: Partial<EndSessionDeps> = {}) {
  const log: string[] = [];
  const d: EndSessionDeps = {
    signOutLocal: () => { log.push('signOut'); return Promise.resolve({ error: null }); },
    removeItem: (k) => { log.push(`remove:${k}`); return Promise.resolve(); },
    forceSignedOut: () => { log.push('forced'); },
    clearPendingTakeover: () => { log.push('clearTakeover'); return Promise.resolve(); },
    clearPendingInvite: () => { log.push('clearInvite'); return Promise.resolve(); },
    signOutOfGoogle: () => { log.push('google'); return Promise.resolve(); },
    userId: 'u-1',
    ...over,
  };
  return { d, log };
}

Deno.test('end session: a clean signOut removes nothing by hand and publishes nothing', async () => {
  const { d, log } = deps();
  assertEquals(await endSessionCore(d), { forced: false });
  assertFalse(log.includes('forced'));
  assertFalse(log.some((l) => l === `remove:${AUTH_STORAGE_KEY}`));
});

Deno.test('end session: signOut RESOLVING {error} (a network blip) removes the stored session + verifier slot and publishes signed-out', async () => {
  const { d, log } = deps({ signOutLocal: () => Promise.resolve({ error: { message: 'fetch failed', status: 0 } }) });
  assertEquals(await endSessionCore(d), { forced: true });
  assert(log.includes(`remove:${AUTH_STORAGE_KEY}`));
  assert(log.includes(`remove:${verifierKey()}`));
  assert(log.includes('forced'));
  assertEquals(AUTH_STORAGE_KEY, 'fantasy-finance-auth');
  assertEquals(verifierKey(), 'fantasy-finance-auth-code-verifier');
});

Deno.test('end session: a THROWN signOut is the same as an error', async () => {
  const { d, log } = deps({ signOutLocal: () => Promise.reject(new Error('boom')) });
  assertEquals((await endSessionCore(d)).forced, true);
  assert(log.includes('forced'));
});

Deno.test('end session: the leaver\'s pending takeover, pending invite, per-user active league and Google account all go, whatever signOut did', async () => {
  for (const out of [{ error: null }, { error: { message: 'x' } }]) {
    const { d, log } = deps({ signOutLocal: () => Promise.resolve(out) });
    await endSessionCore(d);
    for (const want of ['clearTakeover', 'clearInvite', `remove:${activeLeagueStorageKey('u-1')}`, 'google']) assert(log.includes(want), want);
  }
  const { d, log } = deps({ userId: null });
  await endSessionCore(d);
  assertFalse(log.some((l) => l.startsWith('remove:sp.activeLeague')), 'no league key without a user id');
});

Deno.test('end session: one failing step never stops the rest (best effort)', async () => {
  const { d, log } = deps({
    signOutLocal: () => Promise.resolve({ error: 1 }),
    removeItem: () => Promise.reject(new Error('storage')),
    clearPendingTakeover: () => Promise.reject(new Error('x')),
  });
  await endSessionCore(d);
  assert(log.includes('forced') && log.includes('clearInvite') && log.includes('google'));
});

Deno.test('forced sign-out: subscribers hear it once, and unsubscribe', () => {
  let n = 0;
  const off = subscribeForcedSignOut(() => n++);
  forceSignedOut();
  off();
  forceSignedOut();
  assertEquals(n, 1);
});

Deno.test('end session wiring: the real binding checks the signOut result, publishes through the provider, and passes the user id', () => {
  const end = src('lib/account/endSession.ts');
  assert(end.includes("signOutLocal: () => supabase.auth.signOut({ scope: 'local' })"));
  assert(end.includes('forceSignedOut,'));
  assert(src('lib/SessionProvider.tsx').includes('subscribeForcedSignOut('));
  const del = src('app/delete-account.tsx');
  assert(del.includes('endSessionAfterDeletion(meIdRef.current || null)'), 'the id is read at send time, so a late-hydrating user still clears their active-league key');
  assert(del.includes('meIdRef.current = meId;'));
  assertFalse(/endSessionAfterDeletion\(meId\b/.test(del), 'never the value captured at first render');
  assert(src('app/takeover.tsx').includes('[view, code, refresh, setActiveLeagueId, settle]'));
  const core = src('lib/account/endSessionCore.ts');
  assert(core.includes("'error' in r && r.error"), 'the resolved error is READ, not just awaited');
});

// ── P2-b: ONLY user_not_found is gone ───────────────────────────────────────

Deno.test('re-check: only user_not_found means gone; session_not_found, bad_jwt, bare 403/404 and network errors are unknown', () => {
  assertEquals(accountCheckFromGetUser({ error: { status: 403, code: 'user_not_found' } }), 'gone');
  assertEquals(accountCheckFromGetUser({ error: { code: 'user_not_found' } }), 'gone');
  for (const e of [{ status: 403, code: 'session_not_found' }, { status: 401, code: 'bad_jwt' }, { status: 403 }, { status: 404 }, { status: 401 }, { status: 500 }, {}, { code: 'unexpected_failure' }]) {
    assertEquals(accountCheckFromGetUser({ error: e }), 'unknown', JSON.stringify(e));
  }
  assertEquals(accountCheckFromGetUser({ data: { user: { id: 'u' } }, error: null }), 'exists');
});

// ── P3: spent proofs / passwords ────────────────────────────────────────────

Deno.test('spent: a deletion clears the proof and its stamp; the screen clears the password after every answer', () => {
  const pw = { kind: 'password', password: 'hunter2hunter2' } as const;
  const sending = confirmDelete(askConfirm(setProof(initialDeleteState('password'), pw, 5))).state;
  const done = applyOutcome(sending, { kind: 'deleted' });
  assertEquals([done.phase, done.proof, done.proofAt], ['done', null, null]);
  const screen = src('app/delete-account.tsx');
  const after = screen.slice(screen.indexOf('const outcome = await deleteAccount(body, proofAt);'));
  assert(after.indexOf("setPassword('')") > 0 && after.indexOf("setPassword('')") < after.indexOf("if (outcome.kind !== 'deleted') return;"));
});

// ── P3: DEV fixture never sends ─────────────────────────────────────────────

Deno.test('DEV fixture: with DELETE_FIXTURE set the delete-account call is never made', () => {
  const api = src('lib/account/accountApi.ts');
  const invoke = api.slice(api.indexOf('invoke: (body) =>'));
  assert(invoke.indexOf('DELETE_FIXTURE ?') > 0 && invoke.indexOf('DELETE_FIXTURE ?') < invoke.indexOf("seamInvoke('delete-account'"));
  assert(api.includes("import { DELETE_FIXTURE } from '../shell/captureDev'"));
});

// ── P3: a scheme-origin takeover link waits for a tap ───────────────────────

function store(init: string | null = null) {
  let value = init;
  const s = createPendingTakeover({ storage: { get: () => Promise.resolve(value), set: (v) => { value = v; return Promise.resolve(); }, remove: () => { value = null; return Promise.resolve(); } }, now: () => 1_000_000 });
  return { s, read: () => value };
}

Deno.test('takeover origin: https is kept, everything else is scheme (the weaker, tap-requiring origin)', async () => {
  const a = store();
  a.s.capture(CODE, 'https');
  assertEquals(a.s.getSnapshot().origin, 'https');
  a.s.capture(CODE);
  assertEquals(a.s.getSnapshot().origin, 'scheme', 'the default is the weaker origin');
  a.s.capture(CODE, 'https');
  await new Promise((r) => setTimeout(r, 0));
  const b = store(a.read());
  await b.s.load();
  assertEquals(b.s.getSnapshot().origin, 'https', 'persisted and restored');
  for (const bad of ['HTTPS', 'http', 'yes', 1, null, undefined]) {
    assertEquals(parsePersistedTakeover(JSON.stringify({ v: 1, code: CODE, capturedAt: 1_000_000, ownerUserId: null, origin: bad }), 1_000_000)?.origin, 'scheme', String(bad));
  }
  assertEquals(parsePersistedTakeover(JSON.stringify({ v: 1, code: CODE, capturedAt: 1_000_000, ownerUserId: null }), 1_000_000)?.origin, 'scheme', 'a record with no origin can never upgrade itself');
});

Deno.test('takeover origin wiring: native-intent passes the parsed origin; the landing previews by itself ONLY for https and otherwise waits for the tap; no code is the dead view', () => {
  assert(src('app/+native-intent.tsx').includes('pendingTakeover.capture(takeover.code, takeover.origin)'));
  const screen = src('app/takeover.tsx');
  assert(screen.includes("if (snap.origin === 'https') void load();"));
  assert(screen.includes("else setView({ kind: 'tap' });"));
  assert(/if \(!code\) \{\s*setView\(\{ kind: 'dead' \}\);\s*return;\s*\}/.test(screen), 'no pending code: the dead-link view, never loading forever');
  const landing = src('components/shell/TakeoverLanding.tsx');
  assert(landing.includes("state.kind === 'tap'") && landing.includes('<Button label={FIND_LEAGUE} onPress={onFind}'));
  assertEquals(FIND_LEAGUE, 'Find league');
  assert(src('app/join-league.tsx').includes('label="Find league"'), 'the label is the one Join ships');
});
