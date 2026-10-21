/**
 * Hermetic tests for join-league's takeover logic (takeover.ts).
 *   deno test supabase/functions/join-league/takeover.test.ts
 */
import { assertEquals, assertFalse } from 'jsr:@std/assert';
import {
  clientResponse,
  isTakeover,
  isTakeoverPreview,
  parseTakeoverPreviewRequest,
  parseTakeoverRequest,
  previewResponse,
  MALFORMED_CODE_REFUSAL,
  statusFor,
  TAKEOVER_CODE_RE,
  TAKEOVER_REASONS,
  takeoverMessage,
} from './takeover.ts';

const L = '11111111-1111-4111-8111-111111111111';

const CODE = 'ABCDE12345';

Deno.test('isTakeover: only an explicit action; the legacy join body is not one', () => {
  assertEquals(isTakeover({ action: 'takeover', code: CODE }), true);
  for (const b of [{ code: 'ABC123' }, {}, null, 'takeover', { action: 'join' }]) assertEquals(isTakeover(b), false);
});

Deno.test('parse: the body carries ONLY a code; anything else is null', () => {
  assertEquals(parseTakeoverRequest({ action: 'takeover', code: ` ${CODE} ` }), { code: CODE });
  for (const bad of [
    { action: 'takeover' },
    { action: 'takeover', code: '' },
    { action: 'takeover', code: 7 },
    { action: 'takeover', code: 'x'.repeat(65) },
    { code: CODE },
  ]) assertEquals(parseTakeoverRequest(bad), null, JSON.stringify(bad));
});

Deno.test('parse: a league id or user id in the body is never read (the league comes from the code, the user from the JWT)', () => {
  const t = parseTakeoverRequest({ action: 'takeover', code: CODE, league_id: L, user_id: 'someone-else', p_user_id: 'x' });
  assertEquals(t, { code: CODE });
});

Deno.test('code format: exactly ten of A-Z0-9, matched exactly (lowercase is not a code)', () => {
  assertEquals(TAKEOVER_CODE_RE.test(CODE), true);
  for (const bad of ['abcde12345', 'ABCDE1234', 'ABCDE123456', 'ABCDE-2345', ' ABCDE12345', 'ABCDE12345\n', '', 'TKV-123']) {
    assertEquals(TAKEOVER_CODE_RE.test(bad), false, JSON.stringify(bad));
  }
  assertEquals(MALFORMED_CODE_REFUSAL, { ok: false, reason: 'invalid_code' });
});

Deno.test('client response: taken_over carries only the league; the notice and commissioner never leave', () => {
  const r = clientResponse({
    status: 'taken_over', notice_id: 'n1', notify_user_id: 'commish', league_id: L, league_name: 'Alpha', new_name: 'Roberto',
  });
  assertEquals(r, { ok: true, status: 'taken_over', league: { id: L, name: 'Alpha' } });
  const text = JSON.stringify(r);
  for (const leak of ['n1', 'commish', 'Roberto']) assertFalse(text.includes(leak));
});

Deno.test('client response: the league id is the database\'s uuid or null, never an arbitrary value', () => {
  assertEquals(clientResponse({ status: 'taken_over', league_id: 'not-a-uuid', league_name: 'A' }), {
    ok: true, status: 'taken_over', league: { id: null, name: 'A' },
  });
  assertEquals(clientResponse({ status: 'taken_over', league_name: 'A' }), { ok: true, status: 'taken_over', league: { id: null, name: 'A' } });
});

Deno.test("client response: 'taken' and every other known refusal pass through as a reason", () => {
  for (const reason of TAKEOVER_REASONS) {
    assertEquals(clientResponse({ status: 'refused', reason }), { ok: false, reason });
  }
  assertEquals(clientResponse({ status: 'refused', reason: 'taken' }), { ok: false, reason: 'taken' });
});

Deno.test('client response: an unknown reason, status or null is unhandled, never forwarded', () => {
  for (const r of [null, {}, { status: 'refused', reason: 'sql: secret detail' }, { status: 'maybe' }, { status: 'refused' }]) {
    assertEquals(clientResponse(r as never), { ok: false, reason: 'unhandled' });
  }
});

Deno.test('push copy: names the new manager and the placeholder from the database', () => {
  assertEquals(takeoverMessage({ leagueId: L, leagueName: 'Alpha', newName: 'Roberto B.', placeholder: 'Former manager' }), {
    title: 'Alpha',
    body: "Roberto B. took over Former manager's team.",
    data: { type: 'seat_taken_over', league_id: L },
  });
});

Deno.test('push copy: without a placeholder or names it never invents a label', () => {
  const m = takeoverMessage({ leagueId: null, leagueName: null, newName: null, placeholder: '  ' });
  assertEquals(m.title, 'your league');
  assertEquals(m.body, 'A new manager took over an open team.');
});

// ---- takeover_preview ----------------------------------------------------------------

Deno.test('preview: its own action, takes only a code; a take body is not a preview', () => {
  assertEquals(isTakeoverPreview({ action: 'takeover_preview', code: 'x' }), true);
  for (const b of [{ action: 'takeover', code: 'x' }, { code: 'x' }, null]) assertEquals(isTakeoverPreview(b), false);
  assertEquals(isTakeover({ action: 'takeover_preview', code: 'x' }), false, 'a preview must never reach take_over_team');
  assertEquals(parseTakeoverPreviewRequest({ action: 'takeover_preview', code: ' abc ' }), { code: 'abc' });
  for (const bad of [{ action: 'takeover_preview' }, { action: 'takeover_preview', code: '' }, { action: 'takeover_preview', code: 5 },
    { action: 'takeover_preview', code: 'x'.repeat(65) }]) assertEquals(parseTakeoverPreviewRequest(bad), null);
});

Deno.test('preview response: league name and record only, both envelope shapes', () => {
  const want = { ok: true, league_name: 'Alpha', wins: 3, losses: 2, rank: 4 };
  assertEquals(previewResponse({ status: 'ok', league_name: 'Alpha', wins: 3, losses: 2, rank: 4 }), want);
  assertEquals(previewResponse({ ok: true, league_name: 'Alpha', wins: 3, losses: 2, rank: 4 }), want);
  // nothing else the SQL returned leaks through
  const r = previewResponse({ status: 'ok', league_name: 'Alpha', wins: 3, losses: 2, rank: 4, seat_user_id: 'u-secret', league_id: 'L-secret' });
  assertFalse(JSON.stringify(r).includes('secret'));
});

Deno.test('preview response: a missing or odd record is null, not a made-up number', () => {
  assertEquals(previewResponse({ status: 'ok', league_name: 'A', wins: '3', losses: -1, rank: 1.5 }), {
    ok: true, league_name: 'A', wins: null, losses: null, rank: null,
  });
  assertEquals(previewResponse({ status: 'ok', league_name: 'A' }), { ok: true, league_name: 'A', wins: null, losses: null, rank: null });
});

Deno.test('preview response: every takeover reason passes through; unknown ones do not', () => {
  for (const reason of TAKEOVER_REASONS) {
    assertEquals(previewResponse({ status: 'refused', reason }), { ok: false, reason });
    assertEquals(previewResponse({ ok: false, reason }), { ok: false, reason });
  }
  for (const r of [null, {}, { status: 'refused', reason: 'sql: detail' }, { status: 'ok' }, { status: 'ok', league_name: '' }, { ok: true }]) {
    assertEquals(previewResponse(r as never), { ok: false, reason: 'unhandled' });
  }
});

Deno.test("'taken' and 'invalid_code' map to the SAME HTTP status (the body reason may differ for the UI, the transport must not)", () => {
  const taken = clientResponse({ status: 'refused', reason: 'taken' });
  const invalid = clientResponse({ status: 'refused', reason: 'invalid_code' });
  assertEquals(statusFor(taken), statusFor(invalid));
  assertEquals(statusFor(previewResponse({ status: 'refused', reason: 'taken' })), statusFor(previewResponse({ status: 'refused', reason: 'invalid_code' })));
  assertEquals(statusFor(MALFORMED_CODE_REFUSAL), statusFor(invalid), 'the edge answer matches the SQL one');
  // and so does every other seat-state refusal: only rate_limited differs
  for (const reason of ['gone', 'not_deleted', 'window', 'already_member', 'not_eligible', 'taken', 'invalid_code']) {
    assertEquals(statusFor(clientResponse({ status: 'refused', reason })), 200, reason);
  }
});

Deno.test("rate_limited from the SQL passes through both shapers as a 429; every other answer stays 200", () => {
  assertEquals(clientResponse({ status: 'refused', reason: 'rate_limited' }), { ok: false, reason: 'rate_limited' });
  assertEquals(previewResponse({ status: 'refused', reason: 'rate_limited' }), { ok: false, reason: 'rate_limited' });
  assertEquals(previewResponse({ ok: false, reason: 'rate_limited' }), { ok: false, reason: 'rate_limited' });
  assertEquals(statusFor({ ok: false, reason: 'rate_limited' }), 429);
  for (const b of [{ ok: false, reason: 'taken' }, { ok: false, reason: 'unhandled' }, { ok: true, status: 'taken_over' }, { ok: true }]) {
    assertEquals(statusFor(b), 200, JSON.stringify(b));
  }
});
