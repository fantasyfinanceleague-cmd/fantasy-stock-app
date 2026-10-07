/**
 * send-notification's closed set no longer contains `draft_turn` (2026-10-06):
 * the turn push is server-side now (_shared/draft-write.ts notifyNextPicker), and
 * a callerless entry is a free "your turn" spam template any leaguemate could fire.
 * This pins that `draft_turn` is refused EXACTLY like any unknown type, before any
 * membership or token read, run against the REAL index.ts.
 *
 * HOW (same as cron_status_handlers.test.ts): Deno.serve is replaced during the
 * import so the handler is captured, and globalThis.fetch is a fake Supabase
 * (auth/v1/user returns a caller, the rate-limit rpc allows, every other request
 * is recorded and reads empty).
 *
 * Run: deno test --allow-read --allow-env supabase/tests/send_notification_types.test.ts
 */
import { assert, assertEquals } from 'jsr:@std/assert';

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://stub.supabase.test',
  SB_PUBLISHABLE_KEY: 'test-publishable-not-a-secret',
  SB_SECRET_KEY_INTERNAL: 'test-secret-not-a-secret',
};
const JSON_HEADERS = { 'content-type': 'application/json' };

type Handler = (req: Request) => Promise<Response>;

async function loadHandler(): Promise<Handler> {
  let captured: Handler | undefined;
  const original = Deno.serve;
  // deno-lint-ignore no-explicit-any
  (Deno as any).serve = (h: Handler) => {
    captured = h;
    return {};
  };
  try {
    await import(new URL('../functions/send-notification/index.ts', import.meta.url).href);
  } finally {
    Deno.serve = original;
  }
  assert(captured, 'send-notification/index.ts did not call Deno.serve');
  return captured;
}

/** Fake Supabase. Returns the list of data reads (anything but auth + rate limit). */
function installFetch(): { reads: string[]; restore: () => void } {
  const reads: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === '/auth/v1/user') {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: '00000000-0000-0000-0000-00000000000a',
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: {},
            user_metadata: {},
            created_at: '2026-10-06T00:00:00Z',
          }),
          { status: 200, headers: JSON_HEADERS },
        ),
      );
    }
    if (url.pathname === '/rest/v1/rpc/check_and_bump_rate_limit') {
      return Promise.resolve(new Response('true', { status: 200, headers: JSON_HEADERS }));
    }
    reads.push(url.pathname);
    return Promise.resolve(new Response('[]', { status: 200, headers: JSON_HEADERS }));
  }) as typeof fetch;
  return { reads, restore: () => (globalThis.fetch = original) };
}

async function post(h: Handler, type: string): Promise<{ status: number; body: unknown }> {
  const res = await h(
    new Request('http://localhost/send-notification', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-user-jwt', 'content-type': 'application/json' },
      body: JSON.stringify({
        type,
        league_id: '00000000-0000-0000-0000-0000000000l1',
        target_user_id: '00000000-0000-0000-0000-00000000000b',
      }),
    }),
  );
  return { status: res.status, body: await res.json() };
}

Deno.test('send-notification refuses draft_turn exactly like an unknown type, before any data read', async () => {
  const prevEnv = Object.fromEntries(Object.keys(FAKE_ENV).map((k) => [k, Deno.env.get(k)]));
  for (const [k, v] of Object.entries(FAKE_ENV)) Deno.env.set(k, v);
  const fake = installFetch();
  try {
    const h = await loadHandler();
    const unknown = await post(h, 'definitely_not_a_type');
    const draftTurn = await post(h, 'draft_turn');

    // The control reached the closed-set check (authenticated, not rate limited).
    assertEquals(unknown, { status: 400, body: { error: 'bad_request', message: 'unknown notification type' } });
    // draft_turn gets the identical refusal.
    assertEquals(draftTurn, unknown);
    // Refused before any membership, league or push-token lookup.
    assertEquals(fake.reads, []);
  } finally {
    fake.restore();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});
