/**
 * Hermetic tests for draft-order-notify/plan.ts. Run:
 *   deno test supabase/functions/draft-order-notify/plan.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  blockerReason,
  decideNotice,
  fairOrder,
  formatDraftDateTime,
  pushTitle,
  formatWeekdayTime,
  isDebouncing,
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

// ---- draft auto-start pushes (20261109000000): the Design Lead's copy, verbatim ----

Deno.test('ET formatting: time, weekday+time, full date; hourCycle h12 pinned; DST both ways; noon/midnight', () => {
  assertEquals(formatDraftTime('2026-10-10T23:00:00Z'), '7:00 PM'); // EDT
  assertEquals(formatDraftTime('2026-12-01T00:30:00Z'), '7:30 PM'); // EST
  assertEquals(formatDraftTime('2026-10-10T16:00:00Z'), '12:00 PM'); // noon is 12, never 0 (h12, not h11)
  assertEquals(formatDraftTime('2026-10-11T04:00:00Z'), '12:00 AM'); // midnight
  assertEquals(formatWeekdayTime('2026-10-03T22:00:00Z'), 'Sat 6:00 PM');
  assertEquals(formatDraftDateTime('2026-10-04T23:00:00Z'), 'Sun, Oct 4 · 7:00 PM');
  // 2026 switches: Mar 8 (spring forward) and Nov 1 (fall back), on either side.
  assertEquals(formatDraftDateTime('2026-03-08T06:30:00Z'), 'Sun, Mar 8 · 1:30 AM'); // EST, before 2 AM
  assertEquals(formatDraftDateTime('2026-03-08T07:30:00Z'), 'Sun, Mar 8 · 3:30 AM'); // EDT, the gap skipped
  assertEquals(formatDraftDateTime('2026-11-01T05:30:00Z'), 'Sun, Nov 1 · 1:30 AM'); // EDT, first 1:30
  assertEquals(formatDraftDateTime('2026-11-01T06:30:00Z'), 'Sun, Nov 1 · 1:30 AM'); // EST, the repeat
  for (const s of [formatDraftTime('2026-10-10T23:00:00Z'), formatDraftDateTime('2026-10-04T23:00:00Z')]) {
    assertEquals(/[\u202f\u00a0]/.test(s), false, 'plain spaces only');
  }
});

const T = '2026-10-10T23:00:00Z'; // Sat 7:00 PM EDT; the room opens Sat 6:00 PM
function ctx(o: Partial<NoticeContext> = {}): NoticeContext {
  return {
    kind: 'draft_room_open', league_id: 'L1', user_id: 'u1', created_at: '2026-10-10T22:00:00Z',
    league_name: 'Serie A Traders', draft_status: 'not_started', draft_date: T, draft_order_mode: 'random',
    is_member: true, is_commissioner: false, commissioner_name: 'Roberto B.', position: 4, told_time_before: false,
    watch: { draft_date: T, blocked: false, blockers: [], room_opened_at: '2026-10-10T22:00:00Z' },
    postponement: null,
    ...o,
  };
}
const body = (c: NoticeContext) => {
  const d = decideNotice(c);
  return d.send ? d.message.body : `SKIP:${d.outcome}`;
};
const blocked = (blockers: unknown[]) => ({ draft_date: T, blocked: true, room_opened_at: null, blockers });
const sofia = [{ code: 'roster_reconfirm_required', departed: [{ userId: 'x', name: 'Sofia F.' }] }];

Deno.test('room open (everyone): verbatim, your position, routed to the draft', () => {
  assertEquals(decideNotice(ctx()), {
    send: true,
    message: {
      title: 'Serie A Traders',
      body: 'The draft room is open. You pick 4th. The draft starts at 7:00 PM ET.',
      data: { type: 'draft_room_open', screen: 'draft', league_id: 'L1' },
    },
  });
  assertEquals(body(ctx({ position: 1 })), 'The draft room is open. You pick 1st. The draft starts at 7:00 PM ET.');
  assertEquals(body(ctx({ position: 12 })), 'The draft room is open. You pick 12th. The draft starts at 7:00 PM ET.');
});

Deno.test('room open: skipped when it no longer holds (postponed, started, another time, not opened, left)', () => {
  assertEquals(body(ctx({ postponement: { postponed_from: T, stage: 'start', reason: 'x', blockers: [] } })), 'SKIP:superseded');
  assertEquals(body(ctx({ draft_status: 'in_progress' })), 'SKIP:superseded');
  assertEquals(body(ctx({ draft_date: '2026-10-11T23:00:00Z' })), 'SKIP:superseded'); // rescheduled since
  assertEquals(body(ctx({ watch: null })), 'SKIP:superseded');
  assertEquals(body(ctx({ position: null })), 'SKIP:not_in_order');
  assertEquals(body(ctx({ is_member: false })), 'SKIP:not_in_order');
});

Deno.test('started (everyone): verbatim; skipped if the draft never started', () => {
  assertEquals(body(ctx({ kind: 'draft_started', draft_status: 'in_progress', position: 2 })), 'The draft has started. You pick 2nd.');
  assertEquals(body(ctx({ kind: 'draft_started', draft_status: 'in_progress', position: 3 })), 'The draft has started. You pick 3rd.');
  assertEquals(body(ctx({ kind: 'draft_started' })), 'SKIP:superseded');
});

Deno.test('at risk (commissioner): verbatim with the first blocker and the room deadline; skipped once fixed', () => {
  const c = ctx({ kind: 'draft_at_risk', is_commissioner: true, watch: blocked(sofia) });
  assertEquals(body(c), "The draft room can't open yet: Sofia F. left the league. Fix it before Sat 6:00 PM ET, or the draft is postponed.");
  assertEquals(body({ ...c, watch: { ...blocked(sofia), blocked: false } }), 'SKIP:superseded'); // fixed before delivery
  assertEquals(body({ ...c, is_commissioner: false }), 'SKIP:superseded'); // the role changed hands
  assertEquals(body({ ...c, watch: { ...blocked(sofia), draft_date: '2026-10-11T23:00:00Z' } }), 'SKIP:superseded');
});

Deno.test('reminder (commissioner, T-2h, still blocked): verbatim', () => {
  const c = ctx({ kind: 'draft_at_risk_reminder', is_commissioner: true, watch: blocked(sofia) });
  assertEquals(body(c), "One hour left to fix your league. If it isn't ready by 6:00 PM ET, the draft is postponed.");
  assertEquals(body({ ...c, watch: { ...blocked(sofia), blocked: false } }), 'SKIP:superseded');
});

Deno.test('postponed: verbatim for members (names the commissioner) and for the commissioner (the time it was judged)', () => {
  const pp = { postponed_from: T, stage: 'room_open', reason: 'not_enough_members', blockers: [{ code: 'not_enough_members' }] };
  const c = ctx({ kind: 'draft_postponed', draft_date: null, postponement: pp, watch: null });
  assertEquals(body(c), 'The draft is postponed. Roberto B. will pick a new time.');
  assertEquals(body({ ...c, commissioner_name: null }), 'The draft is postponed. The commissioner will pick a new time.');
  assertEquals(body({ ...c, is_commissioner: true }),
    "The draft is postponed: the league wasn't ready at 6:00 PM ET. Fix it, then pick a new time.");
  assertEquals(body({ ...c, is_commissioner: true, postponement: { ...pp, stage: 'start' } }),
    "The draft is postponed: the league wasn't ready at 7:00 PM ET. Fix it, then pick a new time."); // judged at T
  assertEquals(body({ ...c, postponement: null }), 'SKIP:superseded'); // a new time was set before delivery
});

Deno.test('time set (everyone): the current time, full form; first-set variant; nothing if cleared/postponed/started', () => {
  const c = ctx({ kind: 'draft_time_set', draft_date: '2026-10-04T23:00:00Z', watch: null, told_time_before: true });
  assertEquals(body(c), 'The draft is now Sun, Oct 4 · 7:00 PM ET.');
  assertEquals(body({ ...c, told_time_before: false }), 'The draft is set for Sun, Oct 4 · 7:00 PM ET.');
  assertEquals(body({ ...c, draft_date: null }), 'SKIP:superseded');
  assertEquals(body({ ...c, draft_status: 'in_progress' }), 'SKIP:superseded');
  assertEquals(body({ ...c, postponement: { postponed_from: T, stage: 'start', reason: 'x', blockers: [] } }), 'SKIP:superseded');
});

Deno.test('time set debounce: held for 2 quiet minutes; other kinds never', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  assertEquals(isDebouncing('draft_time_set', '2026-10-01T11:58:01Z', now), true);
  assertEquals(isDebouncing('draft_time_set', '2026-10-01T11:58:00Z', now), false);
  assertEquals(isDebouncing('draft_room_open', '2026-10-01T11:59:59Z', now), false);
});

Deno.test('blockerReason: the board lines, and a safe default', () => {
  const rc = (names: string[]) => [{ code: 'roster_reconfirm_required', departed: names.map((name) => ({ userId: name, name })) }];
  assertEquals(blockerReason(rc(['Sofia F.'])), 'Sofia F. left the league');
  assertEquals(blockerReason(rc(['Sofia F.', 'Ana P.'])), 'Sofia F. and Ana P. left the league');
  assertEquals(blockerReason(rc(['a', 'b', 'c'])), '3 managers left the league');
  assertEquals(blockerReason([{ code: 'playoff_teams_exceeds_members', playoffTeams: 8, members: 7 }]), '8 playoff teams, but 7 teams are in');
  assertEquals(blockerReason([{ code: 'playoff_teams_exceeds_members' }]), 'more playoff teams than teams');
  assertEquals(blockerReason([{ code: 'not_enough_members', have: 3, need: 4 }]), 'fewer than 4 teams have joined');
  assertEquals(blockerReason([{ code: 'slots_infeasible' }]), "some slots can't be filled");
  for (const code of ['budget_infeasible', 'no_stake_mode', 'invalid_playoff_teams', 'renewal_replies_pending']) {
    assertEquals(blockerReason([{ code }]) === 'something needs fixing', false, code);
  }
  assertEquals(blockerReason([]), 'something needs fixing');
  assertEquals(blockerReason(null), 'something needs fixing');
});

Deno.test('nextPushStatus: superseded settles as skipped', () => {
  assertEquals(nextPushStatus('superseded', 1), 'skipped');
});

Deno.test('fairOrder: round-robin across leagues, capped per league, oldest-first within a league', () => {
  const rows = [
    ...Array.from({ length: 30 }, (_, i) => ({ league_id: 'noisy', n: i })),
    { league_id: 'quiet', n: 100 },
    { league_id: 'other', n: 200 },
  ];
  const out = fairOrder(rows, 50, 20);
  assertEquals(out.slice(0, 3).map((r) => r.league_id), ['noisy', 'quiet', 'other']); // the quiet ones are not starved
  assertEquals(out.filter((r) => r.league_id === 'noisy').length, 20);
  assertEquals(out.filter((r) => r.league_id === 'noisy').map((r) => r.n), Array.from({ length: 20 }, (_, i) => i));
  assertEquals(fairOrder(rows, 2, 20).length, 2);
});

Deno.test('pushTitle: control characters stripped, length capped, a fallback', () => {
  assertEquals(pushTitle('Serie A Traders'), 'Serie A Traders');
  assertEquals(pushTitle('Bad\u0000\u0007\nName'), 'Bad Name');
  assertEquals(pushTitle('x'.repeat(80)).length, 60);
  assertEquals(pushTitle(null), 'Your league');
  assertEquals(pushTitle('   '), 'Your league');
});
