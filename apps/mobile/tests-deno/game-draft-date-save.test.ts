/**
 * The draft date's save rules (3c-2): accepting the picker's default commits
 * a real date, the save never sends undefined, and a 0-row update is not a
 * success. A live 1.1.0 bug: "Success" with the date still NULL.
 * Run: `cd apps/mobile/tests-deno && deno test .`
 */
import { assertEquals } from 'jsr:@std/assert';
import {
  DRAFT_DATE_MISSING,
  defaultDraftDate,
  draftDateForSave,
  seedDraftDate,
  updatedOneRow,
} from '../lib/game/draftDateSave.ts';
// The screens, read as text (raw-imports) for the source guards at the end.
import createSrc from '../app/create-league.tsx' with { type: 'text' };
import settingsSrc from '../app/league-settings.tsx' with { type: 'text' };
import seamSrc from '../lib/game/seamCalls.ts' with { type: 'text' };
import leagueTabSrc from '../app/(tabs)/league.tsx' with { type: 'text' };

const at = (iso: string) => new Date(iso);

// ── (1) the seed ─────────────────────────────────────────────────────────

Deno.test('the default is an hour out, up to the next quarter hour', () => {
  assertEquals(defaultDraftDate(at('2026-10-06T18:07:12Z')).toISOString(), '2026-10-06T19:15:00.000Z');
  assertEquals(defaultDraftDate(at('2026-10-06T18:46:00Z')).toISOString(), '2026-10-06T20:00:00.000Z');
});

Deno.test('on a quarter-hour boundary it stays there', () => {
  assertEquals(defaultDraftDate(at('2026-10-06T18:30:00.000Z')).toISOString(), '2026-10-06T19:30:00.000Z');
});

Deno.test('the default is never in the past and never less than an hour out', () => {
  for (const iso of ['2026-10-06T00:00:00Z', '2026-10-06T23:59:59.999Z', '2026-12-31T23:50:00Z']) {
    const now = at(iso);
    const d = defaultDraftDate(now);
    assertEquals(d.getTime() >= now.getTime() + 60 * 60 * 1000, true, iso);
    assertEquals(d.getTime() % (15 * 60 * 1000), 0, iso);
  }
});

Deno.test('opening the picker with no date seeds the default, so accepting it commits a date', () => {
  const now = at('2026-10-06T18:07:00Z');
  const seeded = seedDraftDate(null, now);
  assertEquals(seeded.toISOString(), '2026-10-06T19:15:00.000Z');
  assertEquals(draftDateForSave(false, seeded), { ok: true, value: '2026-10-06T19:15:00.000Z' });
});

Deno.test('a date the picker can offer is kept; anything else becomes the earliest time', () => {
  const now = at('2026-10-06T18:07:00Z');
  const future = at('2026-10-10T23:00:00Z');
  assertEquals(seedDraftDate(future, now), future);
  assertEquals(seedDraftDate(at('2026-10-06T19:15:00Z'), now).toISOString(), '2026-10-06T19:15:00.000Z'); // exactly the earliest
  assertEquals(seedDraftDate(at('2026-10-01T23:00:00Z'), now).toISOString(), '2026-10-06T19:15:00.000Z'); // past
  assertEquals(seedDraftDate(now, now).toISOString(), '2026-10-06T19:15:00.000Z'); // "now"
  // Auto-start rules: under an hour out, or off the 15-minute grid, is never offered.
  assertEquals(seedDraftDate(at('2026-10-06T19:00:00Z'), now).toISOString(), '2026-10-06T19:15:00.000Z'); // 53 min out
  assertEquals(seedDraftDate(at('2026-10-10T23:07:00Z'), now).toISOString(), '2026-10-06T19:15:00.000Z'); // 12:07-style (1.1.0)
  assertEquals(seedDraftDate(at('2026-10-10T23:00:30Z'), now).toISOString(), '2026-10-06T19:15:00.000Z'); // seconds
});

// ── (2) never undefined ──────────────────────────────────────────────────

Deno.test('Set later (TBD) writes an explicit null', () => {
  assertEquals(draftDateForSave(true, null), { ok: true, value: null });
  assertEquals(draftDateForSave(true, at('2026-10-10T23:00:00Z')), { ok: true, value: null });
});

Deno.test('a chosen date writes its ISO value', () => {
  assertEquals(draftDateForSave(false, at('2026-10-10T23:00:00Z')), { ok: true, value: '2026-10-10T23:00:00.000Z' });
});

Deno.test('a chosen date with no value is a validation error, never an omitted key', () => {
  assertEquals(draftDateForSave(false, null), { ok: false, error: DRAFT_DATE_MISSING });
  assertEquals(draftDateForSave(false, new Date('nope')), { ok: false, error: DRAFT_DATE_MISSING });
  for (const r of [draftDateForSave(true, null), draftDateForSave(false, at('2026-10-10T23:00:00Z'))]) {
    if (r.ok) assertEquals(r.value === undefined, false);
  }
});

// ── (3) 0 rows is not a success ──────────────────────────────────────────

Deno.test('an update counts only if it returned exactly the one row', () => {
  assertEquals(updatedOneRow({ data: [{ id: 'L1' }], error: null }), true);
  assertEquals(updatedOneRow({ data: [], error: null }), false); // RLS or a stale id: resolves with no error
  assertEquals(updatedOneRow({ data: null, error: null }), false);
  assertEquals(updatedOneRow({ data: [{ id: 'L1' }], error: { message: 'x' } }), false);
  assertEquals(updatedOneRow({ data: [{ id: 'a' }, { id: 'b' }], error: null }), false);
});

// ── Source guards: the screens go through the rules ───────────────────────

Deno.test('neither screen writes draft_date from an optional chain (the undefined that hid the bug)', () => {
  for (const [name, src] of [['create-league', createSrc], ['league-settings', settingsSrc]] as const) {
    assertEquals(/draft_date:\s*[^,\n]*draftDate\?\.toISOString\(\)/.test(src), false, name);
    assertEquals(src.includes('draft_date: draftDateValue.value'), true, name);
  }
});

Deno.test('opening the picker seeds the date in both screens', () => {
  assertEquals(createSrc.includes('seedDraftDate(state.draftDate, new Date())'), true);
  assertEquals(settingsSrc.includes('seedDraftDate(d, new Date())'), true);
});

Deno.test('the leagues update returns its row, and both callers check it', () => {
  assertEquals(seamSrc.includes(".update(patch).eq('id', id).select('id')"), true);
  assertEquals(settingsSrc.includes('updatedOneRow(res)'), true);
  // The lobby stepper checks it through playoffTeamsSaveOutcome (lock first, then updatedOneRow).
  assertEquals(leagueTabSrc.includes('playoffTeamsSaveOutcome(res)'), true);
});
