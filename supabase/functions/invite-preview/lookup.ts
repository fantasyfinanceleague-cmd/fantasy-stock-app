// The invite-preview lookup call, BOUNDED and retried once on contention (pure: the call is injected, so every branch is
// hermetically testable; index.ts binds the real supabase-js builder).
//
// WHY THE BOUND IS HERE and not in the database. The lookup is one PostgREST call (`select invite_preview_lookup(...)`).
// Postgres arms statement_timeout when that top-level statement STARTS; a function-level `SET statement_timeout` applies on
// entry and never re-arms the timer, so it would bound nothing (the migration deliberately sets none). The only bound the
// call has is this abort. It is CLIENT-SIDE: it stops the edge function waiting (and passes the signal to supabase-js), but
// PostgREST may not cancel the backend. A hung lookup therefore costs the caller the generic "preview unknown" after
// LOOKUP_TIMEOUT_MS, never a hung request. On the backend only LOCK WAITS are bounded (the migration's lock_timeout, relation
// locks); a slow query keeps running, and the advisory lock with it, so other callers see `contention` until it ends (a
// logged, fail-closed 429). Worst case for the caller: about 2 s + a 20-80 ms jitter + 2 s, when the one contention retry
// also hangs.

import { type LimitKey, type Shaped, toResponse } from './respond.ts';

export const LOOKUP_TIMEOUT_MS = 2000;

/** Thrown when the lookup does not answer in time; index.ts logs its name and answers 500 "unavailable". */
export class LookupTimeout extends Error {
  constructor() {
    super('lookup_timeout');
    this.name = 'LookupTimeout';
  }
}

export interface RpcResult {
  data: unknown;
  error: { code?: string } | null;
}

/** `call` receives the abort signal to hand to supabase-js (`.abortSignal(signal)`); a call that ignores it still times out. */
export async function lookupWithTimeout(call: (signal: AbortSignal) => PromiseLike<RpcResult>, ms: number = LOOKUP_TIMEOUT_MS): Promise<RpcResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LookupTimeout());
    }, ms);
  });
  try {
    return await Promise.race([call(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

export interface LookupDeps {
  timeoutMs?: number;
  /** Waits before the one retry; tests inject an instant one. */
  sleep?: (ms: number) => Promise<void>;
  /** 20-80 ms of jitter, so a burst of refused callers does not retry in lockstep. */
  jitterMs?: () => number;
  now?: Date;
}

export type LookupOutcome = { kind: 'rpc_error'; code: string } | { kind: 'shaped'; shaped: Shaped };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const defaultJitter = () => 20 + Math.floor(Math.random() * 60);

/**
 * One lookup, and ONE retry when the database refused it for `contention` (the try-lock was busy): the busy window is
 * milliseconds, and the retry stays inside the response floor in the ordinary case. Never a loop: a second `contention`
 * is answered as the 429 it is. A timeout throws LookupTimeout (not retried).
 */
export async function runLookup(call: (signal: AbortSignal) => PromiseLike<RpcResult>, deps: LookupDeps = {}): Promise<LookupOutcome> {
  const once = async (): Promise<LookupOutcome> => {
    const { data, error } = await lookupWithTimeout(call, deps.timeoutMs);
    if (error) return { kind: 'rpc_error', code: error.code ?? '' };
    return { kind: 'shaped', shaped: toResponse(data, deps.now) };
  };
  const first = await once();
  if (first.kind === 'shaped' && first.shaped.limit === ('contention' satisfies LimitKey)) {
    await (deps.sleep ?? defaultSleep)((deps.jitterMs ?? defaultJitter)());
    return once();
  }
  return first;
}
