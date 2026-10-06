/**
 * League settings save outcomes (3c). The freeze codes (league_slots_locked,
 * league_rules_locked) become calm copy, never a raw message. A save whose league
 * write landed but whose roster write was refused is named as PARTLY saved, not
 * reported as an error. Run: `deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { lockCodeOf, settingsSaveOutcome, type SaveOutcome } from '../lib/game/settingsSave.ts';

const msgOf = (o: SaveOutcome): string => o.message ?? '';

Deno.test('the lock codes are read from the server message prefix', () => {
  assertEquals(lockCodeOf({ message: 'league_slots_locked: roster is frozen' }), 'slots_locked');
  assertEquals(lockCodeOf({ message: 'league_rules_locked: season shape is frozen' }), 'rules_locked');
  assertEquals(lockCodeOf({ message: 'permission denied' }), 'other');
  assertEquals(lockCodeOf(null), 'other');
});

Deno.test('nothing failed: saved', () => {
  assertEquals(settingsSaveOutcome({ patchError: null, slotsError: null }).kind, 'saved');
});

Deno.test('the league write refused by the rules lock: nothing saved, calm copy, no raw message', () => {
  const o = settingsSaveOutcome({ patchError: { message: 'league_rules_locked: x' }, slotsError: null });
  assertEquals(o.kind, 'nothing_saved');
  assertEquals(o.title, 'Locked for the season');
  assertEquals(msgOf(o).includes('league_rules_locked'), false);
  assertEquals(msgOf(o).includes('42501'), false);
});

Deno.test('the league write landed but the roster write was refused: PARTLY saved', () => {
  const o = settingsSaveOutcome({ patchError: null, slotsError: { message: 'league_slots_locked: roster' } });
  assertEquals(o.kind, 'partly_saved');
  assertEquals(o.title, 'Partly saved');
  assertEquals(msgOf(o).includes('league_slots_locked'), false);
});

Deno.test('any other failure is one honest generic line, never the raw message', () => {
  const o = settingsSaveOutcome({ patchError: { message: 'network down' }, slotsError: null });
  assertEquals(o.kind, 'nothing_saved');
  assertEquals(msgOf(o), "Your settings didn't save. Try again.");
  assertEquals(msgOf(o).includes('network'), false);
});
