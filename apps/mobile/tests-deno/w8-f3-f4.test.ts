/**
 * W8 follow-up (Design Lead, 2026-10-16).
 *  F3: Profile's back link names the tab it came from ("‹ Home" / "‹ Matchup" / "‹ League" / "‹ Portfolio"),
 *      "‹ Back" when unknown; it still calls router.back().
 *  F4: the Renewal review's Draft row reads "Pick a draft time" until a time is set, and a disabled
 *      "Schedule the draft" says why ("Pick a future draft time.", NEW copy) for NO time and for a PAST time.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import {
  PROFILE_BACK_FALLBACK, PROFILE_FROM, profileBackLabel, profileFromParam, profileFromPathname, profileHref,
} from '../lib/shell/profileBack.ts';
import {
  DRAFT_ROW_UNSET, SCHEDULE_FOOTNOTE, SCHEDULE_NEEDS_TIME, canSchedule, scheduleLine, scheduleReason,
} from '../lib/game/renewalReview.ts';
import { SOURCES } from './sourceManifest.generated.ts';

/** Source without comments, so a guard never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

// ── F3 ─────────────────────────────────────────────────────────────────────────────

Deno.test('F3: the back label is the tab the avatar was tapped on; anything else is "Back"', () => {
  assertEquals(PROFILE_FROM.map((f) => profileBackLabel(f)), ['Home', 'Matchup', 'League', 'Portfolio']);
  assertEquals(profileBackLabel(undefined), 'Back');
  assertEquals(profileBackLabel(''), 'Back');
  assertEquals(profileBackLabel('settings'), 'Back', 'unknown');
  assertEquals(profileBackLabel('League'), 'Back', 'case-sensitive: only the four exact values');
  assertEquals(profileBackLabel('league '), 'Back');
  assertEquals(profileBackLabel('__proto__'), 'Back');
  assertEquals(profileBackLabel(['portfolio', 'home']), 'Portfolio', 'a repeated param: the first');
  assertEquals(profileBackLabel([]), 'Back');
  assertEquals(PROFILE_BACK_FALLBACK, 'Back');
});

Deno.test('F3: the param is validated against the four values only', () => {
  for (const f of PROFILE_FROM) assertEquals(profileFromParam(f), f);
  assertEquals(profileFromParam('profile'), null);
  assertEquals(profileFromParam('/league'), null);
});

Deno.test('F3: a pathname maps to its tab ("/" is Home)', () => {
  assertEquals(profileFromPathname('/'), 'home');
  assertEquals(profileFromPathname('/index'), 'home');
  assertEquals(profileFromPathname('/matchup'), 'matchup');
  assertEquals(profileFromPathname('/league'), 'league');
  assertEquals(profileFromPathname('/(tabs)/portfolio'), 'portfolio');
  assertEquals(profileFromPathname('/league/'), 'league');
  assertEquals(profileFromPathname('/profile'), null);
  assertEquals(profileFromPathname('/stock-search'), null);
  assertEquals(profileFromPathname('/home'), null, '"/home" is not a route');
  assertEquals(profileFromPathname(undefined), 'home', 'no pathname yet: the tabs\' root');
});

Deno.test('F3: the avatar pushes /profile with ?from=<tab>, a bare Profile when the tab is unknown', () => {
  assertEquals(profileHref('league'), { pathname: '/profile', params: { from: 'league' } });
  assertEquals(profileHref(null), { pathname: '/profile', params: {} });
});

Deno.test('F3: the wiring (source pins): the header sends the tab, Profile labels from it and keeps router.back()', () => {
  const header = code(SOURCES['components/shell/ShellHeader.tsx']);
  assert(header.includes('router.push(profileHref(profileFromPathname(pathname)))'));
  assert(!header.includes("router.push('/profile')"), 'no bare push');
  const page = code(SOURCES['app/profile.tsx']);
  assert(page.includes('label: profileBackLabel(from)'));
  assert(page.includes("(router.canGoBack() ? router.back() : router.replace('/'))"), 'the action is still a back');
  assert(!page.includes("label: 'Home'"), 'no fixed label');
});

// ── F4 ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-16T12:00:00Z');
const FUTURE = '2026-10-20T23:00:00Z';
const PAST = '2026-10-16T11:59:00Z';

Deno.test('F4: no time, a past time and a future time: the button and its line', () => {
  // No time: disabled, reason.
  assertEquals(canSchedule({ repliesPending: false, draftDate: null, now: NOW }), false);
  assertEquals(scheduleReason({ draftDate: null, now: NOW }), 'Pick a future draft time.');
  assertEquals(scheduleLine({ draftDate: null, now: NOW }), SCHEDULE_NEEDS_TIME);
  // A time in the PAST (not left to the picker's minimumDate): disabled, the same reason.
  assertEquals(canSchedule({ repliesPending: false, draftDate: PAST, now: NOW }), false);
  assertEquals(scheduleReason({ draftDate: PAST, now: NOW }), SCHEDULE_NEEDS_TIME);
  assertEquals(scheduleLine({ draftDate: PAST, now: NOW }), SCHEDULE_NEEDS_TIME);
  assertEquals(canSchedule({ repliesPending: false, draftDate: NOW.toISOString(), now: NOW }), false, 'exactly now is not the future');
  assertEquals(canSchedule({ repliesPending: false, draftDate: 'not-a-date', now: NOW }), false);
  // A future time: enabled, the footnote returns.
  assertEquals(canSchedule({ repliesPending: false, draftDate: FUTURE, now: NOW }), true);
  assertEquals(scheduleReason({ draftDate: FUTURE, now: NOW }), null);
  assertEquals(scheduleLine({ draftDate: FUTURE, now: NOW }), SCHEDULE_FOOTNOTE);
  // A future time that has PASSED since it was picked flips back.
  assertEquals(canSchedule({ repliesPending: false, draftDate: FUTURE, now: new Date('2026-10-21T00:00:00Z') }), false);
  // Replies pending still blocks.
  assertEquals(canSchedule({ repliesPending: true, draftDate: FUTURE, now: NOW }), false);
});

Deno.test('F4: the strings (the footnote is unchanged; the unset value is the shipped one)', () => {
  assertEquals(SCHEDULE_FOOTNOTE, "Everyone who's in gets a notification. Season 1 stays in History.");
  assertEquals(SCHEDULE_NEEDS_TIME, 'Pick a future draft time.');
  assertEquals(DRAFT_ROW_UNSET, 'Pick a draft time');
  // "the shipped string Create league and League settings use"
  assert(code(SOURCES['app/create-league.tsx']).includes("'Pick a draft time'"));
  assert(code(SOURCES['app/league-settings.tsx']).includes("'Pick a draft time'"));
  assert(SOURCES['lib/game/renewalReview.ts'].includes('NEW copy'), 'the new line is marked NEW in the code');
});

Deno.test('F4: the review component (source pins)', () => {
  const src = code(SOURCES['components/game/RenewalReview.tsx']);
  assert(src.includes(': DRAFT_ROW_UNSET}'), 'the Draft row says Pick a draft time until a time is set');
  assert(!src.includes("'Not set'") || !/label="Draft"[^\n]*'Not set'/.test(src), 'no "Not set" on the Draft row');
  assert(src.includes('canSchedule({ repliesPending, draftDate, now })'), 'the gate takes the clock');
  assert(src.includes('{scheduleLine({ draftDate, now })}'), 'the line under the button is the reason or the footnote');
  assert(src.includes('setInterval(() => setNow(new Date()), 15_000)'), 'now ticks, so a time that passes disables Schedule');
  assert(!src.includes('isFutureDraftDate'), 'the rule lives in canSchedule, not in the picker callback');
  assert(src.includes('if (d) setDraftDate(d.toISOString());'), 'a picked time is shown, never silently ignored');
  assert(!src.includes("Everyone who's in gets a notification"), 'the footnote text lives in renewalReview.ts');
});
