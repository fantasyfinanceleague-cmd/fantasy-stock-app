/**
 * Run it back rules (3c, R1–R10), against the PR #94 SQL contract. The group
 * copy map, the counts line, the draft gate (disabled exactly while replies are
 * pending), the 24 h nudge window, the Season 1 order, and which screen each
 * caller sees. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import {
  groupCopy, countsLine, draftDisabled, nudgeWindow, orderRoster, screenFor,
  removeActionTitle, askedLine, type RenewalGroup,
} from '../lib/game/renewal.ts';

Deno.test('group → copy: in is Running back, new is Joining (+ New), out is Out, pending is No reply yet', () => {
  assertEquals(groupCopy('in'), { label: 'Running back', marker: null });
  assertEquals(groupCopy('new'), { label: 'Joining', marker: 'New' });
  assertEquals(groupCopy('out'), { label: 'Out', marker: null });
  assertEquals(groupCopy('pending'), { label: 'No reply yet', marker: null });
});

Deno.test('the counts line is the board\'s own words', () => {
  assertEquals(
    countsLine({ in: 4, new: 1, out: 1, pending: 1, team_count: 5, max_teams: 16 }),
    '4 running back · 1 new · 1 out · 1 no reply yet',
  );
});

Deno.test('the draft rows are disabled exactly while replies are pending', () => {
  assertEquals(draftDisabled(true), true);
  assertEquals(draftDisabled(false), false);
});

Deno.test('a nudge is allowed once a day: enabled with no prior nudge, disabled inside 24 h with the time it unlocks', () => {
  const now = new Date('2026-01-17T14:00:00Z');
  assertEquals(nudgeWindow({ lastNudgedAt: null, now }).enabled, true);
  const soon = nudgeWindow({ lastNudgedAt: '2026-01-17T10:00:00Z', now });
  assertEquals(soon.enabled, false);
  assert(soon.unlocksLine !== null && soon.unlocksLine.startsWith('You can nudge again tomorrow at '));
  assertEquals(nudgeWindow({ lastNudgedAt: '2026-01-16T13:00:00Z', now }).enabled, true);
});

Deno.test('the roster is Season 1 order (its frozen rank), newcomers last', () => {
  const people: { user_id: string; group: RenewalGroup }[] = [
    { user_id: 'marta', group: 'new' },
    { user_id: 'andrea', group: 'pending' },
    { user_id: 'roberto', group: 'in' },
    { user_id: 'alessandro', group: 'out' },
  ];
  const season1 = ['roberto', 'paolo', 'alessandro', 'andrea'];
  assertEquals(orderRoster(people, season1).map((p) => p.user_id), ['roberto', 'alessandro', 'andrea', 'marta']);
});

Deno.test('the commissioner sees the reconcile list; an in player sees the read-only list; pending or out see the ask or nothing', () => {
  assertEquals(screenFor({ status: 'ok', full_list: true, is_commissioner: true, caller_status: 'in' }), 'reconcile');
  assertEquals(screenFor({ status: 'ok', full_list: true, is_commissioner: false, caller_status: 'in' }), 'member_list');
  assertEquals(screenFor({ status: 'ok', full_list: false, caller_status: 'pending' }), 'ask');
  assertEquals(screenFor({ status: 'ok', full_list: false, caller_status: 'out' }), 'none');
  assertEquals(screenFor({ status: 'not_visible' }), 'none');
});

Deno.test('the remove action names the person; the asked line gives the date', () => {
  assertEquals(removeActionTitle('Andrea P.'), 'Remove Andrea P.');
  assertEquals(askedLine('2026-01-16T18:00:00Z'), 'Asked Fri, Jan 16.');
});

import { buildNonReplySheet } from '../lib/game/renewal.ts';

Deno.test('R7: the native sheet names the person, gives the dates, and offers nudge only inside the window', () => {
  const open = buildNonReplySheet({ name: 'Andrea P.', askedLine: 'Asked Fri, Jan 16.', nudgedLine: 'Nudged Sat, Jan 17.', nudgeEnabled: true, unlocksLine: null });
  assertEquals(open.title, 'Andrea P. hasn\'t replied');
  assertEquals(open.message, 'Asked Fri, Jan 16. Nudged Sat, Jan 17. You can nudge once a day.');
  assertEquals(open.actions, ['nudge', 'remove', 'cancel']);
  assertEquals(open.options.map((o) => o.label), ['Nudge again', 'Remove Andrea P.', 'Cancel']);
  assertEquals(open.destructiveIndex, 1);
  assertEquals(open.cancelIndex, 2);
});

Deno.test('R7 inside 24 h: no nudge button, and the message says when it unlocks', () => {
  const soon = buildNonReplySheet({ name: 'Andrea P.', askedLine: 'Asked Fri, Jan 16.', nudgedLine: 'Nudged Sat, Jan 17.', nudgeEnabled: false, unlocksLine: 'You can nudge again tomorrow at 9:15 AM ET.' });
  assertEquals(soon.actions, ['remove', 'cancel']);
  assertEquals(soon.options.map((o) => o.label), ['Remove Andrea P.', 'Cancel']);
  assertEquals(soon.message, 'Asked Fri, Jan 16. Nudged Sat, Jan 17. You can nudge again tomorrow at 9:15 AM ET.');
  assertEquals(soon.destructiveIndex, 0);
  assertEquals(soon.cancelIndex, 1);
});

import { nudgedLine } from '../lib/game/renewal.ts';

Deno.test('the nudged date reads like the asked date', () => {
  assertEquals(nudgedLine('2026-01-17T14:00:00Z'), 'Nudged Sat, Jan 17.');
});

// ── Home's season-complete card: the member's Season 2 ask (board #run-it-back frame 1) ──

import { screenFor as screenFor2, showsHomeRenewalAsk } from '../lib/game/renewal.ts';
import { SOURCES as SOURCES2 } from './sourceManifest.generated.ts';

Deno.test('a member still asked sees the ask on Home', () => {
  const screen = screenFor2({ status: 'ok', full_list: false, caller_status: 'pending' });
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: 'S2', screen }), true);
});

Deno.test('once a member has answered, the ask goes (in → the member list; out → nothing)', () => {
  const inScreen = screenFor2({ status: 'ok', full_list: true, is_commissioner: false, caller_status: 'in' });
  const outScreen = screenFor2({ status: 'ok', full_list: false, caller_status: 'out' });
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: 'S2', screen: inScreen }), false);
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: 'S2', screen: outScreen }), false);
});

Deno.test('the commissioner never sees the ask (they have RunItBackCard); no Season 2, no ask; not read yet, no ask', () => {
  assertEquals(showsHomeRenewalAsk({ isCommissioner: true, successorId: 'S2', screen: 'ask' }), false);
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: null, screen: 'ask' }), false);
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: 'S2', screen: null }), false);
});

Deno.test('Home mounts it next to RunItBackCard, for members only, and it re-reads after an answer (source guards)', () => {
  const home = SOURCES2['app/(tabs)/index.tsx'];
  assertEquals(home.includes('{league?.successor_league_id && league.commissioner_id !== myUserId ? ('), true);
  assertEquals(home.includes('<HomeRenewalAsk'), true);
  const ask = SOURCES2['components/game/HomeRenewalAsk.tsx'];
  assertEquals(ask.includes('onAnswered={() => setKey((k) => k + 1)}'), true);
});
