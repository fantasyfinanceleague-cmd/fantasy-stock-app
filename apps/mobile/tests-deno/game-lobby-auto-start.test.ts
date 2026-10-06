/**
 * The pre-draft lobby on auto-start (3c-2), source guards: no manual Start
 * anywhere; the cards come from lobbyView; the start request goes through
 * startKickOutcome and only in the "starting" phase; the new time's save checks
 * its row and maps the server's refusals. Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import lobbySrc from '../app/(tabs)/league.tsx' with { type: 'text' };
import draftLobbySrc from '../components/game/DraftLobby.tsx' with { type: 'text' };

const lobby = lobbySrc.slice(lobbySrc.indexOf('function LeagueLobby('));
const lobbyBody = lobby.slice(0, lobby.indexOf('\nfunction '));

Deno.test('no manual Start: the button, the confirm and its state are gone', () => {
  assertEquals(lobbySrc.includes('Start the draft'), false);
  assertEquals(lobbySrc.includes('StartDraftConfirm'), false);
  assertEquals(lobbyBody.includes('confirming'), false);
  assertEquals(lobbyBody.includes('setConfirming'), false);
});

Deno.test('the cards come from lobbyView, the phase from the server state on the server clock', () => {
  assertEquals(lobbyBody.includes('lobbyPhase(ds, serverNow)'), true);
  assertEquals(lobbyBody.includes('lobbyView(phase, ds.isCommissioner, fixableBlockers(ds.blockers).length)'), true);
  assertEquals(lobbyBody.includes('phoneNow + ds.serverOffsetMs'), true);
});

Deno.test('the start request: only when lobbyView says kick, once per draft time, through startKickOutcome', () => {
  assertEquals(lobbyBody.includes("if (!view?.kick || !ds.startsAt || kickedFor.current === ds.startsAt) return;"), true);
  assertEquals(lobbyBody.includes('startKickOutcome(res)'), true);
  assertEquals((lobbyBody.match(/action: 'start'/g) ?? []).length, 1);
});

Deno.test("a postponed draft's new time checks its row and maps the refusals", () => {
  assertEquals(lobbyBody.includes('updatedOneRow(res)'), true);
  assertEquals(lobbyBody.includes('draftTimeRefusal(res.error) ?? NEW_TIME_NOT_SAVED'), true);
  assertEquals(lobbyBody.includes('seedDraftDate(null, new Date())'), true);
  assertEquals(lobbyBody.includes('onDone={() => void saveNewTime()}'), true);
});

Deno.test('the old countdown card in DraftLobby is off in the lobby (the auto-start card replaces it)', () => {
  assertEquals(lobbyBody.includes('showCountdown={false}'), true);
  assertEquals(draftLobbySrc.includes('showCountdown = true'), true);
});
