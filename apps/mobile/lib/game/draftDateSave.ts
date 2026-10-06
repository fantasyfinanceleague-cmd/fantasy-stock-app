/**
 * The draft date's save rules (3c-2; a live 1.1.0 bug). Pure, so the rules
 * tests see them.
 *
 * The bug: the iOS picker opened on `value={draftDate || new Date()}`, but
 * draftDate was only set in onChange. Accepting the shown default without
 * spinning never fired onChange, so draftDate stayed null, the save sent
 * `draft_date: undefined` (supabase-js drops the key), and the screen said
 * "Success" while the league kept no date.
 *
 * The fix, in three parts:
 * 1. Opening the picker SEEDS the state with the value it shows (seedDraftDate),
 *    so accepting the default commits a real date.
 * 2. The save never sends undefined (draftDateForSave): Set later is an
 *    explicit null; a chosen date with no value is a validation error.
 * 3. A leagues update must report the row it changed (updatedOneRow): 0 rows
 *    (RLS, a stale id) is "Not saved", never a success.
 */

const QUARTER_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The picker's opening value: an hour from now, up to the next quarter hour
 * (on a boundary it stays). Never in the past. */
export function defaultDraftDate(now: Date): Date {
  return new Date(Math.ceil((now.getTime() + HOUR_MS) / QUARTER_MS) * QUARTER_MS);
}

/** What opening the picker writes to state: the current date if the picker
 * could offer it (on the 15-minute grid and at least the earliest time, an
 * hour out; draft auto-start's rules), otherwise the earliest time. So the
 * value shown is always one the server accepts, and accepting it commits it. */
export function seedDraftDate(current: Date | null, now: Date): Date {
  const earliest = defaultDraftDate(now);
  if (current && current.getTime() % QUARTER_MS === 0 && current.getTime() >= earliest.getTime()) return current;
  return earliest;
}

/** Shown under the Draft time row when a time was chosen but none is set (Design Lead ruling: one term, "draft time"). */
export const DRAFT_DATE_MISSING = 'Pick a draft time, or choose Set later.';

export type DraftDateForSave = { ok: true; value: string | null } | { ok: false; error: string };

/** The draft_date to write: null for Set later (TBD), the ISO date otherwise.
 * Never undefined: a chosen date with no value refuses. */
export function draftDateForSave(tbd: boolean, date: Date | null): DraftDateForSave {
  if (tbd) return { ok: true, value: null };
  if (!date || Number.isNaN(date.getTime())) return { ok: false, error: DRAFT_DATE_MISSING };
  return { ok: true, value: date.toISOString() };
}

/** A single-league update succeeded only if it returned exactly that row (the
 * update selects 'id'). An error, or 0 rows, is not saved: a supabase update
 * that matches nothing resolves with no error. */
export function updatedOneRow(res: { data: unknown; error: unknown }): boolean {
  return !res.error && Array.isArray(res.data) && res.data.length === 1;
}
