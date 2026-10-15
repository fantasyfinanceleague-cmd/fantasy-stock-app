// Onboarding W2 (PKCE) — a timeout on AUTH requests only.
//
// Every sign-up, password reset and code exchange runs inside ONE queue (lib/auth/verifierSlot.ts
// withVerifierLock), because they share the single stored PKCE verifier. A request that hangs would hold
// that queue, and every later sign-up / reset / link exchange on the device would wait behind it with a
// spinner that never ends (React Native's Android networking has no default request timeout). The queue
// itself must NOT be released early (that reintroduces the stale-snapshot race), so the fix is to make the
// hung request END: abort it after AUTH_FETCH_TIMEOUT_MS. auth-js turns an abort into an
// AuthRetryableFetchError, which the link handler already treats as a transport failure (the verifier is
// restored, the dedupe mark released), and sign-up / reset already restore on any error.
//
// Scoped to GoTrue's own endpoints (/auth/v1/): PostgREST and the edge functions keep their existing
// behaviour. Known limits (accepted): the scope is a SUBSTRING match, so any URL containing "/auth/v1/" gets the
// timeout; and the timer is cleared when the response HEADERS arrive, so a body that then stalls is not aborted. Pure and dependency-injected so tests-deno can drive it.

export const AUTH_FETCH_TIMEOUT_MS = 25_000;

type FetchLike = (input: any, init?: any) => Promise<any>;

export interface AuthFetchDeps {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  AbortController: new () => { signal: any; abort(): void };
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input && typeof (input as { href?: unknown }).href === 'string') return (input as { href: string }).href;
  if (input && typeof (input as { url?: unknown }).url === 'string') return (input as { url: string }).url;
  return '';
}

export function createAuthFetch(base: FetchLike, timeoutMs: number, deps: AuthFetchDeps): FetchLike {
  return (input, init) => {
    if (!urlOf(input).includes('/auth/v1/')) return base(input, init);
    const controller = new deps.AbortController();
    const timer = deps.setTimeout(() => controller.abort(), timeoutMs);
    // The caller's own signal still aborts us.
    const outer = init?.signal as { aborted?: boolean; addEventListener?: (t: string, f: () => void, o?: unknown) => void } | undefined;
    if (outer) {
      if (outer.aborted) controller.abort();
      else outer.addEventListener?.('abort', () => controller.abort(), { once: true });
    }
    return base(input, { ...init, signal: controller.signal }).finally(() => deps.clearTimeout(timer));
  };
}
