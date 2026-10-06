/**
 * Reading my draft queue before the draft (3c-2; board "Draft lobby · Your
 * queue"). Pure, so the rules tests see it. draft_queue is owner-only under
 * RLS, so a league-scoped select returns just the caller's rows.
 *
 * A failed read is NOT an empty queue: set_draft_queue replaces the whole
 * list, so an editor seeded with [] after a failed read would wipe the saved
 * queue on its first save. The read reports 'error' and the editor isn't shown.
 */
export type QueueRead = { status: 'loading' } | { status: 'error' } | { status: 'ready'; queue: string[] };

/** The read's outcome from the query's resolved { data, error } (a query
 * error resolves, it doesn't throw). Rows come back ordered by position;
 * they're re-sorted here so the order never depends on the caller. */
export function queueRead(res: { data: { symbol: string; position: number }[] | null; error: unknown }): QueueRead {
  if (res.error || !res.data) return { status: 'error' };
  const queue = res.data
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((r) => r.symbol);
  return { status: 'ready', queue };
}

/** A re-read after the first one (the live room re-reads on every pick; the
 * lobby after a save). A failed re-read keeps the last good list: it is real
 * server data from this session, and hiding the editor mid-draft would throw
 * away unsaved edits. Only a read that never succeeded is an error, so the
 * editor is never seeded with an empty list it didn't read. */
export function nextQueueRead(
  prev: QueueRead,
  res: { data: { symbol: string; position: number }[] | null; error: unknown },
): QueueRead {
  const next = queueRead(res);
  if (next.status === 'error' && prev.status === 'ready') return prev;
  return next;
}

/** The load-failure line (Design Lead ruling: the house "X didn't load" form, with Try again). */
export const QUEUE_LOAD_FAILED = "Your queue didn't load.";

/** The live draft room's load failure, in the same form. */
export const DRAFT_ROOM_LOAD_FAILED = "The draft room didn't load.";
