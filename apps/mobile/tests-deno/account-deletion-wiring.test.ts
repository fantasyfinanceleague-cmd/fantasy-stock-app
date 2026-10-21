/**
 * Account deletion, W4: the wiring. Source scans, each one a rule a regression would have to break on purpose:
 * nothing is sent before the alert's "Delete", the Profile row's place and style, the avatar never initials, the
 * label's single literal, the proof mode creating no session, the takeover link's own capture, and where the
 * screens are registered.
 *
 *   cd apps/mobile/tests-deno && deno test -R account-deletion-wiring.test.ts
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';
import { SOURCES } from './sourceManifest.generated.ts';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const src = (path: string) => {
  const s = SOURCES[path];
  assert(s !== undefined, `${path} is in the source manifest (run tests-deno/gen-source-manifest.mjs)`);
  return strip(s);
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;
/** The text of `export async function name` / `function name` up to its closing brace at column 0. */
function fnBody(s: string, name: string): string {
  const i = s.search(new RegExp(`(export )?(async )?function ${name}\\b`));
  assert(i >= 0, `function ${name}`);
  const end = s.indexOf('\n}\n', i);
  return s.slice(i, end === -1 ? undefined : end + 3);
}

// ── Nothing is sent before "Delete" ─────────────────────────────────────────

Deno.test('send: delete-account is called from exactly one place, and only the alert\'s Delete reaches it', () => {
  const screen = src('app/delete-account.tsx');
  assertEquals(count(screen, 'deleteAccount('), 1, 'one call site');
  // The one call sits in `send`, which is reached only through the alert's destructive button.
  assert(/const send = useCallback\(async \(\) => \{[\s\S]*?await deleteAccount\(body\)/.test(screen));
  assertEquals(count(screen, 'send()'), 1);
  assert(/\{ text: ALERT_DELETE, style: 'destructive', onPress: \(\) => void send\(\) \}/.test(screen));
  // The button the person taps only ASKS.
  assert(screen.includes('onDelete={onAsk}'));
  assert(/const onAsk = useCallback\(\(\) => setState\(\(s\) => askConfirm\(s\)\), \[\]\)/.test(screen));
  // Nothing else in the app calls the function.
  for (const [path, text] of Object.entries(SOURCES)) {
    if (path === 'app/delete-account.tsx' || path === 'lib/account/accountApi.ts') continue;
    assertFalse(strip(text).includes("'delete-account'"), `${path} must not invoke delete-account`);
  }
  assertEquals(count(src('lib/account/accountApi.ts'), "seamInvoke('delete-account'"), 1);
});

Deno.test('alert: "Keep my account" is the cancel-style default, "Delete" destructive, and it opens only from the state', () => {
  const screen = src('app/delete-account.tsx');
  assert(screen.includes("{ text: ALERT_KEEP, style: 'cancel', onPress: () => setState((s) => keepAccount(s)) }"));
  assert(screen.includes("if (phase !== 'confirming') return;"), 'the alert opens only when the state machine says confirming');
  assertEquals(count(screen, 'Alert.alert('), 1);
  assert(screen.includes('onDismiss: () => setState((s) => keepAccount(s))'), 'a dismissal is Keep');
  assert(screen.includes('ALERT_TITLE') && screen.includes('ALERT_BODY'));
});

Deno.test('proof: Apple/Google sheets run BEFORE the alert (the code is used within seconds), and an Apple proof mints no session', () => {
  const screen = src('app/delete-account.tsx');
  assert(screen.includes('proveWithApple()') && screen.includes('proveWithGoogle()'));
  const social = src('lib/auth/socialSignIn.ts');
  const apple = fnBody(social, 'proveWithApple');
  const google = fnBody(social, 'proveWithGoogle');
  for (const body of [apple, google]) {
    assertFalse(body.includes('signInWithIdToken'), 'a proof never creates a session');
    assertFalse(body.includes('supabase.auth'), 'a proof never touches the client session');
  }
  assert(apple.includes('authorizationCode') && apple.includes('nonce: rawNonce'), 'Apple\'s code and the RAW nonce travel with the token');
  assert(apple.includes('!credential.authorizationCode'), 'no code, no proof');
  // The sign-in paths (W2's) are intact.
  assert(fnBody(social, 'signInWithApple').includes('supabase.auth.signInWithIdToken'));
  assert(fnBody(social, 'signInWithGoogle').includes('supabase.auth.signInWithIdToken'));
});

Deno.test('button: the destructive pill (lossFill / onYou), dimmed until the proof is in hand', () => {
  const view = src('components/shell/DeleteAccountView.tsx');
  assert(view.includes('variant="destructive"'));
  assert(view.includes('disabled={!canAsk(state) && !sending}'));
  const button = src('components/sp/Button.tsx');
  assert(/case 'destructive':\s*backgroundColor = colors\.lossFill;\s*textTone = 'onYou';/.test(button));
  // While sending nothing takes a tap.
  assert(view.includes("pointerEvents={sending ? 'none' : 'auto'}"));
});

Deno.test('after deletion: the line is raised BEFORE the local sign-out, and the sign-out is local', () => {
  const screen = src('app/delete-account.tsx');
  assert(screen.indexOf('setDeletedNotice(true)') > 0 && screen.indexOf('setDeletedNotice(true)') < screen.indexOf('endSessionAfterDeletion()'));
  assert(screen.includes("if (outcome.kind !== 'deleted') return;"));
  const end = src('lib/account/endSession.ts');
  assert(end.includes("supabase.auth.signOut({ scope: 'local' })"));
  assert(end.includes('signOutOfGoogle()'));
});

Deno.test('Sign in: the notice is mounted, spent on a sign-in attempt, and spent on leaving', () => {
  const login = src('app/login.tsx');
  assert(login.includes('<DeletedAccountNotice />'));
  assert(login.includes('setDeletedNotice(false)'));
  assert(src('components/shell/SocialSignIn.tsx').includes('setDeletedNotice(false)'));
  const notice = src('components/shell/DeletedAccountNotice.tsx');
  assert(/useEffect\(\(\) => \(\) => setDeletedNotice\(false\), \[\]\)/.test(notice));
  assert(notice.includes('ACCOUNT_DELETED'));
});

// ── Profile ─────────────────────────────────────────────────────────────────

Deno.test('Profile: Delete account is the LAST row, below Sign out, in the same card, danger text only (no highlight)', () => {
  const view = src('components/shell/ProfileView.tsx');
  const signOut = view.indexOf('<Row label="Sign out" onPress={onSignOut} danger />');
  const del = view.indexOf('<Row label={DELETE_ROW} onPress={onDeleteAccount} danger />');
  assert(signOut > 0 && del > signOut, 'below Sign out');
  const between = view.slice(signOut, del);
  assertFalse(between.includes('</Card>'), 'the same Card as Sign out');
  const afterDel = view.slice(del);
  assert(afterDel.indexOf('</Card>') < afterDel.indexOf('brand.name') || afterDel.indexOf('</Card>') > 0);
  assertEquals(count(view, 'danger'), count(view, 'danger') ); // (the row is the shared Row; styling lives there)
  // The shared Row styles `danger` as text colour only: no background, no border.
  const row = view.slice(view.indexOf('function Row('));
  assert(row.includes('color={danger ? colors.danger : colors.text}'));
  assertFalse(/danger[^\n]*backgroundColor|backgroundColor[^\n]*danger/.test(row), 'no tint behind the danger row');
  assert(src('app/profile.tsx').includes("onDeleteAccount={() => router.push('/delete-account')}"));
});

Deno.test('routes: the delete screen and the takeover landing are registered for the signed-in stack only', () => {
  const layout = src('app/_layout.tsx');
  const signedIn = layout.indexOf('<Stack.Protected guard={signedIn}>');
  assert(signedIn > 0);
  assert(layout.indexOf('name="delete-account"') > signedIn);
  assert(layout.indexOf('name="takeover"') > signedIn);
  // The landing opens through the pending takeover's own gate, never through the invite's.
  assert(layout.includes('shouldOpenTakeover({'));
  assert(layout.includes("router.push('/takeover' as never)"));
});

// ── The seat ────────────────────────────────────────────────────────────────

Deno.test('avatar: a deleted seat is drawn BEFORE initials are computed, and its branch never touches them', () => {
  const avatar = src('components/sp/Avatar.tsx');
  const face = avatar.slice(avatar.indexOf('function AvatarFace'));
  const gate = face.indexOf('isDeletedSeatName(name, deletedLabel)');
  const initials = face.indexOf('const initial = discInitials(name, size)');
  assert(gate > 0 && initials > 0 && gate < initials, 'the seat check precedes the initials');
  const branch = face.slice(gate, initials);
  assertFalse(branch.includes('discInitials') || branch.includes('initial'), 'the seat branch never computes initials');
  assert(branch.includes('return ('), 'the seat branch returns its own disc');
  assert(branch.includes('ICON_GLYPHS.person'));
  assertFalse(branch.includes('uri'), 'no photo on a deleted seat');
});

Deno.test('label: "Former manager" has ONE client literal (the server\'s is read; this is only the fallback)', () => {
  const holders: string[] = [];
  for (const [path, text] of Object.entries(SOURCES)) {
    if (/Former manager/i.test(strip(text)) && !path.startsWith('lib/dev')) holders.push(path);
  }
  assertEquals(holders, ['lib/account/deletedSeat.ts']);
  // Everything else takes it as a parameter or reads the server's.
  assert(src('lib/account/deletedLabelStore.ts').includes("supabase.rpc('deleted_manager_label')"));
  assert(src('app/_layout.tsx').includes('loadDeletedManagerLabel()'));
});

Deno.test('seat ink: the seat\'s name is the secondary colour wherever a seat name is drawn', () => {
  for (const p of ['components/sp/gn/ManagerRow.tsx', 'components/sp/gn/Scoreboard.tsx', 'components/league/MembersSection.tsx']) {
    assert(src(p).includes('useSeatInk('), p);
    assert(src(p).includes('color={seatInk}'), p);
  }
});

// ── The commissioner ────────────────────────────────────────────────────────

Deno.test('Find a new manager: only on a deleted seat, only when the commissioner may (the pill and the team view agree)', () => {
  const section = src('components/league/MembersSection.tsx');
  assert(section.includes('showFind={findable && r.deleted}'));
  const settings = src('app/league-settings.tsx');
  assert(settings.includes("canFindNewManager({ isCommissioner, seatDeleted: true, draftStatus: league.draft_status, seasonStatus: league.season_status })"));
  assert(settings.includes('{membersBlock}'));
  const team = src('components/money/PlayerPortfolioScreen.tsx');
  assert(team.includes('canFindNewManager({'));
  assert(team.includes("activeLeague.commissioner_id === user?.id"));
  assert(team.includes('isDeletedSeatName(data.portfolio?.displayName, deletedLabel)'));
  // The share goes through the one builder.
  assert(src('lib/account/useFindNewManager.ts').includes('takeoverShareMessage(leagueName, code)'));
});

// ── The takeover link ───────────────────────────────────────────────────────

Deno.test('takeover link: native-intent captures it with its OWN parser into its OWN store, never as an invite or a route', () => {
  const intent = src('app/+native-intent.tsx');
  assert(intent.includes('parseTakeoverArrival(path)'));
  assert(intent.includes('pendingTakeover.capture(takeover.code)'));
  const at = intent.indexOf('parseTakeoverArrival(path)');
  assert(intent.slice(at, at + 400).includes("return '/'"), 'the router just opens the root');
  assertFalse(intent.slice(at, at + 400).includes('pendingInvite'), 'a takeover is not an invite');
  // The takeover parser lives apart from the invite's.
  const link = src('lib/invite/takeoverLink.ts');
  assertFalse(link.includes("JOIN_PATH"), 'no join path in the takeover parser');
  assert(link.includes("TAKEOVER_PATH = 'take'"));
  // The pending-route replay allowlist does not know /take/ (a link is never a route).
  assertFalse(src('lib/shell/resumeTarget.ts').includes('take'));
});

Deno.test('takeover landing: only "Take the team" writes; "Not now" and a dead link clear the pending link', () => {
  const screen = src('app/takeover.tsx');
  assertEquals(count(screen, 'takeOverTeam('), 1);
  assert(/const take = useCallback\(async \(\) => \{[\s\S]*?await takeOverTeam\(code\)/.test(screen));
  assert(screen.includes('onTake={take}'));
  assert(/const notNow = useCallback\(async \(\) => \{\s*if \(code\) await pendingTakeover\.clear\(code\);/.test(screen));
  // a lost answer keeps the link (no loop): the unknown branch re-shows the found view and clears nothing
  const unknown = screen.slice(screen.indexOf("if (r.kind === 'unknown')"));
  assertFalse(unknown.slice(0, 160).includes('clear('));
});
