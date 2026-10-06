/**
 * Hermetic tests for draft-order-notify/plan.ts. Run:
 *   deno test supabase/functions/draft-order-notify/plan.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  blockerReason,
  decideNotice,
  draftOrderSetMessage,
  formatDraftTime,
  MAX_PUSH_ATTEMPTS,
  nextPushStatus,
  type NoticeContext,
  ordinal,
} from './plan.ts';

Deno.test('ordinal: 1st 2nd 3rd 4th, the teens, and the twenties', () => {
  const got = [1, 2, 3, 4, 10, 11, 12, 13, 14, 21, 22, 23, 24, 101, 111, 112, 113].map(ordinal);
  assertEquals(got, [
    '1st', '2nd', '3rd', '4th', '10th', '11th', '12th', '13th', '14th',
    '21st', '22nd', '23rd', '24th', '101st', '111th', '112th', '113th',
  ]);
});

Deno.test('message: Design Lead copy, random and manual; time only, Eastern, labeled ET', () => {
  const base = { leagueName: 'Office League', leagueId: 'L1', position: 4, draftStarted: false };
  // 2026-10-10 23:00Z = 7:00 PM EDT
  assertEquals(draftOrderSetMessage({ ...base, mode: 'random', draftDate: '2026-10-10T23:00:00Z' }), {
    title: 'Office League',
    body: 'The draft order is set. You pick 4th. The draft starts at 7:00 PM ET.',
    data: { type: 'draft_order_set', screen: 'draft', league_id: 'L1' },
  });
  assertEquals(
    draftOrderSetMessage({ ...base, mode: 'manual', position: 1, draftDate: '2026-12-01T00:30:00Z' }).body,
    'The commissioner set the draft order. You pick 1st. The draft starts at 7:30 PM ET.', // EST in December
  );
});

Deno.test('message: no start time when the date is TBD or the draft already started', () => {
  const base = { leagueName: 'L', leagueId: 'L1', mode: 'random', position: 2 };
  assertEquals(draftOrderSetMessage({ ...base, draftDate: null, draftStarted: false }).body,
    'The draft order is set. You pick 2nd.');
  assertEquals(draftOrderSetMessage({ ...base, draftDate: '2026-10-10T23:00:00Z', draftStarted: true }).body,
    'The draft order is set. You pick 2nd.');
});

Deno.test('formatDraftTime: plain ASCII space before AM/PM', () => {
  assertEquals(formatDraftTime('2026-10-10T13:05:00Z'), '9:05 AM');
});

Deno.test('nextPushStatus: definitive outcomes settle at once', () => {
  assertEquals(nextPushStatus('sent', 1), 'sent');
  assertEquals(nextPushStatus('no_token', 1), 'no_device');
  assertEquals(nextPushStatus('not_in_order', 1), 'skipped');
});

Deno.test('nextPushStatus: transient failures retry until the budget is spent, then fail', () => {
  for (const o of ['lookup_failed', 'expo_error', 'expo_ticket_error'] as const) {
    for (let a = 1; a < MAX_PUSH_ATTEMPTS; a++) assertEquals(nextPushStatus(o, a), 'pending', `${o} @${a}`);
    assertEquals(nextPushStatus(o, MAX_PUSH_ATTEMPTS), 'failed', o);
  }
});

// ---- draft auto-start pushes (20261109000000) -------------------------------

const T = '2026-10-10T23:00:00Z'; // 7:00 PM EDT
function ctx(o: Partial<NoticeContext> = {}): NoticeContext {
  return {
    kind: 'draft_room_open', league_id: 'L1', user_id: 'u1', created_at: '2026-10-10T22:00:00Z',
    league_name: 'Serie A Traders', draft_status: 'not_started', draft_date: T, draft_order_mode: 'random',
    is_member: true, is_commissioner: false, commissioner_name: 'Roberto B.', position: 4,
    watch: { draft_date: T, blocked: false, blockers: [], room_opened_at: '2026-10-10T22:00:00Z' },
    postponement: null,
    ...o,
  };
}
const body = (c: NoticeContext) => {
  const d = decideNotice(c);
  return d.send ? d.message.body : `SKIP:${d.outcome}`;
};

Deno.test('room open: the board string with your position and the time; routed to the draft', () => {
  const d = decideNotice(ctx());
  assertEquals(d, {
    send: true,
    message: {
      title: 'Serie A Traders',
      body: 'The draft order is set. You pick 4th. The draft starts at 7:00 PM ET.',
      data: { type: 'draft_room_open', screen: 'draft', league_id: 'L1' },
    },
  });
  assertEquals(body(ctx({ draft_order_mode: 'manual', position: 1 })),
    'The commissioner set the draft order. You pick 1st. The draft starts at 7:00 PM ET.');
});

Deno.test('room open: skipped when it no longer holds (postponed, started, another time, not opened, left)', () => {
  assertEquals(body(ctx({ postponement: { postponed_from: T, stage: 'start', reason: 'x', blockers: [] } })), 'SKIP:superseded');
  assertEquals(body(ctx({ draft_status: 'in_progress' })), 'SKIP:superseded');
  assertEquals(body(ctx({ draft_date: '2026-10-11T23:00:00Z' })), 'SKIP:superseded'); // rescheduled since
  assertEquals(body(ctx({ watch: null })), 'SKIP:superseded');
  assertEquals(body(ctx({ position: null })), 'SKIP:not_in_order');
  assertEquals(body(ctx({ is_member: false })), 'SKIP:not_in_order');
});

Deno.test('started: the board string; skipped if the draft never started', () => {
  assertEquals(body(ctx({ kind: 'draft_started', draft_status: 'in_progress' })), 'Your draft has started. You pick 4th.');
  assertEquals(body(ctx({ kind: 'draft_started' })), 'SKIP:superseded');
});

Deno.test('at risk: the board string early; the deadline version inside T-2h; skipped once fixed', () => {
  const blocked = {
    draft_date: T, blocked: true, room_opened_at: null,
    blockers: [{ code: 'roster_reconfirm_required', departed: [{ userId: 'x', name: 'Sofia F.' }] }],
  };
  const c = ctx({ kind: 'draft_at_risk', is_commissioner: true, watch: blocked, created_at: '2026-10-10T18:00:00Z' });
  assertEquals(body(c), "Your draft can't start at 7:00 PM ET: Sofia F. left the league. Fix it in the lobby.");
  assertEquals(body({ ...c, created_at: '2026-10-10T21:00:00Z' }), // T-2h exactly: the reminder
    "Your draft can't start at 7:00 PM ET: Sofia F. left the league. Fix it by 6:00 PM ET, or it will be postponed.");
  assertEquals(body({ ...c, watch: { ...blocked, blocked: false } }), 'SKIP:superseded'); // fixed before delivery
  assertEquals(body({ ...c, is_commissioner: false }), 'SKIP:superseded'); // commissioner changed
  assertEquals(body({ ...c, watch: { ...blocked, draft_date: '2026-10-11T23:00:00Z' } }), 'SKIP:superseded');
});

Deno.test('postponed: the board string for members (names the commissioner); NEW copy for the commissioner', () => {
  const pp = { postponed_from: T, stage: 'room_open', reason: 'not_enough_members', blockers: [{ code: 'not_enough_members' }] };
  const c = ctx({ kind: 'draft_postponed', draft_date: null, postponement: pp, watch: null });
  assertEquals(body(c), 'The draft is postponed. Roberto B. will pick a new time.');
  assertEquals(body({ ...c, commissioner_name: null }), 'The draft is postponed. The commissioner will pick a new time.');
  assertEquals(body({ ...c, is_commissioner: true }),
    'Your draft is postponed: the league needs at least 4 managers. Pick a new draft time in the lobby.');
  assertEquals(body({ ...c, postponement: null }), 'SKIP:superseded'); // a new time was set before delivery
});

Deno.test('blockerReason: names who left; one line per blocker; a safe default', () => {
  const rc = (names: string[]) => [{ code: 'roster_reconfirm_required', departed: names.map((name) => ({ userId: name, name })) }];
  assertEquals(blockerReason(rc(['Sofia F.'])), 'Sofia F. left the league');
  assertEquals(blockerReason(rc(['Sofia F.', 'Ana P.'])), 'Sofia F. and Ana P. left the league');
  assertEquals(blockerReason(rc(['a', 'b', 'c'])), '3 managers left the league');
  assertEquals(blockerReason(rc([])), 'a manager left the league');
  for (const code of ['not_enough_members', 'no_stake_mode', 'invalid_playoff_teams', 'playoff_teams_exceeds_members',
    'slots_infeasible', 'budget_infeasible', 'renewal_replies_pending', 'room_did_not_open', 'start_failed']) {
    const s = blockerReason([{ code }]);
    assertEquals(s === 'something needs fixing', false, code);
  }
  assertEquals(blockerReason([]), 'something needs fixing');
  assertEquals(blockerReason(null), 'something needs fixing');
});

Deno.test('nextPushStatus: superseded settles as skipped', () => {
  assertEquals(nextPushStatus('superseded', 1), 'skipped');
});
