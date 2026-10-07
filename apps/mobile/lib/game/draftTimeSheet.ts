/**
 * draftTimeSheet (3c-2; Giorgio's ruling B on board #call-ux-pass1, PR #140):
 * the Draft time sheet holds the time it shows LOCALLY and writes only on
 * "Set draft time". The wheel spinning writes nothing, and × or a swipe closes
 * without saving: the 1.1.0 half-save (the picker wrote as it spun, Done only
 * closed, so a swipe-away kept a time you were still scrolling to) is gone.
 * "Set later" (only where a time is optional) writes "no time".
 *
 * Pure, so a dismiss-writes-nothing test runs the same steps the sheet does.
 */
import { earliestDraftMs } from './autoStart';
import { seedDraftDate } from './draftDateSave';

export const SET_DRAFT_TIME = 'Set draft time'; // Design Lead, ruled (B)
export const SET_LATER = 'Set later'; // board
/** Home, commissioner, no draft time yet (ruling B). */
export const PICK_A_TIME_HOME = 'Pick a time, and the countdown starts here.'; // Design Lead, ruled (B)

/** Home's no-time card leads with setting the time (ruling B): the commissioner
 * only. Members keep "{Commissioner} will set the draft time." and Build your queue. */
export function homeSetsDraftTime(noDate: boolean, isCommissioner: boolean): boolean {
  return noDate && isCommissioner;
}

export type SheetAction =
  | { type: 'open'; current: Date | null; now: Date }
  | { type: 'spin'; date: Date }
  | { type: 'dismiss' }
  | { type: 'confirm'; nowMs: number }
  | { type: 'set_later' };

export type SheetWrite = { kind: 'none' } | { kind: 'time'; date: Date } | { kind: 'later' };

export interface SheetStep {
  /** The time the sheet holds (and shows, floored at the earliest time). */
  local: Date | null;
  open: boolean;
  write: SheetWrite;
}

const NONE: SheetWrite = { kind: 'none' };

/** The time the sheet shows: the held time, or the earliest when it's missing or
 * has fallen below it (the sheet sat open). What's shown is what's saved. */
export function shownDraftTime(local: Date | null, nowMs: number): Date {
  const earliest = earliestDraftMs(nowMs);
  return local && local.getTime() >= earliest ? local : new Date(earliest);
}

export function draftTimeSheet(local: Date | null, a: SheetAction): SheetStep {
  switch (a.type) {
    // Opening seeds the held time from the caller's (seedDraftDate) and writes nothing.
    case 'open': return { local: seedDraftDate(a.current, a.now), open: true, write: NONE };
    case 'spin': return { local: a.date, open: true, write: NONE };
    case 'dismiss': return { local: null, open: false, write: NONE };
    case 'confirm': return { local: null, open: false, write: { kind: 'time', date: shownDraftTime(local, a.nowMs) } };
    case 'set_later': return { local: null, open: false, write: { kind: 'later' } };
  }
}
