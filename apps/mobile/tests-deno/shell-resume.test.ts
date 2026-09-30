/**
 * Hermetic tests for the signed-out deep-link guard's resume logic
 * (Phase 3b-1, spec gate criterion 9): lib/shell/resumeTarget.ts decides
 * WHICH incoming links may be resumed after sign-in, and
 * lib/shell/pendingRoute.ts decides WHEN.
 *
 *   cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { resolveResumeTarget } from '../lib/shell/resumeTarget.ts';
import { createPendingRoute } from '../lib/shell/pendingRoute.ts';

// ── resolveResumeTarget: which links ──────────────────────────────────────

Deno.test('resume target: the three guard-proof deep links, in every URL shape', () => {
  for (const route of ['create-league', 'join-league', 'trade-history']) {
    assertEquals(resolveResumeTarget(`fantasystockapp:///${route}`), `/${route}`);
    assertEquals(resolveResumeTarget(`fantasystockapp://${route}`), `/${route}`); // host form
    assertEquals(resolveResumeTarget(`exp://127.0.0.1:8081/--/${route}`), `/${route}`); // Expo Go
    assertEquals(resolveResumeTarget(`/${route}`), `/${route}`); // already a path
  }
});

Deno.test('resume target: tab routes, with and without the (tabs) group', () => {
  assertEquals(resolveResumeTarget('fantasystockapp:///matchup'), '/matchup');
  assertEquals(resolveResumeTarget('fantasystockapp:///(tabs)/league'), '/league');
  assertEquals(resolveResumeTarget('/(tabs)/portfolio'), '/portfolio');
});

Deno.test('resume target: only the params a route actually reads survive', () => {
  assertEquals(
    resolveResumeTarget('fantasystockapp:///league-settings?leagueId=abc-123&evil=1'),
    '/league-settings?leagueId=abc-123'
  );
  assertEquals(
    resolveResumeTarget('/player-portfolio?userId=u1&username=roberto_b'),
    '/player-portfolio?userId=u1&username=roberto_b'
  );
  // A route that reads no params drops them all.
  assertEquals(resolveResumeTarget('/trade-history?foo=bar'), '/trade-history');
});

Deno.test('resume target: auth screens, recovery links and the root are never resumed', () => {
  for (const url of [
    'fantasystockapp:///login',
    'fantasystockapp:///forgot-password',
    'fantasystockapp:///reset-password?rn=abc#access_token=x&refresh_token=y',
    'fantasystockapp:///reset-password?status=invalid',
    'fantasystockapp:///pick-username',
    'fantasystockapp:///',
    'fantasystockapp://',
    '/',
    '',
  ]) {
    assertEquals(resolveResumeTarget(url), null, url);
  }
});

Deno.test('resume target: unknown routes, web URLs and traversal are rejected', () => {
  for (const url of [
    'https://evil.example/create-league',
    'http://127.0.0.1/create-league',
    'fantasystockapp:///create-league/../../etc',
    'fantasystockapp:///design-gallery',
    'fantasystockapp:///modal',
    'fantasystockapp:///create-leaguex',
    'javascript:alert(1)',
    'fantasystockapp:////create-league', // an empty segment is not normalised away
  ]) {
    assertEquals(resolveResumeTarget(url), null, url);
  }
});

// ── createPendingRoute: when ──────────────────────────────────────────────

Deno.test('pending route: signed-out link resumes exactly once on sign-in', () => {
  const p = createPendingRoute();
  assertEquals(p.authChanged('signedOut'), null);
  p.record('fantasystockapp:///create-league');
  assertEquals(p.peek(), '/create-league');
  assertEquals(p.authChanged('ready'), '/create-league');
  assertEquals(p.peek(), null); // consumed
  assertEquals(p.authChanged('ready'), null); // not replayed
});

Deno.test('pending route: resumes after the username gate, not before', () => {
  const p = createPendingRoute();
  p.authChanged('signedOut');
  p.record('/trade-history');
  assertEquals(p.authChanged('gated'), null); // pick-username first
  assertEquals(p.peek(), '/trade-history');
  assertEquals(p.authChanged('ready'), '/trade-history');
});

Deno.test('pending route: a cold-start link while ALREADY signed in is not replayed', () => {
  // The router opens it natively; replaying would push it a second time.
  const p = createPendingRoute();
  p.record('fantasystockapp:///create-league'); // arrives while auth is 'unknown'
  assertEquals(p.authChanged('ready'), null);
  assertEquals(p.peek(), null);
});

Deno.test('pending route: a cold-start link while signed out IS kept for sign-in', () => {
  const p = createPendingRoute();
  p.record('fantasystockapp:///join-league'); // 'unknown'
  assertEquals(p.authChanged('signedOut'), null);
  assertEquals(p.authChanged('ready'), '/join-league');
});

Deno.test('pending route: a cold-start link with a NULL username resumes after the gate', () => {
  const p = createPendingRoute();
  p.record('/create-league'); // 'unknown'
  assertEquals(p.authChanged('gated'), null);
  assertEquals(p.authChanged('ready'), '/create-league');
});

Deno.test('pending route: links while signed in are ignored; rejected links store nothing', () => {
  const p = createPendingRoute();
  p.authChanged('ready');
  p.record('/create-league');
  assertEquals(p.peek(), null);
  p.authChanged('signedOut');
  p.record('fantasystockapp:///reset-password?status=invalid');
  assertEquals(p.peek(), null);
});

Deno.test('pending route: the latest link wins, and signing out after a resume starts clean', () => {
  const p = createPendingRoute();
  p.authChanged('signedOut');
  p.record('/create-league');
  p.record('/join-league');
  assertEquals(p.authChanged('ready'), '/join-league');
  assertEquals(p.authChanged('signedOut'), null);
  assertEquals(p.peek(), null);
  assertEquals(p.authChanged('ready'), null);
});

Deno.test('pending route: a rejected link does not erase a valid pending one', () => {
  const p = createPendingRoute();
  p.authChanged('signedOut');
  p.record('/create-league');
  p.record('https://evil.example/x');
  assertEquals(p.peek(), '/create-league');
});
