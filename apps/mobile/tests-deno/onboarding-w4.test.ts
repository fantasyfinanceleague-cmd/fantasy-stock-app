/**
 * Onboarding W4 (plan docs/plans/2026-10-14-onboarding.md; PRODUCT_RULES "Onboarding"): the pure
 * rules and the source guards for the gamertag username, the push pre-prompt, the confirm-failed
 * notice, the first-time tip, the no-league state on every tab, Skip-remembered and Profile's
 * "How it works".
 *
 *   cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  ADJECTIVES,
  ANIMALS,
  gamertagCandidates,
  isGamertagSafe,
  makeGamertag,
  pickAvailableGamertag,
  seededRng,
} from '../lib/shell/gamertag.ts';
import { initialUsernameState, usernameReducer, usernameSuggestions, usernameView } from '../lib/shell/usernameMachine.ts';
import { USERNAME_RE } from '../lib/shell/usernameRules.ts';
import {
  CONFIRM_FAILED_NOTICE,
  isConfirmFailedNotice,
  raisesConfirmFailedNotice,
  setConfirmFailedNotice,
  subscribeConfirmFailedNotice,
} from '../lib/auth/confirmFailedNotice.ts';
import { PUSH_ASK_COPY, pushAskDestination, pushAskRoute, shouldPrePrompt, type OsPush, type PushAskRecord } from '../lib/shell/pushAskPolicy.ts';
import { TIPS, tipVisible } from '../lib/shell/firstTimeTipPolicy.ts';
import { confirmedChipLabel } from '../lib/shell/confirmedChip.ts';
import { CONFIRM_EMAIL_COPY } from '../constants/confirmEmailCopy.ts';
import { ARRIVAL_COPY, arrivalTitle, arrivalView, keepName, refusalLine } from '../lib/invite/arrivalView.ts';
import { INVITE_COPY } from '../lib/invite/inviteCopy.ts';
import { fixtureJoinedRows, joinedFactRows } from '../lib/join/joinedFacts.ts';
import { INVITE_FIXTURES, inviteFixture } from '../lib/invite/inviteFixture.ts';
import { JOIN_COPY, blockMessage, previewView, type PreviewLeague } from '../lib/join/joinPreview.ts';
import { parseCaptureKnobs } from '../lib/shell/captureKnobs.ts';
import { SOURCES } from './sourceManifest.generated.ts';

/** Source without comments, so a guard never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

// ── The gamertag generator ───────────────────────────────────────────────────────

Deno.test('gamertag: every adjective × animal passes the format AND the content check, at the longest digits', () => {
  for (const a of ADJECTIVES) {
    for (const n of ANIMALS) {
      const tag = `${a}${n}999`;
      assert(USERNAME_RE.test(tag), `${tag} must fit ^[A-Za-z0-9_]{3,20}$`);
      assert(isGamertagSafe(tag), `${tag} must pass the content check`);
    }
  }
});

Deno.test('gamertag: the longest possible tag is within the server cap of 20', () => {
  const longestA = Math.max(...ADJECTIVES.map((a) => a.length));
  const longestN = Math.max(...ANIMALS.map((a) => a.length));
  assert(longestA + longestN + 3 <= 20, `${longestA}+${longestN}+3`);
});

Deno.test('gamertag: the shape is Adjective + Animal + digits, and a seeded source is deterministic', () => {
  const a = makeGamertag(seededRng(151));
  assertEquals(a, makeGamertag(seededRng(151)));
  assert(/^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/.test(a), a);
  assert(makeGamertag(seededRng(1)) !== makeGamertag(seededRng(2)));
});

Deno.test('gamertag: candidates are distinct (case-insensitive) and safe, and a stuck source cannot loop forever', () => {
  const tags = gamertagCandidates(seededRng(7), 9);
  assertEquals(tags.length, 9);
  assertEquals(new Set(tags.map((t) => t.toLowerCase())).size, 9);
  for (const t of tags) assert(isGamertagSafe(t));
  // A source that always returns the same number yields ONE tag, and returns (bounded).
  assertEquals(gamertagCandidates(() => 0.5, 9).length, 1);
});

Deno.test('gamertag: the module takes no person input (no name, email, session or metadata)', () => {
  const src = code(SOURCES['lib/shell/gamertag.ts']);
  for (const w of ['email', 'user_metadata', 'full_name', 'first_name', 'session', 'supabase', 'AsyncStorage']) {
    assert(!src.toLowerCase().includes(w.toLowerCase()), `gamertag.ts mentions ${w}`);
  }
});

Deno.test('gamertag: pickAvailableGamertag retries on a clash, and gives up with null (never an unchecked name)', async () => {
  const rng = seededRng(3);
  let calls = 0;
  // Everything taken on the first two batches, the third batch has a free name.
  const hit = await pickAvailableGamertag(rng, async (cands) => {
    calls++;
    return cands.map((c, i) => ({ username: c, status: calls === 3 && i === 2 ? 'available' : 'taken' }));
  });
  assert(hit && isGamertagSafe(hit));
  assertEquals(calls, 3);
  // All taken for every attempt: null.
  assertEquals(await pickAvailableGamertag(seededRng(3), async (c) => c.map((u) => ({ username: u, status: 'taken' }))), null);
  // The check itself failed (offline): null, and it stops asking.
  let asked = 0;
  assertEquals(await pickAvailableGamertag(seededRng(3), async () => { asked++; return null; }), null);
  assertEquals(asked, 1);
  // Never more than the server's batch cap of 10.
  let size = 0;
  await pickAvailableGamertag(seededRng(3), async (c) => { size = c.length; return null; }, { batch: 50 });
  assert(size <= 10);
});

// ── The username machine: a suggested tag, and suggestions that never read the email ──

Deno.test('username machine: a suggested tag is available at once (Keep enabled), with the "change it later" helper', () => {
  const s = usernameReducer(initialUsernameState, { type: 'suggested', value: 'HelpfulHornet151' });
  assertEquals(s.kind, 'available');
  const v = usernameView(s);
  assertEquals(v.canContinue, true);
});

Deno.test('taken-name alternatives come from what was TYPED, then generated gamertags; the email is not an input', () => {
  const out = usernameSuggestions('roberto', seededRng(5), 26);
  assertEquals(out.slice(0, 4), ['roberto_26', 'roberto26', 'roberto_1', 'roberto_10']);
  for (const c of out) assert(USERNAME_RE.test(c), c);
  assert(!out.includes('roberto'), 'the taken name is never offered back');
  assert(usernameSuggestions('', seededRng(5), 26).every((c) => isGamertagSafe(c)), 'an empty typed name falls back to gamertags');
  // The signature has no email parameter, and neither does the machine's source.
  const src = code(SOURCES['lib/shell/usernameMachine.ts']);
  assert(!/email|user_metadata|full_name/i.test(src));
});

// ── The username picker (source guards) ──────────────────────────────────────────

Deno.test('picker: Keep / Change on a suggestion, Continue only when editing; helper; the chip clears on keep; no email prop', () => {
  const picker = code(SOURCES['components/shell/UsernamePicker.tsx']);
  assert(picker.includes('label="Keep"') && picker.includes('label="Change"'));
  assert(picker.includes('onPress={startEditing}'), 'Change acts: it opens the field');
  assert(picker.includes('view.continueShown ? ('));
  assert(picker.includes('HELPER_CHANGE_LATER'));
  assert(picker.includes('setEmailJustConfirmed(false)'), 'the chip clears when the name is kept');
  assert(picker.includes('SUGGEST_TIMEOUT_MS'), 'a slow generator falls back to typing');
  assert(picker.includes('pickAvailableGamertag('));
  for (const page of ['app/pick-username.tsx', 'app/username.tsx']) assert(!/email/i.test(code(SOURCES[page])), `${page} takes no email`);
  assert(!/\buser\.email\b|\bemail\b/.test(picker.replace(/EmailJustConfirmed|EmailConfirmedChip|emailConfirmed/g, '')), 'the picker never reads the email address');
});

// ── The confirmed chip ───────────────────────────────────────────────────────────

Deno.test('the confirmed chip: the glyph is drawn, the words are the approved constant, the spoken label is sentence case', () => {
  assertEquals(CONFIRM_EMAIL_COPY.confirmedChip, '✓ EMAIL CONFIRMED');
  assertEquals(confirmedChipLabel(CONFIRM_EMAIL_COPY.confirmedChip), { shown: 'EMAIL CONFIRMED', spoken: 'Email confirmed' });
  assertEquals(confirmedChipLabel('Plain'), { shown: 'Plain', spoken: 'Plain' });
});

// ── The confirm-failed notice on Sign in ─────────────────────────────────────────

Deno.test('confirm-failed notice: the words are the Planner\'s, verbatim', () => {
  assertEquals(CONFIRM_FAILED_NOTICE, 'Your email is confirmed. Sign in with your password.');
});

Deno.test('confirm-failed notice: ONLY the confirm-failed outcome raises it', () => {
  const outcomes = [
    'none', 'duplicate', 'confirm-ignored', 'confirm-failed', 'confirm-wrong-type', 'confirm-signed-in',
    'recovery-signed-in', 'recovery-failed', 'recovery-ignored',
  ] as const;
  for (const o of outcomes) {
    assertEquals(raisesConfirmFailedNotice(o as never), o === 'confirm-failed', o);
  }
});

Deno.test('confirm-failed notice: the store sets, clears and notifies once per change', () => {
  setConfirmFailedNotice(false);
  let n = 0;
  const off = subscribeConfirmFailedNotice(() => n++);
  setConfirmFailedNotice(true);
  setConfirmFailedNotice(true);
  assertEquals([isConfirmFailedNotice(), n], [true, 1]);
  setConfirmFailedNotice(false);
  assertEquals([isConfirmFailedNotice(), n], [false, 2]);
  off();
  setConfirmFailedNotice(true);
  assertEquals(n, 2);
  setConfirmFailedNotice(false);
});

Deno.test('confirm-failed notice: wired from the link handler result, cleared on the next attempt, on sign-in and on dismiss', () => {
  const layout = code(SOURCES['app/_layout.tsx']);
  assert(layout.includes('raisesConfirmFailedNotice(outcome)'));
  assertEquals(layout.split('.then(noteOutcome)').length - 1, 2, 'both delivery paths note the outcome');
  const login = code(SOURCES['app/login.tsx']);
  assert(login.includes('<ConfirmedEmailNotice />'));
  const attempt = login.slice(login.indexOf('async function handleSignIn'), login.indexOf('async function handleResend'));
  assert(attempt.indexOf('setConfirmFailedNotice(false)') > -1 && attempt.indexOf('setConfirmFailedNotice(false)') < attempt.indexOf('signIn('));
  assert(code(SOURCES['lib/SessionProvider.tsx']).includes('setConfirmFailedNotice(false)'), 'cleared on SIGNED_IN');
  const notice = code(SOURCES['components/shell/ConfirmedEmailNotice.tsx']);
  assert(notice.includes('CONFIRM_FAILED_NOTICE') && notice.includes('setConfirmFailedNotice(false)'), 'dismiss acts');
});

// ── The push pre-prompt ──────────────────────────────────────────────────────────

Deno.test('push ask: due only when never asked AND the OS is undetermined (every record × OS pair)', () => {
  const records: PushAskRecord[] = [null, 'continued', 'declined'];
  const states: OsPush[] = ['granted', 'denied', 'undetermined', 'unavailable'];
  for (const r of records) {
    for (const o of states) {
      assertEquals(shouldPrePrompt(r, o), r === null && o === 'undetermined', `${r} × ${o}`);
    }
  }
});

Deno.test('push ask: "Not now" is final; the route exists only when due', () => {
  assertEquals(pushAskRoute('declined', 'undetermined', '/(tabs)'), null);
  assertEquals(pushAskRoute('continued', 'undetermined', '/(tabs)'), null);
  assertEquals(pushAskRoute(null, 'granted', '/(tabs)'), null);
  assertEquals(pushAskRoute(null, 'unavailable', '/(tabs)'), null);
  assertEquals(pushAskRoute(null, 'undetermined', '/(tabs)/league'), '/notifications-ask?next=%2F(tabs)%2Fleague');
});

Deno.test('push ask: the destination is an allow-list (a link-carried route string cannot redirect)', () => {
  assertEquals(pushAskDestination('/(tabs)/league'), '/(tabs)/league');
  for (const bad of ['/draft-room', 'https://evil.example', '//evil', '', null, undefined, '/(tabs)/league/../x']) {
    assertEquals(pushAskDestination(bad as string), '/(tabs)');
  }
});

Deno.test('push ask: the words are Giorgio\'s, and the screen records the answer and acts', () => {
  assertEquals(PUSH_ASK_COPY.notNow, 'Not now');
  assertEquals(PUSH_ASK_COPY.continue, 'Continue');
  const screen = code(SOURCES['app/notifications-ask.tsx']);
  assert(screen.includes("writePushAskRecord('continued')") && screen.includes("writePushAskRecord('declined')"));
  assert(screen.includes('setupPushNotifications(user.id)'), 'Continue asks the OS (prompt on)');
  assert(screen.includes('router.replace(to)'));
  const view = code(SOURCES['components/shell/PushPrePrompt.tsx']);
  assert(view.includes('PUSH_ASK_COPY.notNow') && view.includes('PUSH_ASK_COPY.continue'));
});

Deno.test('push ask: the OS prompt is gone from sign-in (silent refresh only) and shown only through the ask', () => {
  const sp = code(SOURCES['lib/SessionProvider.tsx']);
  assertEquals(sp.split('setupPushNotifications(').length - 1, 3);
  assertEquals(sp.split('setupPushNotifications(session.user.id, false)').length - 1, 2);
  assert(sp.includes('setupPushNotifications(id, false)'));
  const n = code(SOURCES['lib/notifications.ts']);
  assert(n.includes('prompt = true') && n.includes('!== \'granted\' && prompt'));
  for (const f of ['app/join-league.tsx', 'app/create-league.tsx']) assert(code(SOURCES[f]).includes('pushAskRouteFor('), f);
  assert(code(SOURCES['app/_layout.tsx']).includes('name="notifications-ask"'), 'the route is declared');
});

// ── The first-time tip ───────────────────────────────────────────────────────────

Deno.test('first-time tip: shows only when the stored flag was read and is empty', () => {
  assertEquals(tipVisible(null), true);
  for (const s of [undefined, 'error', '1', '0', '']) assertEquals(tipVisible(s as never), false, String(s));
});

Deno.test('first-time tip: Giorgio\'s existing words, mounted first on the pre-draft Home card', () => {
  assertEquals(TIPS.weekWindow.text, "Your week runs Monday's open to Friday's close. Best performance wins.");
  const card = code(SOURCES['components/home/PreDraftCard.tsx']);
  assert(card.includes('<FirstTimeTip tip="weekWindow" />'));
  assert(code(SOURCES['components/shell/FirstTimeTip.tsx']).includes('dismissTip(tip)'), 'dismiss acts');
});

// ── No-league state on every tab ─────────────────────────────────────────────────

Deno.test('no leagues: all four tabs show the shared state (Matchup and Portfolio no longer draw a blank tab)', () => {
  const index = code(SOURCES['app/(tabs)/index.tsx']);
  const league = code(SOURCES['app/(tabs)/league.tsx']);
  assert(index.includes('<NoLeagueState title="Home"') && league.includes('<NoLeagueState title="League"'));
  for (const [file, title] of [['app/(tabs)/matchup.tsx', 'Matchup'], ['app/(tabs)/portfolio.tsx', 'Portfolio']] as const) {
    assert(code(SOURCES[file]).includes(`<LeagueListGate title="${title}">`), file);
  }
});

Deno.test('no leagues: the gate steps aside for loading and for leagues, and a failed read is never "No leagues yet"', () => {
  const g = code(SOURCES['components/shell/NoLeagueState.tsx']);
  assert(g.includes("if (fallback === 'empty') return <NoLeagueState"));
  assert(g.includes("if (fallback === 'failed') return <LeaguesFailedState"));
  assert(g.includes('return <>{children}</>;'));
  assert(g.indexOf("fallback === 'failed'") > -1);
  assert(g.includes("router.push('/create-league')") && g.includes("router.push('/join-league')"));
});

// ── Skip is remembered / cards on the cold path only ─────────────────────────────

Deno.test('Skip: both Skip and the last card mark onboarding seen AND keep get-started reachable', () => {
  const onboarding = code(SOURCES['app/onboarding.tsx']);
  const to = onboarding.slice(onboarding.indexOf('const toGetStarted'), onboarding.indexOf('const toGetStarted') + 220);
  assert(to.includes('openGetStarted()') && to.includes("router.replace('/get-started')") && to.includes('markOnboardingSeen()'));
  assert(to.indexOf('openGetStarted()') < to.indexOf('markOnboardingSeen()'), 'reachable before the seen flag drops the screen');
  assert(code(SOURCES['app/get-started.tsx']).includes('leaveGetStarted()'));
  const layout = code(SOURCES['app/_layout.tsx']);
  assert(layout.includes('guard={getStartedOpen || (!onboardingSeen && !pendingRoute.peek())}'));
});

Deno.test('cards on the cold path only: a link that opened the app counts as seen', () => {
  const ni = code(SOURCES['app/+native-intent.tsx']);
  assert(ni.includes('if (pendingRoute.peek()) markOnboardingSeen();'));
  assert(ni.indexOf('pendingRoute.record(') < ni.indexOf('markOnboardingSeen()'));
});

// ── Profile: How it works ────────────────────────────────────────────────────────

Deno.test('Profile: a "How it works" row opens the sheet (the three cards, still)', () => {
  const view = code(SOURCES['components/shell/ProfileView.tsx']);
  assert(view.includes('<Row label="How it works" onPress={onHowItWorks} />'));
  const page = code(SOURCES['app/profile.tsx']);
  assert(page.includes('onHowItWorks={() => setHowItWorks(true)}') && page.includes('<HowItWorksSheet'));
  const sheet = code(SOURCES['components/shell/HowItWorksSheet.tsx']);
  assert(sheet.includes('How it works') && sheet.includes('still'));
});

// ── The signed-out invite arrival (Giorgio's B ruling) ────────────────────────────

const view = (k: (typeof INVITE_FIXTURES)[number]) => arrivalView(inviteFixture(k));
const NB = '\u00a0';

Deno.test('arrival: "{inviter} invited you to {league}" over the inviter\'s initials; "You\'re invited to {league}" and the generic line over the league icon', () => {
  assertEquals(view('found').title, `Roberto invited you to Stock${NB}Scudetto`);
  assertEquals(view('found').titleParts, { lead: 'Roberto invited you to', name: `Stock${NB}Scudetto` });
  assertEquals(view('solo').titleParts, { lead: "You're invited to", name: `Stock${NB}Scudetto` });
  assertEquals(view('loading').titleParts, { lead: "You're invited to a league", name: null });
  assertEquals(view('found').mark, { kind: 'inviter', name: 'Roberto' });
  assertEquals(view('solo').title, `You're invited to Stock${NB}Scudetto`);
  assertEquals(view('solo').mark, { kind: 'league' });
  assertEquals(arrivalTitle(null, 'Roberto'), "You're invited to a league", 'no name: never a half-built sentence');
  for (const k of ['loading', 'unavailable'] as const) {
    assertEquals([view(k).title, view(k).mark], ["You're invited to a league", { kind: 'league' }], k);
  }
  assertEquals(ARRIVAL_COPY.generic, "You're invited to a league");
});

Deno.test('arrival: the league\'s name never breaks across lines (non-breaking spaces and a word joiner at hyphens)', () => {
  assertEquals(keepName('Stock Scudetto'), `Stock${NB}Scudetto`);
  assert(!arrivalTitle('Stock Scudetto', 'Roberto').includes('Stock Scudetto'));
  assertEquals(keepName('Big Fish League'), `Big${NB}Fish${NB}League`);
  assert(keepName('Wall-Street Bets').includes('-\u2060'), 'a hyphen between letters carries a word joiner');
  assertEquals(keepName('Stock Scudetto').replace(/\u00a0/g, ' '), 'Stock Scudetto', 'the words are unchanged');
});

Deno.test('arrival: a dead link (not found) has NO heading: the refusal alone, then Sign in', () => {
  const v = view('not_found');
  assertEquals([v.title, v.mark, v.refusal, v.canJoin, v.retry], [null, { kind: 'none' }, "This invite link doesn't work anymore. Ask for a new one.", false, false]);
});

Deno.test('arrival: loading and unavailable keep every sign-in option, never an error page; only unavailable offers Try again', () => {
  for (const k of ['loading', 'unavailable', 'found', 'solo'] as const) assertEquals([view(k).canJoin, view(k).refusal], [true, null], k);
  for (const k of INVITE_FIXTURES) assertEquals(view(k).retry, k === 'unavailable', k);
  assertEquals(view('unavailable').unreachable, JOIN_COPY.unreachable);
  for (const k of INVITE_FIXTURES) if (k !== 'unavailable') assertEquals(view(k).unreachable, null, k);
  assertEquals(ARRIVAL_COPY.tryAgain, 'Try again');
});

Deno.test('arrival: the refusals are Giorgio\'s / the Planner\'s lines, verbatim, and replace the sign-in buttons', () => {
  const full = view('full');
  assertEquals([full.canJoin, full.refusal], [false, 'Stock Scudetto is full. Ask whoever invited you if they can make room.']);
  for (const k of ['drafting', 'over'] as const) {
    assertEquals([view(k).canJoin, view(k).refusal], [false, "Stock Scudetto isn't taking new players right now."], k);
    assertEquals(view(k).title, `Roberto invited you to Stock${NB}Scudetto`, 'the heading stays above a refusal');
  }
  for (const k of ['found', 'solo', 'loading', 'unavailable'] as const) assertEquals(view(k).refusal, null, k);
});

Deno.test('arrival: the reason mapping matches previewJoinReason (invite_expired and anything unknown are a dead link)', () => {
  assertEquals(refusalLine('league_full', 'X'), INVITE_COPY.full('X'));
  assertEquals(refusalLine('draft_started', 'X'), INVITE_COPY.closed('X'));
  assertEquals(refusalLine('season_completed', 'X'), INVITE_COPY.closed('X'));
  assertEquals(refusalLine('invite_expired', 'X'), INVITE_COPY.dead);
  assertEquals(refusalLine('something_new', 'X'), INVITE_COPY.dead);
  // The function's own vocabulary (supabase/functions/preview-league/reason.ts), so a new reason is noticed here.
  const reasons = ['already_member', 'season_completed', 'invite_expired', 'draft_started', 'league_full'];
  const reasonSrc = Deno.readTextFileSync(new URL('../../../supabase/functions/preview-league/reason.ts', import.meta.url));
  for (const r of reasons) assert(reasonSrc.includes(`'${r}'`), r);
});

Deno.test('arrival: before sign-in there are no facts: the shape carries only the name, the inviter and the reason', () => {
  const types = code(SOURCES['lib/invite/usePendingInvite.ts']);
  assert(!/league\??:|PreviewLeague/.test(types), 'the pending-invite shape carries no league facts');
  const src = code(SOURCES['lib/invite/arrivalView.ts']);
  for (const w of ['blockMessage', 'previewView', 'unknownBlock', 'members', 'max']) assert(!src.includes(w), w);
  assert(!/rows|Card/.test(code(SOURCES['components/shell/InviteArrival.tsx'])), 'no facts rows signed out');
});

Deno.test('arrival: the capture knob parses only in a dev build and only a known state', () => {
  for (const k of INVITE_FIXTURES) assertEquals(parseCaptureKnobs(true, { invite: k }).invite, k);
  assertEquals(parseCaptureKnobs(true, { invite: 'nope' }).invite, null);
  assertEquals(parseCaptureKnobs(false, { invite: 'found' }).invite, null);
});

Deno.test('arrival: the layout centres the invite and docks the actions; wired first in the signed-out group', () => {
  const screen = code(SOURCES['components/shell/InviteArrival.tsx']);
  assert(screen.includes('<AuthScaffold centerBody footer='), 'invite centred above, actions in the footer');
  assert(screen.includes('numberOfLines={1} adjustsFontSizeToFit'), 'the league name is fitted to one line, so it never breaks even at the largest size');
  assert(screen.includes('onPress={invite.retryPreview}'), 'Try again re-asks on a tap, never a loop');
  assert(screen.includes("router.push('/create-account')") && screen.includes("router.push('/login')"));
  assert(!/setInterval|setTimeout|useEffect/.test(screen), 'no polling or retry loop');
  const scaffold = code(SOURCES['components/shell/AuthScaffold.tsx']);
  assert(scaffold.includes("flexGrow: 1") && scaffold.includes("justifyContent: 'center'"));
  const layout = code(SOURCES['app/_layout.tsx']);
  const group = layout.slice(layout.indexOf('<Stack.Protected guard={!signedIn}>'));
  assert(group.indexOf('name="invite"') > -1 && group.indexOf('name="invite"') < group.indexOf('name="onboarding"'), 'invite comes before the cards');
  assert(layout.includes('<Stack.Protected guard={pendingInvite !== null}>') && layout.includes('useArrivalInvite()'));
  assert(code(SOURCES['lib/invite/usePendingInvite.ts']).includes('return null;'), 'the stub never has a pending invite');
  assert(code(SOURCES['lib/invite/useArrivalInvite.ts']).includes('FIXTURE ?? pending'));
});

// ── "You're in {league}": the facts card (C1) and the invited-only "full" line ───────

const LG: PreviewLeague = {
  name: 'Stock Scudetto', members: 4, max: 6, stakeMode: 'fixed_notional', notionalPerSlot: 100, budgetAmount: null,
  leagueType: 'matchup', numWeeks: 10, durationDays: null, draftDate: '2026-10-17T23:00:00Z', draftStatus: 'not_started',
};
const FACTS = { num_participants: 6, stake_mode: 'fixed_notional', notional_per_slot: 100, budget_amount: null, league_type: 'matchup', num_weeks: 10, duration_days: null };

Deno.test('You\'re in: the card is Managers / Stakes / Season (no Draft row: the draft sentence stays)', () => {
  const rows = joinedFactRows(FACTS, 6);
  assertEquals(rows.map((r) => r.label), ['Managers', 'Stakes', 'Season']);
  assertEquals(rows[0].value, '6 of 6');
  assertEquals(rows[2].value, '10 weeks');
  assert(!rows.some((r) => r.label === 'Draft'));
});

Deno.test('You\'re in: an unreadable member count drops Managers (never a guessed count); a league with no length drops Season', () => {
  assertEquals(joinedFactRows(FACTS, null).map((r) => r.label), ['Stakes', 'Season']);
  assertEquals(joinedFactRows({ ...FACTS, num_weeks: null, duration_days: null }, 6).map((r) => r.label), ['Managers', 'Stakes']);
});

Deno.test('You\'re in: a fixture reads the held preview with the new member added, capped at the league size', () => {
  assertEquals(fixtureJoinedRows(LG)[0].value, '5 of 6');
  assertEquals(fixtureJoinedRows({ ...LG, members: 6 })[0].value, '6 of 6');
});

Deno.test('You\'re in: the facts come from the member\'s league list after the join, not from the preview', () => {
  const join = code(SOURCES['app/join-league.tsx']);
  const joined = join.slice(join.indexOf('function Joined('), join.indexOf('const styles = StyleSheet.create'));
  assert(joined.includes('useLeagueContext()') && joined.includes('joinedFactRows(joined, members)'));
  assert(joined.includes('fixtureLeague ? fixtureJoinedRows(fixtureLeague)'), 'only a fixture falls back to the preview');
  assert(join.includes('fixtureLeague={JOIN_FIXTURE ? league : null}'), 'a real join never passes the preview');
  assert(join.includes('setJoinedId(JOIN_FIXTURE ? null : outcome.leagueId)'));
});

Deno.test('a full league: inside an invite the Planner\'s line; a typed code keeps "Ask your commissioner"', () => {
  const l = { name: 'Stock Scudetto', max: 6 };
  assertEquals(blockMessage('league_full', l, { invited: true }), 'Stock Scudetto is full. Ask whoever invited you if they can make room.');
  assertEquals(blockMessage('league_full', l), 'Stock Scudetto is full: 6 of 6 managers. Ask your commissioner if they can make room.');
  assertEquals(blockMessage('league_full', l, { invited: false }), blockMessage('league_full', l));
  // Only the full line changes; every other refusal is the same in both flows.
  for (const b of ['draft_started', 'draft_in_progress', 'season_completed', 'invite_expired', 'unknown'] as const) {
    assertEquals(blockMessage(b, l, { invited: true }), blockMessage(b, l), b);
  }
  assertEquals(previewView(LG, 'league_full', { invited: true }).message, INVITE_COPY.full('Stock Scudetto'));
  assertEquals(previewView(LG, 'league_full').message, blockMessage('league_full', LG));
});

Deno.test('a full league: Join keys the line on a pending invite, and the post-join refusal re-renders through it', () => {
  const join = code(SOURCES['app/join-league.tsx']);
  assert(join.includes('const invited = useArrivalInvite() !== null;'));
  assert(join.includes('previewView(league, block, { invited })'));
});

// ── Large text: nothing the person must read is clipped or turned into a column of words ──

Deno.test('large text: the suggested name never truncates, and the tip and the notice are capped so they stay cards', () => {
  const picker = code(SOURCES['components/shell/UsernamePicker.tsx']);
  assert(picker.includes("maxFontSizeMultiplier={mode === 'suggested' ? SUGGESTED_NAME_MAX_SCALE : undefined}"));
  const scale = Number(/SUGGESTED_NAME_MAX_SCALE = ([\d.]+);/.exec(picker)![1]);
  // The longest tag at 17pt x the cap and 0.55 em per character, against the narrowest supported phone (375pt):
  // the field is the screen less 2x24 margins, 2x17 padding and the check's 36pt.
  const longest = Math.max(...ADJECTIVES.map((a) => a.length)) + Math.max(...ANIMALS.map((a) => a.length)) + 3;
  assert(longest * 17 * scale * 0.55 <= 375 - 48 - 34 - 36, `a ${longest}-char gamertag at ${scale}x must fit one line`);
  assert(code(SOURCES['components/shell/FirstTimeTip.tsx']).includes('maxFontSizeMultiplier={TIP_MAX_SCALE}'));
  assert(code(SOURCES['components/shell/ConfirmedEmailNotice.tsx']).includes('maxFontSizeMultiplier={NOTICE_MAX_SCALE}'));
});

Deno.test('arrival: the stress fixture (a long league name and inviter) still splits into a wrapping lead and a one-line name', () => {
  const v = view('long');
  assertEquals(v.titleParts?.lead, 'Gianluigi Bartolomeo-Ricci invited you to');
  assert(!v.titleParts!.name!.includes(' '), 'the name carries no breaking space');
  assertEquals(v.mark, { kind: 'inviter', name: 'Gianluigi Bartolomeo-Ricci' });
  assertEquals([v.canJoin, v.refusal], [true, null]);
});

Deno.test('How it works: the thumbnail is tall enough for the FINAL scene (its winner line was clipped at 88pt)', () => {
  const sheet = code(SOURCES['components/shell/HowItWorksSheet.tsx']);
  const height = Number(/THUMB = \{ width: \d+, height: (\d+) \}/.exec(sheet)![1]);
  const scale = Number(/SCALE = ([\d.]+);/.exec(sheet)![1]);
  const sceneWidth = Number(/SCENE_WIDTH = (\d+);/.exec(sheet)![1]);
  assert(height >= 96, 'the thumbnail is at least 96pt tall');
  assert(sceneWidth * scale <= 120, 'the scaled scene fits the thumbnail width');
});

Deno.test('capture knobs seed the real stores once (so a dismiss or a keep still acts), never override the screen', () => {
  const notice = code(SOURCES['components/shell/ConfirmedEmailNotice.tsx']);
  assert(notice.includes("if (CAPTURE.confirmed === 'notice') setConfirmFailedNotice(true);"));
  assert(!/stored \|\| CAPTURE|confirmed \|\| CAPTURE/.test(notice), 'no OR-ing the knob into what is shown');
  const picker = code(SOURCES['components/shell/UsernamePicker.tsx']);
  assert(picker.includes("if (CAPTURE.confirmed === 'chip') setEmailJustConfirmed(true);"));
  assert(picker.includes('{firstRun && confirmed ? <EmailConfirmedChip /> : null}'));
});
