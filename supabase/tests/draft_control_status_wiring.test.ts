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

Deno.test('starting a draft pushes the FIRST picker once, through the one turn-push path, only after a committed start', async () => {
  // Giorgio, 2026-10-11: "if a draft is happening, the player should be notified
  // if its their turn even if they close the app." Pick 1 has no previous pick
  // (#160's notifyNextPicker runs only after a RECORDED pick), and draft_started
  // rides a once-a-minute cron a 30 s clock can beat. So the start path pushes
  // pick 1 itself (this replaces #160's "no turn push at start" guard; the
  // first picker now gets both, by the rule). Behaviour: draft-start.test.ts.
  const start = await Deno.readTextFile(new URL('../functions/_shared/draft-start.ts', import.meta.url));
  // The one path: never a hand-rolled lookup or send next to the shared skip rules.
  for (const name of ['notifyNextPicker', 'commitGatedPick', 'sendExpoPush', 'getTargetToken', 'draftTurnMessage']) {
    assert(!new RegExp(`\\b${name}\\b`).test(start), `draft-start.ts must not use ${name} (go through notifyFirstPicker)`);
  }
  const calls = [...start.matchAll(/\bnotifyFirstPicker\(/g)];
  assert(calls.length === 1, `draft-start.ts must call notifyFirstPicker exactly once, found ${calls.length}`);
  const started = start.slice(start.indexOf("case 'started': {"), start.indexOf("case 'already_started':"));
  assert(started.length > 0 && /notifyFirstPicker\(admin, leagueId, push\)/.test(started),
    "notifyFirstPicker must be called inside start_league_draft's 'started' branch (after the committed flip), nowhere else");
  const sql = await Deno.readTextFile(new URL('../migrations/20261111000000_draft_auto_start.sql', import.meta.url));
  const fn = sql.slice(sql.indexOf('create or replace function public.start_league_draft'));
  const body = fn.slice(0, fn.indexOf('$$;'));
  const kinds = [...body.matchAll(/'(draft_[a-z_]+)'\s*\n?\s*from public\.league_draft_order/g)].map((m) => m[1]);
  assert(kinds.length === 1 && kinds[0] === 'draft_started', `start_league_draft writes only draft_started notices, got ${kinds}`);
});
