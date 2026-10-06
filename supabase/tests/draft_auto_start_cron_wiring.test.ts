/**
 * Structural guard for the auto-start crons (20261109000002: the sweep;
 * 20261109000003: draft-order-notify, promoted from deferred/). The crons cannot run
 * in PGlite (no pg_cron / pg_net / vault), so what a header comment cannot
 * enforce is read as TEXT. Reads files only, no network or DB:
 *   deno test --allow-read supabase/tests/draft_auto_start_cron_wiring.test.ts
 *
 * The guard's BEHAVIOUR is executed in draft_auto_start.pglite.test.ts.
 *
 * THE ORDERING HAZARD this exists for: 20261106000000 (the auto-pick cron) and
 * 20261109000002 both unschedule + re-schedule 'draft_autopick_sweep'. Whichever
 * applies LAST wins. If a re-stamp ever put the overdue-only file after this
 * one, drafts would silently stop auto-starting. So the assertions run on the
 * LATEST migration (by filename, deferred/ excluded) that schedules the job.
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const MIGRATIONS = new URL('../migrations/', import.meta.url);

/** The SQL a file actually executes: line comments stripped. */
const sqlOf = (src: string) => src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

async function schedulers(job = 'draft_autopick_sweep'): Promise<string[]> {
  const hits: string[] = [];
  for await (const e of Deno.readDir(MIGRATIONS)) {
    if (!e.isFile || !e.name.endsWith('.sql')) continue;
    if (new RegExp(`cron\\.schedule\\(\\s*'${job}'`).test(sqlOf(await Deno.readTextFile(new URL(e.name, MIGRATIONS))))) {
      hits.push(e.name);
    }
  }
  return hits.sort();
}

Deno.test('the LATEST draft_autopick_sweep schedule guards on overdue turns, due starts AND the watch', async () => {
  const files = await schedulers();
  assert(files.length > 0, 'no migration schedules draft_autopick_sweep');
  const latest = files[files.length - 1];
  const sql = sqlOf(await Deno.readTextFile(new URL(latest, MIGRATIONS)));
  assert(/where exists\s*\(\s*select 1\s+from public\.overdue_draft_turns\(\)/.test(sql),
    `${latest}: lost the overdue_draft_turns() guard (live drafts would stop auto-picking)`);
  assert(/or exists \(select 1 from public\.due_draft_starts\(\)\)/.test(sql),
    `${latest}: lost the due_draft_starts() guard (drafts would stop auto-starting). ` +
      `Is an overdue-only schedule stamped after 20261109000002?`);
  assert(/or exists \(select 1 from public\.draft_watch_due\(\)\)/.test(sql),
    `${latest}: lost the draft_watch_due() guard (no early warning, no room-open gate: every draft would be postponed)`);
  // The stall throttle from 20261106000000 is kept verbatim.
  assert(/s\.reason\s*<>\s*'vendor_outage'/.test(sql) && /last_seen_at\s*>\s*now\(\)\s*-\s*interval\s*'60 seconds'/.test(sql),
    `${latest}: the draft_stalls throttle is missing`);
});

Deno.test('the auto-start schedule keeps the job contract: name, cadence, vault key, 180000 ms, no key literal', async () => {
  const sql = sqlOf(await Deno.readTextFile(new URL('20261109000002_draft_autopick_sweep_auto_start.sql', MIGRATIONS)));
  assert(/cron\.schedule\(\s*'draft_autopick_sweep'\s*,\s*'10 seconds'/.test(sql), 'wrong job name or cadence');
  assert(sql.includes("vault.decrypted_secrets where name = 'cron_apikey'"), 'the apikey must come from the vault');
  assert(/timeout_milliseconds\s*:=\s*180000\b/.test(sql), 'net.http_post must carry timeout_milliseconds := 180000');
  assert(sql.includes("url     := 'https://haiaaifjcclsvmkfqgmd.supabase.co/functions/v1/draft-autopick-sweep'"), 'wrong URL');
  assertFalse(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|sb_publishable_/.test(sql), 'a key-shaped literal is in the cron command');
  // Only this job: no other cron.schedule / unschedule in the file.
  const jobs = [...sql.matchAll(/cron\.(?:un)?schedule\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert(jobs.every((j) => j === 'draft_autopick_sweep'), `touches other jobs: ${jobs.join(', ')}`);
});

Deno.test('the auto-start schedule is stamped after the auto-pick cron (both present)', async () => {
  const files = await schedulers();
  const autopick = files.find((f) => f.endsWith('_schedule_draft_autopick_sweep.sql'));
  const mine = files.find((f) => f.endsWith('_draft_autopick_sweep_auto_start.sql'));
  assert(autopick, 'the auto-pick cron migration (20261106000000) is missing: auto-start must land after it');
  assert(mine, 'the auto-start reschedule (20261109000002) is missing');
  assert(mine > autopick, `${mine} must sort after ${autopick}`);
});

Deno.test('draft_order_notify is PROMOTED: scheduled once in migrations/, gone from deferred/, guard + 180000 ms + vault', async () => {
  const files = await schedulers('draft_order_notify');
  assertEquals(files, ['20261109000003_schedule_draft_order_notify.sql']);
  const sql = sqlOf(await Deno.readTextFile(new URL(files[0], MIGRATIONS)));
  assert(/cron\.schedule\(\s*'draft_order_notify'\s*,\s*'\* \* \* \* \*'/.test(sql), 'wrong job name or cadence');
  assert(/where public\.draft_order_notify_due\(\) or public\.draft_room_notices_due\(\);/.test(sql),
    'the post must be guarded by draft_order_notify_due() OR draft_room_notices_due() (rooms would never open)');
  assert(/timeout_milliseconds\s*:=\s*180000\b/.test(sql), '180000 ms (the 20261108000000 rule)');
  assert(sql.includes("vault.decrypted_secrets where name = 'cron_apikey'"), 'the apikey must come from the vault');
  assertFalse(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|sb_publishable_/.test(sql), 'a key-shaped literal is in the cron command');
  const held: string[] = [];
  for await (const e of Deno.readDir(new URL('deferred/', MIGRATIONS))) held.push(e.name);
  assertFalse(held.some((n) => n.includes('draft_order_notify')), `deferred/ still holds it: ${held.join(', ')}`);
});
