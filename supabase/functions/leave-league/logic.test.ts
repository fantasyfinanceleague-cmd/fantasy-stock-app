import { assertEquals } from 'jsr:@std/assert';
import { clientResponse, commissionerTransferredMessage, memberLeftMessage, noticeStatus, parseLeaveRequest } from './logic.ts';

const L = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

Deno.test('parseLeaveRequest: defaults to leave; strict on everything else', () => {
  assertEquals(parseLeaveRequest({ league_id: L }), { action: 'leave', leagueId: L, newCommissionerId: null });
  assertEquals(parseLeaveRequest({ action: 'leave', league_id: ` ${L} `, new_commissioner_id: U }),
    { action: 'leave', leagueId: L, newCommissionerId: U });
  assertEquals(parseLeaveRequest({ action: 'unhide', league_id: L }), null, 'unhide is not exposed in 1.2.0');
  assertEquals(parseLeaveRequest({ action: 'transfer', league_id: L, new_commissioner_id: U }),
    { action: 'transfer', leagueId: L, newCommissionerId: U });
  assertEquals(parseLeaveRequest({ action: 'transfer', league_id: L }), null, 'a transfer needs its target');
  assertEquals(parseLeaveRequest({ action: 'transfer', league_id: L, new_commissioner_id: 'bot-2' }), null);
  assertEquals(parseLeaveRequest({ action: 'leave', league_id: L, new_commissioner_id: '' }),
    { action: 'leave', leagueId: L, newCommissionerId: null });
  for (const bad of [
    null, 'x', 42, {}, { league_id: 'nope' }, { action: 'delete', league_id: L },
    { league_id: L, new_commissioner_id: 'bot-1' }, // a bot is never a successor
    { league_id: L, new_commissioner_id: 7 },
  ]) {
    assertEquals(parseLeaveRequest(bad), null, JSON.stringify(bad));
  }
});

Deno.test('clientResponse: the outcome only, never the push internals', () => {
  const left = clientResponse({
    status: 'left', reconfirm_required: true, made_commissioner: false, notice_id: 'n', notify_user_id: U,
    leaver_name: 'Sam', league_name: 'L', members_before: 5, members_after: 4,
  });
  assertEquals(left, { ok: true, status: 'left', reconfirm_required: true });
  assertEquals(clientResponse({ status: 'hidden', already_hidden: true }), { ok: true, status: 'hidden' });
  assertEquals(
    clientResponse({ status: 'transferred', reconfirm_owed: true, notice_id: 'n', notify_user_id: U, from_name: 'R', league_name: 'L' }),
    { ok: true, status: 'transferred', reconfirm_owed: true },
  );
  assertEquals(clientResponse({ status: 'refused', reason: 'transfer_first' }), { ok: false, reason: 'transfer_first' });
  assertEquals(clientResponse({ status: 'shown', already_shown: false }), { ok: false, reason: 'unhandled' });
  assertEquals(clientResponse({ status: 'refused', reason: 'locked_in', window: 'order_set' }),
    { ok: false, reason: 'locked_in', window: 'order_set' });
  assertEquals(clientResponse({ status: 'refused', reason: 'successor_required' }), { ok: false, reason: 'successor_required' });
  assertEquals(clientResponse(null as never), { ok: false, reason: 'unhandled' });
  assertEquals(clientResponse({ status: 'weird' }), { ok: false, reason: 'unhandled' });
});

Deno.test('memberLeftMessage: three variants, safe fallbacks', () => {
  const base = { leagueId: L, leagueName: 'Wall St', leaverName: 'Sam', madeCommissioner: false, reconfirmRequired: true };
  assertEquals(memberLeftMessage(base).body, 'Sam left Wall St. Confirm your roster before the draft.');
  assertEquals(memberLeftMessage({ ...base, madeCommissioner: true }).body,
    'Sam left Wall St and made you commissioner. Confirm your roster before the draft.');
  assertEquals(memberLeftMessage({ ...base, reconfirmRequired: false }).body, 'Sam left Wall St.');
  assertEquals(memberLeftMessage({ ...base, leagueName: ' ', leaverName: null }).body,
    'A manager left your league. Confirm your roster before the draft.');
  assertEquals(memberLeftMessage(base).title, 'Wall St');
  assertEquals(memberLeftMessage(base).data, { type: 'member_left', league_id: L });
});

Deno.test('noticeStatus: one attempt, settled truthfully', () => {
  assertEquals(noticeStatus('sent'), 'sent');
  assertEquals(noticeStatus('no_token'), 'no_device');
  for (const o of ['lookup_failed', 'expo_error', 'expo_ticket_error'] as const) assertEquals(noticeStatus(o), 'failed');
});

Deno.test('commissionerTransferredMessage: copy, owed-confirmation variant, fallbacks', () => {
  const base = { leagueId: L, leagueName: 'Serie A Traders', fromName: 'Roberto B.', reconfirmOwed: false };
  assertEquals(commissionerTransferredMessage(base).body, 'Roberto B. made you commissioner of Serie A Traders.');
  assertEquals(commissionerTransferredMessage({ ...base, reconfirmOwed: true }).body,
    'Roberto B. made you commissioner of Serie A Traders. Confirm your roster before the draft.');
  assertEquals(commissionerTransferredMessage({ ...base, leagueName: null, fromName: ' ' }).body,
    "You're now the commissioner of your league.");
  assertEquals(commissionerTransferredMessage(base).title, 'Serie A Traders');
  assertEquals(commissionerTransferredMessage(base).data, { type: 'commissioner_transferred', league_id: L });
});
