/**
 * League settings save outcomes (3c). The freeze (a stale save once the draft has
 * started) comes back as 42501 with a message prefix: league_slots_locked or
 * league_rules_locked. The copy is calm and never shows the raw message. A save
 * whose league write landed but whose roster write was refused is reported as
 * PARTLY saved, so the manager knows what changed.
 * NEW COPY, flagged for the Design Lead.
 */

export type LockCode = 'slots_locked' | 'rules_locked' | 'other';

export function lockCodeOf(err: { message?: string } | null | undefined): LockCode {
  const m = err?.message ?? '';
  if (m.startsWith('league_slots_locked')) return 'slots_locked';
  if (m.startsWith('league_rules_locked')) return 'rules_locked';
  return 'other';
}

export type SaveOutcome =
  | { kind: 'saved'; title?: undefined; message?: undefined }
  | { kind: 'nothing_saved'; title: string; message: string }
  | { kind: 'partly_saved'; title: string; message: string };

export function settingsSaveOutcome(input: { patchError: { message?: string } | null; slotsError: { message?: string } | null }): SaveOutcome {
  if (input.patchError) {
    if (lockCodeOf(input.patchError) === 'rules_locked') {
      return {
        kind: 'nothing_saved',
        title: 'Locked for the season',
        message: "The draft has started, so the season setup can't change now. Nothing was saved.",
      };
    }
    return { kind: 'nothing_saved', title: 'Not saved', message: "Your settings didn't save. Try again." };
  }
  if (input.slotsError) {
    // The league row landed. The roster did not: say so, and say what it means.
    return {
      kind: 'partly_saved',
      title: 'Partly saved',
      message: "Your league details saved, but the roster didn't. The draft has started, so roster changes are locked now.",
    };
  }
  return { kind: 'saved' };
}
