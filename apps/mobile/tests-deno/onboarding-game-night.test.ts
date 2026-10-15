/**
 * W4 Onboarding, invite and join on Game Night (DESIGN_DIRECTION §9C; PRODUCT_RULES "Nothing
 * tappable does nothing"; docs/design/reviews/w4-gate-checklist.md §5). The pure decisions
 * (usernameMachine's continueShown, createLeagueSteps' createNextDisabled, the onboarding
 * vignettes' data) and the source guards that keep the auth / first-run / create / join screens
 * on the Game Night primitives.
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { initialUsernameState, usernameReducer, usernameView, type UsernameState } from '../lib/shell/usernameMachine.ts';
import { createNextDisabled, leagueNameError, stakesStepError, CREATE_STEPS } from '../lib/game/createLeagueSteps.ts';
import { PRICE_TIERS_NEED_A_SLOT } from '../lib/game/slotBuilderCopy.ts';
import { FINAL, ONBOARDING_CARDS, ROSTER_PICKS, VERSUS, versusSides } from '../components/shell/onboarding/sampleData.ts';
import { CATEGORIES, scoreboardModel } from '../components/sp/logic/gameNight.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const code = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const src = (path: string) => {
  const s = SOURCES[path];
  assert(s !== undefined, `${path} is in the source manifest`);
  return code(s);
};

// ── Profile › Username: no silent disabled Continue ──────────────────────────────

const input = (state: UsernameState, value: string, current: string | null) =>
  usernameReducer(state, { type: 'input', value, contentOk: true, current });

Deno.test('username: Continue is HIDDEN while the name is unchanged (nothing to save, no words to say so)', () => {
  const unchanged = input(initialUsernameState, 'roberto_b', 'roberto_b');
  assertEquals(unchanged.kind, 'unchanged');
  assertEquals(usernameView(unchanged).continueShown, false);
  // Edited: Continue comes back (checking → its spinner is the reason it waits).
  const edited = input(unchanged, 'roberto_c', 'roberto_b');
  assertEquals(edited.kind, 'checking');
  assertEquals(usernameView(edited).continueShown, true);
});

Deno.test('username: every other state shows Continue, and each disabled one has its reason on screen', () => {
  const empty = usernameView(initialUsernameState);
  assertEquals(empty.continueShown, true);
  assertEquals(empty.canContinue, false);
  assert(empty.rules.length > 0 && empty.rules.every((r) => !r.ok), 'the unmet rules are the reason');
  const invalid = usernameView(input(initialUsernameState, 'ab', null));
  assertEquals(invalid.continueShown, true);
  assert(invalid.error, 'a local-invalid name says why');
  const available = usernameView({ kind: 'available', seq: 1, candidate: 'roberto_c' });
  assertEquals(available.canContinue, true);
  assertEquals(available.continueShown, true);
});

Deno.test('the picker renders Continue only under continueShown (source)', () => {
  const s = src('components/shell/UsernamePicker.tsx');
  assert(s.includes('view.continueShown ? ('), 'Continue sits under continueShown');
});

// ── Create league: Next is never a silent no-op ──────────────────────────────────

Deno.test('create league: an empty name does NOT disable Next; its press says "Enter a league name."', () => {
  for (const step of CREATE_STEPS) {
    if (step === 'stakes') continue;
    assertEquals(createNextDisabled(step, null), false, step);
  }
  assertEquals(leagueNameError('   ', () => ({ isValid: true })), 'Enter a league name.');
});

Deno.test('create league: Create is disabled only while the Stakes step shows its reason', () => {
  assertEquals(createNextDisabled('stakes', null), false);
  const reason = stakesStepError('price_tiers', 0, []);
  assertEquals(reason, PRICE_TIERS_NEED_A_SLOT);
  assertEquals(createNextDisabled('stakes', reason), true);
  assertEquals(createNextDisabled('stakes', stakesStepError('fixed_notional', 0, [])), false);
});

Deno.test('create-league.tsx disables its footer through createNextDisabled only (source)', () => {
  const s = src('app/create-league.tsx');
  assert(s.includes('const blocked = createNextDisabled(step, stakesStepError('), 'one decision');
  assert(!s.includes("step === 'league' && !state.name.trim()"), 'the old silent name gate is gone');
});

// ── Onboarding vignettes: the app's own pieces ───────────────────────────────────

Deno.test('onboarding: every roster pick carries one of the 11 categories (the draft tile line)', () => {
  assertEquals(ROSTER_PICKS.length, 6);
  for (const p of ROSTER_PICKS) assert(CATEGORIES[p.category], `${p.ticker} has a category`);
  assertEquals(ONBOARDING_CARDS.length, 3);
});

Deno.test('onboarding: versus is a lead change, said by the Scoreboard line', () => {
  const before = versusSides('before');
  const after = versusSides('after');
  assertEquals(scoreboardModel(before.you, before.opponent, false).line, 'Gianluigi B. leads by $37.66');
  assertEquals(scoreboardModel(after.you, after.opponent, false).line, 'Roberto B. leads by $123.16');
  assertEquals(before.you.name, VERSUS.you.name);
  assert(FINAL.you > FINAL.opp, 'the final is a win, as "You win Week 6" says');
});

Deno.test('onboarding vignettes are built from Game Night pieces, not Game Day ones (source)', () => {
  const s = src('components/shell/onboarding/Vignettes.tsx');
  for (const gone of ['TugBar', 'Chyron', 'ScoreDigits', "'VS'", '>VS<']) assert(!s.includes(gone), `no ${gone}`);
  assert(s.includes("import { DraftTile, Scoreboard } from '@/components/sp/gn';"));
  assert(s.includes('<DraftTile pick={index + 1} state="picked"'));
  assert(s.includes('<Scoreboard you={you} opponent={opponent} />'));
  const pager = src('components/shell/onboarding/OnboardingPager.tsx');
  assert(!pager.includes('colors.inset'), 'the art panel is the page, not an inset');
  assert(!pager.includes('numberOfLines={3}'), 'the card line wraps, never truncates');
  assert(pager.includes('minWidth: 44'), 'Skip is a 44pt target');
});

// ── §9C rule 2 (no rule lines between rows) and rule 4 (every fill its own ink) ──

const ROW_SCREENS = [
  'app/join-league.tsx',
  'components/shell/ProfileView.tsx',
  'components/shell/LeagueSheetRow.tsx',
  'components/shell/GetStarted.tsx',
];

Deno.test('no hairline row dividers on the onboarding / join / profile / league-sheet rows', () => {
  for (const path of ROW_SCREENS) {
    const s = src(path);
    assert(!s.includes('hairlineWidth'), `${path}: no hairline`);
    assert(!s.includes('borderTopWidth'), `${path}: no top rule`);
  }
});

Deno.test('drawn sp/Icon, not raw Ionicons, on the flows this gate covers', () => {
  for (const path of [...ROW_SCREENS, 'components/shell/LeagueSheet.tsx', 'components/shell/AuthScaffold.tsx']) {
    assert(!src(path).includes('Ionicons'), `${path}: sp/Icon`);
  }
});

Deno.test('a refusal reads the warn fill\'s own ink: WarnPanel / WarnNote use warnText', () => {
  const panel = src('components/sp/WarnPanel.tsx');
  assert(panel.includes('color={colors.warnText}'));
  const rows = src('components/game/SetupRows.tsx');
  const note = rows.slice(rows.indexOf('export function WarnNote'), rows.indexOf('export function LockNote'));
  assertEquals(note.match(/color=\{colors\.warnText\}/g)?.length, 2, 'title and line');
  const join = src('app/join-league.tsx');
  assert(join.includes('<WarnPanel text={view.message} />') && join.includes('<WarnPanel text={actionError} />'));
  assert(!join.includes('AlertCard'));
  const signup = src('app/create-account.tsx');
  assert(signup.includes('<WarnPanel text={`${brand.name} is not open for new signups yet'), 'the signups-paused line, verbatim');
});

Deno.test('Get started: the choices are §9C Cards and carry no accent (accent = live / your turn / selected)', () => {
  const s = src('components/shell/GetStarted.tsx');
  assert(s.includes('<Card style={styles.choice}>'));
  assert(!s.includes('accentTint') && !s.includes('elevation.card'));
});

Deno.test('Joined uses the trade-done medallion (onYou on you), not a gain check', () => {
  const s = src('app/join-league.tsx');
  assert(s.includes('<Icon name="check" size="medallion" tone="onYou" discTone="you" />'));
  assert(!s.includes('discTone="gainTint"'));
});

Deno.test('44pt targets: Chip, Forgot password?, the league sheet close', () => {
  assert(src('components/sp/Chip.tsx').includes('minHeight: 44'));
  const login = src('app/login.tsx');
  assert(/forgot: \{\s*alignSelf: 'flex-end',\s*minHeight: 44/.test(login));
  const sheet = src('components/shell/LeagueSheet.tsx');
  assert(/close: \{\s*minWidth: 44,\s*minHeight: 44/.test(sheet));
});

// ── Invite / share: every Share follows the one ruled condition ──────────────────

import { inviteShareShownFor } from '../lib/game/leagueSettingsEntry.ts';

Deno.test('Share (any surface): before the draft only; hidden from T−1h, mid-season and after the season', () => {
  const draft = Date.parse('2026-10-20T23:00:00Z');
  const facts = { seasonStatus: 'active', draftStatus: 'not_started', draftDate: '2026-10-20T23:00:00Z' };
  assertEquals(inviteShareShownFor(facts, draft - 2 * 3600_000), true, 'two hours out');
  assertEquals(inviteShareShownFor(facts, draft - 3600_000 + 1), false, 'the room is open (T−1h)');
  assertEquals(inviteShareShownFor({ ...facts, draftDate: null }, draft), true, 'no draft time yet');
  assertEquals(inviteShareShownFor({ ...facts, draftStatus: 'completed' }, draft - 5 * 3600_000), false, 'mid-season');
  assertEquals(inviteShareShownFor({ ...facts, seasonStatus: 'completed', draftStatus: 'completed' }, draft), false, 'season over');
});

Deno.test('Home\'s pre-draft invite row shows Share under inviteShareShownFor, with the one Share message (source)', () => {
  const s = src('components/home/PreDraftCard.tsx');
  assert(s.includes('{shareShown ? <Button label="Share" onPress={onShare} variant="secondary" size="sm" /> : null}'));
  assert(s.includes('const shareShown = inviteShareShownFor('));
  assert(s.includes('message: inviteShareMessage(inviteCode)'));
  assert(!s.includes('Join my Stockpile league'), 'no product name in the share text (the name is going)');
});

// ── DEV capture knobs: dead in a release bundle, never guessed ───────────────────

import { createFixtureStep, NO_KNOBS, parseCaptureKnobs } from '../lib/shell/captureKnobs.ts';

Deno.test('capture knobs: a release bundle (isDev false) reads nothing, whatever the env says', () => {
  assertEquals(parseCaptureKnobs(false, { card: '2', create: 'stakes', joinAuto: 'join', signupPaused: '1', usernamePrefill: 'roberto' }), NO_KNOBS);
});

Deno.test('capture knobs: recognised values only', () => {
  const k = parseCaptureKnobs(true, { card: '3', create: 'tiers', joinAuto: 'find', signupPaused: '1', usernamePrefill: ' roberto ' });
  assertEquals(k, { onboardingCard: 2, create: 'tiers', joinAuto: 'find', signupPaused: true, usernamePrefill: 'roberto', pushAsk: false, confirmed: null, invite: null });
  assertEquals(parseCaptureKnobs(true, { confirmed: 'chip' }).confirmed, 'chip');
  assertEquals(parseCaptureKnobs(true, { confirmed: 'notice' }).confirmed, 'notice');
  assertEquals(parseCaptureKnobs(true, { confirmed: 'x' }).confirmed, null);
  assertEquals(parseCaptureKnobs(false, { confirmed: 'chip' }).confirmed, null);
  assertEquals(parseCaptureKnobs(true, { pushAsk: '1' }).pushAsk, true);
  assertEquals(parseCaptureKnobs(true, { card: '4', create: 'bogus', joinAuto: 'yes', signupPaused: 'true' }), NO_KNOBS);
  assertEquals(createFixtureStep('tiers'), 'stakes');
  assertEquals(createFixtureStep('done'), 'league');
  assertEquals(createFixtureStep(null), 'league');
  assertEquals(createFixtureStep('draft'), 'draft');
});

Deno.test('capture knobs are read in ONE __DEV__-gated file (source)', () => {
  const dev = src('lib/shell/captureDev.ts');
  assert(dev.includes('parseCaptureKnobs(__DEV__, {'));
  for (const [path, s] of Object.entries(SOURCES)) {
    if (path === 'lib/shell/captureDev.ts') continue;
    for (const v of ['EXPO_PUBLIC_ONBOARDING_CARD', 'EXPO_PUBLIC_CREATE_FIXTURE', 'EXPO_PUBLIC_JOIN_AUTO', 'EXPO_PUBLIC_SIGNUP_PAUSED', 'EXPO_PUBLIC_USERNAME_PREFILL']) {
      assert(!code(s).includes(`process.env.${v}`), `${path} reads ${v} directly`);
    }
  }
});

Deno.test('Forgot password shows the shared auth copy, never the server message (source)', () => {
  const s = src('app/forgot-password.tsx');
  assert(s.includes('setError(getAuthErrorMessage(resetError));'));
  assert(!s.includes('setError(resetError.message)'));
});

// ── Large text: nothing breaks a word, the standout stays loudest ────────────────

import { keepDots, NBSP } from '../lib/game/keepDots.ts';

Deno.test('Join preview / Create summary lines wrap only between "·" segments', () => {
  assertEquals(keepDots('Sat, Oct 10 · 7:00 PM ET'), `Sat,${NBSP}Oct${NBSP}10${NBSP}· 7:00${NBSP}PM${NBSP}ET`);
  assertEquals(keepDots('Equal stakes · $2,000 per slot'), `Equal${NBSP}stakes${NBSP}· $2,000${NBSP}per${NBSP}slot`);
  const join = src('app/join-league.tsx');
  assert(join.includes('{keepDots(row.value)}'));
  assert(join.includes('style={stackRows ? styles.rowStacked : styles.row}'), 'rows stack at accessibility sizes');
  const create = src('app/create-league.tsx');
  assertEquals(create.match(/keepDots\(/g)?.length, 3, 'stakes, draft (summary) and Draft time');
});

Deno.test('the Stepper stacks its box under the label at accessibility sizes (no "Manager / s")', () => {
  const s = src('components/game/Stepper.tsx');
  assert(s.includes('const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;'));
  assert(s.includes('style={[styles.row, stacked && styles.rowStacked, disabled && styles.dim]}'));
});

Deno.test('Profile: rows and the version line never outgrow the username heading', async () => {
  const PROFILE_ROW_MAX_SCALE = 2; // ProfileView.tsx's export (pinned below); a .tsx can't load under Deno.
  const { type } = await import('../constants/tokens/type.ts');
  const heading = type.title.fontSize * (type.title.maxScale ?? Infinity);
  assert(type.body.fontSize * PROFILE_ROW_MAX_SCALE < heading, 'body row < title');
  const s = src('components/shell/ProfileView.tsx');
  assert(s.includes('export const PROFILE_ROW_MAX_SCALE = 2;'));
  assertEquals(s.match(/maxFontSizeMultiplier=\{PROFILE_ROW_MAX_SCALE\}/g)?.length, 3, 'label, value, version');
  assert(src('components/shell/AuthScaffold.tsx').includes('maxFontSizeMultiplier={2}'), 'the back row is capped');
});

// ── DL gate pass (2026-10-14) ─────────────────────────────────────────────────────

import { inviteShareDraftTime } from '../lib/game/leagueSettingsEntry.ts';
import { leaveWindow } from '../lib/game/leaveLeague.ts';
import { keepHyphens, WORD_JOINER } from '../lib/game/keepDots.ts';
import { fittedTotalPt, lineUnderTotalsCap } from '../components/sp/logic/gameNight.ts';
import { getAuthErrorMessage } from '../lib/authErrors.ts';
import { type } from '../constants/tokens/type.ts';

Deno.test('a POSTPONED draft is before_draft (no draft time) and Share shows; the old time is never read', () => {
  const now = Date.parse('2026-10-20T23:30:00Z');
  // postpone_league_draft cleared leagues.draft_date: the status says starts_at null.
  const draftDate = inviteShareDraftTime(true, null, null);
  assertEquals(draftDate, null);
  const facts = { seasonStatus: 'active', draftStatus: 'not_started', draftDate };
  assertEquals(leaveWindow(facts, now), 'before_draft');
  assertEquals(inviteShareShownFor(facts, now), true);
  // Status read: the server's time wins over a stale league row; unread: the league row.
  assertEquals(inviteShareDraftTime(true, null, '2026-10-20T23:00:00Z'), null);
  assertEquals(inviteShareDraftTime(false, null, '2026-10-20T23:00:00Z'), '2026-10-20T23:00:00Z');
  for (const path of ['lib/game/useDraftAutoStart.ts', 'components/home/PreDraftCard.tsx']) {
    const s = src(path);
    assert(s.includes('inviteShareDraftTime(phase !== null, ds.startsAt,'), `${path}: one draft-time source`);
    assert(!/inviteShare[\s\S]{0,200}postponed/.test(s), `${path}: never the postponement`);
  }
});

Deno.test('the blockers card shows "Share invite code" only under the one rule; the code stays', () => {
  assert(src('components/game/AutoStartBlockers.tsx').includes('onShareInvite={f.shareShown ? f.shareInvite : null}'));
  const card = src('components/game/DraftBlockersCard.tsx');
  assert(card.includes('{onShareInvite ? <Button label="Share invite code"'));
  assert(card.includes('<Text variant="headline" selectable>{inviteCode}</Text>'));
  assert(src('lib/game/useDraftAutoStart.ts').includes('const shareShown = inviteShareShownFor('));
});

Deno.test('SetupScaffold: subtitle ≤ 2×, the top row ≤ 1.6×, both under the step title at every size', () => {
  const s = src('components/game/SetupScaffold.tsx');
  assert(s.includes('export const SUBTITLE_MAX_SCALE = 2;') && s.includes('export const TOP_ROW_MAX_SCALE = 1.6;'));
  assertEquals(s.match(/maxFontSizeMultiplier=\{TOP_ROW_MAX_SCALE\}/g)?.length, 2, 'Back and Step N of 4');
  assert(s.includes('<Text variant="body" tone="secondary" maxFontSizeMultiplier={SUBTITLE_MAX_SCALE}>'));
  const title = type.display.fontSize * (type.display.maxScale ?? 1);
  assert(type.body.fontSize * 2 < title);
  assert(type.callout.fontSize * 1.6 < type.body.fontSize * 2, 'the top row stays under the subtitle');
});

Deno.test('onboarding card 3: "You win Week 6" never outranks the totals (cap from their FITTED size)', () => {
  const totals = ['+$351.77', '−$38.88'];
  // The vignette's real width: the art panel inside the gutter, border and padding (17e 308pt,
  // 17 Pro 320pt).
  for (const [width, scale] of [[308, 1], [308, 1.35], [308, 2], [320, 1.35], [320, 3]]) {
    const inner = width / 2 - 40;
    const totalPt = 32 * Math.min(scale, 1.2);
    const cap = lineUnderTotalsCap({ totals, totalPt, innerWidth: inner, linePt: 17 });
    const fitted = Math.min(...totals.map((t) => fittedTotalPt(t, totalPt, inner)));
    const drawn = 17 * Math.min(scale, cap);
    assert(drawn <= fitted, `width ${width} scale ${scale}: ${drawn} ≤ ${fitted}`);
  }
  const v = src('components/shell/onboarding/Vignettes.tsx');
  assert(v.includes('<Text variant="headline" maxFontSizeMultiplier={winnerCap}'));
});

Deno.test('auth errors never show the server\'s own words: an unmapped error is the generic line', () => {
  assertEquals(getAuthErrorMessage({ code: 'unexpected_failure', message: 'Database error saving new user' }), 'Something went wrong. Please try again.');
  assertEquals(getAuthErrorMessage({ message: 'AuthApiError: something internal' }), 'Something went wrong. Please try again.');
  assertEquals(getAuthErrorMessage(null), 'Something went wrong. Please try again.');
  assert(!src('lib/authErrors.ts').includes('return error?.message'));
});

Deno.test('the signups-paused capture knob takes the real refusal path (scrolls the panel into view)', () => {
  const s = src('app/create-account.tsx');
  assert(s.includes('const t = setTimeout(showPaused, 600);'));
  assert(s.includes('if (isSignupsPausedError(result.error)) {\n        showPaused();'));
  assert(s.includes('scrollRef.current?.scrollToEnd({ animated: !reduced })'));
});

Deno.test('"first-round byes" never splits at the hyphen; the copy itself is unchanged', () => {
  assertEquals(keepHyphens('the top 2 seeds get first-round byes'), `the top 2 seeds get first-${WORD_JOINER}round byes`);
  assertEquals(keepHyphens('6 teams · −$38.88'), '6 teams · −$38.88', 'only letter-hyphen-letter');
  assert(src('app/create-league.tsx').includes("{keepHyphens(playoffLine(playoffTeams) ?? '')}"));
});

Deno.test('Forgot / Reset password draw their EmptyState icon with sp/Icon', () => {
  for (const p of ['app/forgot-password.tsx', 'app/reset-password.tsx']) assert(!src(p).includes('Ionicons'), p);
});
