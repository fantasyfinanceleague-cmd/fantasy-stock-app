import { parseSlotShape, type SlotShape } from './tierContract';
/**
 * recordTradeOutcome: turns one record-trade call into a single outcome the
 * screens can act on. supabase-js resolves every result as { data, error }
 * (CLAUDE.md success-signal #5): a 200 refusal comes back as data, and a
 * non-2xx comes back as an error whose context is the Response, so the body
 * is read from there. A 503 calendar_unavailable keeps the review open
 * (it is not a failed trade). A transport failure is 'network', never 'ok'.
 */
export type RecordTradeOutcome =
  | { kind: 'ok'; trade: unknown }
  | { kind: 'refused'; reason: string; marketReason?: string; nextOpenAt?: string | null; tier?: { price: number | null; openSlots: SlotShape[] } }
  | { kind: 'unavailable' }
  | { kind: 'network' };

interface RecordTradeBody {
  ok?: unknown;
  trade?: unknown;
  reason?: unknown;
  market_reason?: unknown;
  next_open_at?: unknown;
}

function refusedFrom(body: RecordTradeBody, reason: string): RecordTradeOutcome {
  if (reason === 'no_eligible_slot') {
    // The contract's refusal carries the open slots (validated; a malformed list is dropped, never guessed).
    const raw = (body as { open_slots?: unknown }).open_slots;
    const openSlots = Array.isArray(raw) ? raw.map(parseSlotShape) : [];
    const price = typeof (body as { price?: unknown }).price === 'number' ? (body as { price: number }).price : null;
    return { kind: 'refused', reason, tier: { price, openSlots: openSlots.every((x) => x !== null) ? (openSlots as SlotShape[]) : [] } };
  }
  if (reason === 'calendar_unavailable') return { kind: 'unavailable' };
  // 'unhandled' is a server fault: the trade may or may not have been written.
  if (reason === 'unhandled') return { kind: 'network' };
  const out: RecordTradeOutcome = { kind: 'refused', reason };
  if (typeof body.market_reason === 'string') out.marketReason = body.market_reason;
  if ('next_open_at' in body) out.nextOpenAt = typeof body.next_open_at === 'string' ? body.next_open_at : null;
  return out;
}

export async function readRecordTradeOutcome(result: { data: unknown; error: unknown }): Promise<RecordTradeOutcome> {
  if (!result.error) {
    const body = (result.data ?? null) as RecordTradeBody | null;
    if (body && body.ok === true) return { kind: 'ok', trade: body.trade };
    if (body && body.ok === false && typeof body.reason === 'string') return refusedFrom(body, body.reason);
    return { kind: 'refused', reason: 'unhandled' };
  }

  const ctx = (result.error as { context?: unknown } | null)?.context as
    | { status?: number; json?: () => Promise<unknown> }
    | undefined;
  if (!ctx || typeof ctx.json !== 'function') return { kind: 'network' };

  const body = (await ctx.json().catch(() => null)) as RecordTradeBody | null;
  if (!body || typeof body.reason !== 'string') return { kind: 'network' };
  // A 5xx that isn't the calendar's 503 is a server fault: it may have written. Unconfirmed.
  const serverFault = typeof ctx.status === 'number' && ctx.status >= 500 && body.reason !== 'calendar_unavailable';
  if (serverFault) return { kind: 'network' };
  return refusedFrom(body, body.reason);
}
