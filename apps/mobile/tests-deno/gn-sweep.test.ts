/**
 * gn-sweep (Design Lead triage of the old-skin inventory, 2026-10-14): one sweep before the
 * 1.3 TestFlight build ("no screen mixes skins").
 *   1. Rule lines on mounted screens → space (§9C rule 2).
 *   2. Raw Ionicons in mounted UI → sp/Icon's drawn set.
 *   3. reset-password and +not-found on Game Night.
 *   4. LeagueContext: a failed league-list read is its own state, never "No leagues yet".
 * Run: `cd apps/mobile/tests-deno && deno test --allow-read --allow-env --allow-sys --allow-run .`
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';
import { classifyLeagueRead, needsLeaguesRead } from '../lib/shell/leagueRead.ts';
import { LEAGUES_LOAD_FAILED, leagueFallback } from '../lib/game/leagueView.ts';
import { ICON_GLYPHS, iconPointSize } from '../components/sp/logic/icon.ts';

/** Source without comments, so a guard never passes on a comment that names the thing. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

// ── 4. The league-list read ──────────────────────────────────────────────────────

const M = (n: number) => Array.from({ length: n }, (_, i) => ({ league_id: `l${i}` }));
const L = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` }));

Deno.test('a SUCCESSFUL read with zero memberships is "empty" (the only road to "No leagues yet")', () => {
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: [] }, leagues: null }), { kind: 'empty' });
});

Deno.test('a failed membership read is "failed", never "empty" (the bug)', () => {
  assertEquals(classifyLeagueRead({ memberships: { error: { message: 'timeout' }, rows: null }, leagues: null }), { kind: 'failed', reason: 'memberships' });
  // An error WITH rows still failed (never trust a half answer).
  assertEquals(classifyLeagueRead({ memberships: { error: { message: 'x' }, rows: M(2) }, leagues: null }).kind, 'failed');
  // No error and no rows (supabase-js returned nothing): not proof of zero memberships.
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: null }, leagues: null }), { kind: 'failed', reason: 'memberships' });
});

Deno.test('partial: memberships in, the leagues read failed → "failed" (it left the list empty on a first load)', () => {
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: M(3) }, leagues: { error: { message: 'x' }, rows: null } }), { kind: 'failed', reason: 'leagues' });
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: M(3) }, leagues: { error: null, rows: null } }), { kind: 'failed', reason: 'leagues' });
  // Memberships but the leagues read wasn't made: failed, never empty.
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: M(1) }, leagues: null }), { kind: 'failed', reason: 'leagues' });
});

Deno.test('partial: memberships say N, the leagues read returned ZERO rows → "failed", not "empty"', () => {
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: M(2) }, leagues: { error: null, rows: [] } }), { kind: 'failed', reason: 'no_league_rows' });
});

Deno.test('partial: N memberships, M of them came back (0 < M < N) → the M real leagues, `missing` = N − M (recoverable, never a blanket refusal)', () => {
  const r = classifyLeagueRead({ memberships: { error: null, rows: M(3) }, leagues: { error: null, rows: L(2) } });
  assertEquals(r, { kind: 'ok', leagues: L(2), missing: 1 });
  assertEquals(classifyLeagueRead({ memberships: { error: null, rows: M(2) }, leagues: { error: null, rows: L(2) } }), { kind: 'ok', leagues: L(2), missing: 0 });
});

Deno.test('the leagues read is made only for a successful read with memberships', () => {
  assertEquals(needsLeaguesRead({ error: null, rows: M(1) }), true);
  assertEquals(needsLeaguesRead({ error: null, rows: [] }), false);
  assertEquals(needsLeaguesRead({ error: { message: 'x' }, rows: M(1) }), false);
  assertEquals(needsLeaguesRead({ error: null, rows: null }), false);
});

Deno.test('leagueFallback: "failed" only for a failed read with no leagues in hand; "empty" only for a clean read', () => {
  assertEquals(leagueFallback({ loading: false, leagueCount: 0, loadFailed: true }), 'failed');
  assertEquals(leagueFallback({ loading: false, leagueCount: 0, loadFailed: false }), 'empty');
  // Try again: while the re-read runs, the header and a skeleton (it shows the tap acted).
  assertEquals(leagueFallback({ loading: true, leagueCount: 0, loadFailed: true }), 'pending');
  // Leagues in hand always win.
  assertEquals(leagueFallback({ loading: false, leagueCount: 2, loadFailed: true }), 'pending');
});

Deno.test('LeagueContext: classifies the reads, empties the lists on ANY non-ok read, flags the failure, clears it per read', () => {
  const ctx = code(SOURCES['lib/LeagueContext.tsx']);
  assert(ctx.includes('const read = classifyLeagueRead<League>({ memberships: membershipRead, leagues: leagueRead });'));
  const bail = ctx.slice(ctx.indexOf("if (read.kind !== 'ok') {"), ctx.indexOf('const list = read.leagues;'));
  for (const s of ['setLeagues([]);', 'setSheetLeagues([]);', 'setHomeSummaryByLeague(new Map());', 'setMarket(null);', 'setMarketCalendar([]);', "setLoadFailed(read.kind === 'failed');", 'setLoading(false);', 'return;']) {
    assert(bail.includes(s), s);
  }
  // Cleared when a read starts (so Try again shows the skeleton, then the answer).
  const fetch = ctx.slice(ctx.indexOf('const fetchLeagues = useCallback'), ctx.indexOf('if (LEAGUE_FIXTURE) {'));
  assert(fetch.indexOf('setLoading(true);') < fetch.indexOf('setLoadFailed(false);'));
  // The old all-or-nothing guard is gone.
  assert(!ctx.includes('if (memberError || !memberships || memberships.length === 0) {'));
  assert(ctx.includes('loadFailed,\n        activeLeagueId,'));
});

for (const [file, title] of [['app/(tabs)/index.tsx', 'Home'], ['app/(tabs)/league.tsx', 'League']] as const) {
  Deno.test(`${title}: the failed read shows the load-failed state with Try again (it re-reads), BEFORE "No leagues yet"`, () => {
    const src = code(SOURCES[file]);
    const failed = src.indexOf("if (fallback === 'failed') {");
    const empty = src.indexOf('heading="No leagues yet"');
    assert(failed > 0 && empty > failed, 'failed is decided before the empty state');
    const block = src.slice(failed, src.indexOf('\n    );', failed)); // the placeholder's whole JSX
    for (const s of [`title="${title}"`, 'showAvatar', 'heading={LEAGUES_LOAD_FAILED}', 'message={MONEY_COPY.loadRetryMessage}', 'actionLabel={MONEY_COPY.tryAgain}', 'onAction={refresh}', 'onRefresh={refresh}']) {
      assert(block.includes(s), `${title}: ${s}`);
    }
    assert(src.includes('leagueFallback({ loading, leagueCount:'));
    assert(src.includes('loadFailed'));
  });
}

Deno.test('Home: "No leagues yet" only on the empty fallback (not on !loading && 0, the old rule)', () => {
  const home = code(SOURCES['app/(tabs)/index.tsx']);
  assert(!home.includes('if (!loading && leagues.length === 0) {'));
  assert(home.includes("if (fallback === 'empty') {"));
  assert(home.indexOf("if (fallback === 'empty') {") < home.indexOf('heading="No leagues yet"'));
});

Deno.test('the load-failed copy: Giorgio\'s approved title (2026-10-14), the existing retry line and Try again', async () => {
  assertEquals(LEAGUES_LOAD_FAILED, "Your leagues didn't load.");
  // One constant, shared by Home and League (never a second copy of the string).
  for (const p of ['app/(tabs)/index.tsx', 'app/(tabs)/league.tsx']) assert(!SOURCES[p].includes("leagues didn't load"), p);
  const { COPY } = await import('../lib/money/moneyCopy.ts');
  assertEquals(COPY.tryAgain, 'Try again');
  assertEquals(COPY.loadRetryMessage, 'Check your connection, then try again.');
});

Deno.test('the DEV fixture leagues-failed-once fails the first read only (captures; never in a release bundle)', () => {
  // Source guard: devFixture reaches React Native through its imports, so Deno can't load it.
  const src = SOURCES['lib/shell/devFixture.ts'];
  assert(src.includes("return f === 'leagues-failed-once' && attempt === 0;"));
  assert(src.includes("if (fixture === 'leagues-failed-once') fixture = 'leagues';"));
  assert(src.includes('export const SHELL_FIXTURE: ShellFixture | null = __DEV__ ?'));
  assert(code(SOURCES['lib/LeagueContext.tsx']).includes('if (fixtureReadFails(LEAGUE_FIXTURE, fixtureAttempt.current++)) {'));
});

// ── 1. Rule lines → space ────────────────────────────────────────────────────────

const RULE = /hairlineWidth|borderBottomWidth|borderBottomColor|RowDivider|colors\.line\b/;

for (const p of ['components/SymbolSearchField.tsx', 'components/game/QueueEditor.tsx', 'components/sp/ListRow.tsx', 'components/home/SeasonCompleteCard.tsx', 'components/money/SalePicker.tsx', 'components/money/PlayerPortfolioScreen.tsx']) {
  Deno.test(`no rule line in ${p} (§9C rule 2: separation is space or a surface step)`, () => {
    const m = code(SOURCES[p]).match(RULE);
    assertEquals(m, null, `${p}: ${m?.[0]}`);
  });
}

Deno.test('ListRow has no divider prop left to turn a line back on', () => {
  const row = code(SOURCES['components/sp/ListRow.tsx']);
  assert(!row.includes('divider'));
  assert(!code(SOURCES['components/home/SeasonCompleteCard.tsx']).includes('divider='));
});

Deno.test('SalePicker: the rows sit on an inset panel (a surface step on the sheet), the idle radio a ≥3:1 control ring', () => {
  const sp = code(SOURCES['components/money/SalePicker.tsx']);
  assert(sp.includes('<View style={[styles.card, { backgroundColor: colors.inset }]}>'));
  assert(sp.includes('borderColor: selected ? colors.accent : colors.borderStrong'));
});

Deno.test('PlayerPortfolioScreen: a money page (moneyBg), rows at the 56pt rhythm', () => {
  const pp = code(SOURCES['components/money/PlayerPortfolioScreen.tsx']);
  assert(pp.includes('backgroundColor: colors.moneyBg'));
  assert(!pp.includes('colors.bg'));
  assert(pp.includes("row: { minHeight: 56, paddingVertical: space[3],"));
});

Deno.test('SymbolSearchField: the result badge holds the 11pt floor (§9B)', () => {
  const f = code(SOURCES['components/SymbolSearchField.tsx']);
  const badge = f.slice(f.indexOf('badge: {'), f.indexOf('},', f.indexOf('badge: {')));
  assert(badge.includes('fontSize: 11,'));
});

// ── 2. Raw Ionicons → sp/Icon ────────────────────────────────────────────────────

for (const p of [
  'components/shell/TabIcon.tsx', 'components/shell/LeaguePill.tsx', 'components/home/ThisWeekCard.tsx', 'components/home/StandingsCard.tsx',
  'app/(tabs)/index.tsx', 'components/sp/ListRow.tsx', 'components/sp/Button.tsx', 'app/reset-password.tsx',
]) {
  Deno.test(`no raw Ionicons in ${p}: sp/Icon's drawn set only`, () => {
    const src = code(SOURCES[p]);
    assert(!src.includes('@expo/vector-icons'), p);
    assert(!src.includes('<Ionicons'), p);
    assert(src.includes("from '@/components/sp/Icon'"), p);
  });
}

Deno.test('the drawn set carries the tab glyphs (outline idle, filled selected) and the two new semantic names', () => {
  assertEquals([ICON_GLYPHS.tabHome, ICON_GLYPHS.tabHomeSelected], ['home-outline', 'home']);
  assertEquals([ICON_GLYPHS.tabMatchup, ICON_GLYPHS.tabMatchupSelected], ['trending-up-outline', 'trending-up']);
  assertEquals([ICON_GLYPHS.tabLeague, ICON_GLYPHS.tabLeagueSelected], ['trophy-outline', 'trophy']);
  assertEquals([ICON_GLYPHS.tabPortfolio, ICON_GLYPHS.tabPortfolioSelected], ['bar-chart-outline', 'bar-chart']);
  assertEquals(ICON_GLYPHS.checkCircle, 'checkmark-circle-outline');
  assertEquals(ICON_GLYPHS.pending, 'hourglass-outline');
});

Deno.test('the tab role is 24pt at every text size (the tab bar keeps its height); the others still scale', () => {
  for (const s of [0.8, 1, 1.35, 2, 3.1]) assertEquals(iconPointSize('tab', s), 24, String(s));
  assertEquals(iconPointSize('callout', 1.3), 20.8);
});

Deno.test('TabIcon crossfades two sp Icons at the tab role, in the token the label reads', () => {
  const tab = code(SOURCES['components/shell/TabIcon.tsx']);
  assert(tab.includes('<Icon name={glyph.outline} size="tab" tone={tone} />'));
  assert(tab.includes('<Icon name={glyph.filled} size="tab" tone={tone} />'));
  assert(code(SOURCES['components/shell/ShellTabBar.tsx']).includes('<TabIcon name={icon} tone={tone} focused={focused} />'));
});

Deno.test('Button: its checks read the label\'s own token (every fill has its own ink, §9C rule 4)', () => {
  const b = code(SOURCES['components/sp/Button.tsx']);
  assert(b.includes('const textColor = colors[textTone];'));
  assert(b.includes('<Icon name="check" size="callout" tone={textTone} />'));
  assert(b.includes('<Icon name="check" size="headline" tone={textTone} />'));
  for (const [v, t] of [['primaryBg', 'primaryFg'], ['lossFill', 'onYou']]) {
    const at = b.indexOf(`backgroundColor = colors.${v};`);
    assert(at > 0 && b.slice(at, at + 80).includes(`textTone = '${t}';`), v);
  }
});

// ── 3. reset-password and +not-found ─────────────────────────────────────────────

Deno.test('reset-password: the success and invalid states draw sp Icons in the EmptyState disc (text2, the house load pattern)', () => {
  const rp = code(SOURCES['app/reset-password.tsx']);
  assert(rp.includes('icon={() => <Icon name="checkCircle" size="title" tone="text2" />}'));
  assert(rp.includes('icon={() => <Icon name="alert" size="title" tone="text2" />}'));
  // Every tappable acts: Continue → Home; Request a new link → forgot-password; Back to sign in → Cancel.
  assert(rp.includes("onAction={() => router.replace('/')}"));
  assert(rp.includes("onAction={() => router.replace('/forgot-password')}"));
  assert(rp.includes('onSecondaryAction={handleCancel}'));
  assert(rp.includes('<Pressable onPress={handleCancel} accessibilityRole="button"'));
});

Deno.test('+not-found: one way out (Go to Home), the sp medallion, no raw glyphs', () => {
  const nf = code(SOURCES['app/+not-found.tsx']);
  assert(nf.includes('<Icon name="search" size="medallion" tone="text2" discTone="sunken" />'));
  assert(nf.includes('<Button label="Go to Home" onPress={goHome} />'));
  assert(!nf.includes('Ionicons'));
});

Deno.test('reset-password capture override: DEV only, form|success only, view only (never the recovery flag)', async () => {
  const { parseResetCaptureView } = await import('../lib/shell/resetCaptureView.ts');
  assertEquals(parseResetCaptureView('form', true), 'form');
  assertEquals(parseResetCaptureView('success', true), 'success');
  assertEquals(parseResetCaptureView('form', false), null); // a release bundle
  assertEquals(parseResetCaptureView('invalid', true), null);
  assertEquals(parseResetCaptureView(undefined, true), null);
  const rp = code(SOURCES['app/reset-password.tsx']);
  assert(rp.includes('const CAPTURE_VIEW = parseResetCaptureView(process.env.EXPO_PUBLIC_RESET_CAPTURE, __DEV__);'));
  // It never sets the recovery session: the only setRecoverySession(true) stays in _layout's verified path.
  assert(!rp.includes('setRecoverySession(true)'));
  assert(!code(SOURCES['lib/shell/resetCaptureView.ts']).includes('Recovery'));
});

Deno.test('EmptyState: the message never outgrows its title at any text size (reset-password XXXL capture)', async () => {
  const { messageMaxScale } = await import('../components/sp/logic/emptyState.ts');
  const { type } = await import('../constants/tokens/type.ts');
  const cap = messageMaxScale(type.title.fontSize, type.title.maxScale ?? 1, type.body.fontSize);
  assertEquals(cap, 2.34);
  for (const s of [1, 1.35, 2.35, 3.12]) {
    const title = type.title.fontSize * Math.min(s, type.title.maxScale ?? 1);
    const message = type.body.fontSize * Math.min(s, cap);
    assert(message <= title, `at ${s}×: message ${message} > title ${title}`);
  }
  assert(code(SOURCES['components/sp/EmptyState.tsx']).includes('maxFontSizeMultiplier={MESSAGE_MAX_SCALE}'));
});

Deno.test('capture-script actions (DEV, headless captures): each calls the handler a finger would, and is inert without the seam', () => {
  // The script only runs under SEAM_ON (a dev build AND the seam flag) with a script set.
  assert(code(SOURCES['lib/money/captureScript.ts']).includes('const STEPS = SEAM_ON ? parseCaptureScript(process.env.EXPO_PUBLIC_CAPTURE_SCRIPT) : [];'));
  const field = code(SOURCES['components/SymbolSearchField.tsx']);
  assert(field.includes("captureAction = '',")); // unset: no action registered (useCaptureAction skips '')
  assert(field.includes("useCaptureAction(captureAction, (q) => handleChangeText(q ?? ''));"));
  assert(code(SOURCES['components/game/DraftRoom.tsx']).includes('captureAction="type"'));
  assert(code(SOURCES['components/game/QueueEditor.tsx']).includes('captureAction="typeq"'));
  // Try again's own handler: the re-read.
  assert(code(SOURCES['lib/LeagueContext.tsx']).includes("useCaptureAction('retry', () => { void fetchLeagues(); });"));
  assert(code(SOURCES['components/shell/BarsRefresh.tsx']).includes("useCaptureAction('scrollto', (y) => scrollRef.current?.scrollTo({ y: Number(y) || 0, animated: false }));"));
});

// ── Security review LOWs (2026-10-14): stale reads, error logging ────────────────

Deno.test('readSequence: a read for user A that resolves after the switch to B is stale; B\'s is current', async () => {
  const { createReadSequence } = await import('../lib/shell/readSequence.ts');
  const reads = createReadSequence();
  const writes: string[] = [];
  // Two reads in flight; A's answers LAST (the race the guard exists for).
  const readFor = (user: string, ms: number) => {
    const token = reads.begin();
    return new Promise<void>((done) => setTimeout(() => { if (reads.isCurrent(token)) writes.push(user); done(); }, ms));
  };
  await Promise.all([readFor('A', 20), readFor('B', 5)]);
  assertEquals(writes, ['B']);
  // A refresh supersedes an older refresh the same way.
  const t1 = reads.begin(); const t2 = reads.begin();
  assertEquals([reads.isCurrent(t1), reads.isCurrent(t2)], [false, true]);
  // Sign-out invalidates whatever is in flight.
  const t3 = reads.begin(); reads.invalidate();
  assertEquals(reads.isCurrent(t3), false);
});

Deno.test('errorSummary: a log line carries only message and code, never the rest of the error', async () => {
  const { errorSummary } = await import('../lib/shell/readSequence.ts');
  const err = { message: 'permission denied for table leagues', code: '42501', details: 'row data', hint: 'secret hint' };
  assertEquals(errorSummary(err), { message: 'permission denied for table leagues', code: '42501' });
  assertEquals(errorSummary(null), null);
  assertEquals(errorSummary(undefined), null);
  assertEquals(errorSummary({ details: 'x' }), { message: null, code: null });
});

Deno.test('fetchLeagues: every await is followed by the stale check, before any setter; sign-out invalidates; logs use errorSummary', () => {
  const ctx = code(SOURCES['lib/LeagueContext.tsx']);
  const body = ctx.slice(ctx.indexOf('const fetchLeagues = useCallback'), ctx.indexOf('}, [userId, setActiveLeagueId]);'));
  assert(body.includes('const token = reads.current.begin();'));
  assert(body.includes('const stale = () => !reads.current.isCurrent(token);'));
  // Each await's statement ends with ';' — the next statement must be the guard.
  let from = 0; let awaits = 0;
  for (;;) {
    const at = body.indexOf('await ', from);
    if (at < 0) break;
    awaits += 1;
    const end = body.indexOf(';', at);
    const next = body.slice(end + 1).trimStart();
    assert(next.startsWith('if (stale()) return;'), `no stale check after: ${body.slice(at, end + 1).slice(0, 80)}`);
    from = end + 1;
  }
  assertEquals(awaits, 5); // fixture: delay, stored id; real: memberships, leagues, facts + stored id
  const signOut = ctx.slice(ctx.indexOf('if (!userId) {', ctx.indexOf('useCaptureAction(\'retry\'')));
  const inv = signOut.indexOf('reads.current.invalidate();');
  assert(inv >= 0 && inv < signOut.indexOf('setLeagues([]);'), 'sign-out invalidates in-flight reads, before clearing');
  assert(body.includes('errorSummary(memberError ?? leagueRead?.error)'));
  assert(!/console\.(error|warn)\([^)]*\b(memberError|leagueError|leagueRead\?\.error)\s*[,)]/.test(body.replace('errorSummary(memberError ?? leagueRead?.error)', '')));
});

Deno.test('NewPasswordForm (reset + change password): no autoFocus at large text, so the title is read first (DL P3)', async () => {
  const { isLargeText } = await import('../components/sp/logic/largeText.ts');
  // Large (1.0) and the standard sizes below 1.3 still open the keyboard; XL / XXXL don't.
  for (const [scale, focus] of [[1, true], [1.235, true], [1.3, false], [2.35, false], [3.12, false]] as const) {
    assertEquals(!isLargeText(scale), focus, String(scale));
  }
  const form = code(SOURCES['components/shell/NewPasswordForm.tsx']);
  assert(form.includes('const largeText = useLargeText();'));
  assert(form.includes('autoFocus={!largeText}'));
  assert(!/autoFocus\s*\n/.test(form) && !/autoFocus\s*\/?>/.test(form), 'no bare autoFocus left');
  assert(code(SOURCES['components/sp/useLargeText.ts']).includes('isLargeText('));
});
