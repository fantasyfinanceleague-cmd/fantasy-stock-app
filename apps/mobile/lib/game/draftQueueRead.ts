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

/** The load-failure line (NEW copy, the draft room's pattern). */
export const QUEUE_LOAD_FAILED = "Couldn't load your queue.";
