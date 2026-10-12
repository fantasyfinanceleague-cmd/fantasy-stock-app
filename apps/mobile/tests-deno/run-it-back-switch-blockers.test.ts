/**
 * Run it back's switch-flip blockers (Design Lead build spec, docs/design/reviews/ux-audit-2026-10.md
 * "Build spec · Run it back switch-flip blockers"; board #run-it-back):
 * - GS-10 (RibMemberList): a member who's in sees no commissioner draft card, gets the board's
 *   line, and "You're running back" with Change until the draft is set; Change is the ask itself.
 * - GS-11 (RibHomeCounts): the commissioner's Season 2 Home has no Set draft time while replies
 *   are pending; Build your queue, Members and the invite code stay.
 * - GS-14 (RibMemberPrompt 1b): an out player keeps the ask ("You're out"); a removed one doesn't.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  ANSWER_NOT_SAVED, ASK_CHANGE_NOTE, ASK_LINE, CHANGE_ANSWER, MEMBER_DRAFT_LINE, RUNNING_BACK_BANNER, TRY_AGAIN, YOURE_OUT_CHIP,
  afterAskAnswer, askQuestion, homeRepliesPending, renewalAnswerOutcome, renewalAnswerRefusal, renewalAskAnswer,
  renewalDraftSet, rosterCommissionerName, rosterView, screenFor, showsHomeRenewalAsk,
} from '../lib/game/renewal.ts';
import { homeNoDateBlock, homeSetsDraftTime } from '../lib/game/draftTimeSheet.ts';
import { showsLeagueRenewalAsk } from '../lib/game/leaguePhase.ts';
import { callerAfterAnswer, fixtureRoster, FIXTURE_SET_DRAFT_DATE } from '../lib/game/renewalFixture.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const NOW = new Date('2026-01-17T20:00:00Z');
const PEOPLE = [
  { is_commissioner: false, display_name: 'Roberto B.' },
  { is_commissioner: true, display_name: 'Paolo M.' },
];
const member = (over: Record<string, unknown> = {}) => ({ is_commissioner: false, caller_status: 'in', draft_date: null, draft_status: 'not_started', people: PEOPLE, ...over });

// ── GS-10 item 1: the draft card is the commissioner's ──

Deno.test('GS-10: no commissioner draft card for a member; the commissioner keeps it', () => {
  assertEquals(rosterView(member()).draftCard, false);
  assertEquals(rosterView(member({ caller_status: 'new' })).draftCard, false);
  assertEquals(rosterView(member({ is_commissioner: true })).draftCard, true);
  // The card's JSX is gated on the rule (it was unconditional: GS-10).
  const roster = SOURCES['components/game/RenewalRoster.tsx'];
  assert(roster.includes('const view = rosterView(roster);'));
  const gate = roster.indexOf('{view.draftCard ? (');
  assert(gate > 0 && gate < roster.indexOf('<Text variant="callout">Draft time</Text>'), 'the draft card sits inside view.draftCard');
  assertEquals(roster.split('Draft time</Text>').length, 2, 'one draft card, no ungated copy');
});

Deno.test("GS-10: a member who is in gets the board's line under the list, verbatim; not once the draft is set", () => {
  assertEquals(MEMBER_DRAFT_LINE, 'The draft is set once everyone has replied. You can change your answer until then.');
  assertEquals(rosterView(member()).memberLine, true);
  assertEquals(rosterView(member({ draft_date: FIXTURE_SET_DRAFT_DATE })).memberLine, false);
  assertEquals(rosterView(member({ is_commissioner: true })).memberLine, false);
  assert(SOURCES['components/game/RenewalRoster.tsx'].includes('{view.memberLine ? <Text variant="caption" tone="secondary">{MEMBER_DRAFT_LINE}</Text> : null}'));
});

// ── GS-10 item 2: "You're running back" + Change, until the draft is set ──

Deno.test("GS-10: the banner and Change for a member who is in (board copy verbatim)", () => {
  assertEquals(RUNNING_BACK_BANNER, "You're running back");
  assertEquals(CHANGE_ANSWER, 'Change');
  assertEquals(rosterView(member()), { draftCard: false, banner: true, change: true, memberLine: true });
  // A newcomer joined by code: no answer to change. The commissioner gets the reconcile view.
  assertEquals(rosterView(member({ caller_status: 'new' })).banner, false);
  assertEquals(rosterView(member({ caller_status: 'new' })).change, false);
  assertEquals(rosterView(member({ is_commissioner: true })).banner, false);
});

Deno.test('GS-10: Change is hidden once the draft is set (scheduled, or under way); the banner stays', () => {
  assertEquals(renewalDraftSet({ draft_date: null, draft_status: 'not_started' }), false);
  assertEquals(renewalDraftSet({}), false);
  assertEquals(renewalDraftSet({ draft_date: '2026-01-24T00:00:00Z', draft_status: 'not_started' }), true);
  assertEquals(renewalDraftSet({ draft_date: null, draft_status: 'in_progress' }), true);
  const set = rosterView(member({ draft_date: '2026-01-24T00:00:00Z' }));
  assertEquals(set.banner, true);
  assertEquals(set.change, false);
  assertEquals(rosterView(member({ draft_status: 'completed' })).change, false);
  // The fixture caller for the capture: in, everyone replied, the draft set.
  const inSet = fixtureRoster('in-set', NOW) as unknown as Parameters<typeof rosterView>[0] & { replies_pending: boolean };
  assertEquals(inSet.replies_pending, false);
  assertEquals(rosterView(inSet).change, false);
  // The button and its sheet render only under view.change.
  const roster = SOURCES['components/game/RenewalRoster.tsx'];
  assert(roster.includes('{view.change ? (\n            <Pressable onPress={() => setChanging(true)}'));
  assert(roster.includes('{view.change ? (\n        <RenewalChangeSheet'));
});

Deno.test("GS-10: Change's question names the real commissioner from the roster (no stand-in)", () => {
  assertEquals(rosterCommissionerName(PEOPLE), 'Paolo M.');
  assertEquals(rosterCommissionerName([{ is_commissioner: false, display_name: 'Roberto B.' }]), null);
  assertEquals(rosterView(member({ people: [{ is_commissioner: false, display_name: 'Roberto B.' }] })).change, false);
  assertEquals(askQuestion('Paolo M.'), 'Paolo M. is running it back. Are you in?');
  for (const p of ['components/game/RenewalRoster.tsx', 'components/game/RenewalChangeSheet.tsx']) {
    assert(!SOURCES[p].includes('Your commissioner'), p);
  }
});

Deno.test('GS-10: the Change sheet IS the ask (its copy verbatim, the current answer selected, the same RPC)', () => {
  assertEquals(ASK_LINE, 'Same league, new season. The draft is set once everyone has replied.');
  assertEquals(ASK_CHANGE_NOTE, 'You can change your answer until the draft is set.');
  const sheet = SOURCES['components/game/RenewalChangeSheet.tsx'];
  assert(sheet.includes('<RenewalAskBody'));
  assert(sheet.includes('answered={current}'));
  assert(!sheet.includes('seamRpc('), 'the sheet answers through the ask body, not a second call site');
  assert(SOURCES['components/game/RenewalRoster.tsx'].includes('current="in"'));
  const ask = SOURCES['components/game/RenewalAsk.tsx'];
  assert(ask.includes("seamRpc('respond_to_renewal', { p_league_id: leagueId, p_response: response })"));
  assert(ask.includes('selected={response === current}'));
  // The ask's three strings come from the shared constants, so the card and the sheet can't drift.
  for (const s of ['{askQuestion(commissionerName)}', '{ASK_LINE}', '{ASK_CHANGE_NOTE}']) assert(ask.includes(s), s);
});

// ── Refusals, per reason (Design Lead ruling, 2026-10-11, verbatim) ──

Deno.test('an answer refusal maps per reason; only the catch-all retries', () => {
  assertEquals(renewalAnswerRefusal('draft_started'), { line: 'The draft has started, so answers are locked.', retry: false });
  assertEquals(renewalAnswerRefusal('removed'), { line: 'The commissioner removed you from Season 2.', retry: false });
  assertEquals(renewalAnswerRefusal('league_full'), { line: 'Season 2 is full. Ask your commissioner if they can make room.', retry: false });
  assertEquals(renewalAnswerRefusal(null), { line: "Your answer didn't go through. Try again.", retry: true });
  assertEquals(renewalAnswerRefusal('not_invited'), { line: ANSWER_NOT_SAVED, retry: true });
  assertEquals(renewalAnswerRefusal('commissioner_cannot_opt_out'), { line: ANSWER_NOT_SAVED, retry: true });
  assertEquals(TRY_AGAIN, 'Try again');
});

Deno.test('respond_to_renewal: replied and unchanged are saved; a refusal keeps its reason; no answer is a refusal with none', () => {
  assertEquals(renewalAnswerOutcome({ status: 'replied', response: 'out' }, null), { kind: 'saved' });
  assertEquals(renewalAnswerOutcome({ status: 'unchanged', response: 'in' }, null), { kind: 'saved' });
  assertEquals(renewalAnswerOutcome({ status: 'refused', reason: 'league_full' }, null), { kind: 'refused', reason: 'league_full' });
  assertEquals(renewalAnswerOutcome({ status: 'refused' }, null), { kind: 'refused', reason: null });
  assertEquals(renewalAnswerOutcome(null, { message: 'network' }), { kind: 'refused', reason: null });
  assertEquals(renewalAnswerOutcome({ status: 'replied' }, { message: 'x' }), { kind: 'refused', reason: null });
  // In place, under the choice (never an Alert any more).
  const ask = SOURCES['components/game/RenewalAsk.tsx'];
  assert(!ask.includes('Alert.alert'));
  assert(ask.includes('setRefusal({ ...renewalAnswerRefusal(outcome.reason), response });'));
});

// ── GS-14: the out player keeps the ask; a removed one doesn't ──

Deno.test("GS-14: out by choice → the ask, answer 'out'; removed by the commissioner → nothing", () => {
  const out = { status: 'ok' as const, full_list: false as const, caller_status: 'out' as const, caller_decided_by: 'player' };
  const removed = { ...out, caller_decided_by: 'commissioner' };
  const pending = { status: 'ok' as const, full_list: false as const, caller_status: 'pending' as const, caller_decided_by: null };
  assertEquals(screenFor(out), 'ask');
  assertEquals(renewalAskAnswer(out), 'out');
  assertEquals(screenFor(removed), 'none');
  assertEquals(renewalAskAnswer(removed), null);
  assertEquals(showsHomeRenewalAsk({ isCommissioner: false, successorId: 'S2', screen: screenFor(removed) }), false);
  assertEquals(renewalAskAnswer(pending), null);
  assertEquals(renewalAskAnswer({ status: 'ok', full_list: true, is_commissioner: false, caller_status: 'in' }), null);
  // The fixture callers for the captures.
  assertEquals(screenFor(fixtureRoster('out', NOW) as never), 'ask');
  assertEquals(screenFor(fixtureRoster('removed', NOW) as never), 'none');
});

Deno.test('GS-14: the chip "You\'re out" (new copy, verbatim) and I\'m out checked', () => {
  assertEquals(YOURE_OUT_CHIP, "You're out");
  const ask = SOURCES['components/game/RenewalAsk.tsx'];
  assert(ask.includes("{answered === 'out' ? ("));
  assert(ask.includes('{YOURE_OUT_CHIP}'));
  for (const p of ['components/game/HomeRenewalAsk.tsx', 'components/game/LeagueRenewal.tsx']) assert(SOURCES[p].includes('renewalAskAnswer('), p);
});

Deno.test("GS-14: I'm in from the finished league's ask opens Season 2's list; I'm out re-reads in place", () => {
  assertEquals(afterAskAnswer('in'), 'open_season_2');
  assertEquals(afterAskAnswer('out'), 'reread');
  // The fixture follows the seam's answer (a capture of the flip).
  assertEquals(callerAfterAnswer('out', 'in'), 'in');
  assertEquals(callerAfterAnswer('in', 'out'), 'out');
  assertEquals(callerAfterAnswer('pending', 'in'), 'in');
  assertEquals(callerAfterAnswer('out', null), 'out');
  assertEquals(callerAfterAnswer('removed', 'in'), 'removed');
  assertEquals(callerAfterAnswer('commissioner', 'out'), 'commissioner');
  assert(SOURCES['lib/game/seamCalls.ts'].includes("if (f && name === 'respond_to_renewal') markFixtureAnswer(args.p_response);"));
});

Deno.test("GS-14 / board frame 1: the ask is on a finished league's League tab too, for members only", () => {
  assertEquals(showsLeagueRenewalAsk({ phase: 'completed', isCommissioner: false, hasSuccessor: true }), true);
  assertEquals(showsLeagueRenewalAsk({ phase: 'completed', isCommissioner: true, hasSuccessor: true }), false);
  assertEquals(showsLeagueRenewalAsk({ phase: 'completed', isCommissioner: false, hasSuccessor: false }), false);
  assertEquals(showsLeagueRenewalAsk({ phase: 'regular', isCommissioner: false, hasSuccessor: true }), false);
});

// ── GS-11: no Set draft time on the commissioner's Season 2 Home while replies are pending ──

Deno.test('GS-11: PreDraftCard has no draft block and no Set draft time while replies are pending', () => {
  assertEquals(homeSetsDraftTime(true, true, true), false);
  assertEquals(homeSetsDraftTime(true, true, false), true); // the last reply landed: back
  assertEquals(homeSetsDraftTime(true, true), true); // any other league: unchanged
  assertEquals(homeNoDateBlock(true, true), false);
  assertEquals(homeNoDateBlock(true, false), true);
  assertEquals(homeNoDateBlock(false, false), false);
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  assert(card.includes('const setsTime = homeSetsDraftTime(!!view?.noDate, ds.isCommissioner, repliesPending);'));
  assert(card.includes('homeNoDateBlock(true, repliesPending) ? ('));
  // The title sits inside that gate.
  assert(card.indexOf('homeNoDateBlock(true, repliesPending) ? (') < card.indexOf('<Text variant="title">{NO_DATE_TITLE}</Text>'));
});

Deno.test('GS-11: Members and the invite code stay while replies are pending (nothing else reads the flag)', () => {
  const card = SOURCES['components/home/PreDraftCard.tsx'];
  const uses = card.split('repliesPending').length - 1;
  // The prop, its default, the setsTime rule and the no-date gate: nothing else.
  assertEquals(uses, 4, `repliesPending is read ${uses} times`);
  assert(card.includes('{MEMBERS_TITLE}'));
  assert(card.includes('{INVITE_CODE_LABEL}'));
});

Deno.test("GS-11: Home's replies-pending read: pending until the first read, then the roster's; a failed read is today's card", () => {
  const full = (replies_pending: boolean) => ({ status: 'ok', full_list: true, replies_pending });
  assertEquals(homeRepliesPending({ status: 'loading', roster: null }), true);
  assertEquals(homeRepliesPending({ status: 'idle', roster: null }), true);
  assertEquals(homeRepliesPending({ status: 'ready', roster: full(true) }), true);
  assertEquals(homeRepliesPending({ status: 'ready', roster: full(false) }), false);
  // A re-read keeps the last answer (no flicker on focus).
  assertEquals(homeRepliesPending({ status: 'loading', roster: full(false) }), false);
  assertEquals(homeRepliesPending({ status: 'error', roster: null }), false);
  // One read, shared: the counts card is render-only, PreDraftCard gets the flag.
  const home = SOURCES['app/(tabs)/index.tsx'];
  assert(home.includes('<PreDraftCard {...preDraft} repliesPending={homeRepliesPending(st)} />'));
  assert(home.includes('{roster ? <RenewalCountsCard roster={roster} /> : null}'));
});
