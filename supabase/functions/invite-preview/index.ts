import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { runLookup } from './lookup.ts';
import { clientIp, corsHeaders, normalizeCode, RESPONSE_FLOOR_MS, type Shaped } from './respond.ts';

// invite-preview: the NO-SESSION league preview behind the invite link (Onboarding W3; Planner ruling,
// 2026-10-14). verify_jwt = false (supabase/config.toml): the person has no session yet, so there is no JWT
// to verify, and this function reads none. What it may say, and how it is limited, is in respond.ts and in
// supabase/migrations/20261124000000_invite_preview.sql; preview-league's session path is untouched.
//
// ONE database call does the limiting and the lookup (invite_preview_lookup, service_role only), so a hit
// and a miss cost the same round trip, and every response is then held to the same floor.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req: Request) => {
  const started = Date.now();
  const cors = corsHeaders(req.headers.get('Origin') ?? '');

  async function finish(shaped: Shaped): Promise<Response> {
    const wait = RESPONSE_FLOOR_MS - (Date.now() - started);
    if (wait > 0) await sleep(wait);
    return new Response(JSON.stringify(shaped.body), {
      status: shaped.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
    });
  }

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return finish({ status: 405, body: { error: 'method_not_allowed' } });

  try {
    const body = await req.json().catch(() => ({}));
    // A malformed or missing code is sent as '' so the SQL counts it as a miss like any other.
    const code = normalizeCode((body as { code?: unknown } | null)?.code) ?? '';
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY_INTERNAL')!);
    // Bounded and retried once on contention (./lookup.ts): the abort is the call's ONLY bound (client-side).
    const outcome = await runLookup((signal) =>
      admin.rpc('invite_preview_lookup', { p_code: code, p_ip: clientIp(req.headers) }).abortSignal(signal)
    );
    if (outcome.kind === 'rpc_error') {
      // The client degrades quietly to the generic line by design, so the failure must be visible HERE (a later
      // migration revoking service_role EXECUTE would otherwise break the endpoint for everyone, silently).
      // The error CODE only: never the invite code, the address or the message text.
      console.error('invite-preview: lookup rpc failed', outcome.code);
      return finish({ status: 500, body: { error: 'unavailable' } });
    }
    const shaped = outcome.shaped;
    if (shaped.status === 500) console.error('invite-preview: unexpected lookup result');
    // A tripped limit is visible HERE (the global ceiling and a missing salt would otherwise look like a quiet
    // outage). A constant line plus the limit key from a fixed list: never the code, the address or the body.
    if (shaped.status === 429) console.warn('invite-preview: limited', shaped.limit ?? 'unknown');
    return finish(shaped);
  } catch (e) {
    console.error('invite-preview: unhandled', e instanceof Error ? e.name : typeof e);
    return finish({ status: 500, body: { error: 'unavailable' } });
  }
});
