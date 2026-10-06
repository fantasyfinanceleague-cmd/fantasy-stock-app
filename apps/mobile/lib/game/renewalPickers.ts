/**
 * The R8 pickers (3c): what the commissioner may change before the draft is set.
 * The pick clock uses the server's own range and step (30–90 s, every 15). The
 * draft order is Random or Manual. A draft date must be in the future.
 */

/** The pick clock options: the server's range (30–90) in its step (15). */
export const PICK_CLOCK_OPTIONS: readonly number[] = [30, 45, 60, 75, 90];

/** The board's two draft-order choices. */
export const DRAFT_ORDER_OPTIONS: readonly { value: 'random' | 'manual'; label: string }[] = [
  { value: 'random', label: 'Random' },
  { value: 'manual', label: 'Manual' },
];

export function isFutureDraftDate(iso: string | null, now: Date): boolean {
  if (iso === null) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t > now.getTime();
}
