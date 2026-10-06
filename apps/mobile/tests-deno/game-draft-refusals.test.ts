/**
 * "Draft never skips" codes (3c, fixtures ahead of the backend merge). Every
 * refusal, blocker and turn state maps to a copy key the Design Lead will
 * write; until then each is a clearly flagged placeholder, and an unknown code
 * gets one generic line rather than a made-up reason. Run: `deno test .`
 */
import { assertEquals, assert } from 'jsr:@std/assert';
import {
  pickRefusalCopy,
  statusBlockerCopy,
  turnState,
  COPY_KEYS,
} from '../lib/game/draftRefusals.ts';

Deno.test('every pick refusal and status blocker has a flagged placeholder (new copy)', () => {
  for (const key of COPY_KEYS) {
    assert(key.startsWith('[new copy: '), `not flagged: ${key}`);
  }
});

Deno.test('pick refusals map to their own keys', () => {
  assertEquals(pickRefusalCopy('would_strand_slot'), '[new copy: would_strand_slot]');
  assertEquals(pickRefusalCopy('budget_reserve'), '[new copy: budget_reserve]');
  assertEquals(pickRefusalCopy('skip_disabled'), '[new copy: skip_disabled]');
});

Deno.test('an unknown pick refusal is one honest generic line, never a made-up reason', () => {
  assertEquals(pickRefusalCopy('future_reason'), "That pick can't be made.");
});

Deno.test('status blockers map to their own keys; an unknown one fails closed with a generic line', () => {
  assertEquals(statusBlockerCopy({ code: 'slots_infeasible' }), '[new copy: slots_infeasible]');
  assertEquals(statusBlockerCopy({ code: 'budget_infeasible' }), '[new copy: budget_infeasible]');
  assertEquals(statusBlockerCopy({ code: 'feasibility_unavailable' }), '[new copy: feasibility_unavailable]');
  assertEquals(statusBlockerCopy({ code: 'unknown_thing' }), "The draft can't start yet.");
});

Deno.test('a stalled turn is shown as waiting, never as a pick', () => {
  const s = turnState({ reason: 'stalled', pickNumber: 14 });
  assertEquals(s.kind, 'stalled');
  assertEquals(s.label, '[new copy: stalled_waiting]');
  assertEquals(s.commissionerNotice, '[new copy: stalled_commissioner]');
});

Deno.test('a normal turn is not stalled and carries no notice', () => {
  const s = turnState({ reason: null, pickNumber: 14 });
  assertEquals(s.kind, 'normal');
  assertEquals(s.commissionerNotice, null);
});
