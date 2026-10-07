/**
 * Leaving a league and handing over the title (3c-2, item 13; board #call-leave,
 * ruled 2026-10-06; refusals from the UX audit's Rule 8 table › leave-league).
 * The window mirrors _league_membership_window (20261110000000); the server is
 * the gate, so these only shape the row, the sheet, and the outcome lines.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  COMMISSIONER_ROW, COMMISSIONER_YOU, HAND_OVER, LEAVE_COMMISSIONER_FIRST, LEAVE_LEAGUE, LEAVE_LOCKED_LINE, LEAVE_REFUSAL_REASONS,
  LEAVE_UNCONFIRMED, LEAVE_UNTIL_NO_TIME, MEMBER_LINE, STAY, TRANSFER_NOTE, TRANSFER_TITLE, WHO_TAKES_OVER,
  handOverLabel, leaveOutcome, leaveRecheck, transferUnknownLine, leaveRowView, leaveSheetCopy, leaveWindow, orderAtLabel, orderSetAtMs, transferAllowed, transferCandidates,
} from '../lib/game/leaveLeague.ts';
import { leaveLeagueFixture } from '../lib/game/seamFixtures.ts';
import { SOURCES } from './sourceManifest.generated.ts';

// The board's sample: Serie A Traders, draft Sat Oct 3 2026 7:00 PM ET (23:00Z); the order is set at 6:00 PM ET.
const DRAFT = '2026-10-03T23:00:00Z';
const THU = Date.parse('2026-10-01T16:00:00Z');
const ORDER_SET = Date.parse('2026-10-03T22:00:00Z');
const pre = { seasonStatus: 'active', draftStatus: 'not_started', draftDate: DRAFT };

Deno.test('the board\'s copy, verbatim', () => {
  assertEquals(LEAVE_LEAGUE, 'Leave league');
  assertEquals(STAY, 'Stay');
  assertEquals(COMMISSIONER_ROW, 'Commissioner');
  assertEquals(COMMISSIONER_YOU, 'You');
  assertEquals(LEAVE_LOCKED_LINE, 'Teams are locked in from an hour before the draft until the season ends.');
  assertEquals(LEAVE_COMMISSIONER_FIRST, 'Make someone else commissioner first.');
  assertEquals(WHO_TAKES_OVER, 'Who takes over as commissioner?');
  assertEquals(MEMBER_LINE, 'Member');
  // The transfer sheet (Design Lead, ruled).
  assertEquals(TRANSFER_TITLE, 'Make someone else commissioner');
  assertEquals(TRANSFER_NOTE, 'The new commissioner takes over right away. You stay in the league.');
  assertEquals(LEAVE_UNTIL_NO_TIME, 'You can leave until an hour before the draft.');
  assertEquals(LEAVE_UNCONFIRMED, "We couldn't confirm that. Check your connection, then try again.");
  assertEquals(handOverLabel('Paolo M.'), 'Hand over to Paolo M.');
  assertEquals(HAND_OVER, 'Hand over');
});

// ── The window ──

Deno.test('open before the order is set; locked from T−1h; locked once the draft starts; open after the season', () => {
  assertEquals(leaveWindow(pre, THU), 'before_draft');
  assertEquals(leaveWindow(pre, ORDER_SET - 1), 'before_draft');
  assertEquals(leaveWindow(pre, ORDER_SET), 'locked_order_set');
  assertEquals(leaveWindow({ ...pre, draftStatus: 'in_progress' }, THU), 'locked_season');
  assertEquals(leaveWindow({ ...pre, draftStatus: 'completed', seasonStatus: 'playoffs' }, THU), 'locked_season');
  assertEquals(leaveWindow({ ...pre, draftStatus: 'completed', seasonStatus: 'completed' }, THU), 'after_season');
});

Deno.test('the server\'s order of checks: a finished season wins over a started draft; no draft time is never "due"', () => {
  assertEquals(leaveWindow({ seasonStatus: 'completed', draftStatus: 'in_progress', draftDate: DRAFT }, ORDER_SET), 'after_season');
  assertEquals(leaveWindow({ seasonStatus: 'active', draftStatus: null, draftDate: null }, ORDER_SET), 'before_draft');
  assertEquals(leaveWindow({ seasonStatus: 'active', draftStatus: 'not_started', draftDate: 'nonsense' }, ORDER_SET), 'before_draft');
});

Deno.test('the order time: an hour before the draft, "Sat 6:00 PM ET"', () => {
  assertEquals(orderSetAtMs(DRAFT), ORDER_SET);
  assertEquals(orderSetAtMs(null), null);
  assertEquals(orderAtLabel(ORDER_SET), 'Sat 6:00 PM ET');
  // Winter (EST): Sat Dec 5 2026 7:00 PM ET = 00:00Z Sun.
  assertEquals(orderAtLabel(Date.parse('2026-12-05T23:00:00Z')), 'Sat 6:00 PM ET');
});

// ── The row ──

Deno.test('the row: open says until when (board "Before the lock")', () => {
  assertEquals(leaveRowView('before_draft', false, DRAFT), { enabled: true, sub: 'You can leave until Sat 6:00 PM ET, when the draft order is set.' });
  assertEquals(leaveRowView('before_draft', false, null), { enabled: true, sub: 'You can leave until an hour before the draft.' }); // ruled
  assertEquals(leaveRowView('after_season', false, DRAFT), { enabled: true, sub: null });
});

Deno.test('the row: locked in, the same line for members and the commissioner, before and during the season', () => {
  for (const w of ['locked_order_set', 'locked_season'] as const) {
    for (const commish of [false, true]) assertEquals(leaveRowView(w, commish, DRAFT), { enabled: false, sub: LEAVE_LOCKED_LINE }, `${w} ${commish}`);
  }
});

Deno.test('the row: the commissioner transfers first, in both open windows', () => {
  assertEquals(leaveRowView('before_draft', true, DRAFT), { enabled: false, sub: LEAVE_COMMISSIONER_FIRST });
  assertEquals(leaveRowView('after_season', true, DRAFT), { enabled: false, sub: LEAVE_COMMISSIONER_FIRST });
});

Deno.test('the title changes hands only when a member could leave (PR #132: one window)', () => {
  assertEquals(transferAllowed('before_draft'), true);
  assertEquals(transferAllowed('after_season'), true);
  assertEquals(transferAllowed('locked_order_set'), false);
  assertEquals(transferAllowed('locked_season'), false);
});

// ── The sheet ──

const facts = { leagueName: 'Serie A Traders', commissionerName: 'Roberto B.', seasonNumber: 1, draftDate: DRAFT };

Deno.test('the member\'s sheet before the draft (board LeaveSheet "pre")', () => {
  assertEquals(leaveSheetCopy('before_draft', facts), {
    title: 'Leave Serie A Traders?',
    bullets: [
      'Roberto B. chooses whether to go ahead with one fewer team or invite someone new.',
      'You can rejoin with the invite code until Sat 6:00 PM ET.',
    ],
  });
  // No draft time: no rejoin deadline to state.
  assertEquals(leaveSheetCopy('before_draft', { ...facts, draftDate: null })!.bullets.length, 1);
});

Deno.test('a finished league\'s sheet (board LeaveFinished), with the season; never a guessed "Season 1"', () => {
  assertEquals(leaveSheetCopy('after_season', { ...facts, leagueName: 'Stock Scudetto', seasonNumber: 2 }), {
    title: 'Leave Stock Scudetto?',
    bullets: ['It comes off your Home and Your leagues.', 'Season 2 stays in the league’s History, with your record in it.'],
  });
  assertEquals(leaveSheetCopy('after_season', { ...facts, seasonNumber: null })!.bullets[1], 'Your season stays in the league’s History, with your record in it.');
});

Deno.test('no sheet while locked', () => {
  assertEquals(leaveSheetCopy('locked_order_set', facts), null);
  assertEquals(leaveSheetCopy('locked_season', facts), null);
});

// ── Outcomes ──

const ok = (body: Record<string, unknown>) => leaveOutcome({ transport: false, status: null, reason: null, body });
const refused = (reason: string, status: number | null = null) => leaveOutcome({ transport: false, status, reason, body: { ok: false, reason } });

Deno.test('the server\'s outcomes: left, hidden, transferred', () => {
  assertEquals(ok({ ok: true, status: 'left', reconfirm_required: true }), { kind: 'left' });
  assertEquals(ok({ ok: true, status: 'hidden' }), { kind: 'hidden' });
  assertEquals(ok({ ok: true, status: 'transferred', reconfirm_owed: false }), { kind: 'transferred' });
});

Deno.test('the Rule 8 table, verbatim', () => {
  const line = (r: string, s: number | null = null) => (refused(r, s) as { line: string }).line;
  assertEquals(line('locked_in'), LEAVE_LOCKED_LINE);
  assertEquals(line('transfer_first'), 'Make someone else commissioner first, then you can leave.');
  assertEquals(line('not_commissioner'), 'Only the commissioner can hand over the title.');
  assertEquals(line('target_invalid'), 'Pick a manager in this league.');
  assertEquals(line('not_member'), "You're not in this league anymore.");
  assertEquals(line('successor_not_allowed'), "That didn't go through.");
  assertEquals(line('bad_request', 400), "That didn't go through.");
  assertEquals(line('rate_limited', 429), 'Too many tries. Wait a moment, then try again.');
  assertEquals(line('not_authenticated', 401), 'Your session ended. Sign in again.');
  assertEquals(LEAVE_REFUSAL_REASONS.length, 9);
});

Deno.test('never a guessed outcome: no answer, a server fault, or an unknown status is UNKNOWN', () => {
  assertEquals(leaveOutcome({ transport: true }), { kind: 'unknown' });
  assertEquals(ok({ ok: true }), { kind: 'unknown' });
  assertEquals(ok({ ok: true, status: 'mystery' }), { kind: 'unknown' });
  assertEquals(refused('unhandled', 500), { kind: 'unknown' });
  assertEquals(refused('mystery', 503), { kind: 'unknown' });
  // A client bug (the audit) is a known refusal, not unknown.
  assertEquals(refused('mystery'), { kind: 'refused', reason: 'mystery', line: "That didn't go through." });
});

Deno.test('a leave\'s unknown outcome re-reads your membership (ruled): still in, gone, or unconfirmed', () => {
  // Still a member: nothing happened.
  assertEquals(leaveRecheck({ error: null, data: [{ hidden_at: null }] }, 'Serie A Traders'), {
    kind: 'refused', reason: null, line: "You're still in Serie A Traders. Try again.",
  });
  // Gone: the leave went through (your own row is always readable, so no row means left).
  assertEquals(leaveRecheck({ error: null, data: [] }, 'Serie A Traders'), { kind: 'left' });
  // A finished league you hid: the row stays, hidden.
  assertEquals(leaveRecheck({ error: null, data: [{ hidden_at: '2026-12-20T10:00:00Z' }] }, 'Stock Scudetto'), { kind: 'hidden' });
  // The re-read failed.
  assertEquals(leaveRecheck({ error: { message: 'network' }, data: null }, 'Serie A Traders'), { kind: 'refused', reason: null, line: LEAVE_UNCONFIRMED });
  assertEquals(leaveRecheck({ error: null, data: null }, 'Serie A Traders'), { kind: 'refused', reason: null, line: LEAVE_UNCONFIRMED });
});

Deno.test('a transfer\'s unknown outcome keeps "That didn\'t go through." and refreshes (source guard)', () => {
  assertEquals(transferUnknownLine(), "That didn't go through.");
  const s = SOURCES['app/league-settings.tsx'];
  assertEquals(s.includes("out.kind === 'unknown' ? transferUnknownLine() : null"), true);
  assertEquals(s.includes("if (out.kind === 'unknown') void refresh();"), true);
});

// ── The transfer picker ──

Deno.test('current human members other than you; no bots, no past participants, no nameless rows; nothing preselected', () => {
  const names = [
    { user_id: 'roberto', display_name: 'Roberto B.', is_bot: false },
    { user_id: 'paolo', display_name: 'Paolo M.', is_bot: false },
    { user_id: 'bot-atlas', display_name: 'Atlas', is_bot: true },
    { user_id: 'bot-nova', display_name: 'Nova', is_bot: false }, // a bot id is a bot, whatever the flag says
    { user_id: 'sofia', display_name: 'Sofia F.', is_bot: false }, // left before the draft: not a member
    { user_id: 'luca', display_name: '  ', is_bot: false },
    { user_id: 'marco', display_name: 'Marco R.', is_bot: null },
  ];
  const members = ['roberto', 'paolo', 'bot-atlas', 'bot-nova', 'luca', 'marco'];
  assertEquals(transferCandidates(members, names, 'roberto'), [
    { userId: 'paolo', name: 'Paolo M.' },
    { userId: 'marco', name: 'Marco R.' },
  ]);
  assertEquals(transferCandidates([], names, 'roberto'), []); // a failed member read: no rows, never the whole name list
});

// ── The capture seam ──

Deno.test('the leave fixture: each outcome and refusal, in the client response\'s shape', () => {
  assertEquals(leaveLeagueFixture({ action: 'leave' }, null), { ok: true, status: 'left', reconfirm_required: true });
  assertEquals(leaveLeagueFixture({ action: 'transfer' }, ''), { ok: true, status: 'transferred', reconfirm_owed: false });
  assertEquals(leaveLeagueFixture({ action: 'leave' }, 'hidden'), { ok: true, status: 'hidden' });
  assertEquals(leaveLeagueFixture({ action: 'leave' }, 'locked_in:season'), { ok: false, reason: 'locked_in', window: 'season' });
  assertEquals(leaveLeagueFixture({ action: 'leave' }, 'transfer_first'), { ok: false, reason: 'transfer_first' });
});

// ── Wiring (source guards) ──

Deno.test('League settings: the real row, the sheets, a member view, the Commissioner row (source guard)', () => {
  const s = SOURCES['app/league-settings.tsx'];
  assertEquals(s.includes('view={leaveRowView(membershipWindow, isCommissioner, league.draft_date)}'), true);
  assertEquals(s.includes('if (league && !isCommissioner && leaveOn) {'), true);
  assertEquals(s.includes("onPress={transferAllowed(membershipWindow) ? () => {"), true);
  assertEquals(s.includes("router.replace('/(tabs)');"), true);
  assertEquals(s.includes('accessibilityState={{ disabled: true }}'), false); // the placement-only row is gone
  const hook = SOURCES['lib/game/useLeaveLeague.ts'];
  assertEquals(hook.includes("const outcome = leaveOutcome(await readFunctionRefusal(data, error));"), true);
  // The re-read: only on an unknown outcome, your own row, then leaveRecheck.
  assertEquals(hook.includes("if (first.kind !== 'unknown' || !leagueId) return first;"), true);
  assertEquals(hook.includes(".select('hidden_at').eq('league_id', leagueId).eq('user_id', me)"), true);
  assertEquals(hook.includes('return leaveRecheck({ error: read.error, data: read.data }, leagueName);'), true);
  assertEquals(hook.includes("call({ league_id: leagueId, action: 'transfer', new_commissioner_id: newCommissionerId })"), true);
});

Deno.test('reachable: the League tab shows League settings to members with the flag on, pre-draft and in season (source guard)', () => {
  const tab = SOURCES['app/(tabs)/league.tsx'];
  assertEquals(tab.includes('showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id, LEAVE_LEAGUE_ON)'), true);
  assertEquals(tab.includes('{LEAVE_LEAGUE_ON && activeLeagueId && showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id, true) ? ('), true);
  // The draft room's commissioner check keeps its commissioner-only meaning.
  assertEquals(tab.includes('isCommissioner={showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id)}'), true);
});

Deno.test('a hidden league comes off Your leagues (source guard)', () => {
  assertEquals(SOURCES['lib/LeagueContext.tsx'].includes(".eq('user_id', userId)\n      .is('hidden_at', null);"), true);
});

Deno.test('the sheets: the danger button and Stay; the transfer button names the pick, disabled until one (source guard)', () => {
  const v = SOURCES['components/game/LeaveLeagueSheets.tsx'];
  assertEquals(v.includes('<Button label={LEAVE_LEAGUE} variant="destructive"'), true);
  assertEquals(v.includes('<Button label={STAY} onPress={onStay}'), true);
  assertEquals(v.includes('label={pickedName ? handOverLabel(pickedName) : HAND_OVER}'), true);
  assertEquals(v.includes('disabled={!picked || busy}'), true);
  assertEquals(v.includes('if (visible) setPicked(null);'), true);
});

Deno.test('a member\'s League settings: ONLY Invite code (with Share), the Commissioner\'s name, Leave league (ruled; source guard)', () => {
  const s = SOURCES['app/league-settings.tsx'];
  const start = s.indexOf('if (league && !isCommissioner && leaveOn) {');
  const member = s.slice(start, s.indexOf('if (!league || !isCommissioner) {', start));
  assertEquals(start > 0, true);
  // What it has.
  assertEquals(member.includes('>Invite code</Text>'), true);
  assertEquals(member.includes('<Button label="Share"'), true);
  assertEquals(member.includes('<SettingRow label={COMMISSIONER_ROW} value={commissionerName} />'), true);
  assertEquals(member.includes('{leaveBlock}'), true);
  // No commissioner controls, not even disabled ones.
  for (const c of ['<Field', '<SegmentedControl', '<Stepper', '<SlotBuilder', '<SwitchRow', '<ChoiceRow', '<DraftDateSheet', 'Save changes', 'footer=', '{transferSheet}', 'COMMISSIONER_YOU', 'onPress={transferAllowed', 'LockNote']) {
    assertEquals(member.includes(c), false, c);
  }
  // The shared leave block carries no transfer sheet; that's the commissioner's alone.
  const block = s.slice(s.indexOf('const leaveBlock = '), s.indexOf('const transferSheet = '));
  assertEquals(block.includes('TransferCommissionerSheet'), false);
  assertEquals(s.includes('const transferSheet = leaveOn && league && isCommissioner ? ('), true);
});

Deno.test('the transfer sheet shows the ruled line under its title (source guard)', () => {
  const v = SOURCES['components/game/LeaveLeagueSheets.tsx'];
  assertEquals(v.includes('{TRANSFER_TITLE}</Text>\n        <Text variant="callout" tone="secondary">{TRANSFER_NOTE}</Text>'), true);
});
