/**
 * Structural guard for the promoted auto-pick cron (20261106000000) and the
 * cron-log purge (20261106000001). The cron itself cannot run in PGlite (no
 * pg_cron / pg_net / vault), so the things a header comment cannot enforce are
 * read as TEXT here. Reads files only, no network or DB:
 *   deno test --allow-read supabase/tests/autopick_cron_wiring.test.ts
 *
 * The WHERE predicate's behaviour is executed for real in
 * autopick_cron_predicate.pglite.test.ts.
 */
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert';

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const CRON = new URL('20261106000000_schedule_draft_autopick_sweep.sql', MIGRATIONS);
const PURGE = new URL('20261106000001_purge_cron_run_details.sql', MIGRATIONS);
const SKIP = new URL('20261106000002_drafts_refuse_new_skip.sql', MIGRATIONS);
const DRAFT_WRITE = new URL('../functions/_shared/draft-write.ts', import.meta.url);
const DEFERRED = new URL('deferred/', MIGRATIONS);

/** The SQL a file actually executes: line comments stripped, so a header that
 * merely MENTIONS a token cannot satisfy (or trip) an assertion about the code. */
const sqlOf = (src: string) => src.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

Deno.test('cron: schedule, cadence, vault key, explicit 180000 ms timeout, overdue guard', async () => {
  const sql = sqlOf(await Deno.readTextFile(CRON));
  assert(/cron\.schedule\(\s*'draft_autopick_sweep'\s*,\s*'10 seconds'/.test(sql), 'wrong job name or cadence');
  assert(sql.includes("vault.decrypted_secrets where name = 'cron_apikey'"), 'the apikey must come from the vault');
  assert(/timeout_milliseconds\s*:=\s*180000\b/.test(sql), 'net.http_post must carry timeout_milliseconds := 180000');
  assert(/where exists\s*\(\s*select 1\s+from public\.overdue_draft_turns\(\)/.test(sql),
    'the post must be guarded by overdue_draft_turns() (an idle tick must make no edge call)');
  assertFalse(/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|sb_publishable_/.test(sql), 'a key-shaped literal is in the cron command');
});

Deno.test('cron: the stall throttle window equals the function cooldown, and never throttles vendor_outage', async () => {
  const sql = sqlOf(await Deno.readTextFile(CRON));
  const win = sql.match(/last_seen_at\s*>\s*now\(\)\s*-\s*interval\s*'(\d+)\s*seconds'/);
  assert(win, 'the cron has no stall throttle on draft_stalls.last_seen_at');
  const src = await Deno.readTextFile(DRAFT_WRITE);
  const cooldown = src.match(/export const STALL_COOLDOWN_MS\s*=\s*([\d_]+)/);
  assert(cooldown, 'STALL_COOLDOWN_MS moved: update this guard and the cron together');
  assertEquals(Number(win[1]) * 1000, Number(cooldown[1].replaceAll('_', '')),
    'the cron throttle window and recentStall cooldown must be the same number');
  // recentStall exempts vendor_outage from the cooldown; the cron must mirror it.
  assert(/data\.reason === 'vendor_outage'/.test(src), 'recentStall no longer exempts vendor_outage');
  assert(/s\.reason\s*<>\s*'vendor_outage'/.test(sql), 'the cron throttles vendor_outage stalls, which the function retries every tick');
});

Deno.test("the throttle's re-arm property: recordStall's repeat path rewrites last_seen_at", async () => {
  const src = await Deno.readTextFile(DRAFT_WRITE);
  assert(/\.update\(\{ attempts, reason: why, last_seen_at: new Date\(\)\.toISOString\(\) \}\)/.test(src),
    'recordStall no longer refreshes last_seen_at on a repeat stall: the cron throttle would never re-arm');
});

Deno.test('purge: plain SQL (no HTTP), deletes by coalesce(end_time, start_time), 7 days, daily', async () => {
  const sql = sqlOf(await Deno.readTextFile(PURGE));
  assertFalse(/net\.http_post/.test(sql), 'the purge must be plain SQL, not an HTTP post');
  assert(/cron\.schedule\(\s*'purge_cron_run_details'\s*,\s*'17 4 \* \* \*'/.test(sql), 'wrong job name or schedule');
  assert(/delete from cron\.job_run_details where coalesce\(end_time, start_time\) < now\(\) - interval '7 days'/.test(sql),
    'must delete only runs older than 7 days (an unfinished run included)');
});

Deno.test('SKIP trigger is promoted out of deferred/, and neither old stamp is left behind', async () => {
  const sql = sqlOf(await Deno.readTextFile(SKIP));
  assert(/create trigger drafts_refuse_new_skip\s+before insert or update of symbol on public\.drafts/.test(sql));
  const held: string[] = [];
  for await (const e of Deno.readDir(DEFERRED)) held.push(e.name);
  assertFalse(held.some((n) => n.includes('autopick_sweep') || n.includes('refuse_new_skip')),
    `deferred/ still holds a promoted file: ${held.join(', ')}`);
});

Deno.test('the three files are stamped later than prod\'s latest applied migration, in order', () => {
  const names = [CRON, PURGE, SKIP].map((u) => u.pathname.split('/').pop()!.slice(0, 14));
  assertEquals(names, ['20261106000000', '20261106000001', '20261106000002']);
  // 20261103000000 is the latest applied (STATUS.md); 20261104 and 20261105 are reserved.
  assert(names.every((n) => n > '20261103000000'));
});
