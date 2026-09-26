/**
 * Hermetic unit tests for lib/uuid.ts. Run:
 *
 *   deno test apps/mobile/tests-deno/
 *
 * Covers the bug this guards: `!id.startsWith('bot-')` was used as a stand-in
 * for "is this a real user id safe to query user_profiles.id (uuid) with" —
 * true for a real Supabase auth id, but also true for a non-bot-prefixed
 * synthetic test id like "test-user-2", which then 22P02'd the whole `.in()`
 * batch (see lib/uuid.ts's docstring).
 */
import { assertEquals } from 'jsr:@std/assert';
import { isUuid } from '../lib/uuid.ts';

Deno.test('isUuid: accepts a real (lowercase) v4 UUID', () => {
  assertEquals(isUuid('769c3fad-1234-4abc-8def-0123456789ab'), true);
});

Deno.test('isUuid: accepts an uppercase UUID (case-insensitive)', () => {
  assertEquals(isUuid('769C3FAD-1234-4ABC-8DEF-0123456789AB'), true);
});

Deno.test('isUuid: rejects a bot-prefixed id', () => {
  assertEquals(isUuid('bot-1'), false);
});

Deno.test('isUuid: rejects a synthetic test-user id (the bug this guards)', () => {
  // Not bot-prefixed, but also not a UUID — the exact shape that broke a
  // `.filter(id => !id.startsWith('bot-'))` gate.
  assertEquals(isUuid('test-user-2'), false);
});

Deno.test('isUuid: rejects null/undefined/empty without throwing', () => {
  assertEquals(isUuid(null), false);
  assertEquals(isUuid(undefined), false);
  assertEquals(isUuid(''), false);
});

Deno.test('isUuid: rejects a UUID-length string with a wrong shape (no dashes)', () => {
  assertEquals(isUuid('769c3fad1234abc8def0123456789ab'), false);
});

Deno.test('isUuid: rejects a truncated/partial UUID', () => {
  assertEquals(isUuid('769c3fad-1234-4abc-8def'), false);
});
