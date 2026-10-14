/**
 * preDraftPortfolio (W4 Portfolio, DL gate): what Portfolio shows before the draft is done —
 * the app's line "Trading opens after the draft." PLUS the existing hook, no new copy:
 *   - during the draft: Home's "Go to the draft room" (the one primary);
 *   - before it starts, with a time set: Home's draft date/time line ("Sat, Oct 3 · 7:00 PM ET");
 *   - before it starts with no time: the line alone (Home owns setting the time).
 * Pure, so tests-deno pins it.
 */
import { draftDateTimeLabel } from '../home/draftCountdown';
import { GO_TO_DRAFT_ROOM } from '../home/homeCopy';
import { COPY } from './moneyCopy';

export type PreDraftHook = { kind: 'room'; label: string } | { kind: 'date'; label: string } | null;

export interface PreDraftView {
  line: string;
  hook: PreDraftHook;
}

/** Null once the draft is completed (Portfolio shows the team). */
export function preDraftPortfolio(draftStatus: string | null | undefined, draftDate: string | null | undefined): PreDraftView | null {
  if (draftStatus === 'completed') return null;
  if (draftStatus === 'in_progress') return { line: COPY.draftNotCompleted, hook: { kind: 'room', label: GO_TO_DRAFT_ROOM } };
  const when = draftDateTimeLabel(draftDate ?? null);
  return { line: COPY.draftNotCompleted, hook: when ? { kind: 'date', label: when } : null };
}
