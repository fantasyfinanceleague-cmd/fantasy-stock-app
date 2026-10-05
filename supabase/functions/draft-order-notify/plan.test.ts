/**
 * Hermetic tests for draft-order-notify/plan.ts. Run:
 *   deno test supabase/functions/draft-order-notify/plan.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  draftOrderSetMessage,
  formatDraftTime,
  MAX_PUSH_ATTEMPTS,
  nextPushStatus,
  ordinal,
  renewalNoticeMessage,
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

const LEAGUE = { leagueName: 'Stock Scudetto', leagueId: 'lg-1' };

Deno.test('renewal invite and nudge: the 3c copy, verbatim', () => {
  const detail = { commissioner_name: 'Roberto B.', season_number: 2 };
  const want = 'Roberto B. is running it back. Are you in for Season 2?';
  assertEquals(renewalNoticeMessage({ kind: 'renewal_invite', detail, ...LEAGUE })?.body, want);
  assertEquals(renewalNoticeMessage({ kind: 'renewal_nudge', detail, ...LEAGUE })?.body, want);
  assertEquals(renewalNoticeMessage({ kind: 'renewal_invite', detail, ...LEAGUE })?.title, 'Stock Scudetto');
});

Deno.test('renewal reply: "running back" and "out", with the counts tail', () => {
  const m = renewalNoticeMessage({
    kind: 'renewal_reply', ...LEAGUE,
    detail: { subject_name: 'Gianluigi B.', response: 'in', season_number: 2, in: 4, out: 1, pending: 1 },
  });
  assertEquals(m?.body, 'Gianluigi B. is running back for Season 2. 4 running back · 1 out · 1 no reply yet.');
  const out = renewalNoticeMessage({
    kind: 'renewal_reply', ...LEAGUE,
    detail: { subject_name: 'Andrea P.', response: 'out', season_number: 2, in: 4, out: 2, pending: 0 },
  });
  assertEquals(out?.body, 'Andrea P. is out for Season 2. 4 running back · 2 out · 0 no reply yet.');
});

Deno.test('renewal removed: the new copy, pending Giorgio\'s OK', () => {
  const m = renewalNoticeMessage({
    kind: 'renewal_removed', ...LEAGUE,
    detail: { commissioner_name: 'Roberto B.', season_number: 2 },
  });
  assertEquals(m?.body, 'Roberto B. set up Season 2 of Stock Scudetto without you.');
});

Deno.test('season_set: the new copy, with the draft in ET; no date drops the sentence', () => {
  const withTime = renewalNoticeMessage({
    kind: 'season_set', ...LEAGUE,
    detail: { season_number: 2, draft_date: '2026-10-21T00:00:00Z' },
  });
  assertEquals(withTime?.body, 'Season 2 of Stock Scudetto is set. The draft is Tue, Oct 20 · 8:00 PM ET.');
  const noTime = renewalNoticeMessage({ kind: 'season_set', ...LEAGUE, detail: { season_number: 2 } });
  assertEquals(noTime?.body, 'Season 2 of Stock Scudetto is set.');
});

Deno.test('renewal data: the screen and kind are stable for the client router', () => {
  const m = renewalNoticeMessage({ kind: 'renewal_removed', ...LEAGUE, detail: { season_number: 2 } });
  assertEquals(m?.data, { type: 'renewal_removed', screen: 'league', league_id: 'lg-1' });
});

Deno.test('unknown kind: no message, and the row settles as skipped (never retried)', () => {
  assertEquals(renewalNoticeMessage({ kind: 'nonsense' as never, ...LEAGUE, detail: {} }), null);
  assertEquals(nextPushStatus('unknown_kind', 1), 'skipped');
});

