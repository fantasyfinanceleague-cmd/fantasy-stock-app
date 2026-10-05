/**
 * Hermetic tests for record-trade/gate.ts. Run:
 *   deno test supabase/functions/record-trade/gate.test.ts
 */
import { assertEquals } from 'jsr:@std/assert';
import { tradeRefusalReason } from './gate.ts';

Deno.test('tradeRefusalReason: an open season with a completed draft may trade', () => {
  assertEquals(tradeRefusalReason({ draft_status: 'completed', season_status: 'active' }), null);
  assertEquals(tradeRefusalReason({ draft_status: 'completed', season_status: 'playoffs' }), null);
});

Deno.test('tradeRefusalReason: a draft that has not completed refuses (unchanged)', () => {
  assertEquals(tradeRefusalReason({ draft_status: 'in_progress', season_status: 'active' }), 'draft_not_completed');
  assertEquals(tradeRefusalReason({ draft_status: 'not_started', season_status: 'active' }), 'draft_not_completed');
});

Deno.test('tradeRefusalReason: a completed season refuses, even with a completed draft', () => {
  assertEquals(tradeRefusalReason({ draft_status: 'completed', season_status: 'completed' }), 'season_completed');
});

Deno.test('tradeRefusalReason: a null season_status is not treated as completed', () => {
  assertEquals(tradeRefusalReason({ draft_status: 'completed', season_status: null }), null);
});
