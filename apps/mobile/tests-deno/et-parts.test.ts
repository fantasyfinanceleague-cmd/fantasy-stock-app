/**
 * Tests for lib/time/etParts.ts (Orchestrator ask, 2026-09-30): every
 * caller extracting date/time fields from Intl.DateTimeFormat.
 * formatToParts must get an explicit null on a missing part, never a
 * silent 0/empty fallback (the marketHours.ts:58 shape this module
 * exists to avoid repeating). Includes the specific "mock formatToParts
 * returning no hour" case Orchestrator asked for.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import { etDateParts, etDateTimeParts } from '../lib/time/etParts.ts';

Deno.test('etDateParts: a normal instant returns the real ET calendar date', () => {
  // 2026-09-24T14:05:00Z = 10:05 AM EDT -- same ET calendar date either way.
  assertEquals(etDateParts(new Date('2026-09-24T14:05:00.000Z')), { year: 2026, month: 9, day: 24 });
});

Deno.test('etDateTimeParts: EDT (summer) and EST (winter) both resolve correctly', () => {
  assertEquals(etDateTimeParts(new Date('2026-09-24T14:05:00.000Z')), { year: 2026, month: 9, day: 24, hour: 10, minute: 5, second: 0 });
  assertEquals(etDateTimeParts(new Date('2026-12-15T15:00:00.000Z')), { year: 2026, month: 12, day: 15, hour: 10, minute: 0, second: 0 });
});

Deno.test('etDateTimeParts: a runtime that drops the hour part returns null, never a fabricated 0', () => {
  // Mocks the exact failure mode this module exists to catch: Hermes
  // silently omitting a part type from formatToParts's array, the shape
  // that made marketHours.ts's `?? '0'` fallback dangerous.
  const RealDateTimeFormat = Intl.DateTimeFormat;
  try {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = function (...args: unknown[]) {
      // deno-lint-ignore no-explicit-any
      const real = new (RealDateTimeFormat as any)(...args);
      return {
        formatToParts: (d: Date) => real.formatToParts(d).filter((p: { type: string }) => p.type !== 'hour'),
      };
    };
    assertEquals(etDateTimeParts(new Date('2026-09-24T14:05:00.000Z')), null);
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});

Deno.test('etDateParts: a runtime that drops the year part returns null', () => {
  const RealDateTimeFormat = Intl.DateTimeFormat;
  try {
    // deno-lint-ignore no-explicit-any
    (Intl as any).DateTimeFormat = function (...args: unknown[]) {
      // deno-lint-ignore no-explicit-any
      const real = new (RealDateTimeFormat as any)(...args);
      return {
        formatToParts: (d: Date) => real.formatToParts(d).filter((p: { type: string }) => p.type !== 'year'),
      };
    };
    assertEquals(etDateParts(new Date('2026-09-24T14:05:00.000Z')), null);
  } finally {
    Intl.DateTimeFormat = RealDateTimeFormat;
  }
});
