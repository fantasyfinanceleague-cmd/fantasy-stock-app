/**
 * Structural guard: draft-control `status` returns `server_now` (the mobile
 * lobby's clock offset, 2026-10-06), judged at the SAME instant as
 * start_state. The handler needs auth + a DB, so its response shape is pinned
 * as TEXT here; resolveServerNow itself is unit-tested in
 * supabase/functions/_shared/draft-start-policy.test.ts. Files only:
 *   deno test --allow-read supabase/tests/draft_control_status_wiring.test.ts
 */
import { assert } from 'jsr:@std/assert';

const SRC = new URL('../functions/draft-control/index.ts', import.meta.url);

Deno.test('status: server_now is in the response and start_state is judged at that same instant', async () => {
  const src = await Deno.readTextFile(SRC);
  const status = src.slice(src.indexOf("if (action === 'status') {"), src.indexOf("if (!isCommissioner(state, user.id)) {"));
  assert(status.length > 0, 'status branch not found');
  assert(/const \{ now, serverNow \} = resolveServerNow\(\(await fetchDraftClock\(admin, leagueId\)\)\?\.serverNow, new Date\(\)\);/.test(status),
    'status must take ONE instant from the DB clock (get_draft_clock.server_now), edge clock as fallback');
  assert(/\bserver_now: serverNow,/.test(status), 'the response must carry server_now');
  assert(/computeStartState\([\s\S]*?,\s*now,\s*\)/.test(status), 'start_state must be judged with that same `now`');
  assert(!/new Date\(\)\s*;/.test(status.replace('new Date());', '')), 'no second clock read in the status branch');
});
