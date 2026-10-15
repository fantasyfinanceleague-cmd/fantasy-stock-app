/**
 * Onboarding W3 (plan 2026-10-14): the invite link. Link parsing (good, bad, hostile), the share text, the
 * one domain value and its mirrors, the universal-link paths, the pending invite's lifecycle and every
 * partial-state case, the auto-join decisions and the whole join sequence end to end, the no-session preview
 * reader, and the wiring (source scans: each one a rule a regression would have to break on purpose).
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assert, assertEquals, assertFalse, assertNotEquals } from 'jsr:@std/assert';
import { buildInviteUrl, inviteShareMessage, normalizeInviteCode, parseInviteArrival, parseInviteLink } from '../lib/invite/inviteLink.ts';
import { AUTH_LINK_BASES, linkIsPath } from '../lib/auth/authLink.ts';
import { buildConfirmRedirect, isConfirmLink, isConfirmRoute, parseConfirmLink } from '../lib/auth/confirmLink.ts';
import { buildRecoveryRedirect, isRecoveryRoute, parseRecoveryLink } from '../lib/recoveryLink.ts';
import { APPLE_TEAM_ID, UNIVERSAL_LINK_PATHS, WEB_BASE, WEB_DOMAIN, WEB_ORIGIN } from '../lib/links/webDomain.ts';
import {
  cleanName, GENERIC_INVITE_LINE, interpretInvitePreview, inviteHeadline, type InvitePreview,
} from '../lib/invite/invitePreview.ts';
import {
  createPendingInvite, INVITE_STORAGE_KEY, INVITE_TTL_MS, inviteOwnedByOther, parsePersisted, screenPreview, type InviteStorage, type PendingInviteDeps,
} from '../lib/invite/pendingInvite.ts';
import {
  decideAfterJoin, decideAfterPreview, INVITE_JOIN_ROUTE, INVITE_TAP_ROUTE, inviteJoinRoute, inviteNeedsTap, inviteOwnerAction, inviteScreenMode, stripInviteParam, shouldAutoOpenInvite, shouldClearInviteOnAuthChange, shouldClearOnDismiss, signedInAtArrivalFrom, staleRunExit,
} from '../lib/invite/autoJoin.ts';
import { activeLeagueNow, activeLeagueOnContinue, completeInviteJoin, runInvitePreviewOnly, runInviteJoin, type InviteJoinDeps, type InviteJoinResult } from '../lib/invite/inviteJoin.ts';
import { interpretJoin, interpretPreview, JOIN_COPY, blockMessage, previewView } from '../lib/join/joinPreview.ts';
import { createPendingRoute } from '../lib/shell/pendingRoute.ts';
import { arrivalView } from '../lib/invite/arrivalView.ts';
import { INVITE_COPY } from '../lib/invite/inviteCopy.ts';
import { getLiveSession, resetLiveSession, setLiveSession } from '../lib/auth/liveSession.ts';
import { resolveResumeTarget } from '../lib/shell/resumeTarget.ts';
import { inviteShareShown } from '../lib/game/leagueSettingsEntry.ts';
import { inviteShareMessage as shareFromLeagueSettings } from '../lib/game/leagueSettingsEntry.ts';
import { inviteShareMessage as shareFromCreateDone } from '../lib/game/createLeagueDone.ts';
import { SOURCES } from './sourceManifest.generated.ts';
import APP_JSON from '../app.json' with { type: 'json' };
import WEB_ORIGIN_SRC from '../../../supabase/functions/_shared/web-origin.ts' with { type: 'text' };
import AASA_DOC from '../../../docs/security/universal-links.md' with { type: 'text' };

const CODE = 'K7Q2XRM3PA';
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── link parsing ──────────────────────────────────────────────────────────

Deno.test('parse: the accepted shapes yield the upper-cased code', () => {
  for (const url of [
    `https://fantasy-stock-app.vercel.app/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app/join/${CODE}/`,
    `https://fantasy-stock-app.vercel.app/join/${CODE.toLowerCase()}`,
    `https://fantasy-stock-app.vercel.app/join/${CODE}?utm_source=sms&code=EVILEVILEV`, // the query is ignored, never a source
    `https://fantasy-stock-app.vercel.app/join/${CODE}#frag`,
    `HTTPS://FANTASY-STOCK-APP.VERCEL.APP/join/${CODE}`, // a host is case-insensitive
    `  https://fantasy-stock-app.vercel.app/join/${CODE}  `,
    `fantasystockapp://join/${CODE}`,
    `fantasystockapp:///join/${CODE}`,
    `FantasyStockApp://join/${CODE}`,
    `fantasystockapp://join/${CODE}?x=1`,
  ]) assertEquals(parseInviteLink(url, false), CODE, url);
});

Deno.test('parse: legacy 6-character codes and the code-shape bounds', () => {
  assertEquals(parseInviteLink('fantasystockapp://join/A1B2C3', false), 'A1B2C3');
  assertEquals(parseInviteLink('fantasystockapp://join/ABCD', false), 'ABCD');
  assertEquals(parseInviteLink('fantasystockapp://join/ABC', false), null);
  assertEquals(parseInviteLink(`fantasystockapp://join/${'A'.repeat(12)}`, false), 'A'.repeat(12));
  assertEquals(parseInviteLink(`fantasystockapp://join/${'A'.repeat(13)}`, false), null);
});

Deno.test('parse: look-alike hosts, other schemes and other paths never yield a code', () => {
  for (const url of [
    `https://fantasy-stock-app.vercel.app.evil.com/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app@evil.com/join/${CODE}`,
    `https://evil.com/fantasy-stock-app.vercel.app/join/${CODE}`,
    `https://evil.fantasy-stock-app.vercel.app/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app:8443/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app\\@evil.com/join/${CODE}`,
    `http://fantasy-stock-app.vercel.app/join/${CODE}`, // not https
    `ftp://fantasy-stock-app.vercel.app/join/${CODE}`,
    `javascript:alert(1)//fantasystockapp://join/${CODE}`,
    `data:text/html,fantasystockapp://join/${CODE}`,
    `fantasystockapp.evil://join/${CODE}`,
    `otherscheme://join/${CODE}`,
    `https://fantasy-stock-app.vercel.app/joinX/${CODE}`,
    `https://fantasy-stock-app.vercel.app/xjoin/${CODE}`,
    `https://fantasy-stock-app.vercel.app/join`,
    `https://fantasy-stock-app.vercel.app/join/`,
    `https://fantasy-stock-app.vercel.app/join?code=${CODE}`, // a code in the QUERY is never read
    `fantasystockapp://join?code=${CODE}`,
    `fantasystockapp://join#${CODE}`,
    `https://fantasy-stock-app.vercel.app/#/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app/auth/join/${CODE}`,
    `https://fantasy-stock-app.vercel.app/join/${CODE}/extra`,
    `https://fantasy-stock-app.vercel.app/join/x/${CODE}`,
    `https://fantasy-stock-app.vercel.app/auth/confirm?code=${CODE}`,
  ]) assertEquals(parseInviteLink(url, false), null, url);
});

Deno.test('parse: hostile codes are refused, not repaired', () => {
  for (const code of [
    '', 'ABC', 'A'.repeat(13), 'AB-CDEF', 'AB_CDEF', 'AB.CDEF', 'AB CDEF', 'AB%20CDEF', '%41%42%43%44', 'AB%2FCD', 'AB%00CD',
    // (the next five fold onto ASCII when upper-cased)
    'ÅBCDEF', 'ＡＢＣＤＥＦ', 'ııııı', 'ßßßß', 'ſſſſſ', 'ǆǆǆǆ', 'İİİİİ', 'AB​CDEF', 'AB\nCDEF', 'AB\tCDEF', 'AB\\CDEF', "AB'CDEF", 'AB"CDEF', 'AB<CDEF>', '..%2F..%2Fx',
    '../x', '..', '.', '{{code}}', '${CODE}', 'AB;CDEF', 'AB&CDEF', 'AB=CDEF', 'AB+CDEF', 'AB:CDEF',
  ]) {
    assertEquals(parseInviteLink(`https://fantasy-stock-app.vercel.app/join/${code}`, false), null, `https ${JSON.stringify(code)}`);
    assertEquals(parseInviteLink(`fantasystockapp://join/${code}`, false), null, `scheme ${JSON.stringify(code)}`);
  }
  for (const bad of [null, undefined, '', '   ', 42 as unknown as string, {} as unknown as string]) assertEquals(parseInviteLink(bad, false), null);
  assertEquals(parseInviteLink(`https://fantasy-stock-app.vercel.app/join/${'A'.repeat(100_000)}`, false), null);
});

Deno.test('parse: the origin is folded ASCII-only: a Kelvin sign is not a "k"', () => {
  assertEquals(parseInviteLink(`https://fantasy-stoc\u212A-app.vercel.app/join/${CODE}`, false), null);
  assertEquals(parseInviteLink(`fantasystoc\u212Aapp://join/${CODE}`, false), null);
  assertEquals(parseInviteLink(`https://fantasy-stock-app.vercel.app\u212A/join/${CODE}`, false), null);
  assertEquals(parseInviteLink(`https://fantasy-stock-app.vercel.app/join/${CODE}`, false), CODE); // the real one still works
});

Deno.test('parse: the dev-only shapes (Expo Go, bare path) work only in a development build', () => {
  assertEquals(parseInviteLink(`exp://192.168.1.4:8081/--/join/${CODE}`, true), CODE);
  assertEquals(parseInviteLink(`/join/${CODE}`, true), CODE);
  assertEquals(parseInviteLink(`exp://192.168.1.4:8081/--/join/${CODE}`, false), null);
  assertEquals(parseInviteLink(`/join/${CODE}`, false), null);
});

Deno.test('normalizeInviteCode: the one shape rule', () => {
  assertEquals(normalizeInviteCode(' k7q2xrm3pa '), CODE);
  for (const bad of ['', 'abc', 'a'.repeat(13), 'ab cd', 'ab-cd', null, undefined, 7, {}, [CODE], 'ııııı', 'ßßßß', 'ſſſſſ', 'ab\u0131cd']) assertEquals(normalizeInviteCode(bad), null, String(bad));
});

// ── the share text ────────────────────────────────────────────────────────

Deno.test('share: Giorgio\'s sentence verbatim, then the link on its own line; one function for every Share', () => {
  const msg = inviteShareMessage(CODE);
  assertEquals(msg, `Join my league with code ${CODE}\nhttps://fantasy-stock-app.vercel.app/join/${CODE}`);
  assertEquals(msg.split('\n')[0], `Join my league with code ${CODE}`); // the approved sentence, untouched
  assertEquals(parseInviteLink(msg.split('\n')[1], false), CODE); // the link we send is the link we read
  assertEquals(buildInviteUrl(CODE), `${WEB_ORIGIN}/join/${CODE}`);
  assertEquals(shareFromLeagueSettings(CODE), msg);
  assertEquals(shareFromCreateDone(CODE), msg);
  // a code that cannot be a link falls back to the sentence alone, never a broken URL
  assertEquals(inviteShareMessage('A'), 'Join my league with code A');
  assertEquals(inviteShareMessage('AB CD'), 'Join my league with code AB CD');
  assertEquals(buildInviteUrl('x/y'), null);
});

Deno.test('share: still hidden while locked and after the season (inviteShareShown is untouched)', () => {
  assertEquals(inviteShareShown('before_draft'), true);
  for (const w of ['locked', 'after_season', 'in_season'] as const) assertEquals(inviteShareShown(w as never), false, w);
  const src = SOURCES['lib/game/leagueSettingsEntry.ts'];
  assert(src.includes("return window === 'before_draft';"));
  // exactly one definition of the message in the app; the two historical modules re-export it
  const defs = Object.entries(SOURCES).filter(([, s]) => /function inviteShareMessage\(/.test(s)).map(([f]) => f);
  assertEquals(defs, ['lib/invite/inviteLink.ts']);
});

// ── the one domain value and its mirrors ─────────────────────────────────

Deno.test('domain: one value; app.json, the edge functions and the confirm redirect all follow it', () => {
  assertEquals(WEB_ORIGIN, `https://${WEB_DOMAIN}`);
  assertEquals(WEB_BASE, `${WEB_ORIGIN}/`);
  assertEquals(APP_JSON.expo.ios.associatedDomains, [`applinks:${WEB_DOMAIN}`]);
  assert(WEB_ORIGIN_SRC.includes(`export const WEB_ORIGIN = '${WEB_ORIGIN}';`), 'supabase/functions/_shared/web-origin.ts differs');
  assertEquals(buildConfirmRedirect(), `${WEB_ORIGIN}/auth/confirm`);
  assertEquals(buildConfirmRedirect(), 'https://fantasy-stock-app.vercel.app/auth/confirm');
  assert(AUTH_LINK_BASES.includes(WEB_BASE));
  assertEquals(AUTH_LINK_BASES[0], 'fantasystockapp://'); // the scheme stays first and stays the fallback
  assertEquals(APP_JSON.expo.scheme + '://', AUTH_LINK_BASES[0]);
});

Deno.test('domain: a rename would have to touch exactly the mirrors the header names (no hard-coded copies elsewhere)', () => {
  const offenders = Object.entries(SOURCES)
    .filter(([f, s]) => strip(s).includes('fantasy-stock-app.vercel.app') && f !== 'lib/links/webDomain.ts')
    .map(([f]) => f);
  assertEquals(offenders, []);
});

Deno.test('universal links: every path in the AASA list is handled by the app, and the doc\'s JSON is built from the list', () => {
  const sample: Record<string, string> = { '/join/*': `${WEB_ORIGIN}/join/${CODE}`, '/auth/confirm': `${WEB_ORIGIN}/auth/confirm?code=0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0` };
  assertEquals([...UNIVERSAL_LINK_PATHS].sort(), Object.keys(sample).sort());
  assertEquals(parseInviteLink(sample['/join/*'], false), CODE);
  assert(isConfirmLink(sample['/auth/confirm'], false));
  assert(isConfirmRoute(sample['/auth/confirm']));
  // the doc W5 reads
  const json = JSON.parse(AASA_DOC.match(/```json\n([\s\S]*?)```/)![1]);
  const detail = json.applinks.details[0];
  assertEquals(APPLE_TEAM_ID, '688SPM7BS6'); // Giorgio, 2026-10-14
  assert(/^[A-Z0-9]{10}$/.test(APPLE_TEAM_ID));
  assertEquals(detail.appIDs, [`${APPLE_TEAM_ID}.${APP_JSON.expo.ios.bundleIdentifier}`]);
  assertEquals(detail.appIDs, ['688SPM7BS6.com.stockpile.fantasystock']);
  assertEquals(detail.components.map((c: { '/': string }) => c['/']), [...UNIVERSAL_LINK_PATHS]);
  assertFalse(JSON.stringify(json).includes('reset-password'), 'recovery stays on the scheme');
});

// ── W2's links: the https base is accepted for confirm only ──────────────

const UUID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

Deno.test('confirm: the https link parses like the scheme link, a look-alike host does not', () => {
  assertEquals(parseConfirmLink(`${WEB_ORIGIN}/auth/confirm?code=${UUID}`, false), { kind: 'code', code: UUID });
  assertEquals(parseConfirmLink(`fantasystockapp://auth/confirm?code=${UUID}`, false), { kind: 'code', code: UUID });
  assertEquals(parseConfirmLink(`${WEB_ORIGIN}/auth/confirm?invite=${CODE}&code=${UUID}`, false), { kind: 'code', code: UUID });
  assertEquals(parseConfirmLink(`https://fantasy-stock-app.vercel.app.evil.com/auth/confirm?code=${UUID}`, false), { kind: 'none' });
  assertEquals(parseConfirmLink(`http://fantasy-stock-app.vercel.app/auth/confirm?code=${UUID}`, false), { kind: 'none' });
  assertEquals(parseConfirmLink(`${WEB_ORIGIN}/auth/confirm?invite=${CODE}`, false), { kind: 'empty' });
});

Deno.test('recovery: pinned to the scheme: the https base neither builds nor parses a reset link', () => {
  assertEquals(buildRecoveryRedirect(), 'fantasystockapp://reset-password?flow=pkce');
  assertEquals(parseRecoveryLink(`fantasystockapp://reset-password?flow=pkce&code=${UUID}`, false), { kind: 'code', code: UUID });
  assertEquals(parseRecoveryLink(`${WEB_ORIGIN}/reset-password?flow=pkce&code=${UUID}`, false), { kind: 'none' });
  assertEquals(isRecoveryRoute(`${WEB_ORIGIN}/reset-password`), false);
  assertEquals(isRecoveryRoute('fantasystockapp://reset-password'), true);
  // and linkIsPath with the full list would have accepted it: the pin is what refuses
  assertEquals(linkIsPath(`${WEB_ORIGIN}/reset-password`, 'reset-password', false), true);
});

Deno.test('the pending-route allow-list is NOT widened: an invite link is never a resumable route', () => {
  for (const url of [`${WEB_ORIGIN}/join/${CODE}`, `fantasystockapp://join/${CODE}`, `/join/${CODE}`, '/join-league?invite=1&code=X', `/join-league?code=${CODE}`]) {
    const resolved = resolveResumeTarget(url);
    assert(resolved === null || resolved === '/join-league', `${url} -> ${resolved}`);
    if (resolved) assertFalse(resolved.includes('code'));
  }
  const route = createPendingRoute();
  route.record(`${WEB_ORIGIN}/join/${CODE}`);
  assertEquals(route.peek(), null);
});

// ── the no-session preview, as the app reads it ──────────────────────────

Deno.test('preview reader: found / not_found / unavailable, strictly', () => {
  assertEquals(interpretInvitePreview({ found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason: null }, null),
    { kind: 'found', name: 'Stock Scudetto', inviter: 'Roberto', reason: null });
  assertEquals(interpretInvitePreview({ found: true, name: 'Stock Scudetto', inviter: null, reason: 'league_full' }, null),
    { kind: 'found', name: 'Stock Scudetto', inviter: null, reason: 'league_full' });
  // a reason this app doesn't know (a newer server) is unavailable: never guessed at
  assertEquals(interpretInvitePreview({ found: true, name: 'X', inviter: 'R', reason: 'a_future_reason' }, null), { kind: 'unavailable' });
  assertEquals(interpretInvitePreview({ found: false }, null), { kind: 'not_found' });
  for (const bad of [null, undefined, 'found', 7, [], {}, { found: 'yes' }, { found: true }, { found: true, name: '  ' },
    { found: true, name: 'X', reason: 5 }, { found: true, name: 5 }]) {
    assertEquals(interpretInvitePreview(bad, null), { kind: 'unavailable' }, JSON.stringify(bad));
  }
  assertEquals(interpretInvitePreview({ found: true, name: 'X' }, new Error('429')), { kind: 'unavailable' });
  assertEquals(interpretInvitePreview({ found: false }, { context: { status: 500 } }), { kind: 'unavailable' }, 'an error beats any body');
});

Deno.test('preview reader: names are drawn safely (control characters out, capped), never server text', () => {
  assertEquals(cleanName('  Stock\u0000 ‮ Scudetto\n'), 'Stock ‮ Scudetto');
  assertEquals(cleanName('a b c'), 'a b c');
  assertEquals(cleanName('x'.repeat(100), 60)?.length, 60);
  assertEquals(cleanName('   '), null);
  assertEquals(cleanName(5), null);
  const p = interpretInvitePreview({ found: true, name: 'League', inviter: 'Bob', reason: null, message: 'server text', error: 'x' }, null);
  assertFalse(JSON.stringify(p).includes('server text'));
});

Deno.test('headline: "{inviter} invited you to {league}" (decision 7), else the generic line', () => {
  const f = (inviter: string | null): InvitePreview => ({ kind: 'found', name: 'Stock Scudetto', inviter, reason: null });
  assertEquals(inviteHeadline(f('Roberto')), 'Roberto invited you to Stock Scudetto');
  assertEquals(inviteHeadline(f(null)), "You're invited to Stock Scudetto");
  for (const p of [{ kind: 'unavailable' }, { kind: 'not_found' }, { kind: 'loading' }, { kind: 'idle' }] as const) {
    assertEquals(inviteHeadline(p), GENERIC_INVITE_LINE);
  }
  assertEquals(GENERIC_INVITE_LINE, "You're invited to a league");
});

// ── the pending invite: lifecycle ────────────────────────────────────────

function rig(over: Partial<PendingInviteDeps> = {}, initial: string | null = null) {
  let stored = initial;
  const log: string[] = [];
  const clock = { t: 1_800_000_000_000 };
  const calls: string[] = [];
  const storage: InviteStorage = {
    get: () => Promise.resolve(stored),
    set: (v) => { stored = v; log.push('set'); return Promise.resolve(); },
    remove: () => { stored = null; log.push('remove'); return Promise.resolve(); },
  };
  const deps: PendingInviteDeps = {
    storage,
    fetchPreview: (code) => { calls.push(code); return Promise.resolve({ kind: 'found', name: 'Stock Scudetto', inviter: 'Roberto', reason: null }); },
    now: () => clock.t,
    warn: (m) => log.push(`warn:${m}`),
    ...over,
  };
  const store = createPendingInvite(deps);
  return { store, deps, log, calls, clock, stored: () => stored };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test('lifecycle: capture -> persisted, preview fetched once, the league name filled in', async () => {
  const r = rig();
  assert(r.store.capture(CODE));
  assertEquals(r.store.getSnapshot().code, CODE);
  assertEquals(r.store.getSnapshot().preview, { kind: 'loading' });
  await tick();
  const s = r.store.getSnapshot();
  assertEquals(s.preview, { kind: 'found', name: 'Stock Scudetto', inviter: 'Roberto', reason: null });
  assertEquals(s.leagueName, 'Stock Scudetto');
  assertEquals(r.calls, [CODE]);
  const saved = JSON.parse(r.stored()!);
  assertEquals([saved.code, saved.leagueName, saved.triedJoin, saved.v], [CODE, 'Stock Scudetto', false, 1]);
  assertEquals(INVITE_STORAGE_KEY, 'sp.invite.pending.v1');
});

Deno.test('lifecycle: the cold-start link arrives twice: ONE fetch, nothing reset; a hostile code is refused', async () => {
  const r = rig();
  assert(r.store.capture(CODE));
  await r.store.markTried();
  assert(r.store.capture(CODE.toLowerCase()), 'the same code again is accepted and changes nothing');
  assertEquals(r.store.getSnapshot().triedJoin, true, 'a repeat does not reset triedJoin');
  await tick();
  assertEquals(r.calls.length, 1);
  for (const bad of ['', 'abc', '../../x', 'AB%20CD', null, 7]) assertFalse(r.store.capture(bad), String(bad));
  assertEquals(r.store.getSnapshot().code, CODE, 'a refused code erases nothing');
});

Deno.test('lifecycle: the latest DIFFERENT link wins, and starts clean', async () => {
  const r = rig();
  r.store.capture(CODE);
  await r.store.markTried();
  await tick();
  assert(r.store.capture('ZZZZ2222YY'));
  const s = r.store.getSnapshot();
  assertEquals([s.code, s.triedJoin, s.leagueName, s.autoOpenedCode], ['ZZZZ2222YY', false, null, null]);
});

Deno.test('lifecycle: a slow preview for an OLD code never lands on the new invite', async () => {
  let release: (p: InvitePreview) => void = () => {};
  const r = rig({
    fetchPreview: (code) => code === CODE
      ? new Promise<InvitePreview>((res) => { release = res; })
      : Promise.resolve({ kind: 'found', name: 'Second League', inviter: null, reason: null }),
  });
  r.store.capture(CODE);
  r.store.capture('ZZZZ2222YY');
  await tick();
  release({ kind: 'found', name: 'First League', inviter: 'Old', reason: null });
  await tick();
  assertEquals(r.store.getSnapshot().leagueName, 'Second League');
  assertEquals(r.store.getSnapshot().code, 'ZZZZ2222YY');
});

Deno.test('lifecycle: clear() while a preview is in flight: the late answer is dropped', async () => {
  let release: (p: InvitePreview) => void = () => {};
  const r = rig({ fetchPreview: () => new Promise<InvitePreview>((res) => { release = res; }) });
  r.store.capture(CODE);
  await r.store.clear();
  release({ kind: 'found', name: 'Late', inviter: null, reason: null });
  await tick();
  assertEquals(r.store.getSnapshot().code, null);
  assertEquals(r.store.getSnapshot().leagueName, null);
  assertEquals(r.stored(), null);
});

Deno.test('lifecycle: survives an app kill: a new store loads the stored invite, asks the preview again once', async () => {
  const first = rig();
  first.store.capture(CODE);
  await tick();
  await first.store.markTried();
  const second = rig({}, first.stored());
  assertEquals(second.store.getSnapshot().loaded, false);
  await second.store.load();
  const s = second.store.getSnapshot();
  assertEquals([s.loaded, s.code, s.leagueName, s.triedJoin], [true, CODE, 'Stock Scudetto', true]);
  assertEquals(s.autoOpenedCode, null, 'a relaunch may open the join once more');
  await tick();
  assertEquals(second.calls, [CODE]);
  assertEquals((second.store.getSnapshot().preview as { inviter: string }).inviter, 'Roberto', 'the inviter is refetched, not persisted');
});

Deno.test('lifecycle: a link captured while the stored read is in flight beats the stored one', async () => {
  const old = JSON.stringify({ v: 1, code: 'OLDOLD2222', capturedAt: 1_800_000_000_000, leagueName: 'Old', triedJoin: true });
  let release: (v: string | null) => void = () => {};
  const r = rig({}, old);
  r.deps.storage.get = () => new Promise((res) => { release = res; });
  const loading = r.store.load();
  r.store.capture(CODE);
  release(old);
  await loading;
  assertEquals(r.store.getSnapshot().code, CODE);
  assertEquals(r.store.getSnapshot().triedJoin, false);
});

Deno.test('lifecycle: the invite expires (14 days); junk, hostile and future-dated storage is removed, not trusted', async () => {
  const now = 1_800_000_000_000;
  const good = { v: 1, code: CODE, capturedAt: now - 1000, leagueName: 'L', triedJoin: false };
  assertEquals(parsePersisted(JSON.stringify(good), now)?.code, CODE);
  assertEquals(parsePersisted(JSON.stringify({ ...good, capturedAt: now - INVITE_TTL_MS - 1 }), now), null);
  assertEquals(parsePersisted(JSON.stringify({ ...good, capturedAt: now + 3 * 24 * 3600_000 }), now), null);
  for (const bad of [null, '', 'not json', '[]', '7', 'null', JSON.stringify({ ...good, v: 2 }), JSON.stringify({ ...good, code: '../x' }),
    JSON.stringify({ ...good, code: 'abc' }), JSON.stringify({ ...good, capturedAt: 'yesterday' }), JSON.stringify({ ...good, capturedAt: null })]) {
    assertEquals(parsePersisted(bad, now), null, String(bad));
  }
  const odd = parsePersisted(JSON.stringify({ ...good, leagueName: 'x'.repeat(500), triedJoin: 'yes' }), now)!;
  assertEquals([odd.leagueName?.length, odd.triedJoin], [80, false]);
  const r = rig({}, JSON.stringify({ ...good, capturedAt: now - INVITE_TTL_MS - 5 }));
  await r.store.load();
  await tick();
  assertEquals([r.store.getSnapshot().code, r.store.getSnapshot().loaded, r.stored()], [null, true, null]);
});

Deno.test('lifecycle: a storage failure never throws: the invite still works for this launch, and says so', async () => {
  const r = rig({
    storage: { get: () => Promise.reject(new Error('disk')), set: () => Promise.reject(new Error('disk')), remove: () => Promise.reject(new Error('disk')) },
  });
  await r.store.load();
  assert(r.store.capture(CODE));
  await r.store.markTried();
  assertEquals([r.store.getSnapshot().code, r.store.getSnapshot().triedJoin], [CODE, true]);
  assert(r.log.some((l) => l.startsWith('warn:')), 'a failed write is warned, not silent');
  await r.store.clear();
  assertEquals(r.store.getSnapshot().code, null);
});

Deno.test('lifecycle: the preview failing is "unavailable", never a throw, and retryPreview is ONE call per tap', async () => {
  let n = 0;
  const r = rig({ fetchPreview: () => { n++; return n === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ kind: 'found', name: 'Back', inviter: null, reason: null }); } });
  r.store.capture(CODE);
  await tick();
  assertEquals(r.store.getSnapshot().preview, { kind: 'unavailable' });
  assertEquals(r.store.getSnapshot().code, CODE, 'unavailable keeps the invite');
  await tick();
  assertEquals(n, 1, 'no automatic retry');
  r.store.retryPreview();
  await tick();
  assertEquals(n, 2);
  assertEquals(r.store.getSnapshot().leagueName, 'Back');
});

Deno.test('lifecycle: a signed-out not_found does NOT clear the invite (the definitive clear happens at ready)', async () => {
  const r = rig({ fetchPreview: () => Promise.resolve({ kind: 'not_found' }) });
  r.store.capture(CODE);
  await tick();
  assertEquals(r.store.getSnapshot().code, CODE);
  assertEquals(r.store.getSnapshot().preview, { kind: 'not_found' });
});

Deno.test('lifecycle: markAutoOpened is per code, in memory only', async () => {
  const r = rig();
  r.store.capture(CODE);
  r.store.markAutoOpened('OTHER22222');
  assertEquals(r.store.getSnapshot().autoOpenedCode, null);
  r.store.markAutoOpened(CODE);
  assertEquals(r.store.getSnapshot().autoOpenedCode, CODE);
  await tick();
  await r.store.markTried(); // flush the write chain
  assertFalse(r.stored()!.includes('autoOpened'));
});

Deno.test('lifecycle: subscribers hear every change (useSyncExternalStore contract)', async () => {
  const r = rig();
  let heard = 0;
  const off = r.store.subscribe(() => heard++);
  const before = r.store.getSnapshot();
  r.store.capture(CODE);
  assertNotEquals(r.store.getSnapshot(), before);
  assert(heard >= 1);
  const stable = r.store.getSnapshot();
  assertEquals(r.store.getSnapshot(), stable, 'the snapshot is referentially stable between changes');
  off();
  const n = heard;
  await r.store.clear();
  assertEquals(heard, n);
});

// ── the decisions ────────────────────────────────────────────────────────

const LEAGUE = { name: 'Stock Scudetto', members: 3, max: 8, stakeMode: null, notionalPerSlot: null, budgetAmount: null, leagueType: null, numWeeks: 10, durationDays: null, draftDate: null, draftStatus: 'not_started' };
const previewBody = (over: Record<string, unknown> = {}) => ({
  found: true, joinable: true, reason: null,
  league: { name: 'Stock Scudetto', num_participants: 8, current_members: 3, draft_status: 'not_started', num_weeks: 10, ...(over.league as object ?? {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'league')),
});
const joined = { ok: true, league: { id: 'L-1', name: 'Stock Scudetto' } };
const refusal = (reason: string, withId = false) => ({ ok: false, reason, ...(withId ? { league: { id: 'L-1' } } : {}) });
const wire = { status: 500 };

Deno.test('decide after preview: the table', () => {
  const found = (data: unknown) => interpretPreview(data, null);
  assertEquals(decideAfterPreview(found(previewBody()), false).kind, 'join');
  assertEquals(decideAfterPreview(found(previewBody({ joinable: false, reason: 'already_member' })), false).kind, 'open');
  assertEquals(decideAfterPreview(found(previewBody({ joinable: false, reason: 'already_member' })), true).kind, 'joined_earlier');
  for (const reason of ['league_full', 'draft_started', 'season_completed', 'invite_expired', 'a_new_reason']) {
    const d = decideAfterPreview(found(previewBody({ joinable: false, reason })), false);
    assertEquals([d.kind, d.fate], ['refused', 'clear'], reason);
  }
  assertEquals(decideAfterPreview(found({ found: false }), false), { kind: 'bad_code', fate: 'clear' });
  const e = decideAfterPreview(interpretPreview(null, { context: wire }), false);
  assertEquals([e.kind, e.fate], ['error', 'keep']);
  const limited = decideAfterPreview(interpretPreview(null, { context: { status: 429 } }), false);
  assertEquals(limited, { kind: 'error', fate: 'keep', error: 'rate_limited' });
});

Deno.test('decide after join: the table', () => {
  assertEquals(decideAfterJoin(interpretJoin(joined, null)), { kind: 'joined', fate: 'clear', leagueId: 'L-1', leagueName: 'Stock Scudetto' });
  assertEquals(decideAfterJoin(interpretJoin(refusal('already_member', true), null)), { kind: 'joined_already', fate: 'clear', leagueId: 'L-1' });
  // already_member with no league to open is a refusal, never a silent success
  const noId = decideAfterJoin(interpretJoin(refusal('already_member'), null));
  assertEquals([noId.kind, noId.fate], ['refused', 'clear']);
  for (const reason of ['league_full', 'draft_started', 'season_completed', 'invite_expired', 'weird']) {
    const d = decideAfterJoin(interpretJoin(refusal(reason), null));
    assertEquals([d.kind, d.fate], ['refused', 'clear'], reason);
  }
  assertEquals(decideAfterJoin(interpretJoin(null, { context: wire })), { kind: 'error', fate: 'keep', error: 'unreachable' });
  assertEquals(decideAfterJoin(interpretJoin({ ok: true }, null)), { kind: 'error', fate: 'keep', error: 'unreachable' }, 'ok with no league is not "joined"');
  assertEquals(decideAfterJoin(interpretJoin('garbage', null)).fate, 'keep');
});

Deno.test('auto-open: ready only, once per code, never during a recovery hold', () => {
  const base = { phase: 'ready' as const, code: CODE, autoOpenedCode: null, recoveryHold: false, ownerAction: 'none' as const, arrivalSettled: true };
  assert(shouldAutoOpenInvite(base));
  for (const phase of ['unknown', 'signedOut', 'gated'] as const) assertFalse(shouldAutoOpenInvite({ ...base, phase }), phase);
  assertFalse(shouldAutoOpenInvite({ ...base, code: null }));
  assertFalse(shouldAutoOpenInvite({ ...base, autoOpenedCode: CODE }), 'once per code per launch');
  assert(shouldAutoOpenInvite({ ...base, autoOpenedCode: 'OTHER22222' }), 'a different code opens again');
  assertFalse(shouldAutoOpenInvite({ ...base, recoveryHold: true }));
  // never in the same commit that claims or clears the invite for the person signed in
  assertFalse(shouldAutoOpenInvite({ ...base, ownerAction: 'claim' }));
  assertFalse(shouldAutoOpenInvite({ ...base, ownerAction: 'clear' }));
  assertFalse(shouldAutoOpenInvite({ ...base, arrivalSettled: false }), 'the route (auto or tap) is decided from a settled arrival');
  assertEquals(INVITE_JOIN_ROUTE, '/join-league?invite=1');
  assertFalse(INVITE_JOIN_ROUTE.includes(CODE));
});

// ── the whole sequence, with a fake server (the partial-state cases) ─────

interface Server { preview: unknown[]; join: unknown[]; }
function seq(server: Server, over: Partial<InviteJoinDeps> = {}, tried = false) {
  const state = { tried, cleared: 0, markTried: 0, previews: 0, joins: 0, current: true, order: [] as string[] };
  const next = (list: unknown[], i: number) => (i < list.length ? list[i] : list[list.length - 1]);
  const answer = (v: unknown) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(
    v && typeof v === 'object' && 'transport' in (v as object) ? { data: null, error: { context: { status: (v as { transport: number }).transport } } } : { data: v, error: null }));
  const deps: InviteJoinDeps = {
    preview: () => { state.order.push('preview'); return answer(next(server.preview, state.previews++)); },
    join: () => { state.order.push('join'); return answer(next(server.join, state.joins++)); },
    triedJoin: () => state.tried,
    markTried: () => { state.tried = true; state.markTried++; state.order.push('markTried'); return Promise.resolve(); },
    clear: () => { state.cleared++; state.order.push('clear'); return Promise.resolve(); },
    isCurrent: () => state.current,
    ...over,
  };
  return { state, deps };
}

Deno.test('flow: joinable -> markTried BEFORE the join -> joined, invite cleared, "You\'re in"', async () => {
  const { state, deps } = seq({ preview: [previewBody()], join: [joined] });
  const res = await runInviteJoin(deps, CODE);
  assertEquals(res?.kind, 'joined');
  assertEquals((res as unknown as { leagueName: string }).leagueName, 'Stock Scudetto');
  assertEquals(state.order, ['preview', 'markTried', 'join', 'clear']);
});

Deno.test('flow: PARTIAL STATE: the join landed but its answer was lost -> kept; the retry says already_member -> "You\'re in", not a silent open', async () => {
  // run 1: preview ok, markTried, the join's answer is lost on the wire
  const run1 = seq({ preview: [previewBody()], join: [{ transport: 500 }] });
  const r1 = await runInviteJoin(run1.deps, CODE);
  assertEquals(r1?.kind, 'join_error');
  assertEquals(run1.state.cleared, 0, 'a lost answer KEEPS the invite');
  assertEquals(run1.state.tried, true, 'and triedJoin is set');
  // run 2 (the person taps Join, or relaunches): the server now says they are a member
  const run2 = seq({ preview: [previewBody({ joinable: false, reason: 'already_member' })], join: [refusal('already_member', true)] }, {}, true);
  const r2 = await runInviteJoin(run2.deps, CODE);
  assertEquals(r2?.kind, 'joined', 'triedJoin + already_member = the earlier join landed');
  assertEquals(run2.state.cleared, 1);
  assertEquals(run2.state.markTried, 0, 'nothing new to try');
  // the same server answer WITHOUT triedJoin is a member tapping their league's link: it opens, no ceremony
  const run3 = seq({ preview: [previewBody({ joinable: false, reason: 'already_member' })], join: [refusal('already_member', true)] }, {}, false);
  const r3 = await runInviteJoin(run3.deps, CODE);
  assertEquals(r3, { kind: 'opened', leagueId: 'L-1' });
});

Deno.test('flow: the preview itself fails on the wire -> kept, error shown, nothing tried, no loop', async () => {
  for (const status of [0, 429, 500, 503]) {
    const { state, deps } = seq({ preview: [{ transport: status }], join: [joined] });
    const res = await runInviteJoin(deps, CODE);
    assertEquals(res?.kind, 'lookup_error', String(status));
    assertEquals([state.cleared, state.markTried, state.joins, state.previews], [0, 0, 0, 1], String(status));
  }
  const thrown = seq({ preview: [new Error('offline')], join: [joined] });
  assertEquals((await runInviteJoin(thrown.deps, CODE))?.kind, 'lookup_error');
});

Deno.test('flow: every refusal CLEARS the invite and shows the existing copy (nothing silently dropped)', async () => {
  for (const [reason, copy] of [
    ['league_full', 'is full'], ['draft_started', 'drafting right now'], ['season_completed', 'season is over'], ['invite_expired', 'expired'],
  ] as const) {
    const { state, deps } = seq({ preview: [previewBody({ joinable: false, reason })], join: [joined] });
    const res = await runInviteJoin(deps, CODE);
    assertEquals(res?.kind, 'refused', reason);
    assertEquals(state.cleared, 1, reason);
    assertEquals(state.joins, 0, 'a refused preview never calls join');
    const block = (res as unknown as { block: never }).block;
    assert(blockMessage(block, { name: 'Stock Scudetto', max: 8 }).includes(copy) || reason === 'draft_started', `${reason}: ${block}`);
    assert(blockMessage(block, { name: 'Stock Scudetto', max: 8 }).length > 10);
  }
  // draft_started with an under-way draft reads "drafting right now"; a completed one "already drafted"
  const underway = seq({ preview: [previewBody({ joinable: false, reason: 'draft_started', league: { draft_status: 'in_progress' } })], join: [joined] });
  assertEquals((await runInviteJoin(underway.deps, CODE) as unknown as { block: string }).block, 'draft_in_progress');
  const done = seq({ preview: [previewBody({ joinable: false, reason: 'draft_started', league: { draft_status: 'completed' } })], join: [joined] });
  assertEquals((await runInviteJoin(done.deps, CODE) as unknown as { block: string }).block, 'draft_started');
});

Deno.test('flow: no league has the code -> cleared, the "no league has that code" line', async () => {
  const { state, deps } = seq({ preview: [{ found: false, reason: 'invalid_code' }], join: [joined] });
  assertEquals((await runInviteJoin(deps, CODE))?.kind, 'bad_code');
  assertEquals([state.cleared, state.joins], [1, 0]);
  assertEquals(JOIN_COPY.badCode, 'No league has that code. Check it and try again.');
});

Deno.test('flow: the league changed between the preview and the join (room opened / filled) -> cleared, reason shown', async () => {
  for (const reason of ['draft_started', 'league_full', 'season_completed']) {
    const { state, deps } = seq({ preview: [previewBody()], join: [refusal(reason)] });
    const res = await runInviteJoin(deps, CODE);
    assertEquals(res?.kind, 'refused', reason);
    assertEquals(state.cleared, 1, reason);
    assertEquals(state.tried, true, 'it was tried: the order markTried -> join -> clear holds');
  }
  const started = seq({ preview: [previewBody()], join: [refusal('draft_started')] });
  const res = await runInviteJoin(started.deps, CODE) as unknown as { block: string; league: { draftStatus: string } };
  assertEquals([res.block, res.league.draftStatus], ['draft_in_progress', 'in_progress'], 'the Draft row agrees with the line under it');
});

Deno.test('flow: already_member from the join with no league id is a refusal, never "You\'re in"', async () => {
  const { state, deps } = seq({ preview: [previewBody()], join: [refusal('already_member')] });
  const res = await runInviteJoin(deps, CODE);
  assertEquals(res?.kind, 'refused');
  assertEquals(state.cleared, 1);
});

Deno.test('flow: the person taps Join on the kept preview after a lost answer: the same sequence, no second markTried needed', async () => {
  const lost = seq({ preview: [previewBody()], join: [{ transport: 0 }, joined] });
  const first = await runInviteJoin(lost.deps, CODE);
  assertEquals(first?.kind, 'join_error');
  const league = (first as unknown as { league: typeof LEAGUE }).league;
  const retry = await completeInviteJoin(lost.deps, CODE, league, 'join');
  assertEquals(retry?.kind, 'joined');
  assertEquals(lost.state.cleared, 1);
  assertEquals(lost.state.joins, 2, 'exactly one call per tap, no automatic retry between');
});

Deno.test('flow: walking away mid-run: a stale answer neither clears, marks nor draws', async () => {
  const { state, deps } = seq({ preview: [previewBody()], join: [joined] }, { isCurrent: () => false });
  assertEquals(await runInviteJoin(deps, CODE), null);
  assertEquals([state.cleared, state.markTried, state.joins], [0, 0, 0]);
  let calls = 0;
  const mid = seq({ preview: [previewBody()], join: [joined] }, { isCurrent: () => ++calls <= 1 });
  assertEquals(await runInviteJoin(mid.deps, CODE), null, 'stale after the join returned');
  assertEquals(mid.state.cleared, 0, 'a stale join result is not applied');
});

Deno.test('flow: the screen is the thin shell it should be: it draws results and applies no fate of its own', () => {
  const s = strip(SOURCES['app/join-league.tsx']);
  assert(s.includes('runInviteJoin(inviteDeps(inviteCode), inviteCode)'));
  assert(s.includes('completeInviteJoin(inviteDeps(tapped), tapped, league'));
  // the sequence owns markTried and clear; the screen calls them only as injected deps and on dismissal
  assertEquals((s.match(/pendingInvite\.markTried\(/g) ?? []).length, 2, 'the dep, and the tap-to-retry path');
  assert(s.includes('markTried: () => pendingInvite.markTried(inviteCode),') && s.includes('clear: () => pendingInvite.clear(inviteCode),'), 'scoped to the code the run is for');
  assert(s.includes('isCurrent: () => mine === request.current && pendingInvite.getSnapshot().code === inviteCode,'));
  assert(s.includes('shouldClearOnDismiss(pendingInvite.getSnapshot(), mounted)') && s.includes('pendingInvite.clear(mounted as string)'), 'dismissal clears, unless a join was tried or a different link replaced it');
  assertFalse(/useLocalSearchParams[^;]*\bcode\b/.test(s), 'the code is never read from the route');
});

// ── the wiring ───────────────────────────────────────────────────────────

Deno.test('wiring: +native-intent captures a strict invite link, marks the cards seen, returns the root, and keeps W2\'s lines', () => {
  const s = strip(SOURCES['app/+native-intent.tsx']);
  assert(s.includes('const invite = parseInviteArrival(path);'));
  assert(s.includes('pendingInvite.capture(invite.code, { origin: invite.origin, signedInAtArrival: live.signedIn, userIdAtArrival: live.userId })'));
  assert(s.includes('markOnboardingSeen();'));
  assert(s.includes("return '/';"));
  assert(s.includes("if (isConfirmRoute(path)) return '/login';"));
  assert(s.includes("if (isRecoveryRoute(path)) return '/reset-password';"));
  // the invite branch comes first and is inside the try/catch that cannot crash the router
  assert(s.indexOf('parseInviteArrival(path)') < s.indexOf('isConfirmRoute(path)'));
  assert(/try \{[^}]*const invite = parseInviteArrival/.test(s.replace(/\s+/g, ' ')));
  assertFalse(/parseInviteArrival\(path,\s*true\)/.test(s), 'a release build accepts only registered origins');
});

Deno.test('wiring: the root layout opens the join once, behind the recovery hold, clears on any user change or sign-out, and the cards honour the invite', () => {
  const s = strip(SOURCES['app/_layout.tsx']);
  assert(s.includes('shouldAutoOpenInvite({ phase: shownPhase, code: invite.code, autoOpenedCode: invite.autoOpenedCode, recoveryHold: isRecoveryHold(), ownerAction, arrivalSettled })'));
  assert(s.includes('inviteStore.markAutoOpened(invite.code as string);'));
  assert(s.includes('const route = inviteJoinRoute(invite);') && s.includes('router.push(route as never)'));
  assert(s.includes('shouldClearInviteOnAuthChange(lastUserId.current, userId)') && s.includes('inviteStore.clear(seen)'));
  assert(s.includes('!onboardingSeen && !pendingRoute.peek() && !invite.code'));
  // the stored invite is read before the first screen is chosen (no sign-in flash for someone with an invite)
  assert(s.includes("onboardingSeen !== null && invite.loaded;"));
  // the timer has NO cleanup: marking the code opened re-runs the effect, which would cancel it
  const effect = s.slice(s.indexOf('shouldAutoOpenInvite({'), s.indexOf('holdTick]);'));
  assertFalse(/return\s*\(\)\s*=>\s*clearTimeout/.test(effect));
});

Deno.test('wiring: firstRun cannot overwrite an in-memory mark with the stale stored "not seen"', () => {
  const s = strip(SOURCES['lib/shell/firstRun.ts']);
  assert(s.includes('if (seen === null) seen = v === \'1\';'));
  assert(s.includes('if (seen === null) seen = true;'));
});

Deno.test('wiring: sign-up sends the https confirm redirect with the pending code; ConfirmEmailSent gets the league', () => {
  const sp = strip(SOURCES['lib/SessionProvider.tsx']);
  assert(sp.includes('emailRedirectTo: buildConfirmRedirect()'));
  // decision 17: no invite code in the confirmation email, anywhere in the sign-up path
  assertFalse(/pendingInvite|invite/i.test(sp.slice(sp.indexOf('const signUp = useCallback'), sp.indexOf('const fixtureSocial'))));
  assertFalse(strip(SOURCES['lib/auth/confirmLink.ts']).includes('invite'), 'confirmLink carries no invite plumbing');
  for (const f of ['app/create-account.tsx', 'app/login.tsx']) {
    const s = strip(SOURCES[f]);
    assert(s.includes('league={invite?.leagueName ?? null}'), f);
    assert(s.includes('usePendingInvite()') && s.includes("from '@/lib/invite/usePendingInvite'"), f);
  }
  const reset = strip(SOURCES['app/forgot-password.tsx']);
  assert(reset.includes('buildRecoveryRedirect()'));
  assertEquals(buildRecoveryRedirect().startsWith('fantasystockapp://'), true);
});

Deno.test('wiring: the preview call is the no-session function, and nothing but the store reads its result', () => {
  const api = strip(SOURCES['lib/invite/invitePreviewApi.ts']);
  assert(api.includes("supabase.functions.invoke('invite-preview', { body: { code } })"));
  assert(api.includes('if (SHELL_FIXTURE) return'), 'dev fixtures make no calls');
  // the join screen still uses the SESSION functions
  const j = strip(SOURCES['app/join-league.tsx']);
  assert(j.includes("invoke('preview-league'") && j.includes("invoke('join-league'"));
  assertFalse(j.includes("invoke('invite-preview'"));
});

Deno.test('wiring: no server text reaches the UI from the invite path; names are cleaned', () => {
  for (const f of ['lib/invite/invitePreview.ts', 'lib/invite/inviteJoin.ts', 'lib/invite/autoJoin.ts', 'lib/invite/pendingInvite.ts']) {
    const s = strip(SOURCES[f]);
    assertFalse(/\.message\b/.test(s), `${f} reads a server message`);
  }
});

Deno.test('wiring: the invite code never travels in router params, logs, or analytics', () => {
  for (const f of ['lib/invite/pendingInvite.ts', 'lib/invite/pendingInviteStore.ts', 'lib/invite/inviteJoin.ts', 'lib/invite/autoJoin.ts', 'app/+native-intent.tsx']) {
    const s = strip(SOURCES[f]);
    assertFalse(/console\.(log|info|debug)\(/.test(s), `${f} logs`);
    assertFalse(/console\.warn\([^)]*\b(code|invite\.code|snap\.code)\b/.test(s), `${f} warns with a code`);
  }
  assertFalse(/router\.(push|replace)\([^)]*\$\{/.test(strip(SOURCES['app/_layout.tsx'])));
});

Deno.test('wiring: associatedDomains is the only native change; the scheme stays registered', () => {
  assertEquals(Object.keys(APP_JSON.expo.ios).sort(), ['associatedDomains', 'bundleIdentifier', 'infoPlist', 'runtimeVersion', 'supportsTablet', 'usesAppleSignIn']);
  assertEquals(APP_JSON.expo.scheme, 'fantasystockapp');
});

Deno.test('the arrival API: W4\'s exported shape (usePendingInvite.ts replaces its stub whole; the types live in a pure module), never a league fact', () => {
  const t = strip(SOURCES['lib/invite/pendingInviteTypes.ts']);
  for (const needle of ['export type { InviteReason };', 'export type InvitePreview =', 'export interface PendingInvite {',
    "{ kind: 'loading' }", "{ kind: 'not_found' }", "{ kind: 'unavailable' }", 'retryPreview(): void;', 'leagueName: string | null;', 'code: string;']) {
    assert(t.includes(needle), needle);
  }
  assertFalse(/\bleague\??\s*:/.test(t), 'no league facts in the signed-out preview type (W4 dropped its proposed field too)');
  // the hook re-exports the SAME names, so every importer of usePendingInvite keeps working
  const h = strip(SOURCES['lib/invite/usePendingInvite.ts']);
  assert(h.includes("export type { InvitePreview, InviteReason, PendingInvite } from './pendingInviteTypes';"));
  assert(h.includes('export function usePendingInvite(): PendingInvite | null'));
  // the pure types module is dependency-free, so hermetic tests (W4's arrivalView / inviteFixture) can import it under Deno
  assertFalse(/from 'react|from '@\/|AsyncStorage|supabase/.test(t.replace(/from '\.\/invitePreview'/g, '')), 'no React, storage or supabase');
  for (const f of ['lib/invite/arrivalView.ts', 'lib/invite/inviteFixture.ts']) {
    assert(strip(SOURCES[f]).includes("from './pendingInviteTypes'"), f);
    assertFalse(strip(SOURCES[f]).includes("from './usePendingInvite'"), f);
  }
  // the found payload read from the function has exactly name/inviter/reason
  assertEquals(Object.keys(interpretInvitePreview({ found: true, name: 'X', inviter: 'R', reason: null, current_members: 3, num_participants: 8, stake_mode: 'cash' }, null) as object).sort(),
    ['inviter', 'kind', 'name', 'reason']);
});


Deno.test('what a screen sees: "idle" is "loading", never an answer; every other state passes through', () => {
  assertEquals(screenPreview({ kind: 'idle' }), { kind: 'loading' });
  for (const p of [{ kind: 'loading' }, { kind: 'not_found' }, { kind: 'unavailable' }, { kind: 'found', name: 'L', inviter: null, reason: null }] as const) {
    assertEquals(screenPreview(p), p);
  }
});

Deno.test('scoped store operations: clear/markTried for an OLD code are no-ops once a newer link replaced it', async () => {
  const r = rig();
  r.store.capture(CODE);
  r.store.capture('ZZZZ2222YY');
  await r.store.markTried(CODE);
  assertEquals(r.store.getSnapshot().triedJoin, false, 'markTried(old) did not mark the new invite');
  await r.store.clear(CODE);
  assertEquals(r.store.getSnapshot().code, 'ZZZZ2222YY', 'clear(old) did not wipe the new invite');
  await r.store.markTried('ZZZZ2222YY');
  assertEquals(r.store.getSnapshot().triedJoin, true);
  await r.store.clear('ZZZZ2222YY');
  assertEquals(r.store.getSnapshot().code, null);
  await r.store.clear(CODE); // clearing something that is not there is harmless
  assertEquals(r.store.getSnapshot().code, null);
});

Deno.test('race: invite A\'s run is in flight, link B replaces it, A\'s late answer neither wipes B, marks B, nor draws', async () => {
  const r = rig();
  r.store.capture(CODE);
  await tick();
  let answerJoin: (v: { data: unknown; error: unknown }) => void = () => {};
  const screen = { request: 1, drew: [] as string[] };
  // the dependency set the screen builds (app/join-league.tsx inviteDeps), over the REAL store
  const deps: InviteJoinDeps = {
    preview: () => Promise.resolve({ data: previewBody(), error: null }),
    join: () => new Promise((res) => { answerJoin = res; }),
    triedJoin: () => r.store.getSnapshot().triedJoin,
    markTried: () => r.store.markTried(CODE),
    clear: () => r.store.clear(CODE),
    isCurrent: () => screen.request === 1 && r.store.getSnapshot().code === CODE,
  };
  const run = runInviteJoin(deps, CODE);
  await tick();
  assertEquals(r.store.getSnapshot().triedJoin, true, 'A was marked tried before its join call');
  r.store.capture('ZZZZ2222YY'); // the newer link arrives while A's join is in flight
  answerJoin({ data: joined, error: null });
  assertEquals(await run, null, 'A\'s run is stale: nothing for the screen to draw');
  assertEquals(r.store.getSnapshot().code, 'ZZZZ2222YY', 'B survives');
  assertEquals(r.store.getSnapshot().triedJoin, false, 'and is not marked tried by A');
  assert(r.stored()!.includes('ZZZZ2222YY'));
});

Deno.test('race: a late refusal for A (after B replaced it) clears nothing of B either', async () => {
  const r = rig();
  r.store.capture(CODE);
  await tick();
  let answerPreview: (v: { data: unknown; error: unknown }) => void = () => {};
  const deps: InviteJoinDeps = {
    preview: () => new Promise((res) => { answerPreview = res; }),
    join: () => Promise.resolve({ data: joined, error: null }),
    triedJoin: () => r.store.getSnapshot().triedJoin,
    markTried: () => r.store.markTried(CODE),
    clear: () => r.store.clear(CODE),
    isCurrent: () => r.store.getSnapshot().code === CODE,
  };
  const run = runInviteJoin(deps, CODE);
  r.store.capture('ZZZZ2222YY');
  answerPreview({ data: previewBody({ joinable: false, reason: 'league_full' }), error: null });
  assertEquals(await run, null);
  assertEquals(r.store.getSnapshot().code, 'ZZZZ2222YY');
});

Deno.test('refusal copy: a full league after an invite LINK says "Ask whoever invited you"; a typed code keeps the commissioner wording', () => {
  const l = { name: 'Stock Scudetto', max: 8 };
  assertEquals(blockMessage('league_full', l, { invited: true }), 'Stock Scudetto is full. Ask whoever invited you if they can make room.');
  assertEquals(blockMessage('league_full', l), 'Stock Scudetto is full: 8 of 8 managers. Ask your commissioner if they can make room.');
  assertEquals(blockMessage('league_full', l, { invited: false }), blockMessage('league_full', l));
  // no other refusal changes with the flag
  for (const b of ['draft_started', 'draft_in_progress', 'already_member', 'invite_expired', 'season_completed', 'left_league', 'unknown'] as const) {
    assertEquals(blockMessage(b, l, { invited: true }), blockMessage(b, l, { invited: false }), b);
  }
  const league = { name: 'Stock Scudetto', members: 8, max: 8, stakeMode: null, notionalPerSlot: null, budgetAmount: null, leagueType: null, numWeeks: 10, durationDays: null, draftDate: null, draftStatus: 'not_started' };
  assertEquals(previewView(league, 'league_full', { invited: true }).message, 'Stock Scudetto is full. Ask whoever invited you if they can make room.');
  assertEquals(previewView(league, 'league_full').message, blockMessage('league_full', league));
  const screen = strip(SOURCES['app/join-league.tsx']);
  assert(screen.includes('previewView(league, block, { invited })') && screen.includes('const invited = inviteMode || arrivalInvite !== null;'), 'the invite flow (this screen opened for one, or one pending) uses it, and it outlives the invite being cleared');
});

// ── review round 2: decision 17 and the blast radius of a forced join ────

Deno.test('decision 17: the confirmation redirect never carries an invite code, whatever is pending', () => {
  assertEquals(buildConfirmRedirect(), 'https://fantasy-stock-app.vercel.app/auth/confirm');
  assertEquals(buildConfirmRedirect.length, 0, 'no parameter to put one in');
  for (const f of ['lib/auth/confirmLink.ts', 'lib/SessionProvider.tsx', 'app/create-account.tsx', 'app/login.tsx']) {
    assertFalse(/\?invite=|invite=\$\{/.test(SOURCES[f]), f);
  }
});

Deno.test('a FORCED join does not take over the active league: only the person\'s "Go to the league" tap does', () => {
  const league = { name: 'L', members: 1, max: 8, stakeMode: null, notionalPerSlot: null, budgetAmount: null, leagueType: null, numWeeks: 10, durationDays: null, draftDate: null, draftStatus: 'not_started' };
  const joinedRes: InviteJoinResult = { kind: 'joined', league, leagueId: 'L-1', leagueName: 'L' };
  const openedRes: InviteJoinResult = { kind: 'opened', leagueId: 'L-1' };
  assertEquals(activeLeagueNow(joinedRes), null, 'joined: nothing is switched automatically');
  assertEquals(activeLeagueOnContinue(joinedRes), 'L-1', '...the tap switches');
  assertEquals(activeLeagueNow(openedRes), 'L-1', 'a member tapping their own league\'s link: that league opens');
  assertEquals(activeLeagueOnContinue(openedRes), null);
  for (const r of [{ kind: 'bad_code' }, { kind: 'lookup_error', error: 'unreachable' }, { kind: 'refused', league, block: 'league_full' }, { kind: 'join_error', league, error: 'unreachable' }] as InviteJoinResult[]) {
    assertEquals([activeLeagueNow(r), activeLeagueOnContinue(r)], [null, null], r.kind);
  }
  const s = strip(SOURCES['app/join-league.tsx']);
  const auto = s.slice(s.indexOf('async function showInviteResult'), s.indexOf('async function runInvite'));
  assertEquals((auto.match(/setActiveLeagueId\(/g) ?? []).length, 1, 'the automatic path sets the active league in exactly one place');
  assert(auto.includes('const activeNow = activeLeagueNow(result);') && auto.includes('if (activeNow) setActiveLeagueId(activeNow);'));
  assert(auto.includes('setContinueLeagueId(activeLeagueOnContinue(result));'));
  assert(s.includes('if (continueLeagueId) setActiveLeagueId(continueLeagueId);'), 'the Joined tap');
  // W4's continuation (the notifications ask when due, then Home) comes AFTER the person's own tap makes the league active
  const joinedTap = s.slice(s.indexOf('<Joined'));
  assert(joinedTap.indexOf('setActiveLeagueId(continueLeagueId)') > 0
    && joinedTap.indexOf('setActiveLeagueId(continueLeagueId)') < joinedTap.indexOf("pushAskRouteFor('/(tabs)')"));
  assert(s.includes('setJoinedId(result.leagueId);'), 'and the facts card (W4 C1) is fed by the auto-join path too');
});

Deno.test('dismissing the join screen: cleared, EXCEPT after a join was attempted or once a newer link replaced it', () => {
  assertEquals(shouldClearOnDismiss({ code: CODE, triedJoin: false }, CODE), true);
  assertEquals(shouldClearOnDismiss({ code: CODE, triedJoin: true }, CODE), false, 'the answer may have been lost: the relaunch resolves it');
  assertEquals(shouldClearOnDismiss({ code: 'ZZZZ2222YY', triedJoin: false }, CODE), false, 'a newer link is not this screen\'s to clear');
  assertEquals(shouldClearOnDismiss({ code: null, triedJoin: false }, CODE), false);
  assertEquals(shouldClearOnDismiss({ code: CODE, triedJoin: false }, null), false);
  const s = strip(SOURCES['app/join-league.tsx']);
  assert(s.includes('shouldClearOnDismiss(pendingInvite.getSnapshot(), mounted)'));
  assert(s.includes('pendingInvite.clear(mounted as string)'));
});

Deno.test('lost answer, screen dismissed, relaunch: the invite survives and the retry reads "You\'re in"', async () => {
  // run 1: markTried, the join's answer is lost, the person closes the screen (dismissal keeps it: triedJoin)
  const r = rig();
  r.store.capture(CODE);
  await tick();
  const lost = seq({ preview: [previewBody()], join: [{ transport: 0 }] }, { markTried: () => r.store.markTried(CODE), clear: () => r.store.clear(CODE), triedJoin: () => r.store.getSnapshot().triedJoin });
  assertEquals((await runInviteJoin(lost.deps, CODE))?.kind, 'join_error');
  if (shouldClearOnDismiss(r.store.getSnapshot(), CODE)) await r.store.clear(CODE);
  assertEquals(r.store.getSnapshot().code, CODE, 'kept');
  // the app is killed; a new store loads it
  const relaunched = rig({}, r.stored());
  await relaunched.store.load();
  assertEquals([relaunched.store.getSnapshot().code, relaunched.store.getSnapshot().triedJoin], [CODE, true]);
  const retry = seq({ preview: [previewBody({ joinable: false, reason: 'already_member' })], join: [refusal('already_member', true)] },
    { triedJoin: () => relaunched.store.getSnapshot().triedJoin, clear: () => relaunched.store.clear(CODE) });
  assertEquals((await runInviteJoin(retry.deps, CODE))?.kind, 'joined', '"You\'re in", not a silent open');
});

Deno.test('markTried: a failed write is reported (false), the flag still holds in memory, and the join goes on', async () => {
  const failing = rig({ storage: { get: () => Promise.resolve(null), set: () => Promise.reject(new Error('disk')), remove: () => Promise.resolve() } });
  failing.store.capture(CODE);
  assertEquals(await failing.store.markTried(CODE), false);
  assertEquals(failing.store.getSnapshot().triedJoin, true);
  assert(failing.log.some((l) => l.startsWith('warn:')));
  const ok = rig();
  ok.store.capture(CODE);
  assertEquals(await ok.store.markTried(CODE), true);
  assertEquals(await ok.store.markTried(CODE), true, 'already marked: nothing to write');
  // the sequence does NOT gate the join on it
  const s = seq({ preview: [previewBody()], join: [joined] }, { markTried: () => Promise.resolve(false) });
  assertEquals((await runInviteJoin(s.deps, CODE))?.kind, 'joined');
  assert(strip(SOURCES['lib/invite/inviteJoin.ts']).includes('markTried(): Promise<unknown>;'));
});

Deno.test('a stale run: never a dead spinner, never navigation from a screen that is gone or buried', () => {
  const at = (mounted: boolean, spinnerShowing: boolean, focused: boolean) => staleRunExit({ mounted, spinnerShowing, focused });
  assertEquals(at(true, true, true), 'leave', 'spinner up, screen in front: pop itself');
  assertEquals(at(true, true, false), 'leave_on_focus', 'a newer invite\'s screen is on top: leave when uncovered, never pop THAT screen');
  assertEquals(at(false, true, true), 'stay', 'the person already left: router.back() would pop whatever they are on now');
  assertEquals(at(false, true, false), 'stay');
  assertEquals(at(true, false, true), 'stay', 'no spinner: the person is reading something');
  assertEquals(at(true, false, false), 'stay');
  const s = strip(SOURCES['app/join-league.tsx']);
  assert(s.includes('const exit = staleRunExit({ mounted: mountedRef.current, spinnerShowing: spinnerShowing.current, focused: navigation.isFocused() });'));
  assert(s.includes("if (exit === 'leave') leave();") && s.includes("else if (exit === 'leave_on_focus') leaveWhenUncovered.current = true;"));
  assert(s.includes('useFocusEffect('), 'the buried screen leaves the moment it is uncovered');
  assert(s.includes("spinnerShowing.current = inviteMode && step === 'code' && findStatus === 'loading';"));
  // an unmounted screen neither draws nor navigates, before AND after the league list is awaited
  const body = s.slice(s.indexOf('async function showInviteResult'), s.indexOf('async function runInvite'));
  assertEquals((body.match(/if \(!mountedRef\.current\) return;/g) ?? []).length, 2);
  assert(body.indexOf('if (!mountedRef.current) return;') < body.indexOf('if (!result) {'));
  assert(body.indexOf('await refresh();') < body.lastIndexOf('if (!mountedRef.current) return;'));
  assert(s.includes('mountedRef.current = false;'));
});

Deno.test('another person on the same phone never inherits the pending invite: any user change or sign-out clears it', () => {
  assertEquals(shouldClearInviteOnAuthChange('A', null), true, 'sign-out (from ANY phase)');
  assertEquals(shouldClearInviteOnAuthChange('A', 'B'), true, 'a different person');
  assertEquals(shouldClearInviteOnAuthChange(null, 'A'), false, 'the first sign-in: the invited friend arriving');
  assertEquals(shouldClearInviteOnAuthChange('A', 'A'), false, 'a token refresh');
  assertEquals(shouldClearInviteOnAuthChange(null, null), false);
  const s = strip(SOURCES['app/_layout.tsx']);
  assert(s.includes('const userId = user?.id ?? null;'));
  assert(s.includes('if (seen && shouldClearInviteOnAuthChange(lastUserId.current, userId)) void inviteStore.clear(seen);'));
  assert(s.includes('lastUserId.current = userId;'));
  assertFalse(s.includes("previousPhase === 'ready'"), 'the old ready -> signedOut-only rule is gone (it missed the username gate)');
});

Deno.test('invite ownership: stamped for the first person signed in with it, dropped for a different one, across a cold start too', async () => {
  assertEquals(inviteOwnerAction(null, null), 'none', 'nobody signed in');
  assertEquals(inviteOwnerAction('A', null), 'none', 'nobody signed in yet: wait');
  assertEquals(inviteOwnerAction(null, 'A'), 'claim', 'the invited friend arriving');
  assertEquals(inviteOwnerAction('A', 'A'), 'none');
  assertEquals(inviteOwnerAction('A', 'B'), 'clear', 'a different person on the same phone');

  // the hole the auth-CHANGE rule cannot see: A signed in with the invite pending, A's session ended while the app was
  // closed (so A -> signed-out was never observed), then B signs in
  const r = rig();
  r.store.capture(CODE);
  await tick();
  r.store.claim('user-A');
  await r.store.markTried(CODE);                                   // flush the write chain
  assertEquals(JSON.parse(r.stored()!).ownerUserId, 'user-A', 'the owner is persisted');
  const relaunched = rig({}, r.stored());
  await relaunched.store.load();
  const owner = relaunched.store.getSnapshot().ownerUserId;
  assertEquals(owner, 'user-A');
  assertEquals(inviteOwnerAction(owner, 'user-B'), 'clear', 'B does not inherit A\'s pending league');
  assertEquals(inviteOwnerAction(owner, 'user-A'), 'none', 'A, back after a relaunch, keeps it');

  // an invite captured while SIGNED OUT has no owner, so the friend who then signs in claims it
  const fresh = rig();
  fresh.store.capture(CODE);
  assertEquals(fresh.store.getSnapshot().ownerUserId, null);
  fresh.store.claim('friend');
  fresh.store.claim('someone-else');                               // a second claim changes nothing
  assertEquals(fresh.store.getSnapshot().ownerUserId, 'friend');
  // a NEW link starts unowned; clear() forgets the owner
  fresh.store.capture('ZZZZ2222YY');
  assertEquals(fresh.store.getSnapshot().ownerUserId, null);
  fresh.store.claim('friend');
  await fresh.store.clear();
  assertEquals(fresh.store.getSnapshot().ownerUserId, null);
  fresh.store.claim('nobody');                                     // no invite pending: nothing to stamp
  assertEquals(fresh.store.getSnapshot().ownerUserId, null);
  // hostile storage: an absurd owner id is dropped, not trusted
  const now = 1_800_000_000_000;
  const base = { v: 1, code: CODE, capturedAt: now - 1000, leagueName: 'L', triedJoin: false };
  assertEquals(parsePersisted(JSON.stringify({ ...base, ownerUserId: 'u'.repeat(65) }), now)?.ownerUserId, null);
  assertEquals(parsePersisted(JSON.stringify({ ...base, ownerUserId: 7 }), now)?.ownerUserId, null);
  assertEquals(parsePersisted(JSON.stringify({ ...base, ownerUserId: '' }), now)?.ownerUserId, null);
  assertEquals(parsePersisted(JSON.stringify(base), now)?.ownerUserId, null, 'an older stored invite has no owner');
  // wiring
  const l = strip(SOURCES['app/_layout.tsx']);
  assert(l.includes("const ownerAction = invite.loaded && invite.code ? inviteOwnerAction(invite.ownerUserId, userId) : 'none';"));
  assert(l.includes("if (ownerAction === 'claim' && userId && seen) inviteStore.claim(userId, seen);"));
  assert(l.includes("else if (ownerAction === 'clear' && seen) void inviteStore.clear(seen);"));
});

// ── decision 18: only the shared https link auto-joins ───────────────────

Deno.test('origin is decided at PARSE time: the shared https link vs everything else (dev exp:// and bare paths count as scheme)', () => {
  const o = (url: string, dev = false) => parseInviteArrival(url, dev);
  for (const url of [`https://fantasy-stock-app.vercel.app/join/${CODE}`, `https://fantasy-stock-app.vercel.app/join/${CODE}/`, `https://fantasy-stock-app.vercel.app/join/${CODE}?utm=sms`,
    `HTTPS://FANTASY-STOCK-APP.VERCEL.APP/join/${CODE}`, `  https://fantasy-stock-app.vercel.app/join/${CODE.toLowerCase()} `]) {
    assertEquals(o(url), { code: CODE, origin: 'https' }, url);
  }
  for (const url of [`fantasystockapp://join/${CODE}`, `fantasystockapp:///join/${CODE}`, `FantasyStockApp://join/${CODE}`, `fantasystockapp://join/${CODE}?x=1`]) {
    assertEquals(o(url), { code: CODE, origin: 'scheme' }, url);
  }
  assertEquals(o(`exp://192.168.1.4:8081/--/join/${CODE}`, true), { code: CODE, origin: 'scheme' }, 'Expo Go counts as scheme');
  assertEquals(o(`exps://host/--/join/${CODE}`, true), { code: CODE, origin: 'scheme' });
  assertEquals(o(`/join/${CODE}`, true), { code: CODE, origin: 'scheme' }, 'a bare dev path counts as scheme');
  // a link that is not an invite link is not an arrival at all, whatever it claims to be
  for (const url of [`https://fantasy-stock-app.vercel.app.evil.com/join/${CODE}`, `http://fantasy-stock-app.vercel.app/join/${CODE}`, `https://fantasy-stock-app.vercel.app/join/ab`, `fantasystockapp://join/ab`, '', 'https://fantasy-stock-app.vercel.app/']) {
    assertEquals(o(url), null, url);
  }
  // parseInviteLink is the same parse, code only
  assertEquals(parseInviteLink(`fantasystockapp://join/${CODE}`, false), CODE);
});

Deno.test('signed in when the link ARRIVED: observed from the auth phase, "unknown" (a cold start) settles later', () => {
  assertEquals(signedInAtArrivalFrom('ready'), true);
  assertEquals(signedInAtArrivalFrom('gated'), true, 'a session exists (the username gate)');
  assertEquals(signedInAtArrivalFrom('signedOut'), false);
  assertEquals(signedInAtArrivalFrom('unknown'), null);
});

Deno.test('who joins on their own: ONLY the shared https link; a scheme link that arrived signed in waits for the tap', () => {
  const needs = (origin: 'https' | 'scheme', signedInAtArrival: boolean | null) => inviteNeedsTap({ origin, signedInAtArrival });
  // https: zero-tap, whatever the arrival (Decision 8)
  for (const si of [true, false, null]) assertEquals(needs('https', si), false, `https ${si}`);
  // scheme + signed in at arrival: the tap
  assertEquals(needs('scheme', true), true);
  // scheme + signed out at arrival: capture, sign in, join (the same as https)
  assertEquals(needs('scheme', false), false);
  // not yet known: the cautious answer
  assertEquals(needs('scheme', null), true);
  assertEquals(inviteJoinRoute({ origin: 'https', signedInAtArrival: true }), '/join-league?invite=1');
  assertEquals(inviteJoinRoute({ origin: 'scheme', signedInAtArrival: true }), '/join-league?invite=tap');
  assertEquals(inviteJoinRoute({ origin: 'scheme', signedInAtArrival: false }), '/join-league?invite=1');
  assertEquals(INVITE_TAP_ROUTE, '/join-league?invite=tap');
  assertFalse(INVITE_TAP_ROUTE.includes(CODE));
});

Deno.test('the pending invite carries its arrival: first arrival wins (no upgrade), settled once, persisted, never self-upgrading', async () => {
  const r = rig();
  r.store.capture(CODE, { origin: 'scheme', signedInAtArrival: true });
  let s = r.store.getSnapshot();
  assertEquals([s.origin, s.signedInAtArrival], ['scheme', true]);
  r.store.capture(CODE, { origin: 'https', signedInAtArrival: false });       // the same code again, another way
  s = r.store.getSnapshot();
  assertEquals([s.origin, s.signedInAtArrival], ['scheme', true], 'nothing changes: the first arrival stands');
  // a different link is a fresh arrival
  r.store.capture('ZZZZ2222YY', { origin: 'https', signedInAtArrival: false });
  assertEquals([r.store.getSnapshot().origin, r.store.getSnapshot().signedInAtArrival], ['https', false]);
  // without an arrival: the cautious kind
  const bare = rig();
  bare.store.capture(CODE);
  assertEquals([bare.store.getSnapshot().origin, bare.store.getSnapshot().signedInAtArrival], ['scheme', null]);
  // a cold-start arrival (unknown) is settled ONCE, at the first resolved phase
  const cold = rig();
  cold.store.capture(CODE, { origin: 'scheme', signedInAtArrival: null });
  cold.store.settleArrival(true);
  cold.store.settleArrival(false);
  assertEquals(cold.store.getSnapshot().signedInAtArrival, true, 'a second settle changes nothing');
  await cold.store.markTried(CODE);                                           // flush the write chain
  const saved = JSON.parse(cold.stored()!);
  assertEquals([saved.origin, saved.signedInAtArrival], ['scheme', true]);
  const back = rig({}, cold.stored());
  await back.store.load();
  assertEquals([back.store.getSnapshot().origin, back.store.getSnapshot().signedInAtArrival], ['scheme', true]);
  // storage can never upgrade an invite to https, and junk reads as the cautious values
  const now = 1_800_000_000_000;
  const base = { v: 1, code: CODE, capturedAt: now - 1000, leagueName: 'L', triedJoin: false };
  for (const origin of [undefined, null, 'HTTPS', 'http', 7, {}, '']) assertEquals(parsePersisted(JSON.stringify({ ...base, origin }), now)?.origin, 'scheme', String(origin));
  assertEquals(parsePersisted(JSON.stringify({ ...base, origin: 'https' }), now)?.origin, 'https');
  for (const si of [undefined, null, 'true', 1, {}]) assertEquals(parsePersisted(JSON.stringify({ ...base, signedInAtArrival: si }), now)?.signedInAtArrival, null, String(si));
  // clear() forgets it
  await r.store.clear();
  assertEquals([r.store.getSnapshot().origin, r.store.getSnapshot().signedInAtArrival], ['scheme', null]);
  r.store.settleArrival(true);                                                // nothing pending: nothing to settle
  assertEquals(r.store.getSnapshot().signedInAtArrival, null);
});

Deno.test('TAP MODE never joins: scheme + signed in -> preview only; https + signed in -> the join is called', async () => {
  // the whole decision: parse -> arrival -> route -> sequence, counting the join calls
  const arrive = (url: string, phase: 'ready' | 'signedOut' | 'gated', dev = false) => {
    const a = parseInviteArrival(url, dev)!;
    return { origin: a.origin, signedInAtArrival: signedInAtArrivalFrom(phase) };
  };
  const run = async (arrival: { origin: 'https' | 'scheme'; signedInAtArrival: boolean | null }) => {
    const { state, deps } = seq({ preview: [previewBody()], join: [joined] });
    const tap = inviteNeedsTap(arrival);
    const res = tap ? await runInvitePreviewOnly(deps, CODE) : await runInviteJoin(deps, CODE);
    return { tap, res, state };
  };
  // https + signed in: zero-tap join
  let r = await run(arrive(`https://fantasy-stock-app.vercel.app/join/${CODE}`, 'ready'));
  assertEquals([r.tap, r.res?.kind, r.state.joins, r.state.markTried], [false, 'joined', 1, 1]);
  // scheme + signed in: the preview, NO join, NO triedJoin
  r = await run(arrive(`fantasystockapp://join/${CODE}`, 'ready'));
  assertEquals([r.tap, r.res?.kind, r.state.joins, r.state.markTried, r.state.cleared], [true, 'preview', 0, 0, 0]);
  assertEquals((r.res as { block: unknown }).block, null, 'joinable: the preview\'s Join button waits');
  // scheme + the username gate (a session exists): the same
  r = await run(arrive(`fantasystockapp://join/${CODE}`, 'gated'));
  assertEquals([r.tap, r.state.joins], [true, 0]);
  // dev exp:// counts as scheme
  r = await run(arrive(`exp://192.168.1.4:8081/--/join/${CODE}`, 'ready', true));
  assertEquals([r.tap, r.res?.kind, r.state.joins], [true, 'preview', 0]);
  // scheme + SIGNED OUT at arrival: capture, sign in, then it joins like https
  r = await run(arrive(`fantasystockapp://join/${CODE}`, 'signedOut'));
  assertEquals([r.tap, r.res?.kind, r.state.joins], [false, 'joined', 1]);
});

Deno.test('TAP MODE: every answer is shown, nothing is silently done, and the invite is kept only while it waits', async () => {
  const tapRun = async (preview: unknown) => {
    const { state, deps } = seq({ preview: [preview], join: [joined] });
    return { res: await runInvitePreviewOnly(deps, CODE), state };
  };
  // already a member: the existing Open button (a tap), the invite waits, nothing opened or switched
  let t = await tapRun(previewBody({ joinable: false, reason: 'already_member' }));
  assertEquals([t.res?.kind, (t.res as { block: string }).block, t.state.joins, t.state.cleared], ['preview', 'already_member', 0, 0]);
  // a refusal: shown, and cleared (nothing left to wait for), like the automatic run
  t = await tapRun(previewBody({ joinable: false, reason: 'league_full' }));
  assertEquals([t.res?.kind, (t.res as { block: string }).block, t.state.joins, t.state.cleared], ['preview', 'league_full', 0, 1]);
  // no such league: the line under the field, cleared
  t = await tapRun({ found: false });
  assertEquals([t.res?.kind, t.state.cleared], ['bad_code', 1]);
  // the lookup fails on the wire: kept, error shown, no loop
  const failing = seq({ preview: [{ transport: 500 }], join: [joined] });
  assertEquals([(await runInvitePreviewOnly(failing.deps, CODE))?.kind, failing.state.cleared, failing.state.previews, failing.state.joins], ['lookup_error', 0, 1, 0]);
  // stale
  const stale = seq({ preview: [previewBody()], join: [joined] }, { isCurrent: () => false });
  assertEquals(await runInvitePreviewOnly(stale.deps, CODE), null);
  assertEquals(stale.state.cleared + stale.state.joins + stale.state.markTried, 0);
  // the person's tap then joins through the SAME sequence as always: triedJoin first, then join, Joined, tap for the league
  const tapJoin = seq({ preview: [previewBody()], join: [joined] });
  const preview = (await runInvitePreviewOnly(tapJoin.deps, CODE)) as { league: typeof LEAGUE };
  await tapJoin.deps.markTried();
  const done = await completeInviteJoin(tapJoin.deps, CODE, preview.league, 'join');
  assertEquals(done?.kind, 'joined');
  assertEquals(activeLeagueNow(done!), null, 'no active-league switch until the Joined tap');
  assertEquals(activeLeagueOnContinue(done!), 'L-1');
});

Deno.test('tap mode wiring: native-intent records the arrival, the layout routes by it, the screen waits', () => {
  const n = strip(SOURCES['app/+native-intent.tsx']);
  assert(n.includes('origin: invite.origin') && n.includes('signedInAtArrival: live.signedIn') && n.includes('userIdAtArrival: live.userId'));
  assert(n.includes('const live = getLiveSession();'));
  assertFalse(n.includes('pendingRoute.phase'), 'the layout\'s phase lags a sign-in; the arrival is read live');
  const l = strip(SOURCES['app/_layout.tsx']);
  assert(l.includes('const arrivalSettled = invite.origin === \'https\' || invite.signedInAtArrival !== null;'));
  assert(l.includes('inviteStore.settleArrival(getLiveSession().signedIn ?? signedInAtArrivalFrom(shownPhase) === true);'));
  assert(l.includes("shownPhase !== 'unknown'"));
  const j = strip(SOURCES['app/join-league.tsx']);
  assert(j.includes("const tapMode = screenMode === 'tap';"));
  assert(j.includes("inviteScreenMode(inviteParam, pendingInvite.getSnapshot())"));
  assert(j.includes('showInviteTapResult(await runInvitePreviewOnly(inviteDeps(inviteCode), inviteCode));'));
  // the tap-mode branch comes before the automatic run, and returns
  const run = j.slice(j.indexOf('async function runInvite('));
  assert(run.includes('if (tapMode) {'), 'the tap-mode branch exists');
  assert(run.indexOf('if (tapMode) {') >= 0 && run.indexOf('if (tapMode) {') < run.indexOf('runInviteJoin(inviteDeps(inviteCode), inviteCode)'));
  assert(/if \(tapMode\) \{\s*showInviteTapResult\([^;]*;\s*return;\s*\}/.test(run), 'and it returns before the automatic run');
  // tap mode draws the preview only: it sets no active league and joins nothing itself
  const draw = j.slice(j.indexOf('function showInviteTapResult'), j.indexOf('async function showInviteResult'));
  assertFalse(/setActiveLeagueId|callJoin|markTried|router\./.test(draw), 'showInviteTapResult only draws');
});

// ── the route param is NEVER trusted for the mode (review: a forged ?invite=1 deep link) ──

Deno.test('the join screen\'s mode comes from the stored invite, not from the router param: ?invite=1 cannot force zero-tap', () => {
  const inv = (o: Partial<{ code: string | null; origin: 'https' | 'scheme'; signedInAtArrival: boolean | null; autoOpenedCode: string | null }> = {}) =>
    ({ code: CODE, origin: 'https' as const, signedInAtArrival: true, autoOpenedCode: CODE, ...o });
  // the legitimate openings
  assertEquals(inviteScreenMode('1', inv()), 'auto', 'https, opened by the layout');
  assertEquals(inviteScreenMode('1', inv({ origin: 'scheme', signedInAtArrival: false })), 'auto', 'scheme tapped signed out');
  assertEquals(inviteScreenMode('tap', inv({ origin: 'scheme', signedInAtArrival: true })), 'tap');
  // THE EXPLOIT: another app fires fantasystockapp://join/<CODE> (tap screen), then fantasystockapp://join-league?invite=1
  assertEquals(inviteScreenMode('1', inv({ origin: 'scheme', signedInAtArrival: true })), 'tap', 'a pending scheme invite stays tap, whatever the param says');
  assertEquals(inviteScreenMode('1', inv({ origin: 'scheme', signedInAtArrival: null })), 'tap', 'an unsettled arrival too');
  // an invite the layout did NOT open (no autoOpenedCode) is never auto-run by a forged link
  assertEquals(inviteScreenMode('1', inv({ autoOpenedCode: null })), 'tap');
  assertEquals(inviteScreenMode('1', inv({ autoOpenedCode: 'OTHER22222' })), 'tap');
  // the param never decides the mode either way: '?invite=tap' on an auto-eligible invite is still 'auto'
  assertEquals(inviteScreenMode('tap', inv()), 'auto');
  // not an invite screen at all
  for (const param of [undefined, '', '0', 'auto', 'TAP', '1 ', 'true']) assertEquals(inviteScreenMode(param, inv()), 'none', String(param));
  assertEquals(inviteScreenMode('1', inv({ code: null })), 'none', 'no pending invite');
});

Deno.test('forged ?invite=1 against a pending scheme invite: the screen runs the tap sequence, which never calls join', async () => {
  const pending = { code: CODE, origin: 'scheme' as const, signedInAtArrival: true as boolean | null, autoOpenedCode: CODE as string | null };
  const mode = inviteScreenMode('1', pending);
  assertEquals(mode, 'tap');
  const { state, deps } = seq({ preview: [previewBody()], join: [joined] });
  const res = mode === 'tap' ? await runInvitePreviewOnly(deps, CODE) : await runInviteJoin(deps, CODE);
  assertEquals([res?.kind, state.joins, state.markTried], ['preview', 0, 0]);
});

Deno.test('an EXTERNAL link to join-league loses its invite param; every other link is left alone', () => {
  assertEquals(stripInviteParam('fantasystockapp://join-league?invite=1'), 'fantasystockapp://join-league');
  assertEquals(stripInviteParam('fantasystockapp://join-league?invite=tap'), 'fantasystockapp://join-league');
  assertEquals(stripInviteParam('/join-league?invite=1'), '/join-league');
  assertEquals(stripInviteParam('/join-league/?invite=1'), '/join-league/');
  assertEquals(stripInviteParam('/(tabs)/join-league?invite=1'), '/(tabs)/join-league');
  assertEquals(stripInviteParam('exp://192.168.1.4:8081/--/join-league?invite=1'), 'exp://192.168.1.4:8081/--/join-league');
  assertEquals(stripInviteParam('/join-league?x=2&invite=1&y=3'), '/join-league?x=2&y=3', 'only the invite key goes');
  assertEquals(stripInviteParam('/join-league?invite=1#frag'), '/join-league#frag');
  assertEquals(stripInviteParam('/join-league?inv%69te=1'), '/join-league', 'an escaped spelling is decoded and removed');
  assertEquals(stripInviteParam('/join-league?invite=1&invite=tap'), '/join-league', 'repeated');
  // untouched
  for (const p of ['/join-league', '/join-league?x=1', '/league-settings?invite=1', '/matchup', `fantasystockapp://join/${CODE}`, '/join-league-x?invite=1', '/xjoin-league?invite=1', '', '/?invite=1']) {
    assertEquals(stripInviteParam(p), p, p);
  }
  const n = strip(SOURCES['app/+native-intent.tsx']);
  assert(n.includes('return stripInviteParam(path);'), 'the fall-through return strips it');
  assertFalse(/return path;/.test(n), 'no un-stripped fall-through');
});

Deno.test('tap-mode "Open the league" (the person\'s tap) clears the invite, so a tried one does not re-open the screen every launch', () => {
  const j = strip(SOURCES['app/join-league.tsx']);
  const open = j.slice(j.indexOf('async function open()'), j.indexOf('// DEV captures only'));
  assert(open.includes('if (inviteMode) void pendingInvite.clear(trimmed.toUpperCase());'));
  assert(open.indexOf('setActiveLeagueId(id)') < open.indexOf('pendingInvite.clear('));
});

// ── review round 3: the arrival is read LIVE; an invite owned by somebody else is replaced; scoped clears ──

Deno.test('the arrival reads the LIVE session, not the layout\'s lagging phase: a scheme link fired mid sign-in is "signed in"', () => {
  resetLiveSession();
  assertEquals(getLiveSession(), { signedIn: null, userId: null }, 'nothing known yet (a cold start)');
  // the layout\'s phase still says signed out while the profile reads and the button holds (~1 s) ...
  const route = createPendingRoute();
  route.authChanged('signedOut');
  // ... but supabase has already announced the session, and SessionProvider published it synchronously
  setLiveSession('user-A');
  assertEquals(getLiveSession(), { signedIn: true, userId: 'user-A' });
  const arrival = parseInviteArrival(`fantasystockapp://join/${CODE}`, false)!;
  const live = getLiveSession();
  const recorded = { origin: arrival.origin, signedInAtArrival: live.signedIn };
  assertEquals(recorded, { origin: 'scheme', signedInAtArrival: true });
  assertEquals(inviteNeedsTap(recorded), true, 'tap mode: no silent join in that window');
  // a definite sign-out is the only thing that stores false
  setLiveSession(null);
  assertEquals(getLiveSession(), { signedIn: false, userId: null });
  assertEquals(inviteNeedsTap({ origin: 'scheme', signedInAtArrival: getLiveSession().signedIn }), false, 'signed out at arrival: capture, sign in, join');
  resetLiveSession();
  // SessionProvider publishes from supabase\'s own events, ahead of React state
  const sp = strip(SOURCES['lib/SessionProvider.tsx']);
  const getSessionPart = sp.slice(sp.indexOf('supabase.auth.getSession().then'), sp.indexOf('const { data: { subscription } }'));
  assert(getSessionPart.includes('setLiveSession(session?.user?.id ?? null);'));
  assert(getSessionPart.indexOf('setLiveSession(') < getSessionPart.indexOf('setSession(session)'), 'before the React state');
  const authPart = sp.slice(sp.indexOf('supabase.auth.onAuthStateChange'), sp.indexOf('Register for push notifications on sign in'));
  assert(authPart.includes('setLiveSession(session?.user?.id ?? null);'));
  assert(authPart.indexOf('setLiveSession(') < authPart.indexOf('setSession(prev'), 'before the React state');
  assert(sp.includes('setLiveSession(null);'), 'the dev fixture\'s sign-out too');
  // the layout's cold-start settle prefers it too
  assert(strip(SOURCES['app/_layout.tsx']).includes('getLiveSession().signedIn ?? signedInAtArrivalFrom(shownPhase) === true'));
});

Deno.test('the same link tapped by somebody OTHER than the stored owner REPLACES the invite (a fresh invite for them)', async () => {
  assertEquals(inviteOwnedByOther(null, { signedInAtArrival: true, userIdAtArrival: 'B' }), false, 'unowned: idempotent');
  assertEquals(inviteOwnedByOther('A', { signedInAtArrival: true, userIdAtArrival: 'A' }), false, 'the owner themselves');
  assertEquals(inviteOwnedByOther('A', { signedInAtArrival: true, userIdAtArrival: 'B' }), true, 'a different signed-in person');
  assertEquals(inviteOwnedByOther('A', { signedInAtArrival: false }), true, 'a definite signed-out arrival is not the owner');
  assertEquals(inviteOwnedByOther('A', { signedInAtArrival: null }), false, 'unknown (cold start): the double delivery stays idempotent');
  assertEquals(inviteOwnedByOther('A', undefined), false);
  assertEquals(inviteOwnedByOther('A', { signedInAtArrival: true, userIdAtArrival: null }), false, 'no user id to compare');

  const r = rig();
  r.store.capture(CODE, { origin: 'scheme', signedInAtArrival: false, userIdAtArrival: null });
  r.store.claim('A');
  await r.store.markTried(CODE);
  assertEquals([r.store.getSnapshot().ownerUserId, r.store.getSnapshot().triedJoin], ['A', true]);
  // the owner taps it again (the cold-start double delivery, or a re-tap): nothing changes
  r.store.capture(CODE, { origin: 'https', signedInAtArrival: true, userIdAtArrival: 'A' });
  assertEquals([r.store.getSnapshot().ownerUserId, r.store.getSnapshot().triedJoin, r.store.getSnapshot().origin], ['A', true, 'scheme']);
  // B is signed in and taps the SAME link: A's invite is replaced, B's tap is fresh
  r.store.capture(CODE, { origin: 'https', signedInAtArrival: true, userIdAtArrival: 'B' });
  const s = r.store.getSnapshot();
  assertEquals([s.code, s.ownerUserId, s.triedJoin, s.origin, s.signedInAtArrival, s.autoOpenedCode], [CODE, null, false, 'https', true, null]);
  r.store.claim('B');
  assertEquals(r.store.getSnapshot().ownerUserId, 'B', 'and B claims it');
});

Deno.test('the layout\'s clears are scoped to the code the render saw, so a link captured in between is not wiped', async () => {
  const l = strip(SOURCES['app/_layout.tsx']);
  assert(l.includes('renderedInviteCode.current = invite.code;'));
  assert(l.includes('if (seen && shouldClearInviteOnAuthChange(lastUserId.current, userId)) void inviteStore.clear(seen);'));
  assert(l.includes("else if (ownerAction === 'clear' && seen) void inviteStore.clear(seen);"));
  assertFalse(/inviteStore\.clear\(\)/.test(l), 'no unscoped clear left in the layout');
  // the behaviour they rely on: clear(seen) is a no-op once a newer link replaced the invite
  const r = rig();
  r.store.capture(CODE);
  const seen = r.store.getSnapshot().code!;                       // the render saw CODE ...
  r.store.capture('ZZZZ2222YY');                                  // ... a newer link arrives before the effect runs
  await r.store.clear(seen);
  assertEquals(r.store.getSnapshot().code, 'ZZZZ2222YY');
});

Deno.test('comments no longer say the confirmation email carries the scheme link or an invite', () => {
  for (const f of ['lib/SessionProvider.tsx', 'lib/auth/authLink.ts', 'lib/auth/confirmLink.ts', 'components/shell/ConfirmEmailSent.tsx']) {
    const raw = SOURCES[f];
    assertFalse(/returns into the app with a one-time code/.test(raw), f);
    assertFalse(/link returns into the app/.test(raw), f);
    assertFalse(/\?invite=<CODE>/.test(raw), f);
  }
  assert(SOURCES['lib/auth/authLink.ts'].includes('https://<domain>/auth/confirm?code=<one-time code>'));
  assert(SOURCES['lib/SessionProvider.tsx'].includes('carries no invite code'));
});

Deno.test('claim is scoped to the code the render saw, and the dev fixture sign-in publishes the live session too', () => {
  const r = rig();
  r.store.capture(CODE);
  r.store.capture('ZZZZ2222YY');                                  // a newer link arrived between the render and its effect
  r.store.claim('A', CODE);
  assertEquals(r.store.getSnapshot().ownerUserId, null, 'the stale claim is a no-op: the newer link is its own tap\'s');
  r.store.claim('A', 'ZZZZ2222YY');
  assertEquals(r.store.getSnapshot().ownerUserId, 'A');
  const sp = strip(SOURCES['lib/SessionProvider.tsx']);
  const fixtureSignIn = sp.slice(sp.indexOf('const signIn = useCallback'), sp.indexOf('return { error: null };', sp.indexOf('const signIn = useCallback')));
  assert(fixtureSignIn.includes('setLiveSession(FIXTURE_USER.id);'));
});

// ── W3 x W4: what the function really returns, through my reader and the hook's mapping, into W4's arrival ──

Deno.test('the signed-out arrival renders from the real wire answers: found, every refusal, not found, unavailable', async () => {
  // the store, fed by a fake invite-preview exactly as the app does (reader -> store -> screenPreview -> arrivalView)
  const show = async (data: unknown, error: unknown = null) => {
    const r = rig({ fetchPreview: () => Promise.resolve(interpretInvitePreview(data, error)) });
    r.store.capture(CODE);
    await tick();
    return arrivalView({ preview: screenPreview(r.store.getSnapshot().preview) });
  };
  // joinable, with the inviter: "{inviter} invited you to {league}", the buttons
  let v = await show({ found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason: null });
  assertEquals([v.title, v.canJoin, v.refusal, v.retry], ['Roberto invited you to Stock Scudetto', true, null, false]);
  // no inviter: "You're invited to {league}"
  v = await show({ found: true, name: 'Stock Scudetto', inviter: null, reason: null });
  assertEquals([v.title, v.canJoin], ["You're invited to Stock Scudetto", true]);
  // the three refusals the function can send
  v = await show({ found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason: 'league_full' });
  assertEquals([v.refusal, v.canJoin], [INVITE_COPY.full('Stock Scudetto'), false]);
  for (const reason of ['draft_started', 'season_completed']) {
    v = await show({ found: true, name: 'Stock Scudetto', inviter: 'Roberto', reason });
    assertEquals([v.refusal, v.canJoin], [INVITE_COPY.closed('Stock Scudetto'), false], reason);
  }
  // an unknown / expired / revoked / malformed code: the function answers {found:false}, the SAME dead link (no heading)
  v = await show({ found: false });
  assertEquals([v.title, v.refusal, v.canJoin], [null, INVITE_COPY.dead, false]);
  // a newer server's unknown reason is 'unavailable' in my reader (never guessed at): the generic heading and a retry
  v = await show({ found: true, name: 'Stock Scudetto', inviter: 'R', reason: 'a_future_reason' });
  assertEquals([v.title, v.canJoin, v.retry], ["You're invited to a league", true, true]);
  // 429 (every cause, incl. contention and a missing salt), 5xx, a network error, an unparseable body, the function not deployed
  for (const [data, error] of [
    [null, { context: { status: 429 } }], [null, { context: { status: 500 } }], [null, new Error('network')], ['<html>', null], [null, null], [{ error: 'rate_limited' }, null],
  ] as [unknown, unknown][]) {
    v = await show(data, error);
    assertEquals([v.title, v.canJoin, v.retry, v.refusal], ["You're invited to a league", true, true, null], JSON.stringify([data, error]));
  }
  // and while the answer is still on its way (or nothing was asked yet), the generic heading without a retry
  const loading = arrivalView({ preview: screenPreview({ kind: 'idle' }) });
  assertEquals([loading.title, loading.retry, loading.unreachable], ["You're invited to a league", false, null]);
});
