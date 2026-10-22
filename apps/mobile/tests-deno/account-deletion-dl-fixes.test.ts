/**
 * Account deletion, W4 — the Design Lead's gate fixes (2026-10-21): the sm Button label ceiling, the social proof lines in
 * the Field label/error styles, names that never split, the lockout without "Try again", and the share payload's https link.
 *
 *   cd apps/mobile/tests-deno && deno test -R account-deletion-dl-fixes.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { keepName, NAME_KEEP_WHOLE } from '../lib/account/keepName.ts';
import { leagueLine, type DeleteLeagueInput } from '../lib/account/leagueLines.ts';
import { takeoverQuestion, pastSeasonsLine, takeoverShareSentence, TAKEOVER_TAP_TITLE } from '../lib/account/deleteCopy.ts';
import { takeoverShareMessage, parseTakeoverArrival } from '../lib/invite/takeoverLink.ts';
import { WEB_BASE } from '../lib/links/webDomain.ts';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const src = (p: string) => strip(SOURCES[p]);
const NBSP = ' ';
const CODE = 'QX7P4KM3AB';

// ── 1. Button: both sizes share the label ceiling ───────────────────────────

Deno.test('Button: the label ceiling is the headline\'s 1.6x for BOTH sizes (the sm callout had none)', () => {
  const b = src('components/sp/Button.tsx');
  assert(b.includes('export const BUTTON_LABEL_MAX_SCALE = type.headline.maxScale ?? 1.6;'));
  assert(b.includes('maxFontSizeMultiplier={BUTTON_LABEL_MAX_SCALE}'));
  const label = b.slice(b.indexOf("variant={size === 'md' ? 'headline' : 'callout'}"), b.indexOf('{label}'));
  assert(label.includes('maxFontSizeMultiplier={BUTTON_LABEL_MAX_SCALE}'), 'the one label Text carries it, whatever the size');
  assert(src('constants/tokens/type.ts').includes("headline: { fontFamily: FONT.semiBold, fontSize: 17, lineHeight: 22, maxScale: 1.6 }"));
});

// ── 2. The social proof lines read in the Field's label / error styles ──────

Deno.test('proof lines: "Confirm it\'s you…", "Confirmed with …" and "Couldn\'t confirm it\'s you…" use the Field label / error styles', () => {
  const view = src('components/shell/DeleteAccountView.tsx');
  assert(view.includes('<FieldLabel>{PROOF_SOCIAL}</FieldLabel>'));
  assert(view.includes('<FieldLabel color={colors.gain}>'));
  assert(view.includes('<FieldError>{PROOF_UNCONFIRMED}</FieldError>'));
  // and the Field itself uses the same two pieces (one style, two homes)
  const field = src('components/shell/Field.tsx');
  assert(field.includes('<FieldLabel>{label}</FieldLabel>') && field.includes('<FieldError>{error}</FieldError>'));
  assert(/export function FieldLabel[\s\S]*?style=\{styles\.label\}/.test(field));
  assert(/export function FieldError[\s\S]*?color=\{colors\.danger\}[\s\S]*?style=\{styles\.error\}/.test(field));
  // no capped, hand-styled proof text left
  assertFalse(view.includes('{PROOF_SOCIAL}</Text>'));
});

// ── 3. Names that never split ───────────────────────────────────────────────

Deno.test('keepName: a name up to 20 characters is glued with no-break spaces; a longer one keeps its breaks; hyphens stay whole', () => {
  assertEquals(keepName('Former manager'), `Former${NBSP}manager`);
  assertEquals(keepName('Stock Scudetto'), `Stock${NBSP}Scudetto`);
  assertEquals(keepName('Friday Night Stocks'), `Friday${NBSP}Night${NBSP}Stocks`);
  const long = 'The Wall Street Wolves of Provo Valley';
  assertEquals(long.length > NAME_KEEP_WHOLE, true);
  assertEquals(keepName(long), long, 'a long name must stay breakable (an unbreakable run wider than the screen splits mid-word)');
  assertEquals(keepName('Jean-Luc Picard Co'), `Jean-⁠Luc${NBSP}Picard${NBSP}Co`);
  assertEquals(keepName(''), '');
  assertEquals(keepName(`Former manager`).replaceAll(NBSP, ' '), 'Former manager', 'display only: the same words');
});

Deno.test('keepName: applied to the heading, the past-seasons line and the league lines (label, league name, successor)', () => {
  const heading = takeoverQuestion(keepName('Former manager'), keepName('Stock Scudetto'));
  assertFalse(/Former manager|Stock Scudetto/.test(heading), 'no breakable space inside either name');
  assertEquals(heading.replaceAll(NBSP, ' '), "Take over Former manager's team in Stock Scudetto?");
  assertFalse(pastSeasonsLine(keepName('Former manager')).includes('Former manager'));
  const ME = 'u-me';
  const l: DeleteLeagueInput = {
    id: 'L', name: 'Stock Scudetto', commissionerId: ME,
    facts: { seasonStatus: 'active', draftStatus: 'completed', draftDate: new Date().toISOString() },
    members: [
      { user_id: ME, joined_at: '2026-01-01', hidden: false, displayName: 'Me', isBot: false, deleted: false },
      { user_id: 'u-p', joined_at: '2026-01-02', hidden: false, displayName: 'Paolo M.', isBot: false, deleted: false },
    ],
  };
  const r = leagueLine(l, ME, 'Former manager', Date.now(), keepName);
  assertEquals(r.name, `Stock${NBSP}Scudetto`);
  assert(r.line.includes(`Former${NBSP}manager`) && r.line.includes(`Paolo${NBSP}M.`));
  assertFalse(r.line.includes('Former manager'));
  // with no `keep` the strings are the approved plain text (the tests above pin them)
  assertEquals(leagueLine(l, ME, 'Former manager', Date.now()).line, 'Your team stays as “Former manager”. Paolo M. becomes the commissioner.');
  // wiring: each surface actually passes through it
  assert(src('components/shell/DeleteAccountView.tsx').includes('pastSeasonsLine(keepName(label))'));
  assert(src('components/shell/TakeoverLanding.tsx').includes('takeoverQuestion(keepName(label), keepName(found.leagueName))'));
  assert(src('app/delete-account.tsx').includes('leagueLine(l, meId, label, Date.now(), keepName)'));
});

// ── 4. The hour's lockout has nothing to retry ──────────────────────────────

Deno.test('lockout: "later" drops Try again and keeps Not now; "moment" and an unreachable league keep Try again', () => {
  const landing = src('components/shell/TakeoverLanding.tsx');
  assert(landing.includes("state.kind === 'rate_limited' && state.wait === 'later' ? null : <Link label={ARRIVAL_COPY.tryAgain} onPress={onRetry} />"));
  const branch = landing.slice(landing.indexOf("state.kind === 'unknown' || state.kind === 'rate_limited'"), landing.indexOf('const found ='));
  assert(branch.includes('NOT_NOW'), 'Not now stays on every variant');
});

// ── The share payload carries the https link ────────────────────────────────

Deno.test('share: the payload is the approved sentence AND the https /take/<CODE> link on its own line, and it parses back as an https takeover', () => {
  const msg = takeoverShareMessage('Stock Scudetto', CODE) as string;
  const [sentence, link, ...rest] = msg.split('\n');
  assertEquals([sentence, rest.length], ['Take over a team in Stock Scudetto', 0]);
  assert(link.startsWith('https://'), 'a universal link, not just text');
  assertEquals(link, `${WEB_BASE}take/${CODE}`);
  assertEquals(parseTakeoverArrival(link, false), { code: CODE, origin: 'https' });
  // and the hook hands exactly that message to the share sheet
  const hook = src('lib/account/useFindNewManager.ts');
  assert(hook.includes('takeoverShareMessage(leagueName, code)') && hook.includes('Share.share({ message })'));
});

// ── Round 2 of the gate: F20 at XXXL, and the crash found at XXXL ───────────

Deno.test('takeover heading: its own ceiling (1.15x) so both names fit on one line at XXXL; nothing changes at Large', () => {
  const landing = src('components/shell/TakeoverLanding.tsx');
  assert(landing.includes('export const TAKEOVER_TITLE_MAX_SCALE = 1.15;'));
  assert(landing.includes('<ScreenTitle style={styles.title} maxFontSizeMultiplier={TAKEOVER_TITLE_MAX_SCALE}>'));
  assert(src('components/shell/ScreenTitle.tsx').includes('maxFontSizeMultiplier={maxFontSizeMultiplier}'));
  // display is 32pt: capped at 1.15 it is ~37pt, narrow enough for ~16 characters of the 'display' face on a 340pt line
  assertEquals(Math.round(32 * 1.15), 37);
});

Deno.test('SetupRows: the native event is read BEFORE the state updater (it is released by the time the updater runs)', () => {
  const rows = src('components/game/SetupRows.tsx');
  assertFalse(/setBrokeAt\(\(prev\) => [^\n]*e\.nativeEvent/.test(rows), 'no e.nativeEvent inside a setState updater');
  assert(rows.includes('const lines = e.nativeEvent.lines;') && rows.includes('const width = e.nativeEvent.layout.width;'));
});

// ── Round 3: the tap view says what it is; the check hangs on the first line ─

Deno.test('tap view: heading "Take over a team" (the share text without the league), in the arrival layout, with the two shipped buttons', () => {
  assertEquals(TAKEOVER_TAP_TITLE, 'Take over a team');
  assert(takeoverShareSentence('Stock Scudetto').startsWith(TAKEOVER_TAP_TITLE + ' in '), 'it IS the approved share text with the league cut off');
  const landing = src('components/shell/TakeoverLanding.tsx');
  const tap = landing.slice(landing.indexOf("state.kind === 'tap'"), landing.indexOf("state.kind === 'loading'"));
  assert(tap.includes('<Avatar name={label} size={DISC} tone="neutral" />'));
  assert(tap.includes('{TAKEOVER_TAP_TITLE}</ScreenTitle>'));
  assert(tap.includes('maxFontSizeMultiplier={TAKEOVER_TITLE_MAX_SCALE}'));
  assert(tap.includes('<Button label={FIND_LEAGUE} onPress={onFind} fullWidth />') && tap.includes('<Link label={NOT_NOW} onPress={onNotNow} muted />'));
  assert(tap.indexOf('<Avatar') < tap.indexOf('{TAKEOVER_TAP_TITLE}'), 'icon above the heading');
  assertFalse(/leagueName/.test(tap), 'nothing about the league before the tap');
});

Deno.test('Confirmed with Apple/Google: the check hangs on the FIRST line (flex-start + the line box offset), not the middle of a wrapped label', () => {
  const view = src('components/shell/DeleteAccountView.tsx');
  const style = view.slice(view.indexOf('  confirmed: {'));
  assert(style.slice(0, style.indexOf('},')).includes("alignItems: 'flex-start'"));
  assert(view.includes('<View style={{ marginTop: checkOffset }}>'));
  assert(view.includes("const checkOffset = Math.max(0, Math.round((type.callout.lineHeight * fontScale - iconPointSize('callout', fontScale)) / 2));"));
  // the arithmetic: at Large the line box is 18pt and the icon 16pt: 1pt; at XXXL (fontScale 3.1) the line is ~56pt, the icon capped at 25.6pt: ~15pt
  const off = (fs: number, icon: number) => Math.max(0, Math.round((18 * fs - icon) / 2));
  assertEquals(off(1, 16), 1);
  assert(off(3.1, 25.6) > 12);
});
