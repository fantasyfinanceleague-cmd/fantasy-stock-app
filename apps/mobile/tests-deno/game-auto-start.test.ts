/**
 * Draft auto-start, the client's rules (3c-2; board #call-auto-start, verbatim
 * copy): the status fields, the phase on the server clock, the countdown
 * format, the ET labels (both 2026 DST switches), the blockers card, the
 * postponed copy, the picker, and the refusals.
 * Sample (the board's): Serie A Traders, draft Sat, Oct 3 2026 · 7:00 PM ET
 * (23:00Z, EDT), room 6:00 PM ET.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  COMMISSIONER_FALLBACK,
  DRAFT_STATUS_LOAD_FAILED,
  DATE_LOCKED_AFTER_ROOM,
  EARLIEST_NOTE,
  INVITE_SOMEONE_NEW,
  PICKER_HELPER,
  PICK_NEW_TIME,
  PICK_NEW_TIME_NOTE,
  blockerClause,
  blockerTitle,
  blockersCardCopy,
  countdownCopy,
  deadlineCopy,
  draftTimeLocked,
  draftTimeRefusal,
  earliestDraftMs,
  etDayWord,
  etTimeLabel,
  etWhenLabel,
  fixableBlockers,
  lobbyPhase,
  lobbyView,
  homeView,
  yourPickLine,
  memberPostponedCopy,
  moveForwardLabel,
  nextBoundaryMs,
  onDraftGrid,
  parseStartStatus,
  pickerLine,
  playoffFixLine,
  postponedAtMs,
  serverOffsetMs,
  startClock,
  startKickOutcome,
  type StartState,
} from '../lib/game/autoStart.ts';

const T = '2026-10-03T23:00:00Z'; // Sat, Oct 3 · 7:00 PM ET
const tMs = Date.parse(T);
const MIN = 60_000;
const HOUR = 60 * MIN;

// ── status ───────────────────────────────────────────────────────────────

Deno.test('parseStartStatus reads the server fields and never guesses', () => {
  assertEquals(
    parseStartStatus({ start_state: 'room_open', starts_at: T, postponed: null }),
    { startState: 'room_open', startsAt: T, postponed: null },
  );
  assertEquals(
    parseStartStatus({ start_state: 'postponed', starts_at: null, postponed: { from: T, stage: 'room_open', reason: 'roster_reconfirm_required' } }),
    { startState: 'postponed', startsAt: null, postponed: { from: T, stage: 'room_open', reason: 'roster_reconfirm_required' } },
  );
  assertEquals(parseStartStatus({ start_state: 'nonsense' }).startState, null);
  assertEquals(parseStartStatus({}), { startState: null, startsAt: null, postponed: null }); // an older server
  assertEquals(parseStartStatus(null), { startState: null, startsAt: null, postponed: null });
});

Deno.test('the server clock offset (server_now minus the phone at receipt)', () => {
  assertEquals(serverOffsetMs('2026-10-03T22:00:05Z', Date.parse('2026-10-03T22:00:00Z')), 5000);
  assertEquals(serverOffsetMs(null, 123), 0);
  assertEquals(serverOffsetMs('garbage', 123), 0);
});

// ── the phase ────────────────────────────────────────────────────────────

const phase = (startState: StartState | null, now: number, startsAt: string | null = T) => lobbyPhase({ startState, startsAt }, now);

Deno.test('every server state maps to a lobby phase', () => {
  const before = tMs - 2 * 24 * HOUR;
  assertEquals(phase('no_date', before, null), 'no_date');
  assertEquals(phase('scheduled', before), 'scheduled');
  assertEquals(phase('at_risk', before), 'at_risk');
  assertEquals(phase('room_open', tMs - 42 * MIN), 'room_open');
  assertEquals(phase('due', tMs + 3000), 'starting');
  assertEquals(phase('postponed', before, null), 'postponed');
  assertEquals(phase('started', tMs + 60_000), 'started');
});

Deno.test('the countdown moves on by itself across T−1h and T (server clock)', () => {
  assertEquals(phase('scheduled', tMs - HOUR - 1), 'scheduled');
  assertEquals(phase('scheduled', tMs - HOUR), 'room_open');
  assertEquals(phase('room_open', tMs - 1), 'room_open');
  assertEquals(phase('room_open', tMs), 'starting');
});

Deno.test('at risk stays at risk until the server decides (no client-side "room open")', () => {
  assertEquals(phase('at_risk', tMs - 30 * MIN), 'at_risk');
  assertEquals(phase('at_risk', tMs + 1), 'starting');
});

Deno.test('the server word wins: postponed, started, no date', () => {
  assertEquals(phase('postponed', tMs + HOUR), 'postponed');
  assertEquals(phase('started', tMs - HOUR), 'started');
  assertEquals(phase('no_date', tMs - HOUR, T), 'no_date');
});

Deno.test('an older server (no start_state) is derived from the time alone', () => {
  assertEquals(phase(null, tMs - 2 * HOUR), 'scheduled');
  assertEquals(phase(null, tMs - 10 * MIN), 'room_open');
  assertEquals(phase(null, tMs - 10 * MIN, null), 'no_date');
});

Deno.test('the next boundary to re-read at: T−1h, then T, then none', () => {
  assertEquals(nextBoundaryMs(T, tMs - 2 * HOUR), tMs - HOUR);
  assertEquals(nextBoundaryMs(T, tMs - 30 * MIN), tMs);
  assertEquals(nextBoundaryMs(T, tMs + 1), null);
  assertEquals(nextBoundaryMs(null, tMs), null);
});

// ── the countdown format ─────────────────────────────────────────────────

Deno.test('the board\'s clock: 2d 06h 40m, 42:18, 00:00', () => {
  assertEquals(startClock(2 * 24 * HOUR + 6 * HOUR + 40 * MIN + 30_000), '2d 06h 40m');
  assertEquals(startClock(42 * MIN + 18_000), '42:18');
  assertEquals(startClock(0), '00:00');
  assertEquals(startClock(-5000), '00:00');
});

Deno.test('the clock\'s edges: an hour or more to the minute, under an hour to the second', () => {
  assertEquals(startClock(6 * HOUR + 40 * MIN), '6h 40m');
  assertEquals(startClock(HOUR), '1h 00m');
  assertEquals(startClock(HOUR - 1), '1h 00m'); // 59:59.999 rounds up to the hour
  assertEquals(startClock(HOUR - 1000), '59:59');
  assertEquals(startClock(59_000), '00:59');
  assertEquals(startClock(1), '00:01'); // reads 00:00 only at the moment itself
  assertEquals(startClock(24 * HOUR), '1d 00h 00m');
});

// ── ET labels ────────────────────────────────────────────────────────────

Deno.test('ET labels: the board sample', () => {
  assertEquals(etWhenLabel(tMs), 'Sat, Oct 3 · 7:00 PM ET');
  assertEquals(etTimeLabel(tMs - HOUR), '6:00 PM ET');
});

Deno.test('ET labels: noon, midnight', () => {
  assertEquals(etTimeLabel(Date.parse('2026-10-03T16:00:00Z')), '12:00 PM ET');
  assertEquals(etTimeLabel(Date.parse('2026-10-04T04:00:00Z')), '12:00 AM ET');
});

Deno.test('ET labels across both 2026 DST switches (Mar 8, Nov 1)', () => {
  assertEquals(etTimeLabel(Date.parse('2026-03-08T06:59:00Z')), '1:59 AM ET'); // EST, just before
  assertEquals(etTimeLabel(Date.parse('2026-03-08T07:00:00Z')), '3:00 AM ET'); // EDT, 2:00 never happens
  assertEquals(etTimeLabel(Date.parse('2026-11-01T05:30:00Z')), '1:30 AM ET'); // EDT, the first 1:30
  assertEquals(etTimeLabel(Date.parse('2026-11-01T06:30:00Z')), '1:30 AM ET'); // EST, the second 1:30
  assertEquals(etWhenLabel(Date.parse('2026-11-02T00:00:00Z')), 'Sun, Nov 1 · 7:00 PM ET');
});

Deno.test('day words follow the ET calendar date, not UTC', () => {
  const now = Date.parse('2026-10-03T13:00:00Z'); // Sat 9:00 AM ET
  assertEquals(etDayWord(Date.parse('2026-10-03T23:00:00Z'), now), 'Today'); // 7 PM ET, already Sunday in UTC
  assertEquals(etDayWord(Date.parse('2026-10-04T03:45:00Z'), now), 'Today'); // 11:45 PM ET Sat
  assertEquals(etDayWord(Date.parse('2026-10-04T04:00:00Z'), now), 'Tomorrow'); // midnight ET
  assertEquals(etDayWord(Date.parse('2026-10-05T23:00:00Z'), now), 'Mon, Oct 5');
});

// ── the countdown card ───────────────────────────────────────────────────

Deno.test('before the room opens (board AutoLobby scheduled)', () => {
  const c = countdownCopy('scheduled', T, tMs - (2 * 24 * HOUR + 6 * HOUR + 40 * MIN));
  assertEquals(c, {
    tag: 'Draft starts in',
    clock: '2d 06h 40m',
    starting: null,
    lines: ['The draft starts automatically at Sat, Oct 3 · 7:00 PM ET.', 'The draft room opens at 6:00 PM ET, when the order is set.'],
  });
});

Deno.test('room open (board AutoLobby open)', () => {
  assertEquals(countdownCopy('room_open', T, tMs - (42 * MIN + 18_000)), {
    tag: 'Draft room open · starts in',
    clock: '42:18',
    starting: null,
    lines: ['The draft starts automatically at Sat, Oct 3 · 7:00 PM ET.'],
  });
});

Deno.test('at 0:00 (board AutoLobby starting)', () => {
  assertEquals(countdownCopy('starting', T, tMs), { tag: 'Draft starts in', clock: '00:00', starting: 'Starting the draft', lines: [] });
});

// ── the blockers card ────────────────────────────────────────────────────

const SOFIA = { code: 'roster_reconfirm_required', departed: [{ name: 'Sofia F.' }], membersBefore: 8, members: 7, choice: 'pending' };
const PLAYOFF = { code: 'playoff_teams_exceeds_members', playoffTeams: 8, members: 7 };

Deno.test('blockers card, at risk (board BlockersCard risk)', () => {
  assertEquals(blockersCardCopy('risk', '6:00 PM ET'), {
    tag: 'Needs you before 6:00 PM ET',
    title: 'The draft can’t start yet',
    line: 'Fix these before 6:00 PM ET, when the draft room opens. If they’re still open then, the draft is postponed.',
  });
});

Deno.test('blockers card, postponed (board BlockersCard postponed)', () => {
  assertEquals(blockersCardCopy('postponed', '6:00 PM ET'), {
    tag: 'Postponed',
    title: 'The draft is postponed',
    line: 'The league wasn’t ready at 6:00 PM ET. Fix these, then pick a new draft time.',
  });
  assertEquals(PICK_NEW_TIME, 'Pick a new draft time');
  assertEquals(PICK_NEW_TIME_NOTE, "Fix these first. The new time needs at least an hour's notice.");
});

Deno.test('the board\'s blocker titles', () => {
  assertEquals(blockerTitle(SOFIA), 'Sofia F. left the league');
  assertEquals(blockerTitle(PLAYOFF), '8 playoff teams, but 7 teams are in');
  assertEquals(blockerTitle({ code: 'not_enough_members', have: 3, need: 4 }), 'Fewer than 4 teams have joined');
  assertEquals(blockerTitle({ code: 'slots_infeasible' }), "Some slots can't be filled");
});

Deno.test('the other blocker clauses (backend list), and the fallback', () => {
  assertEquals(blockerClause({ code: 'roster_reconfirm_required', departed: [{ name: 'Sofia F.' }, { name: 'Ana P.' }] }), 'Sofia F. and Ana P. left the league');
  assertEquals(blockerClause({ code: 'roster_reconfirm_required', departed: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] }), '3 managers left the league');
  assertEquals(blockerClause({ code: 'roster_reconfirm_required', departed: [], membersBefore: 8, members: 6 }), '2 managers left the league');
  assertEquals(blockerClause({ code: 'playoff_teams_exceeds_members' }), 'there are more playoff teams than teams');
  assertEquals(blockerClause({ code: 'budget_infeasible' }), "the budget can't fill every roster");
  assertEquals(blockerClause({ code: 'no_stake_mode' }), "the league's stakes aren't set");
  assertEquals(blockerClause({ code: 'invalid_playoff_teams' }), "the number of playoff teams isn't set");
  assertEquals(blockerClause({ code: 'renewal_replies_pending' }), 'not every Season 1 player has answered');
  assertEquals(blockerClause({ code: 'mystery' }), 'something in League settings needs fixing');
  assertEquals(blockerClause({ code: 'roster_reconfirm_required', departed: [] }), 'something in League settings needs fixing');
});

Deno.test('the card shows only blockers the commissioner can fix', () => {
  const all = [
    { code: 'draft_date_not_reached', draftDate: T }, SOFIA, { code: 'draft_postponed' }, PLAYOFF,
    { code: 'no_draft_date' }, { code: 'feasibility_unavailable' }, { code: 'not_started_state' },
  ];
  assertEquals(fixableBlockers(all).map((b) => b.code), ['roster_reconfirm_required', 'playoff_teams_exceeds_members']);
});

Deno.test('the fixes\' labels', () => {
  assertEquals(playoffFixLine(7), 'Up to 7, one per team.');
  assertEquals(moveForwardLabel(7), 'Move forward with 7');
  assertEquals(INVITE_SOMEONE_NEW, 'Invite someone new');
});

Deno.test('the commissioner\'s at-risk deadline (board: Draft room opens in 58:12)', () => {
  assertEquals(deadlineCopy(T, tMs - HOUR - (58 * MIN + 12_000)), {
    tag: 'Draft room opens in',
    clock: '58:12',
    line: 'The draft starts at 7:00 PM ET.',
  });
});

Deno.test('postponed: the time it wasn\'t ready at (room-open time, or T for a start-stage one)', () => {
  assertEquals(postponedAtMs({ from: T, stage: 'room_open', reason: 'x' }), tMs - HOUR);
  assertEquals(postponedAtMs({ from: T, stage: 'start', reason: 'x' }), tMs);
  assertEquals(postponedAtMs({ from: T, stage: 'legacy', reason: null }), tMs - HOUR);
  assertEquals(postponedAtMs({ from: null, stage: 'room_open', reason: null }), null);
  assertEquals(postponedAtMs(null), null);
});

Deno.test('members once postponed (board MemberPostponed)', () => {
  assertEquals(memberPostponedCopy('Roberto B.'), {
    tag: 'Draft postponed',
    title: 'Roberto B. will pick a new time.',
    line: "You'll see it here and on your Home, with at least an hour's notice.",
  });
  assertEquals(memberPostponedCopy(COMMISSIONER_FALLBACK).title, 'The commissioner will pick a new time.');
});

// ── the picker ───────────────────────────────────────────────────────────

Deno.test('the earliest time: an hour out, up to the next quarter hour', () => {
  const now = Date.parse('2026-10-03T18:07:00Z'); // 2:07 PM ET
  assertEquals(new Date(earliestDraftMs(now)).toISOString(), '2026-10-03T19:15:00.000Z');
  assertEquals(onDraftGrid(earliestDraftMs(now)), true);
  assertEquals(onDraftGrid(Date.parse('2026-10-03T19:07:00Z')), false);
});

Deno.test('the picker line (board: "Today · 3:15 PM ET" + the earliest note)', () => {
  const now = Date.parse('2026-10-03T18:07:00Z');
  assertEquals(pickerLine(Date.parse('2026-10-03T19:15:00Z'), now), { value: 'Today · 3:15 PM ET', earliest: true });
  assertEquals(pickerLine(Date.parse('2026-10-04T23:00:00Z'), now), { value: 'Tomorrow · 7:00 PM ET', earliest: false });
  assertEquals(EARLIEST_NOTE, '(the earliest you can pick: an hour from now)');
  assertEquals(PICKER_HELPER, 'The draft room opens 1 hour before, and the draft starts automatically.');
});

Deno.test('the time is locked from the room opening until the start, except when postponed', () => {
  assertEquals(draftTimeLocked('room_open'), true);
  assertEquals(draftTimeLocked('due'), true);
  for (const s of ['no_date', 'scheduled', 'at_risk', 'postponed', 'started', null] as const) assertEquals(draftTimeLocked(s), false, String(s));
  assertEquals(DATE_LOCKED_AFTER_ROOM, 'The draft time can’t change once the draft room opens.');
});

// ── refusals ─────────────────────────────────────────────────────────────

Deno.test('the server\'s draft-time refusals, calm, never the raw message', () => {
  assertEquals(draftTimeRefusal({ message: "draft_time_locked: the draft room is open, so the draft time can't change" }), DATE_LOCKED_AFTER_ROOM);
  assertEquals(draftTimeRefusal({ message: 'draft_time_too_soon: pick a time at least an hour from now' }), 'Pick a time at least an hour from now.');
  assertEquals(draftTimeRefusal({ message: 'draft_time_invalid: pick a time on the quarter hour' }), 'Pick a time ending in :00, :15, :30 or :45.');
  assertEquals(draftTimeRefusal({ message: 'league_rules_locked: …' }), null);
  assertEquals(draftTimeRefusal(null), null);
});

Deno.test('a start request: started, the server retrying, or re-read', () => {
  assertEquals(startKickOutcome({ ok: true }), 'started');
  assertEquals(startKickOutcome({ ok: true, already_started: true } as { ok: boolean }), 'started');
  assertEquals(startKickOutcome({ ok: false, reason: 'draft_start_retrying' }), 'retrying');
  assertEquals(startKickOutcome({ ok: false, reason: 'draft_postponed' }), 'reread');
  assertEquals(startKickOutcome({ ok: false, reason: 'draft_date_not_reached' }), 'reread');
  assertEquals(startKickOutcome(null), 'reread');
});

// ── What the lobby shows (every phase × viewer) ──────────────────────────

Deno.test('the lobby per phase: everyone', () => {
  assertEquals(lobbyView('no_date', false, 0), { blockers: null, deadline: false, countdown: null, memberPostponed: false, noDate: true, order: true, kick: false });
  assertEquals(lobbyView('scheduled', false, 0).countdown, 'scheduled');
  assertEquals(lobbyView('room_open', false, 0).countdown, 'room_open');
  assertEquals(lobbyView('starting', false, 0), { blockers: null, deadline: false, countdown: 'starting', memberPostponed: false, noDate: false, order: true, kick: true });
  assertEquals(lobbyView('started', true, 0).countdown, 'starting');
  assertEquals(lobbyView('started', true, 0).kick, false);
});

Deno.test('at risk: the commissioner gets the blockers card and the deadline; members the plain countdown', () => {
  assertEquals(lobbyView('at_risk', true, 2), { blockers: 'risk', deadline: true, countdown: null, memberPostponed: false, noDate: false, order: true, kick: false });
  assertEquals(lobbyView('at_risk', false, 2).countdown, 'scheduled');
  assertEquals(lobbyView('at_risk', false, 2).blockers, null);
  assertEquals(lobbyView('at_risk', true, 0).countdown, 'scheduled'); // nothing fixable: no empty card
});

Deno.test('postponed: the commissioner gets the blockers card (pick a new time); members the postponed card', () => {
  assertEquals(lobbyView('postponed', true, 0), { blockers: 'postponed', deadline: false, countdown: null, memberPostponed: false, noDate: false, order: false, kick: false });
  assertEquals(lobbyView('postponed', false, 2), { blockers: null, deadline: false, countdown: null, memberPostponed: true, noDate: false, order: false, kick: false });
});

Deno.test('no phase ever shows a Start button: only "starting" asks the server, and only it', () => {
  for (const p of ['no_date', 'scheduled', 'at_risk', 'room_open', 'starting', 'postponed', 'started'] as const) {
    for (const c of [true, false]) assertEquals(lobbyView(p, c, 1).kick, p === 'starting', `${p} ${c}`);
  }
});

// ── Home (the same view as the lobby) ─────────────────────────────────────

Deno.test('Home shows what the lobby shows, phase by phase', () => {
  for (const p of ['no_date', 'scheduled', 'room_open', 'starting', 'postponed', 'started'] as const) {
    for (const c of [true, false]) {
      const lv = lobbyView(p, c, 2);
      const hv = homeView(p, c, 2);
      assertEquals(hv, { blockers: lv.blockers, countdown: lv.countdown, memberPostponed: lv.memberPostponed, noDate: lv.noDate }, `${p} ${c}`);
    }
  }
});

Deno.test('Home at risk: the commissioner gets the needs-you card AND the countdown (board ReconfirmHome); members the countdown', () => {
  assertEquals(homeView('at_risk', true, 2), { blockers: 'risk', countdown: 'scheduled', memberPostponed: false, noDate: false });
  assertEquals(homeView('at_risk', false, 2), { blockers: null, countdown: 'scheduled', memberPostponed: false, noDate: false });
  assertEquals(homeView('at_risk', true, 0), { blockers: null, countdown: 'scheduled', memberPostponed: false, noDate: false });
});

Deno.test('Home postponed: the commissioner the blockers card, members the postponed card', () => {
  assertEquals(homeView('postponed', true, 2).blockers, 'postponed');
  assertEquals(homeView('postponed', false, 2).memberPostponed, true);
});

Deno.test('your position, once the order is set', () => {
  const ord = (n: number) => `${n}th`;
  assertEquals(yourPickLine(['a', 'b', 'c', 'me'], 'me', ord), 'You pick 4th');
  assertEquals(yourPickLine(['a', 'b'], 'me', ord), null);
  assertEquals(yourPickLine(null, 'me', ord), null);
});

// ── Design Lead's final rulings (one term, "draft time"; the clause list) ──

Deno.test('the lobby load failure and the clauses, as ruled', () => {
  assertEquals(DRAFT_STATUS_LOAD_FAILED, "The draft lobby didn't load.");
  assertEquals(COMMISSIONER_FALLBACK, 'The commissioner');
  // Each clause slots into the at-risk push sentence.
  const push = (c: string) => `The draft room can't open yet: ${c}.`;
  assertEquals(push(blockerClause({ code: 'no_stake_mode' })), "The draft room can't open yet: the league's stakes aren't set.");
  assertEquals(push(blockerClause({ code: 'playoff_teams_exceeds_members' })), "The draft room can't open yet: there are more playoff teams than teams.");
});
