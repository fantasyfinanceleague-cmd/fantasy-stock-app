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

Deno.test('starting a draft never sends a turn push (#160): the first picker hears only "The draft has started. You pick 1st."', async () => {
  // #160's notifyNextPicker runs only after a RECORDED pick (commitGatedPick).
  // The auto-start path (startDraftIfDue + start_league_draft) must not add a
  // second push for pick 1: draft_started already tells that manager they pick 1st.
  const start = await Deno.readTextFile(new URL('../functions/_shared/draft-start.ts', import.meta.url));
  for (const name of ['notifyNextPicker', 'commitGatedPick', 'sendExpoPush', 'getTargetToken']) {
    assert(!new RegExp(`\\b${name}\\b`).test(start), `draft-start.ts must not use ${name}`);
  }
  const sql = await Deno.readTextFile(new URL('../migrations/20261111000000_draft_auto_start.sql', import.meta.url));
  const fn = sql.slice(sql.indexOf('create or replace function public.start_league_draft'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  const kinds = [...body.matchAll(/'(draft_[a-z_]+)'\s*\n?\s*from public\.league_draft_order/g)].map((m) => m[1]);
  assert(kinds.length === 1 && kinds[0] === 'draft_started', `start_league_draft writes only draft_started notices, got ${kinds}`);
});
