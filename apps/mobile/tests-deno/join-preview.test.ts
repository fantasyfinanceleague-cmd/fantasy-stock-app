/**
 * Join a league (3f): the pure view-model and outcome logic in
 * lib/join/joinPreview.ts. Pins the board's copy (key-screens.html
 * #join-league) verbatim, the "read ONLY what preview-league returns" rule,
 * and the house rule that no server text reaches the UI.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert';
import {
  JOIN_COPY, blockMessage, classifyInvokeError, coerceBlock, draftRow, errorMessage,
  interpretJoin, interpretPreview, joinedView, parsePreviewLeague, previewAction, previewView,
  refineBlock, seasonLine,
} from '../lib/join/joinPreview.ts';
import { fixtureJoinResponse, fixturePreviewResponse } from '../lib/join/joinFixtureGate.ts';

const SERIE_A = {
  name: 'Serie A Traders', commissioner_name: 'Roberto B.', league_type: 'matchup',
  num_participants: 8, current_members: 6, budget_mode: 'no-budget', budget_amount: null,
  stake_mode: 'fixed_notional', notional_per_slot: 2000, duration_days: null, num_weeks: 10,
  draft_date: '2026-10-10T23:00:00Z', draft_status: 'not_started',
};
const league = () => parsePreviewLeague(SERIE_A)!;

Deno.test('the board preview: name, run by, Managers / Draft / Stakes / Season, button names the league', () => {
  const v = previewView(league(), null);
  assertEquals(v.name, 'Serie A Traders');
  assertEquals(v.runBy, 'Run by Roberto B.');
  assertEquals(v.rows, [
    { label: 'Managers', value: '6 of 8' },
    { label: 'Draft', value: 'Sat, Oct 10 · 7:00 PM ET' },
    { label: 'Stakes', value: 'Equal stakes · $2,000 per slot' },
    { label: 'Season', value: '10 weeks' },
  ]);
  assertEquals(v.message, null);
  assertEquals(v.action, 'join');
  assertEquals(v.caption, 'You can leave any time before the draft.');
});

Deno.test('the board refusals, verbatim, naming the league', () => {
  const l = league();
  assertEquals(blockMessage('league_full', l), 'Serie A Traders is full: 8 of 8 managers. Ask Roberto B. if they can make room.');
  assertEquals(blockMessage('draft_started', l), "Serie A Traders has already drafted, so it can't take new managers this season.");
  assertEquals(blockMessage('draft_in_progress', l), "Serie A Traders is drafting right now, so it can't take new managers this season.");
  assertEquals(blockMessage('already_member', l), "You're already in Serie A Traders.");
  assertEquals(blockMessage('invite_expired', l), 'This invite has expired. Ask your commissioner for a new code.');
  assertEquals(blockMessage('season_completed', l), "Serie A Traders's season is over. Ask your commissioner whether they're running it back.");
  assertEquals(
    blockMessage('left_league', l),
    "You left Serie A Traders this season, so you can't rejoin it. You can still view it from Your leagues.",
  );
});

Deno.test('every board error line', () => {
  assertEquals(JOIN_COPY.badCode, 'No league has that code. Check it and try again.');
  assertEquals(JOIN_COPY.unreachable, "Couldn't reach the league. Check your connection, then try again.");
  assertEquals(JOIN_COPY.codeIntro, 'Enter the invite code your commissioner sent you.');
});

Deno.test('a full league always reads N of N, and the draft row says Done once drafted', () => {
  const full = previewView({ ...league(), members: 7 }, 'league_full');
  assertEquals(full.rows[0].value, '8 of 8');
  const drafted = previewView({ ...league(), draftStatus: 'completed' }, 'draft_started');
  assertEquals(drafted.rows[1].value, 'Done');
});

Deno.test('the button under each block: join / open / try another / disabled for a leaver', () => {
  assertEquals(previewAction(null), 'join');
  assertEquals(previewAction('already_member'), 'open');
  assertEquals(previewAction('league_full'), 'another');
  assertEquals(previewAction('draft_started'), 'another');
  assertEquals(previewAction('draft_in_progress'), 'another');
  assertEquals(previewAction('invite_expired'), 'another');
  assertEquals(previewAction('season_completed'), 'another');
  assertEquals(previewAction('unknown'), 'another');
  assertEquals(previewAction('left_league'), 'join_disabled');
  // A refusal has no "you can leave any time" caption.
  assertEquals(previewView(league(), 'league_full').caption, null);
});

Deno.test('flag (a): left_league is optional; an old server just sends already_member', () => {
  assertEquals(coerceBlock('left_league'), 'left_league');
  assertEquals(coerceBlock('already_member'), 'already_member');
  // A reason this build doesn't know is a generic refusal, not a crash.
  assertEquals(coerceBlock('something_new'), 'unknown');
  assertEquals(coerceBlock(undefined), 'unknown');
  assertEquals(blockMessage('unknown', league()), JOIN_COPY.unknownBlock);
  assertEquals(JOIN_COPY.unknownBlock, "You can't join this league right now. Ask your commissioner to check the invite.");
});

Deno.test('the Stakes row uses the shared stakesLine (wording is pinned in stakes-line.test.ts)', () => {
  assertEquals(previewView({ ...league(), stakeMode: 'price_tiers' }, null).rows[2].value, 'Price tiers · one share per slot');
  assertEquals(previewView({ ...league(), stakeMode: 'budget_cap', budgetAmount: 2500 }, null).rows[2].value, 'Budget cap · $2,500');
  assertEquals(previewView({ ...league(), stakeMode: null }, null).rows[2].value, 'Not set yet');
  // preview-league not yet redeployed: no per-slot field, so no amount (never "$0").
  assertEquals(previewView({ ...league(), notionalPerSlot: null }, null).rows[2].value, 'Equal stakes');
});

Deno.test('season line and draft row edge cases', () => {
  assertEquals(seasonLine({ leagueType: 'matchup', numWeeks: 1, durationDays: null }), '1 week');
  assertEquals(seasonLine({ leagueType: 'duration', numWeeks: null, durationDays: 30 }), '30 days');
  assertEquals(seasonLine({ leagueType: null, numWeeks: null, durationDays: null }), null);
  // No Season row when the league has no length.
  assertEquals(previewView({ ...league(), numWeeks: null, durationDays: null }, null).rows.map((r) => r.label), ['Managers', 'Draft', 'Stakes']);
  assertEquals(draftRow({ draftDate: null, draftStatus: 'not_started' }), JOIN_COPY.draftNotScheduled);
  assertEquals(draftRow({ draftDate: '2026-10-10T23:00:00Z', draftStatus: 'in_progress' }), JOIN_COPY.draftInProgress);
  assertEquals(draftRow({ draftDate: 'garbage', draftStatus: 'not_started' }), JOIN_COPY.draftNotScheduled);
});

Deno.test('draft_started splits on the preview\'s draft_status: completed vs under way', () => {
  const body = (draft_status: string) => ({ found: true, joinable: false, reason: 'draft_started', league: { ...SERIE_A, draft_status } });
  const inProgress = interpretPreview(body('in_progress'), null);
  assertEquals(inProgress.kind === 'found' && inProgress.block, 'draft_in_progress');
  const completed = interpretPreview(body('completed'), null);
  assertEquals(completed.kind === 'found' && completed.block, 'draft_started');
  // refineBlock leaves every other block alone, and treats a missing status as under way.
  assertEquals(refineBlock('league_full', 'in_progress'), 'league_full');
  assertEquals(refineBlock('already_member', 'completed'), 'already_member');
  assertEquals(refineBlock('draft_started', undefined), 'draft_in_progress');
  // At join time the held preview was joinable (not_started): a refusal now means the draft just began.
  assertEquals(refineBlock('draft_started', 'not_started'), 'draft_in_progress');
  // The Draft row reads "In progress" for the in-progress frame, "Done" for the completed one.
  assertEquals(previewView({ ...league(), draftStatus: 'in_progress' }, 'draft_in_progress').rows[1].value, 'In progress');
  assertEquals(previewView({ ...league(), draftStatus: 'completed' }, 'draft_started').rows[1].value, 'Done');
});

Deno.test('interpretPreview: found / joinable / refused / bad code', () => {
  const ok = interpretPreview({ found: true, joinable: true, reason: null, league: SERIE_A }, null);
  assertEquals(ok.kind, 'found');
  if (ok.kind === 'found') assertEquals(ok.block, null);

  const full = interpretPreview({ found: true, joinable: false, reason: 'league_full', league: SERIE_A }, null);
  assertEquals(full.kind === 'found' && full.block, 'league_full');

  assertEquals(interpretPreview({ found: false, reason: 'invalid_code' }, null), { kind: 'bad_code' });
});

Deno.test('interpretPreview: a malformed body is a failure, never a half-built preview', () => {
  assertEquals(interpretPreview(null, null), { kind: 'error', error: 'unreachable' });
  assertEquals(interpretPreview('nope', null), { kind: 'error', error: 'unreachable' });
  assertEquals(interpretPreview({ found: true, joinable: true, league: { name: 'No size' } }, null), { kind: 'error', error: 'unreachable' });
  assertEquals(interpretPreview({ found: true, joinable: true }, null), { kind: 'error', error: 'unreachable' });
});

Deno.test('house rule: server message text NEVER reaches the UI', () => {
  const body = { error: 'unhandled', message: 'SELECT * FROM leagues WHERE secret = 1' };
  const http500 = { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status: 500, body } };
  const out = interpretPreview(body, http500);
  assertEquals(out, { kind: 'error', error: 'unreachable' });
  assertEquals(errorMessage('unreachable'), JOIN_COPY.unreachable);
  // A 429 maps to its own line, not the body's "Too many attempts" text.
  const http429 = { name: 'FunctionsHttpError', context: { status: 429 } };
  assertEquals(classifyInvokeError(http429), 'rate_limited');
  assertEquals(errorMessage('rate_limited'), JOIN_COPY.rateLimited);
  assertNotEquals(errorMessage('rate_limited'), 'Too many attempts. Please wait a minute.');
  // 401, a fetch failure, a thrown string and nothing at all are all "unreachable".
  assertEquals(classifyInvokeError({ name: 'FunctionsHttpError', context: { status: 401 } }), 'unreachable');
  assertEquals(classifyInvokeError({ name: 'FunctionsFetchError' }), 'unreachable');
  assertEquals(classifyInvokeError('boom'), 'unreachable');
  assertEquals(classifyInvokeError(undefined), 'unreachable');
});

Deno.test('interpretJoin: joined / refused (with the id a member gets) / errors', () => {
  const L = { id: 'abc', name: 'Serie A Traders' };
  assertEquals(interpretJoin({ ok: true, league: L }, null), { kind: 'joined', leagueId: 'abc', leagueName: 'Serie A Traders' });
  assertEquals(
    interpretJoin({ ok: false, reason: 'already_member', league: L }, null),
    { kind: 'refused', block: 'already_member', leagueId: 'abc' },
  );
  assertEquals(interpretJoin({ ok: false, reason: 'league_full' }, null), { kind: 'refused', block: 'league_full', leagueId: null });
  // The server's invalid_code at join time is a refusal this screen has no frame for.
  assertEquals(interpretJoin({ ok: false, reason: 'invalid_code' }, null), { kind: 'refused', block: 'unknown', leagueId: null });
  // ok:true without a league to open is not a success.
  assertEquals(interpretJoin({ ok: true }, null), { kind: 'error', error: 'unreachable' });
  assertEquals(interpretJoin(null, { name: 'FunctionsFetchError' }), { kind: 'error', error: 'unreachable' });
});

Deno.test('joined: the board copy, and a fallback when the draft has no date', () => {
  const v = joinedView('Serie A Traders', '2026-10-10T23:00:00Z');
  assertEquals(v.title, "You're in Serie A Traders");
  assertEquals(v.body, 'The draft is Sat, Oct 10 · 7:00 PM ET. The draft order is set an hour before.');
  assertEquals(joinedView('X', null).body, JOIN_COPY.joinedNoDate);
  assertEquals(JOIN_COPY.joinedNoDate, "The commissioner hasn't set a draft date yet. You'll see it on your Home once they do.");
  // No push exists to promise (order-notify is still deferred).
  assertEquals(v.body.includes("let you know"), false);
  assertEquals(JOIN_COPY.joinedNoDate.includes("let you know"), false);
});

Deno.test('the preview reads ONLY what preview-league returns: no ids, no faces', () => {
  const v = previewView(league(), null);
  const text = JSON.stringify(v);
  assertEquals(Object.keys(v).sort(), ['action', 'block', 'caption', 'message', 'name', 'rows', 'runBy']);
  assertStringIncludes(text, 'Serie A Traders');
  // A raw league row carrying extras must not leak through the parser.
  const parsed = parsePreviewLeague({ ...SERIE_A, id: 'secret-id', commissioner_id: 'secret-uid', invite_code: 'SERIEA7' })!;
  assertEquals(JSON.stringify(parsed).includes('secret'), false);
  assertEquals(JSON.stringify(parsed).includes('SERIEA7'), false);
});

Deno.test('the dev fixtures answer with the same bodies the real functions return', () => {
  // Every fixture response goes through the REAL interpreter.
  assertEquals(interpretPreview(fixturePreviewResponse('preview').data, null).kind, 'found');
  for (const [f, block] of [['full', 'league_full'], ['drafted', 'draft_started'], ['drafting', 'draft_in_progress'], ['member', 'already_member'],
    ['expired', 'invite_expired'], ['season_over', 'season_completed'], ['left', 'left_league']] as const) {
    const r = fixturePreviewResponse(f);
    const o = interpretPreview(r.data, r.error);
    assertEquals(o.kind === 'found' && o.block, block, f);
  }
  assertEquals(interpretPreview(fixturePreviewResponse('bad').data, null), { kind: 'bad_code' });
  const off = fixturePreviewResponse('offline');
  assertEquals(interpretPreview(off.data, off.error), { kind: 'error', error: 'unreachable' });
  const rl = fixturePreviewResponse('rate_limited');
  assertEquals(interpretPreview(rl.data, rl.error), { kind: 'error', error: 'rate_limited' });
  assertEquals(interpretJoin(fixtureJoinResponse('preview').data, null).kind, 'joined');
  assertEquals(interpretJoin(fixtureJoinResponse('member').data, null).kind, 'refused');
  assertEquals(interpretJoin(fixtureJoinResponse('join_race').data, null), { kind: 'refused', block: 'league_full', leagueId: null });
});
