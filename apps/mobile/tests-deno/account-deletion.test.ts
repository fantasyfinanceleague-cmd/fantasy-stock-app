/**
 * Account deletion, W4 (plan 2026-10-21): the pure half. Proof gating, "nothing is sent before Delete", the
 * apple_proof_required path, the reason mapping, the failure re-check, the per-league lines, the takeover link
 * (good, bad, hostile), the pending takeover's lifecycle, the label's single literal and the avatar's
 * never-initials rule. The wiring (source scans) is account-deletion-wiring.test.ts.
 *
 *   cd apps/mobile/tests-deno && deno test account-deletion.test.ts
 */
import { assert, assertEquals, assertFalse, assertNotEquals } from 'jsr:@std/assert';
import {
  OPEN_THE_LEAGUE, PASSWORD_WRONG, PROOF_UNCONFIRMED, TRY_LATER,
  ACCOUNT_DELETED, ALERT_BODY, ALERT_DELETE, ALERT_KEEP, ALERT_TITLE, CONFIRMED_WITH_APPLE, CONFIRMED_WITH_GOOGLE, DELETE_BUTTON, DELETE_FAILED, DELETE_LEAD,
  DELETE_ROW, DELETE_TITLE, FIND_NEW_MANAGER, GO_TO_HOME, NO_OTHERS_LINE, NOT_DRAFTED_LINE, NOT_NOW, PROOF_PASSWORD, PROOF_SOCIAL, TAKE_THE_TEAM,
  TAKEN_LINE, handOverLine, pastSeasonsLine, stayLine, successorLine, takeoverQuestion, takeoverShareSentence,
} from '../lib/account/deleteCopy.ts';
import {
  FORMER_MANAGER_FALLBACK, deletedManagerLabel, isDeletedSeatName, resetDeletedManagerLabel, setDeletedManagerLabel,
} from '../lib/account/deletedSeat.ts';
import { proofInHand, proofKindFor, type DeleteProof } from '../lib/account/proofKind.ts';
import {
  applyOutcome, askConfirm, canAsk, confirmDelete, deleteOutcome, initialDeleteState, keepAccount, setProof, type DeleteState,
} from '../lib/account/deleteFlow.ts';
import { PROOF_MAX_AGE_MS, accountCheckFromGetUser, proofIsStale, readDeleteReply, runDelete, runDeleteFlow, type DeleteFlowDeps, type DeleteRunDeps } from '../lib/account/deleteRun.ts';
import type { SocialProofResult } from '../lib/auth/socialOutcome.ts';
import { canFindNewManager, membersRows } from '../lib/account/findManager.ts';
import { leagueLine, successorOf, type DeleteLeagueInput, type LeagueMemberFact } from '../lib/account/leagueLines.ts';
import { rateWaitOf, readTakeoverReply } from '../lib/account/takeoverReply.ts';
import { deadLine, interpretTakeover, interpretTakeoverPreview, recordLine } from '../lib/account/takeoverView.ts';
import { isDeletedNotice, setDeletedNotice, subscribeDeletedNotice } from '../lib/account/deletedNotice.ts';
import { blockMessage } from '../lib/join/joinPreview.ts';
import { readFunctionRefusal } from '../lib/functionRefusal.ts';
import { INVITE_COPY } from '../lib/invite/inviteCopy.ts';
import { parseInviteArrival } from '../lib/invite/inviteLink.ts';
import { buildTakeoverUrl, normalizeTakeoverCode, parseTakeoverArrival, parseTakeoverLink, takeoverShareMessage } from '../lib/invite/takeoverLink.ts';
import {
  TAKEOVER_STORAGE_KEY, TAKEOVER_TTL_MS, createPendingTakeover, parsePersistedTakeover, shouldOpenTakeover, takeoverOwnerAction,
} from '../lib/invite/pendingTakeover.ts';
import { USERNAME_PATTERN } from '../lib/shell/usernameRules.ts';
import { avatarInitials } from '../components/sp/logic/avatar.ts';

const CODE = 'QX7P4KM3AB';
const BASE = 'https://fantasy-stock-app.vercel.app';

// ── The words: verbatim ─────────────────────────────────────────────────────

Deno.test('copy: Giorgio\'s approved strings, character for character', () => {
  assertEquals(DELETE_ROW, 'Delete account');
  assertEquals(DELETE_TITLE, 'Delete your account?');
  assertEquals(DELETE_LEAD, 'This deletes your account right away.');
  assertEquals(PROOF_PASSWORD, 'Enter your password to continue');
  assertEquals(PROOF_SOCIAL, "Confirm it's you to continue");
  assertEquals(CONFIRMED_WITH_APPLE, 'Confirmed with Apple');
  assertEquals(CONFIRMED_WITH_GOOGLE, 'Confirmed with Google');
  assertEquals(DELETE_BUTTON, 'Delete my account');
  assertEquals(ALERT_TITLE, 'Are you sure?');
  assertEquals(ALERT_BODY, "This can't be undone. Your account and sign-in are deleted for good.");
  assertEquals(ALERT_KEEP, 'Keep my account');
  assertEquals(ALERT_DELETE, 'Delete');
  assertEquals(DELETE_FAILED, "Couldn't delete your account. Try again.");
  assertEquals(ACCOUNT_DELETED, 'Your account is deleted.');
  assertEquals(FIND_NEW_MANAGER, 'Find a new manager');
  assertEquals(TAKE_THE_TEAM, 'Take the team');
  assertEquals(NOT_NOW, 'Not now');
  assertEquals(TAKEN_LINE, 'Someone already took this team.');
  assertEquals(GO_TO_HOME, 'Go to Home');
  assertEquals(NOT_DRAFTED_LINE, 'It hasn’t drafted yet, so you leave it.');
  assertEquals(NO_OTHERS_LINE, 'No other managers, so it’s deleted with your account.');
  assertEquals(successorLine('Former manager', 'Paolo M.'), 'Your team stays as “Former manager”. Paolo M. becomes the commissioner.');
  assertEquals(handOverLine('Former manager'), 'Your team stays as “Former manager”. The commissioner can hand it to a new manager.');
  assertEquals(pastSeasonsLine('Former manager'), 'Past seasons keep your results under “Former manager”.');
  assertEquals(takeoverShareSentence('Stock Scudetto'), 'Take over a team in Stock Scudetto');
  assertEquals(takeoverQuestion('Former manager', 'Stock Scudetto'), "Take over Former manager's team in Stock Scudetto?");
});

// ── The label: one literal, the server's wins, no username can collide ───────

Deno.test('label: the fallback is "Former manager"; the server\'s answer replaces it; blank/garbage is ignored', () => {
  resetDeletedManagerLabel();
  assertEquals(deletedManagerLabel(), 'Former manager');
  assertEquals(FORMER_MANAGER_FALLBACK, 'Former manager');
  setDeletedManagerLabel('Open team');
  assertEquals(deletedManagerLabel(), 'Open team');
  setDeletedManagerLabel('   ');
  setDeletedManagerLabel(null);
  setDeletedManagerLabel(42);
  setDeletedManagerLabel('x'.repeat(61));
  assertEquals(deletedManagerLabel(), 'Open team');
  resetDeletedManagerLabel();
});

Deno.test('label: isDeletedSeatName is exact (trimmed), never a prefix, a case-fold or a person', () => {
  resetDeletedManagerLabel();
  assert(isDeletedSeatName('Former manager'));
  assert(isDeletedSeatName('  Former manager '));
  assertFalse(isDeletedSeatName('former manager'));
  assertFalse(isDeletedSeatName('Former manager 2'));
  assertFalse(isDeletedSeatName('Former'));
  assertFalse(isDeletedSeatName(''));
  assertFalse(isDeletedSeatName(null));
  assertFalse(isDeletedSeatName(undefined));
  setDeletedManagerLabel('Open team');
  assert(isDeletedSeatName('Open team'));
  assertFalse(isDeletedSeatName('Former manager'), 'the server\'s label is the one that counts once known');
  resetDeletedManagerLabel();
});

Deno.test('label: no username can BE the label (a space is not a username character), so a name match cannot collide', () => {
  const re = new RegExp(USERNAME_PATTERN);
  assertFalse(re.test(FORMER_MANAGER_FALLBACK));
  assertFalse(re.test('Open team'));
  assert(FORMER_MANAGER_FALLBACK.includes(' '));
});

// ── The avatar never shows initials of the label ────────────────────────────

Deno.test('avatar: the deleted seat\'s name would produce initials ("FM") that the Avatar must never draw', () => {
  // The Avatar branches on isDeletedSeatName BEFORE it calls discInitials (pinned in the wiring test); here the
  // premise: the label does yield initials, so an Avatar that forgot the branch would visibly show "FM".
  assertEquals(avatarInitials(FORMER_MANAGER_FALLBACK), 'FM');
  assert(isDeletedSeatName(FORMER_MANAGER_FALLBACK));
});

// ── The proof ───────────────────────────────────────────────────────────────

Deno.test('proofKind: Apple wins over everything; Google over email; password only with no social identity', () => {
  assertEquals(proofKindFor([{ provider: 'email' }]), 'password');
  assertEquals(proofKindFor([{ provider: 'google' }]), 'google');
  assertEquals(proofKindFor([{ provider: 'apple' }]), 'apple');
  assertEquals(proofKindFor([{ provider: 'email' }, { provider: 'google' }]), 'google');
  assertEquals(proofKindFor([{ provider: 'google' }, { provider: 'apple' }, { provider: 'email' }]), 'apple');
  assertEquals(proofKindFor([]), 'password');
  assertEquals(proofKindFor(null), 'password');
  assertEquals(proofKindFor(undefined), 'password');
  assertEquals(proofKindFor([{ provider: 'APPLE' }]), 'password', 'a provider is matched exactly, never folded');
});

const T0 = 1_000_000;
const PW: DeleteProof = { kind: 'password', password: 'hunter2hunter2' };
const AP: DeleteProof = { kind: 'apple', identityToken: 'id.tok', authorizationCode: 'c1', nonce: 'n1' };
const GO: DeleteProof = { kind: 'google', idToken: 'g.tok' };

Deno.test('proof gating: in hand only when EVERY field the server reads is present', () => {
  assert(proofInHand(PW, 'password'));
  assertFalse(proofInHand({ kind: 'password', password: '' }, 'password'));
  assert(proofInHand(AP, 'apple'));
  for (const k of ['identityToken', 'authorizationCode', 'nonce'] as const) {
    assertFalse(proofInHand({ ...AP, [k]: '' }, 'apple'), `apple without ${k}`);
  }
  assert(proofInHand(GO, 'google'));
  assertFalse(proofInHand({ kind: 'google', idToken: '' }, 'google'));
  assertFalse(proofInHand(null, 'password'));
  assertFalse(proofInHand(PW, 'apple'), 'a password is not an Apple proof');
});

Deno.test('proof gating: the button is dimmed until the proof is in hand, and again while anything runs', () => {
  let s = initialDeleteState('password');
  assertFalse(canAsk(s), 'no proof yet');
  s = setProof(s, { kind: 'password', password: '' }, T0);
  assertFalse(canAsk(s), 'an empty password is no proof');
  s = setProof(s, PW, T0);
  assert(canAsk(s));
  assertEquals(askConfirm(initialDeleteState('password')).phase, 'editing', 'asking without a proof does nothing');
  s = askConfirm(s);
  assertEquals(s.phase, 'confirming');
  assertFalse(canAsk(s), 'not live while the alert is up');
});

Deno.test('proof gating: a proof of the wrong kind is ignored', () => {
  const s = setProof(initialDeleteState('apple'), PW, T0);
  assertEquals(s.proof, null);
  assertFalse(canAsk(s));
});

// ── Nothing is sent before Delete ───────────────────────────────────────────

Deno.test('nothing sent before Delete: only confirmDelete (from the open alert) yields a body', () => {
  const ready = setProof(initialDeleteState('password'), PW, T0);
  // The button opens the alert: no body anywhere on that path.
  assertEquals(confirmDelete(ready).body, null, 'editing: nothing to send');
  const asking = askConfirm(ready);
  assertEquals(asking.phase, 'confirming');
  // "Keep my account" is the default: back to editing, nothing sent.
  const kept = keepAccount(asking);
  assertEquals(kept.phase, 'editing');
  assertEquals(confirmDelete(kept).body, null);
  // "Delete": the one body.
  const { state, body } = confirmDelete(asking);
  assertEquals(state.phase, 'sending');
  assertEquals(body, { proof: PW });
  // A second tap while sending sends nothing.
  assertEquals(confirmDelete(state).body, null);
  assertEquals(askConfirm(state).phase, 'sending');
});

Deno.test('nothing sent before Delete: a social proof is discarded by "Keep my account" (the code is single-use and short-lived)', () => {
  let s = setProof(initialDeleteState('apple'), AP, T0);
  assert(canAsk(s));
  s = keepAccount(askConfirm(s));
  assertEquals(s.proof, null);
  assertFalse(canAsk(s), 'a new Apple sheet is needed');
  // A password the person typed stays (it is theirs, not a single-use credential).
  let p = keepAccount(askConfirm(setProof(initialDeleteState('password'), PW, T0)));
  assertEquals(p.proof, PW);
  assert(canAsk(p));
  p = keepAccount(p); // already editing: unchanged
  assertEquals(p.phase, 'editing');
});

// ── The reason mapping ──────────────────────────────────────────────────────

async function refusal(status: number, body: unknown) {
  // A faithful stand-in for supabase-js: a 2xx resolves data; a non-2xx rejects with an error whose context is the Response.
  if (status >= 200 && status < 300) return readFunctionRefusal(body, null);
  return readFunctionRefusal(null, { context: new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) });
}

Deno.test('reasons: ok:true is the ONLY success', async () => {
  assertEquals(deleteOutcome(await refusal(200, { ok: true, stage: 'done', apple_revoke: 'none' })), { kind: 'deleted' });
  for (const revoke of ['done', 'pending', 'unrevoked']) assertEquals(deleteOutcome(await refusal(200, { ok: true, stage: 'done', apple_revoke: revoke })), { kind: 'deleted' }, 'the revoke state is the server\'s to retry, never ours to show');
  assertEquals(deleteOutcome(await refusal(200, { ok: true })).kind, 'failed', 'ok without stage done is not a deletion (the re-check recovers a real one)');
  assertEquals(deleteOutcome(await refusal(200, { ok: true, stage: 'scrubbed' })).kind, 'deleted', 'any string stage: the deletion is committed');
  assertEquals(deleteOutcome(await refusal(200, {})).kind, 'failed', 'a 200 with no ok is not a deletion');
  assertEquals(deleteOutcome(await refusal(200, { ok: 'true' })).kind, 'failed');
  assertEquals(deleteOutcome(await refusal(200, { ok: 1 })).kind, 'failed');
  assertEquals(deleteOutcome(await refusal(200, null)).kind, 'failed');
});

Deno.test('reasons: bad_proof and apple_proof_required have their own paths; everything else is the one plain failure', async () => {
  assertEquals(deleteOutcome(await refusal(200, { ok: false, reason: 'bad_proof' })), { kind: 'bad_proof' });
  assertEquals(deleteOutcome(await refusal(200, { ok: false, reason: 'apple_proof_required' })), { kind: 'apple_required' });
  const others: Array<[number, Record<string, unknown>]> = [
    [503, { ok: false, reason: 'try_again' }],
    [500, { ok: false, reason: 'server_config_error', stage: null }],
    [500, { ok: false, reason: 'scrub_failed', stage: null }],
    [400, { ok: false, reason: 'bad_request' }],
    [401, { ok: false, reason: 'not_authenticated' }],
    [200, { ok: false, reason: 'some_future_reason' }],
    [200, { ok: false }],
  ];
  for (const [status, body] of others) assertEquals(deleteOutcome(await refusal(status, body)).kind, 'failed', JSON.stringify(body));
  assertEquals(deleteOutcome({ transport: true }).kind, 'failed', 'a lost answer is an unknown, shown as failed');
});

Deno.test('reasons: a failure clears the proof and shows the plain line; bad_proof marks the field; apple_required switches the proof to Apple', () => {
  const sending = (kind: 'password' | 'apple', proof: DeleteProof): DeleteState => confirmDelete(askConfirm(setProof(initialDeleteState(kind), proof, T0))).state;
  let s = applyOutcome(sending('password', PW), { kind: 'failed' });
  assertEquals([s.phase, s.proof, s.failed, s.proofRejected], ['editing', null, true, false]);
  s = applyOutcome(sending('password', PW), { kind: 'bad_proof' });
  assertEquals([s.phase, s.proof, s.failed, s.proofRejected], ['editing', null, false, true]);
  s = applyOutcome(sending('password', PW), { kind: 'apple_required' });
  assertEquals([s.phase, s.kind, s.proof, s.failed], ['editing', 'apple', null, false]);
  s = applyOutcome(sending('apple', AP), { kind: 'deleted' });
  assertEquals(s.phase, 'done');
  // Only a request in flight can be answered.
  const idle = initialDeleteState('password');
  assertEquals(applyOutcome(idle, { kind: 'deleted' }), idle);
});

Deno.test('apple_proof_required path: password attempt -> Apple block -> Apple proof -> deletes', () => {
  let s = confirmDelete(askConfirm(setProof(initialDeleteState('password'), PW, T0))).state;
  s = applyOutcome(s, { kind: 'apple_required' });
  assertEquals(s.kind, 'apple');
  assertFalse(canAsk(s), 'the button is dimmed again until Apple confirms');
  s = setProof(s, AP, T0);
  assert(canAsk(s));
  const { body } = confirmDelete(askConfirm(s));
  assertEquals(body, { proof: AP });
});

// ── The run: invoke -> outcome -> re-check ──────────────────────────────────

function deps(over: Partial<DeleteRunDeps> & { sent?: unknown[] }): DeleteRunDeps {
  return {
    invoke: over.invoke ?? ((b) => { over.sent?.push(b); return Promise.resolve({ data: { ok: true, stage: 'done', apple_revoke: 'none' }, error: null }); }),
    checkAccount: over.checkAccount ?? (() => Promise.resolve('exists')),
  };
}

Deno.test('run: success sends the proof once', async () => {
  const sent: unknown[] = [];
  assertEquals(await runDelete({ proof: PW }, deps({ sent })), { kind: 'deleted' });
  assertEquals(sent, [{ proof: PW }]);
});

Deno.test('run: a lost answer for a deletion that DID happen reads as deleted (the re-check), not as a failure to retry forever', async () => {
  const r = await runDelete({ proof: PW }, deps({ invoke: () => Promise.reject(new Error('net')), checkAccount: () => Promise.resolve('gone') }));
  assertEquals(r, { kind: 'deleted' });
  const r2 = await runDelete({ proof: PW }, deps({ invoke: () => Promise.resolve({ data: { ok: false, reason: 'not_authenticated' }, error: null }), checkAccount: () => Promise.resolve('gone') }));
  assertEquals(r2, { kind: 'deleted' });
});

Deno.test('run: an unreadable re-check stays a failure (never guessed); a refusal is never re-checked into success', async () => {
  assertEquals((await runDelete({ proof: PW }, deps({ invoke: () => Promise.reject(new Error('net')), checkAccount: () => Promise.resolve('unknown') }))).kind, 'failed');
  assertEquals((await runDelete({ proof: PW }, deps({ invoke: () => Promise.reject(new Error('net')), checkAccount: () => Promise.reject(new Error('x')) }))).kind, 'failed');
  let checked = 0;
  const bad = await runDelete({ proof: PW }, deps({
    invoke: () => Promise.resolve({ data: { ok: false, reason: 'bad_proof' }, error: null }),
    checkAccount: () => { checked++; return Promise.resolve('gone'); },
  }));
  assertEquals(bad, { kind: 'bad_proof' });
  assertEquals(checked, 0, 'only a failure is re-checked');
});

Deno.test('run: getUser() errors map to gone only when definitive', () => {
  assertEquals(accountCheckFromGetUser({ data: { user: { id: 'u' } }, error: null }), 'exists');
  assertEquals(accountCheckFromGetUser({ data: { user: null }, error: null }), 'unknown');
  assertEquals(accountCheckFromGetUser({ error: { status: 403, code: 'user_not_found' } }), 'gone');
  assertEquals(accountCheckFromGetUser({ error: { status: 401, code: 'bad_jwt' } }), 'gone');
  assertEquals(accountCheckFromGetUser({ error: { status: 500 } }), 'unknown');
  assertEquals(accountCheckFromGetUser({ error: {} }), 'unknown', 'a network error carries no status');
});

// ── One line per league ─────────────────────────────────────────────────────

const ME = 'u-me';
const member = (id: string, joined: string | null, over: Partial<LeagueMemberFact> = {}): LeagueMemberFact => ({
  user_id: id, joined_at: joined, hidden: false, displayName: `name-${id}`, isBot: false, deleted: false, ...over,
});
const FUTURE = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const league = (over: Partial<DeleteLeagueInput> & { draft?: string; season?: string }): DeleteLeagueInput => ({
  id: 'L', name: 'League', commissionerId: 'u-other',
  facts: { seasonStatus: over.season ?? 'active', draftStatus: over.draft ?? 'completed', draftDate: FUTURE },
  members: [member(ME, '2026-01-01'), member('u-other', '2026-01-02')],
  ...over,
});
const NOW = Date.now();
const L = 'Former manager';

Deno.test('lines: the four approved lines, by situation', () => {
  // runs it, others in it, drafted
  assertEquals(
    leagueLine(league({ commissionerId: ME, members: [member(ME, '2026-01-01'), member('u-p', '2026-01-03', { displayName: 'Paolo M.' })] }), ME, L, NOW).line,
    'Your team stays as “Former manager”. Paolo M. becomes the commissioner.');
  // plays in
  assertEquals(leagueLine(league({}), ME, L, NOW).line, 'Your team stays as “Former manager”. The commissioner can hand it to a new manager.');
  // before its draft
  assertEquals(leagueLine(league({ draft: 'not_started' }), ME, L, NOW).line, NOT_DRAFTED_LINE);
  // runs it alone
  assertEquals(leagueLine(league({ commissionerId: ME, members: [member(ME, '2026-01-01')] }), ME, L, NOW).line, NO_OTHERS_LINE);
});

Deno.test('lines: running it alone beats the draft window (the league is deleted either way)', () => {
  assertEquals(leagueLine(league({ commissionerId: ME, draft: 'not_started', members: [member(ME, '2026-01-01')] }), ME, L, NOW).line, NO_OTHERS_LINE);
});

Deno.test('lines: a finished season cuts the sentence before the hand-over (nothing left to hand over)', () => {
  assertEquals(leagueLine(league({ season: 'completed' }), ME, L, NOW).line, 'Your team stays as “Former manager”.');
});

Deno.test('lines: the successor is the earliest joined, user_id breaks the tie; leavers, deleted seats and bots never count', () => {
  const ms = [
    member(ME, '2026-01-01'),
    member('u-c', '2026-01-05', { displayName: 'C' }),
    member('u-b', '2026-01-05', { displayName: 'B' }),
    member('u-a', '2026-01-02', { displayName: 'A', hidden: true }),
    member('u-z', '2026-01-01', { displayName: 'Z', deleted: true }),
    member('u-bot', '2026-01-01', { displayName: 'Bot', isBot: true }),
  ];
  assertEquals(successorOf(ms, ME)?.user_id, 'u-b');
  assertEquals(successorOf([member(ME, '2026-01-01')], ME), null);
  assertEquals(successorOf([member('u-n', null), member('u-d', '2026-02-01')], ME)?.user_id, 'u-d', 'a member with no date sorts last');
});

Deno.test('lines: a successor with no known name falls back to the short sentence, never "undefined becomes the commissioner"', () => {
  const l = league({ commissionerId: ME, members: [member(ME, '2026-01-01'), member('u-p', '2026-01-03', { displayName: null })] });
  assertEquals(leagueLine(l, ME, L, NOW).line, 'Your team stays as “Former manager”.');
});

Deno.test('lines: the label is a parameter (the server\'s word), never baked in', () => {
  assertEquals(leagueLine(league({}), ME, 'Open team', NOW).line, 'Your team stays as “Open team”. The commissioner can hand it to a new manager.');
});

// ── The takeover view ───────────────────────────────────────────────────────

Deno.test('takeover view: preview answers', async () => {
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: true, league_name: 'Stock Scudetto', wins: 1, losses: 5, rank: 6 })), { kind: 'found', leagueName: 'Stock Scudetto', wins: 1, losses: 5, rank: 6 });
  for (const reason of ['gone', 'invalid_code', 'not_deleted', 'window']) {
    assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason })), { kind: 'dead' }, reason);
  }
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'taken' })), { kind: 'taken' });
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'already_member' })), { kind: 'member', leagueName: null, leagueId: null });
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'from_the_future' })), { kind: 'unknown' });
  assertEquals(interpretTakeoverPreview({ transport: true }), { kind: 'unknown' });
  // a half-built success is never drawn
  for (const bad of [{ ok: true }, { ok: true, league_name: '', wins: 1, losses: 1, rank: 1 }, { ok: true, league_name: 'X', wins: -1, losses: 1, rank: 1 },
    { ok: true, league_name: 'X', wins: 1, losses: 1, rank: 0 }, { ok: true, league_name: 'X', wins: '1', losses: 1, rank: 1 }, { ok: true, league_name: 'X', wins: 1.5, losses: 1, rank: 1 }]) {
    assertEquals(interpretTakeoverPreview(await refusal(200, bad)).kind, 'unknown', JSON.stringify(bad));
  }
});

Deno.test('takeover view: the write — only {ok:true, status:"taken_over"} is a takeover', async () => {
  assertEquals(interpretTakeover(await refusal(200, { ok: true, status: 'taken_over' })), { kind: 'taken_over', leagueId: null });
  const LID = '3f2b8a1e-5c4d-4e6f-8a9b-0c1d2e3f4a5b';
  assertEquals(interpretTakeover(await refusal(200, { ok: true, status: 'taken_over', league: { id: LID } })), { kind: 'taken_over', leagueId: LID });
  assertEquals(interpretTakeover(await refusal(200, { ok: true, status: 'taken_over', league: { id: 'not-a-uuid' } })), { kind: 'taken_over', leagueId: null }, 'a malformed id is never navigated to');
  assertEquals(interpretTakeover(await refusal(200, { ok: true, status: 'taken_over', league: 'x' })), { kind: 'taken_over', leagueId: null });
  // too many wrong codes: a wait, never the dead-link page, and it never reads as a takeover
  assertEquals(interpretTakeover(await refusal(429, { ok: false, reason: 'rate_limited' })), { kind: 'rate_limited', wait: 'later' });
  assertEquals(interpretTakeoverPreview(await refusal(429, { ok: false, reason: 'rate_limited' })), { kind: 'rate_limited', wait: 'later' });
  assertEquals(interpretTakeover(await refusal(200, { ok: true })).kind, 'unknown');
  assertEquals(interpretTakeover(await refusal(200, { ok: true, status: 'joined' })).kind, 'unknown');
  assertEquals(interpretTakeover(await refusal(200, { ok: false, reason: 'taken' })), { kind: 'taken' });
  assertEquals(interpretTakeover(await refusal(409, { ok: false, reason: 'taken' })), { kind: 'taken' }, 'a non-2xx body is still read');
});

Deno.test('takeover view: dead lines reuse approved copy; the record is "1–5, 6th"', () => {
  assertEquals(deadLine({ kind: 'taken' }), 'Someone already took this team.');
  assertEquals(deadLine({ kind: 'dead' }), INVITE_COPY.dead);
  assertEquals(recordLine(1, 5, 6), '1–5, 6th');
  assertEquals(recordLine(3, 2, 1), '3–2, 1st');
  assertEquals(recordLine(0, 0, 12), '0–0, 12th');
});

// ── The one-time notice ─────────────────────────────────────────────────────

Deno.test('notice: raised, observed, cleared; listeners fire only on a change', () => {
  setDeletedNotice(false);
  let fired = 0;
  const off = subscribeDeletedNotice(() => fired++);
  setDeletedNotice(true);
  setDeletedNotice(true);
  assert(isDeletedNotice());
  assertEquals(fired, 1);
  setDeletedNotice(false);
  assertFalse(isDeletedNotice());
  assertEquals(fired, 2);
  off();
  setDeletedNotice(true);
  assertEquals(fired, 2, 'unsubscribed');
  setDeletedNotice(false);
});

// ── The takeover link: good, bad, hostile ───────────────────────────────────

Deno.test('takeover link: the accepted shapes', () => {
  for (const url of [
    `${BASE}/take/${CODE}`, `${BASE}/take/${CODE}/`, `${BASE}/take/${CODE.toLowerCase()}`, `  ${BASE}/take/${CODE}  `,
    `${BASE}/take/${CODE}?utm_source=sms&code=EVILEVILEV`, `${BASE}/take/${CODE}#frag`,
    `fantasystockapp://take/${CODE}`, `fantasystockapp:///take/${CODE}`, `HTTPS://FANTASY-STOCK-APP.VERCEL.APP/take/${CODE}`,
  ]) assertEquals(parseTakeoverLink(url, false), CODE, url);
});

Deno.test('takeover link: hostile and malformed inputs are refused, never repaired', () => {
  const bad: unknown[] = [
    null, undefined, 42, {}, '', ' ', `${BASE}/take`, `${BASE}/take/`, `${BASE}/take//${CODE}`, `${BASE}//take/${CODE}x/y`,
    `${BASE}/take/${CODE}/extra`, `${BASE}/take/${CODE}/../join/${CODE}`, `${BASE}/take/abc`, `${BASE}/take/${'A'.repeat(13)}`,
    `${BASE}/take/QX7P-4K`, `${BASE}/take/QX7P%34K`, `${BASE}/take/QX7P 4K`, `${BASE}/take/QX7P.4K`, `${BASE}/take/QX7P\\4K`,
    `${BASE}/take/QX7P4KM3AB%00`, `${BASE}/take/ıX7P4K`, `${BASE}/take/QX7P4K`, `${BASE}/take/straße`,
    `https://fantasy-stock-app.vercel.app.evil.com/take/${CODE}`, `https://evil.com/take/${CODE}`,
    `https://fantasy-stock-app.vercel.app@evil.com/take/${CODE}`, `https://evil.com/?https://fantasy-stock-app.vercel.app/take/${CODE}`,
    `http://fantasy-stock-app.vercel.app/take/${CODE}`, `ftp://fantasy-stock-app.vercel.app/take/${CODE}`,
    `javascript:alert(1)//${BASE}/take/${CODE}`, `fantasystockapp://evil/take/${CODE}`, `fantasystockapp://take`, `fantasystockapp://take/`,
    `/take/${CODE}`, `exp://192.168.1.2:8081/--/take/${CODE}`, // dev-only shapes are off in a release
    `${BASE}/?code=${CODE}`, `${BASE}/take?code=${CODE}`, `${BASE}/#/take/${CODE}`,
  ];
  for (const url of bad) assertEquals(parseTakeoverLink(url as string, false), null, String(url));
});

Deno.test('takeover link: dev shapes parse only in a development build', () => {
  assertEquals(parseTakeoverLink(`/take/${CODE}`, true), CODE);
  assertEquals(parseTakeoverLink(`exp://192.168.1.2:8081/--/take/${CODE}`, true), CODE);
});

Deno.test('takeover link: /take/ and /join/ never cross (two capabilities, two parser paths)', () => {
  assertEquals(parseInviteArrival(`${BASE}/take/${CODE}`, false), null, 'a takeover link is not an invite');
  assertEquals(parseTakeoverArrival(`${BASE}/join/${CODE}`, false), null, 'an invite link is not a takeover');
  assertEquals(parseTakeoverArrival(`fantasystockapp://join/${CODE}`, false), null);
});

Deno.test('takeover link: origin is https for the shared link and scheme otherwise', () => {
  assertEquals(parseTakeoverArrival(`${BASE}/take/${CODE}`, false)?.origin, 'https');
  assertEquals(parseTakeoverArrival(`fantasystockapp://take/${CODE}`, false)?.origin, 'scheme');
});

Deno.test('takeover link: the shared message is the approved sentence, then the link on its own line', () => {
  assertEquals(buildTakeoverUrl(CODE), `${BASE}/take/${CODE}`);
  assertEquals(takeoverShareMessage('Stock Scudetto', CODE), `Take over a team in Stock Scudetto\n${BASE}/take/${CODE}`);
  assertEquals(buildTakeoverUrl('bad code!'), null);
  assertEquals(takeoverShareMessage('Stock Scudetto', 'x'), null, 'no link, nothing to share');
  assertEquals(parseTakeoverLink(buildTakeoverUrl(CODE), false), CODE, 'what we share, we can read');
});

// ── The pending takeover ────────────────────────────────────────────────────

function store(init: string | null = null, now = 1_000_000) {
  let value = init;
  let t = now;
  const calls: string[] = [];
  const s = createPendingTakeover({
    storage: {
      get: () => Promise.resolve(value),
      set: (v) => { value = v; calls.push('set'); return Promise.resolve(); },
      remove: () => { value = null; calls.push('remove'); return Promise.resolve(); },
    },
    now: () => t,
  });
  return { s, calls, read: () => value, tick: (ms: number) => { t += ms; } };
}

Deno.test('pending takeover: capture persists; a relaunch restores; clear removes', async () => {
  const a = store();
  assert(a.s.capture('qx7p4km3ab'));
  assertEquals(a.s.getSnapshot().code, CODE);
  await new Promise((r) => setTimeout(r, 0));
  const b = store(a.read());
  await b.s.load();
  assertEquals(b.s.getSnapshot().code, CODE);
  assert(b.s.getSnapshot().loaded);
  await b.s.clear(CODE);
  assertEquals(b.s.getSnapshot().code, null);
  assertEquals(b.read(), null);
});

Deno.test('pending takeover: a bad shape is not captured; a stale one is dropped on load; hostile storage is removed', async () => {
  const a = store();
  assertFalse(a.s.capture('no'));
  assertFalse(a.s.capture('QX7P-4K'));
  assertEquals(a.s.getSnapshot().code, null);
  const stale = JSON.stringify({ v: 1, code: CODE, capturedAt: 1_000_000 - TAKEOVER_TTL_MS - 1, ownerUserId: null });
  const b = store(stale);
  await b.s.load();
  assertEquals(b.s.getSnapshot().code, null);
  assertEquals(b.read(), null, 'removed');
  for (const junk of ['{', 'null', '[]', '"x"', JSON.stringify({ v: 2, code: CODE, capturedAt: 1_000_000 }), JSON.stringify({ v: 1, code: 'bad code', capturedAt: 1_000_000 }),
    JSON.stringify({ v: 1, code: CODE, capturedAt: 'now' }), JSON.stringify({ v: 1, code: CODE, capturedAt: 1_000_000 + 10 * 24 * 3600 * 1000 })]) {
    assertEquals(parsePersistedTakeover(junk, 1_000_000), null, junk);
  }
  assertNotEquals(parsePersistedTakeover(JSON.stringify({ v: 1, code: CODE, capturedAt: 1_000_000, ownerUserId: 'u1' }), 1_000_000), null);
  assertEquals(TAKEOVER_STORAGE_KEY, 'sp.takeover.pending.v1');
});

Deno.test('pending takeover: a link captured while the stored one loads wins (the stale load is harmless)', async () => {
  const stored = JSON.stringify({ v: 1, code: 'OLDCODE1', capturedAt: 1_000_000, ownerUserId: null });
  const a = store(stored);
  const loading = a.s.load();
  a.s.capture(CODE);
  await loading;
  assertEquals(a.s.getSnapshot().code, CODE);
});

Deno.test('pending takeover: it belongs to the person who tapped it; a different person on the phone never gets the seat', () => {
  assertEquals(takeoverOwnerAction(null, 'u1'), 'claim');
  assertEquals(takeoverOwnerAction('u1', 'u1'), 'none');
  assertEquals(takeoverOwnerAction('u1', 'u2'), 'clear');
  assertEquals(takeoverOwnerAction('u1', null), 'none');
  const open = { phase: 'ready' as const, code: CODE, autoOpenedCode: null, recoveryHold: false, ownerAction: 'none' as const };
  assert(shouldOpenTakeover(open));
  for (const over of [{ phase: 'signedOut' }, { phase: 'gated' }, { phase: 'unknown' }, { code: null }, { autoOpenedCode: CODE }, { recoveryHold: true }, { ownerAction: 'claim' }, { ownerAction: 'clear' }]) {
    assertFalse(shouldOpenTakeover({ ...open, ...over } as Parameters<typeof shouldOpenTakeover>[0]), JSON.stringify(over));
  }
});

Deno.test('pending takeover: claim stamps once; markAutoOpened is per code; clear(otherCode) leaves it alone', async () => {
  const a = store();
  a.s.capture(CODE);
  a.s.claim('u1', CODE);
  a.s.claim('u2', CODE);
  assertEquals(a.s.getSnapshot().ownerUserId, 'u1');
  a.s.markAutoOpened('OTHERCODE');
  assertEquals(a.s.getSnapshot().autoOpenedCode, null);
  a.s.markAutoOpened(CODE);
  assertEquals(a.s.getSnapshot().autoOpenedCode, CODE);
  await a.s.clear('OTHERCODE');
  assertEquals(a.s.getSnapshot().code, CODE);
});

// ── Mutation survivors, pinned ──────────────────────────────────────────────

Deno.test('nothing sent: an alert opened over an EMPTY proof still yields no body (the proof is re-checked at Delete)', () => {
  const forced: DeleteState = { phase: 'confirming', kind: 'password', proofAt: T0, proof: { kind: 'password', password: '' }, failed: false, rateLimited: false, proofRejected: false };
  assertEquals(confirmDelete(forced).body, null);
  const forcedApple: DeleteState = { phase: 'confirming', kind: 'apple', proofAt: T0, proof: { kind: 'apple', identityToken: 't', authorizationCode: '', nonce: 'n' }, failed: false, rateLimited: false, proofRejected: false };
  assertEquals(confirmDelete(forcedApple).body, null);
});

Deno.test('lines: the earliest-JOINED member succeeds, not the smallest id or the first listed', () => {
  const ms = [member(ME, '2026-01-01'), member('u-a-late', '2026-03-01'), member('u-z-early', '2026-01-02')];
  assertEquals(successorOf(ms, ME)?.user_id, 'u-z-early');
  assertEquals(successorOf(ms.slice().reverse(), ME)?.user_id, 'u-z-early');
});

Deno.test('Find a new manager: the commissioner, on a deleted seat, from draft complete through the end of the season', () => {
  const ok = { isCommissioner: true, seatDeleted: true, draftStatus: 'completed', seasonStatus: 'active' };
  assert(canFindNewManager(ok));
  assert(canFindNewManager({ ...ok, seasonStatus: 'playoffs' }), 'through the end of the playoffs');
  assertFalse(canFindNewManager({ ...ok, seasonStatus: 'completed' }), 'nothing to take after the season');
  assertFalse(canFindNewManager({ ...ok, draftStatus: 'in_progress' }), 'a live draft: the seat auto-picks');
  assertFalse(canFindNewManager({ ...ok, draftStatus: 'not_started' }), 'before the draft there is no seat to hand over');
  assertFalse(canFindNewManager({ ...ok, isCommissioner: false }), 'a member never sees it');
  assertFalse(canFindNewManager({ ...ok, seatDeleted: false }), 'a live manager has nothing to find');
  assertFalse(canFindNewManager({ ...ok, draftStatus: null }));
});

Deno.test('Members: you first, the rest A–Z, deleted seats last; only current members; the seat is marked, never renamed', () => {
  const names = [
    { user_id: 'u-b', display_name: 'beta' }, { user_id: 'u-seat', display_name: 'Former manager' }, { user_id: ME, display_name: 'Zed' },
    { user_id: 'u-a', display_name: 'Alpha' }, { user_id: 'u-gone', display_name: 'Left' }, { user_id: 'u-null', display_name: null },
  ];
  const rows = membersRows(names, [ME, 'u-a', 'u-b', 'u-seat', 'u-null'], 'u-a', ME, 'Former manager');
  assertEquals(rows.map((r) => r.userId), [ME, 'u-a', 'u-b', 'u-null', 'u-seat']);
  assertEquals(rows.find((r) => r.userId === 'u-seat')?.deleted, true);
  assertEquals(rows.find((r) => r.userId === 'u-a')?.isCommissioner, true);
  assertEquals(rows.find((r) => r.userId === ME)?.isYou, true);
  assertFalse(rows.some((r) => r.userId === 'u-gone'), 'a member who left is not listed');
  assertEquals(rows.find((r) => r.userId === 'u-null')?.name, 'Former manager', 'a missing name reads as the placeholder, never blank');
});

// ── W3's contract: proof_expired, proof age, 10-character codes ─────────────

Deno.test('reasons: proof_expired is its own outcome (never the generic failure) and re-asks without a failure line', async () => {
  assertEquals(deleteOutcome(await refusal(200, { ok: false, reason: 'proof_expired' })), { kind: 'proof_expired' });
  const sending = confirmDelete(askConfirm(setProof(initialDeleteState('apple'), AP, T0))).state;
  const s = applyOutcome(sending, { kind: 'proof_expired' });
  assertEquals([s.phase, s.kind, s.proof, s.proofAt, s.failed, s.proofRejected], ['editing', 'apple', null, null, false, false]);
  const c = applyOutcome(sending, { kind: 'cancelled' });
  assertEquals([c.phase, c.proof, c.failed], ['editing', null, false]);
  for (const [status, reason] of [[503, 'try_again'], [400, 'bad_request']] as const) {
    assertEquals(deleteOutcome(await refusal(status, { ok: false, reason })).kind, 'failed', reason);
  }
});

const FRESH: SocialProofResult = { kind: 'proof', proof: { kind: 'apple', identityToken: 'fresh', authorizationCode: 'c2', nonce: 'n2' } };
function flow(opts: { now: () => number; reprove?: DeleteFlowDeps['reprove']; replies?: unknown[] }) {
  const sent: unknown[] = [];
  const reproved: string[] = [];
  const replies = [...(opts.replies ?? [{ ok: true, stage: 'done', apple_revoke: 'none' }])];
  const deps: DeleteFlowDeps = {
    now: opts.now,
    reprove: (k) => { reproved.push(k); return (opts.reprove ?? (() => Promise.resolve(FRESH)))(k); },
    invoke: (b) => { sent.push(b); return Promise.resolve({ data: replies.shift() ?? { ok: false, reason: 'x' }, error: null }); },
    checkAccount: () => Promise.resolve('exists'),
  };
  return { deps, sent, reproved };
}

Deno.test('proof age: older than ~4 minutes at Delete re-runs the Apple sheet FIRST, then sends the FRESH proof', async () => {
  assertEquals(PROOF_MAX_AGE_MS, 4 * 60 * 1000);
  const f = flow({ now: () => T0 + PROOF_MAX_AGE_MS + 1 });
  assertEquals(await runDeleteFlow({ proof: AP }, T0, f.deps), { kind: 'deleted' });
  assertEquals(f.reproved, ['apple']);
  assertEquals(f.sent, [{ proof: FRESH.kind === 'proof' ? FRESH.proof : null }], 'the stale code never goes out');
});

Deno.test('proof age: exactly at the limit and a fresh proof are sent as they are; a password never ages', async () => {
  const atLimit = flow({ now: () => T0 + PROOF_MAX_AGE_MS });
  await runDeleteFlow({ proof: AP }, T0, atLimit.deps);
  assertEquals([atLimit.reproved.length, atLimit.sent], [0, [{ proof: AP }]]);
  const pw = flow({ now: () => T0 + 60 * 60 * 1000 });
  await runDeleteFlow({ proof: PW }, T0, pw.deps);
  assertEquals([pw.reproved.length, pw.sent], [0, [{ proof: PW }]]);
  assert(proofIsStale(GO, T0, T0 + PROOF_MAX_AGE_MS + 1));
  assertFalse(proofIsStale(GO, T0, T0 + 1000));
  assert(proofIsStale(AP, null, T0), 'an unknown age is stale, never trusted');
  assert(proofIsStale(AP, T0, T0 - 1), 'a clock that went backwards is not trusted either');
});

Deno.test('proof age: a Google proof refreshes through Google, not Apple', async () => {
  const f = flow({ now: () => T0 + PROOF_MAX_AGE_MS + 1, reprove: () => Promise.resolve({ kind: 'proof', proof: { kind: 'google', idToken: 'g2' } }) });
  await runDeleteFlow({ proof: GO }, T0, f.deps);
  assertEquals([f.reproved, f.sent], [['google'], [{ proof: { kind: 'google', idToken: 'g2' } }]]);
});

Deno.test('proof age: a closed sheet sends NOTHING and says nothing; a sheet error is the plain failure (nothing sent either)', async () => {
  const stale = () => T0 + PROOF_MAX_AGE_MS + 1;
  for (const kind of ['cancelled', 'unavailable'] as const) {
    const f = flow({ now: stale, reprove: () => Promise.resolve({ kind }) });
    assertEquals(await runDeleteFlow({ proof: AP }, T0, f.deps), { kind: 'cancelled' });
    assertEquals(f.sent, []);
  }
  const e = flow({ now: stale, reprove: () => Promise.resolve({ kind: 'error', error: { message: 'x' } }) });
  assertEquals((await runDeleteFlow({ proof: AP }, T0, e.deps)).kind, 'failed');
  assertEquals(e.sent, []);
});

Deno.test('proof_expired from the server: ONE silent refresh and resend; a second expiry re-asks (never the generic failure)', async () => {
  const once = flow({ now: () => T0, replies: [{ ok: false, reason: 'proof_expired' }, { ok: true, stage: 'done', apple_revoke: 'pending' }] });
  assertEquals(await runDeleteFlow({ proof: AP }, T0, once.deps), { kind: 'deleted' });
  assertEquals([once.reproved, once.sent.length], [['apple'], 2]);
  const twice = flow({ now: () => T0, replies: [{ ok: false, reason: 'proof_expired' }, { ok: false, reason: 'proof_expired' }] });
  assertEquals(await runDeleteFlow({ proof: AP }, T0, twice.deps), { kind: 'proof_expired' });
  assertEquals([twice.reproved.length, twice.sent.length], [1, 2], 'never a third try');
  // bad_proof is not retried silently (it counts toward the limit)
  const bad = flow({ now: () => T0, replies: [{ ok: false, reason: 'bad_proof' }] });
  assertEquals(await runDeleteFlow({ proof: AP }, T0, bad.deps), { kind: 'bad_proof' });
  assertEquals([bad.reproved.length, bad.sent.length], [0, 1]);
});

Deno.test('proof age: setProof stamps the clock and a cleared proof clears it; "Keep my account" drops a social proof\'s stamp', () => {
  let s = setProof(initialDeleteState('apple'), AP, T0 + 5);
  assertEquals(s.proofAt, T0 + 5);
  assertEquals(confirmDelete(askConfirm(s)).proofAt, T0 + 5);
  s = keepAccount(askConfirm(s));
  assertEquals([s.proof, s.proofAt], [null, null]);
  assertEquals(setProof(setProof(initialDeleteState('password'), PW, T0), null, T0 + 1).proofAt, null);
});

Deno.test('takeover codes: EXACTLY 10 upper-case A-Z/0-9 (W3), ASCII-checked before folding', () => {
  assertEquals(normalizeTakeoverCode('qx7p4km3ab'), 'QX7P4KM3AB');
  assertEquals(normalizeTakeoverCode(' QX7P4KM3AB '), 'QX7P4KM3AB');
  for (const bad of ['QX7P4K', 'QX7P4KM3A', 'QX7P4KM3ABC', 'QX7P4KM3A-', '\u0131X7P4KM3AB', 'QX7P4KM3A\u212A', 'QX7P4KM3A\u00DF', '', null, 7]) {
    assertEquals(normalizeTakeoverCode(bad), null, String(bad));
  }
  assertEquals(parseTakeoverLink(`${BASE}/take/QX7P4K`, false), null, 'a 6-character code is an invite\'s, not a takeover\'s');
  assertEquals(parseTakeoverLink(`${BASE}/take/QX7P4KM3ABC`, false), null);
  assertEquals(buildTakeoverUrl('QX7P4K'), null);
});

// ── The Design Lead's copy rulings (2026-10-21) ─────────────────────────────

Deno.test('DL copy: the three NEW delete lines, verbatim', () => {
  assertEquals(PASSWORD_WRONG, "That password isn't right. Try again.");
  assertEquals(PROOF_UNCONFIRMED, "Couldn't confirm it's you. Try again.");
  assertEquals(TRY_LATER, 'Too many tries. Try again later.');
  assertEquals(OPEN_THE_LEAGUE, 'Open the league');
});

Deno.test('DL copy: the proof limit (429 rate_limited) is its own state, not the generic failure; it clears the proof', async () => {
  assertEquals(deleteOutcome(await refusal(429, { ok: false, reason: 'rate_limited' })), { kind: 'rate_limited' });
  const sending = confirmDelete(askConfirm(setProof(initialDeleteState('apple'), AP, T0))).state;
  const s = applyOutcome(sending, { kind: 'rate_limited' });
  assertEquals([s.phase, s.proof, s.failed, s.rateLimited, s.proofRejected], ['editing', null, false, true, false]);
  assertEquals(canAsk(s), false);
  // the next attempt clears the line
  assertEquals(askConfirm(setProof(s, AP, T0 + 1)).rateLimited, false);
  assertEquals(setProof(s, AP, T0 + 1).rateLimited, s.rateLimited, 'typing/proving alone leaves the notice until the next ask');
});

Deno.test('DL copy: a wrong password clears the proof, marks the field, and keeps Delete dimmed until they type again', () => {
  const sending = confirmDelete(askConfirm(setProof(initialDeleteState('password'), PW, T0))).state;
  let s = applyOutcome(sending, { kind: 'bad_proof' });
  assertEquals([s.proofRejected, s.proof, canAsk(s)], [true, null, false]);
  s = setProof(s, { kind: 'password', password: 'x' }, T0 + 2);
  assertEquals([s.proofRejected, canAsk(s)], [false, true]);
});

Deno.test('DL copy: a finished league you RAN with others names the successor; one you only played in is the short sentence', () => {
  const ran = league({ season: 'completed', commissionerId: ME, members: [member(ME, '2026-01-01'), member('u-p', '2026-01-03', { displayName: 'Paolo M.' })] });
  assertEquals(leagueLine(ran, ME, L, NOW).line, 'Your team stays as \u201cFormer manager\u201d. Paolo M. becomes the commissioner.');
  assertEquals(leagueLine(league({ season: 'completed' }), ME, L, NOW).line, 'Your team stays as \u201cFormer manager\u201d.');
  // ...and one you ran alone is deleted
  assertEquals(leagueLine(league({ season: 'completed', commissionerId: ME, members: [member(ME, '2026-01-01')] }), ME, L, NOW).line, NO_OTHERS_LINE);
});

Deno.test('DL copy: takeover reasons — dead / taken / already in / rate limited', async () => {
  for (const reason of ['invalid_code', 'gone', 'not_deleted', 'window']) assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason })), { kind: 'dead' }, reason);
  assertEquals(deadLine({ kind: 'dead' }), "This invite link doesn't work anymore. Ask for a new one.");
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'taken' })), { kind: 'taken' });
  const LID = '3f2b8a1e-5c4d-4e6f-8a9b-0c1d2e3f4a5b';
  for (const reason of ['already_member', 'not_eligible']) {
    assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason, league_name: 'Stock Scudetto', league_id: LID })), { kind: 'member', leagueName: 'Stock Scudetto', leagueId: LID }, reason);
    assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason, league: { id: LID, name: 'Stock Scudetto' } })), { kind: 'member', leagueName: 'Stock Scudetto', leagueId: LID });
    assertEquals(interpretTakeover(await refusal(200, { ok: false, reason })), { kind: 'member', leagueName: null, leagueId: null });
  }
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'already_member', league_name: 'X', league_id: 'nope' })), { kind: 'member', leagueName: 'X', leagueId: null });
  // the shipped sentence, from the shipped function
  assertEquals(blockMessage('already_member', { name: 'Stock Scudetto', max: 0 }), "You're already in Stock Scudetto.");
  // BOTH rate limits read as the longer wait (never understate an hour's lockout)
  assertEquals(interpretTakeoverPreview(await refusal(429, { ok: false, reason: 'rate_limited' })), { kind: 'rate_limited', wait: 'later' });
  assertEquals(interpretTakeoverPreview(await refusal(200, { ok: false, reason: 'rate_limited' })), { kind: 'rate_limited', wait: 'later' });
});

// ── A takeover 429's two body shapes (W3) ───────────────────────────────────

const http = (status: number, body: unknown, raw = false) =>
  ({ context: new Response(raw ? String(body) : JSON.stringify(body), { status, headers: { 'content-type': raw ? 'text/html' : 'application/json' } }) });
const MOMENT = 'Too many tries. Wait a moment, then try again.';

Deno.test('429 shapes: the edge limiter {error:"rate_limited"} is a MOMENT; the SQL lockout {ok:false,reason} is LATER', async () => {
  const edge = interpretTakeoverPreview(await readTakeoverReply(null, http(429, { error: 'rate_limited', message: 'slow down' })));
  assertEquals(edge, { kind: 'rate_limited', wait: 'moment' });
  const sql429 = interpretTakeoverPreview(await readTakeoverReply(null, http(429, { ok: false, reason: 'rate_limited' })));
  assertEquals(sql429, { kind: 'rate_limited', wait: 'later' });
  const sql200 = interpretTakeover(await readTakeoverReply({ ok: false, reason: 'rate_limited' }, null));
  assertEquals(sql200, { kind: 'rate_limited', wait: 'later' });
  // the write path reads the same two shapes
  assertEquals(interpretTakeover(await readTakeoverReply(null, http(429, { error: 'rate_limited' }))), { kind: 'rate_limited', wait: 'moment' });
});

Deno.test('429 shapes: anything else on a 429 is LATER (never understate a lockout), a non-JSON 429 included', async () => {
  for (const body of [{}, { error: 'something_else' }, { error: 'rate_limited', reason: 'rate_limited' }, { error: 'rate_limited', ok: false }, [], 'x', null]) {
    const v = interpretTakeoverPreview(await readTakeoverReply(null, http(429, body)));
    assertEquals(v, { kind: 'rate_limited', wait: 'later' }, JSON.stringify(body));
  }
  assertEquals(interpretTakeoverPreview(await readTakeoverReply(null, http(429, '<html>slow</html>', true))), { kind: 'rate_limited', wait: 'later' });
  assertEquals(rateWaitOf({ error: 'rate_limited' }), 'moment');
  assertEquals(rateWaitOf(undefined), 'later');
});

Deno.test('429 shapes: only a 429 is read this way — other statuses and plain replies go through the shared reader unchanged', async () => {
  assertEquals(interpretTakeoverPreview(await readTakeoverReply(null, http(500, { error: 'rate_limited' }))), { kind: 'unknown' }, 'a 500 with that body is not a rate limit');
  assertEquals(interpretTakeoverPreview(await readTakeoverReply(null, http(400, { ok: false, reason: 'invalid_code' }))), { kind: 'dead' });
  assertEquals(interpretTakeoverPreview(await readTakeoverReply({ ok: true, league_name: 'X', wins: 1, losses: 0, rank: 1 }, null)).kind, 'found');
  assertEquals(interpretTakeoverPreview(await readTakeoverReply(null, new Error('network'))), { kind: 'unknown' });
});

// ── The ledger rule + google_proof_required (W3 security review) ────────────

Deno.test('ledger rule: ANY string stage means the deletion is committed — a 500 with stage requested/scrubbed/done is DELETED', async () => {
  for (const stage of ['requested', 'scrubbed', 'done']) {
    assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'auth_delete_failed', stage })), { kind: 'deleted' }, `500 ${stage}`);
  }
  assertEquals(deleteOutcome(await refusal(200, { ok: true, stage: 'done', apple_revoke: 'none' })), { kind: 'deleted' }, '200 done');
  // a 500 with stage null, or no stage, is a real failure
  assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'server_config_error', stage: null })).kind, 'failed');
  assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'boom' })).kind, 'failed');
  assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'boom', stage: '' })).kind, 'failed', 'an empty stage is not a stage');
  assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'boom', stage: 3 })).kind, 'failed');
  assertEquals(deleteOutcome({ transport: true }).kind, 'failed');
});

Deno.test('ledger rule: a stage wins over any reason, and a 500 with a stage but NO reason is still deleted', async () => {
  assertEquals(deleteOutcome(await refusal(500, { ok: false, reason: 'bad_proof', stage: 'requested' })), { kind: 'deleted' });
  assertEquals(deleteOutcome(await readDeleteReply(null, http(500, { ok: false, stage: 'scrubbed' }))), { kind: 'deleted' });
  assertEquals(deleteOutcome(await readDeleteReply(null, http(500, { ok: false, stage: null }))).kind, 'failed');
  assertEquals(deleteOutcome(await readDeleteReply(null, http(500, '<html>', true))).kind, 'failed');
  // the shared contract still holds for reason-bearing bodies and plain replies
  assertEquals(deleteOutcome(await readDeleteReply(null, http(400, { ok: false, reason: 'bad_proof' }))), { kind: 'bad_proof' });
  assertEquals(deleteOutcome(await readDeleteReply({ ok: true, stage: 'done' }, null)), { kind: 'deleted' });
});

Deno.test('ledger rule: runDelete turns a committed-but-faulted 500 into deleted WITHOUT the re-check', async () => {
  let checked = 0;
  const r = await runDelete({ proof: PW }, deps({
    invoke: () => Promise.resolve({ data: null, error: http(500, { ok: false, reason: 'auth_delete_failed', stage: 'scrubbed' }) }),
    checkAccount: () => { checked++; return Promise.resolve('exists'); },
  }));
  assertEquals(r, { kind: 'deleted' });
  assertEquals(checked, 0);
  // a FunctionsHttpError resolves { data:null, error } in supabase-js: the same through invoke's resolved shape
  const r2 = await runDelete({ proof: PW }, deps({ invoke: () => Promise.resolve({ data: null, error: http(500, { ok: false, reason: 'x', stage: 'requested' }) }) }));
  assertEquals(r2, { kind: 'deleted' });
});

Deno.test('google_proof_required: re-offers Google with the existing copy, like apple_proof_required', async () => {
  assertEquals(deleteOutcome(await refusal(200, { ok: false, reason: 'google_proof_required' })), { kind: 'google_required' });
  const sending = confirmDelete(askConfirm(setProof(initialDeleteState('password'), PW, T0))).state;
  const s = applyOutcome(sending, { kind: 'google_required' });
  assertEquals([s.phase, s.kind, s.proof, s.failed, s.proofRejected], ['editing', 'google', null, false, false]);
  assertFalse(canAsk(s));
  assert(canAsk(setProof(s, GO, T0 + 1)));
});
