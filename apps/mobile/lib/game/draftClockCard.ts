/**
 * draftClockCard (W4 Draft, Game Night §9C): what the room's clock card is, and how its ring
 * runs down. The board's frame (#call-game-night, "Draft room, on the clock"): a 74pt ring
 * (a 6pt `track` circle under a `live` arc that runs down with the clock, the clock inside it)
 * beside the headline. §9C Motion: your turn "flashes twice in the accent, then rests with an
 * accent ring that runs down". Pure, so tests-deno pins it; the flash itself is yourTurn.ts.
 */
import type { ClockState } from './draftRoom';

/** Whose card it is. `yours` is the screen's one emphasis (the accent tint, the 2pt live
 * edge, the flash); `stalled` and `auto_picking` draw no clock (B-4: never an empty gap). */
export type ClockCardKind = 'yours' | 'theirs' | 'auto_picking' | 'stalled';

export function clockCardKind(o: { isMyTurn: boolean; stalled: boolean; clockKind: ClockState['kind'] }): ClockCardKind {
  if (o.stalled) return 'stalled';
  if (o.clockKind === 'auto_picking') return 'auto_picking';
  return o.isMyTurn ? 'yours' : 'theirs';
}

/** The ring's size and stroke (the board's 74 / 6). */
export const CLOCK_RING_SIZE = 74;
export const CLOCK_RING_STROKE = 6;
/** The clock inside the ring: 20/800 tabular (the board's), capped so "1:30" stays inside. */
export const CLOCK_RING_TEXT = 20;
export const CLOCK_RING_TEXT_MAX_SCALE = 1.2;

/** The arc's dash: the full circle at the turn's start, nothing at 0:00. Past either end
 * (a re-read that lands late, a clock longer than the setting) it clamps, never draws more
 * than one turn. `total` 0 or less draws no arc. */
export function clockRingArc(secondsLeft: number | null, total: number, size = CLOCK_RING_SIZE, stroke = CLOCK_RING_STROKE): { radius: number; circumference: number; dashOffset: number } {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const frac = total > 0 && secondsLeft !== null ? Math.min(1, Math.max(0, secondsLeft / total)) : 0;
  return { radius, circumference, dashOffset: circumference * (1 - frac) };
}

/** The arc's colour: `live`, and `loss` in the last 10 seconds (the room's existing rule:
 * "loss in the last 10 s either way"). The number itself says it too, so colour is never the
 * only code. */
export function clockRingTone(kind: ClockState['kind']): 'live' | 'loss' {
  return kind === 'last10' ? 'loss' : 'live';
}

/** The clock card's headline is its loudest text at every text size (checklist §5, "the standout
 * stays loudest"). `headline` and `display` cap at 1.6×; `callout` and `caption` don't, so at
 * XXXL the round line outgrew "Auto-picking…" (W4 capture). The card's other lines take the
 * same cap: 13 × 1.6 = 20.8 < 17 × 1.6 = 27.2. */
export const CARD_LINE_MAX_SCALE = 1.6;

/** Whether the room offers the search and the Draft button: only on YOUR running clock
 * (`yours`), never just because the pick is yours (W4 gate, P1: it was gated on `isMyTurn`, so
 * the one primary stayed up after the clock ran out). What the server does in the other two:
 * - `auto_picking` (past the deadline): the room has already asked the server to auto-pick
 *   (validate-and-record-pick action 'auto_pick', 0–3 s jitter) and the sweep cron backs it. A
 *   manual pick is NOT refused by any clock check; it lands only if it commits before the
 *   auto-pick (the unique (league_id, pick_number) index: the loser gets 'pick_conflict').
 *   "A missed turn is always auto-picked" (PRODUCT_RULES), so the room never offers that race.
 * - `stalled`: the auto-pick walked the whole pool and nothing passed the gate; the card says
 *   "No stock left fits …'s next slot" and the clock is stopped. A manual pick goes through the
 *   same gatePick, so it is refused for the same reason; the only exception is the documented
 *   residual (a stock whose live price is in its bracket while its cache is >10% outside).
 *   The room keeps to the ruled copy and offers no pick; the commissioner fixes the slot. */
export function draftOffered(kind: ClockCardKind): boolean {
  return kind === 'yours';
}
