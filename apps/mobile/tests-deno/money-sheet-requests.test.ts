/**
 * Hermetic tests for lib/money/sheetRequests.ts: the stock sheet's request
 * budget, per case (3e, Orchestrator correction 2026-10-05). Run with:
 * cd apps/mobile/tests-deno && deno test .
 */
import { assertEquals } from 'jsr:@std/assert';
import { planSheetRequests } from '../lib/money/sheetRequests.ts';

Deno.test('held, everything warm: 0 new requests (reuses the ledger, quote and name)', () => {
  const p = planSheetRequests({ ledgerLoaded: true, quoteCached: true, nameKnown: true });
  assertEquals(p.count, 0);
});

Deno.test('held, quote cold: 1 request (the quote only)', () => {
  const p = planSheetRequests({ ledgerLoaded: true, quoteCached: false, nameKnown: true });
  assertEquals(p, { ledger: false, quote: true, name: false, count: 1 });
});

Deno.test('free stock, nothing warm: 2 requests (the quote and the company name)', () => {
  const p = planSheetRequests({ ledgerLoaded: true, quoteCached: false, nameKnown: false });
  assertEquals(p, { ledger: false, quote: true, name: true, count: 2 });
});

Deno.test('owned by another manager, quote cold: 1 request (its name is in the ledger)', () => {
  const p = planSheetRequests({ ledgerLoaded: true, quoteCached: false, nameKnown: true });
  assertEquals(p.count, 1);
});

Deno.test('a cold session counts the ledger once, and only when it is not loaded', () => {
  assertEquals(planSheetRequests({ ledgerLoaded: false, quoteCached: true, nameKnown: true }).count, 1);
  assertEquals(planSheetRequests({ ledgerLoaded: false, quoteCached: false, nameKnown: false }).count, 3);
});
