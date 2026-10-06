/**
 * A stalled draft turn (3c; ruled copy 3c-2, board #game "Draft paused"): shown
 * as waiting, never as a pick, with the member and commissioner lines. The
 * placeholder copy this module used to hold is gone (P0, Design Lead audit).
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { turnState } from '../lib/game/draftRefusals.ts';

Deno.test('a stalled turn, member view (board "Draft paused, member")', () => {
  assertEquals(turnState({ reason: 'stalled', pickNumber: 14, managerName: 'Paolo M.' }), {
    kind: 'stalled',
    tag: 'Draft paused',
    label: "No stock left fits Paolo M.'s next slot",
    line: 'The clock is stopped and nobody is skipped. The commissioner has been told.',
  });
});

Deno.test('a stalled turn, commissioner view (board "Draft paused, commissioner")', () => {
  assertEquals(
    turnState({ reason: 'stalled', pickNumber: 14, managerName: 'Paolo M.', isCommissioner: true }).line,
    "The clock is stopped and nobody is skipped. You've been notified; the draft continues once the slot can be filled.",
  );
});

Deno.test('no manager name: "the next manager", never an empty possessive', () => {
  assertEquals(turnState({ reason: 'stalled', pickNumber: 14, managerName: '  ' }).label, "No stock left fits the next manager's next slot");
  assertEquals(turnState({ reason: 'stalled', pickNumber: 14 }).label, "No stock left fits the next manager's next slot");
});

Deno.test('a normal turn is not stalled and carries no copy', () => {
  assertEquals(turnState({ reason: null, pickNumber: 14 }), { kind: 'normal', tag: null, label: null, line: null });
});

Deno.test('no stalled line is a placeholder', () => {
  const s = turnState({ reason: 'stalled', pickNumber: 1, managerName: 'A', isCommissioner: true });
  for (const v of [s.tag, s.label, s.line]) assertEquals(String(v).includes('[new copy'), false);
});
