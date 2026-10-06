/**
 * Home's pre-draft card on draft auto-start (3c-2), source guards: it runs on
 * the SAME hook and view as the League tab's lobby (so the two never
 * disagree), never asks the server to start, and has no countdown of its own.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import homeSrc from '../components/home/PreDraftCard.tsx' with { type: 'text' };

Deno.test('Home uses the shared auto-start hook, without the start request', () => {
  assertEquals(homeSrc.includes('useDraftAutoStart(leagueId, { kick: false })'), true);
  assertEquals(homeSrc.includes("action: 'start'"), false);
});

Deno.test('Home\'s cards come from homeView (lobbyView), the clock from countdownCopy / startClock', () => {
  assertEquals(homeSrc.includes('homeView(phase, ds.isCommissioner, auto.fixable.length)'), true);
  assertEquals(homeSrc.includes('countdownCopy(view.countdown, startsAt, serverNow)'), true);
});

Deno.test('no second countdown logic on Home: the old minute tick and countdownLabel are gone', () => {
  assertEquals(homeSrc.includes('countdownLabel'), false);
  assertEquals(homeSrc.includes('60_000'), false);
});

Deno.test('the commissioner\'s blockers card on Home is the lobby\'s (AutoStartBlockers)', () => {
  assertEquals(homeSrc.includes('<AutoStartBlockers'), true);
});
