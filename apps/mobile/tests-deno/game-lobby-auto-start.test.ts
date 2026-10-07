/**
 * The pre-draft lobby on auto-start (3c-2), source guards: no manual Start
 * anywhere; the cards come from lobbyView; the start request goes through
 * startKickOutcome and only in the "starting" phase; the new time's save checks
 * its row and maps the server's refusals. The logic lives in the shared hook
 * (useDraftAutoStart), which Home uses too. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import lobbySrc from '../app/(tabs)/league.tsx' with { type: 'text' };
import draftLobbySrc from '../components/game/DraftLobby.tsx' with { type: 'text' };
import hookSrc from '../lib/game/useDraftAutoStart.ts' with { type: 'text' };
import blockersSrc from '../components/game/AutoStartBlockers.tsx' with { type: 'text' };

const lobby = lobbySrc.slice(lobbySrc.indexOf('function LeagueLobby('));
const lobbyBody = lobby.slice(0, lobby.indexOf('\nfunction '));

Deno.test('no manual Start: the button, the confirm and its state are gone', () => {
  assertEquals(lobbySrc.includes('Start the draft'), false);
  assertEquals(lobbySrc.includes('StartDraftConfirm'), false);
  assertEquals(lobbyBody.includes('confirming'), false);
  assertEquals(lobbyBody.includes('setConfirming'), false);
});

Deno.test('the lobby runs on the shared hook, and only the lobby asks the server to start', () => {
  assertEquals(lobbyBody.includes('useDraftAutoStart(leagueId, { kick: true })'), true);
});

Deno.test('the hook: the phase from the server state on the server clock; the cards from lobbyView', () => {
  assertEquals(hookSrc.includes('lobbyPhase(ds, serverNow)'), true);
  assertEquals(hookSrc.includes('lobbyView(phase, ds.isCommissioner, fixable.length)'), true);
  assertEquals(hookSrc.includes('phoneNow + ds.serverOffsetMs'), true);
});

Deno.test('the start request: only with kick on, only when lobbyView says kick, once per draft time, through startKickOutcome', () => {
  assertEquals(hookSrc.includes('if (!opts.kick || !view?.kick || !ds.startsAt || kickedFor.current === ds.startsAt) return;'), true);
  // Through readFunctionRefusal (the reason survives a non-2xx), then startKickOutcome.
  assertEquals(hookSrc.includes('const r = await readFunctionRefusal(res, error);'), true);
  assertEquals(hookSrc.includes('startKickOutcome('), true);
  assertEquals((hookSrc.match(/action: 'start'/g) ?? []).length, 1);
  assertEquals((lobbySrc.match(/action: 'start'/g) ?? []).length, 0);
});

Deno.test("a postponed draft's new time checks its row and maps the refusals", () => {
  assertEquals(hookSrc.includes('updatedOneRow(res)'), true);
  assertEquals(hookSrc.includes('draftTimeRefusal(res.error) ?? (opts.firstTime ? DRAFT_TIME_NOT_SAVED : NEW_TIME_NOT_SAVED)'), true);
  // Ruling B: the sheet holds the time; "Set draft time" hands it to the save.
  assertEquals(hookSrc.includes('const saveDraftTime = async (date: Date, opts: { firstTime?: boolean } = {}) => {'), true);
  assertEquals(blockersSrc.includes('onConfirm={(d) => void f.saveDraftTime(d)}'), true);
});

Deno.test('the old countdown card in DraftLobby is off in the lobby (the auto-start card replaces it)', () => {
  assertEquals(lobbyBody.includes('showCountdown={false}'), true);
  assertEquals(draftLobbySrc.includes('showCountdown = true'), true);
});
