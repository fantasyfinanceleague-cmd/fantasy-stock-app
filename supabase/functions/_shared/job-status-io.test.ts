/**
 * writeJobStatus: read today's row, apply the same-day overwrite rule, upsert.
 * An in-memory cron_job_status stands in for supabase-js. The rule itself is pinned
 * in week-select.test.ts / the snapshot wiring tests; this file pins the I/O layer
 * around it: that it reads before it writes, checks both resolved errors (#5), never
 * throws, and falls back safely when the read fails.
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { writeJobStatus, type JobStatusRwClient } from './job-status-io.ts';
import type { StoredJobStatus } from './job-status.ts';

type Stored = StoredJobStatus;

function store(opts: { readError?: 'resolved' | 'throws'; upsertError?: 'resolved' | 'throws'; updateError?: 'resolved' | 'throws' } = {}) {
  const rows = new Map<string, Stored & Record<string, unknown>>();
  const upserts: Record<string, unknown>[] = [];
  const client: JobStatusRwClient = {
    from: () => ({
      upsert(row) {
        if (opts.upsertError === 'throws') return Promise.reject(new Error('transport'));
        if (opts.upsertError === 'resolved') return Promise.resolve({ error: { message: 'check violation' } });
        upserts.push(row);
        rows.set(`${row.job_name}|${row.run_date}`, row as never);
        return Promise.resolve({ error: null });
      },
      update: (values: Record<string, unknown>) => ({
        eq: (_a: string, job: string) => ({
          eq: (_b: string, date: string) => ({
            eq: (_c: string, want: string) => ({
              select() {
                if (opts.updateError === 'resolved') return Promise.resolve({ data: null, error: { message: 'rls' } });
                if (opts.updateError === 'throws') return Promise.reject(new Error('transport'));
                const cur = rows.get(`${job}|${date}`);
                if (!cur || cur.status !== want) return Promise.resolve({ data: [], error: null });
                rows.set(`${job}|${date}`, { ...cur, ...values } as never);
                return Promise.resolve({ data: [{ status: 'success' }], error: null });
              },
            }),
          }),
        }),
      }),
      select: () => ({
        eq: (_c1: string, job: string) => ({
          eq: (_c2: string, date: string) => ({
            maybeSingle() {
              if (opts.readError === 'throws') return Promise.reject(new Error('transport'));
              if (opts.readError === 'resolved') return Promise.resolve({ data: null, error: { message: 'rls' } });
              return Promise.resolve({ data: (rows.get(`${job}|${date}`) as StoredJobStatus | undefined) ?? null, error: null });
            },
          }),
        }),
      }),
    }),
  };
  return { client, rows, upserts };
}

const NOW = new Date('2026-10-09T21:15:00Z');
const KEY = 'j|2026-10-09';
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const o = [console.log, console.error];
  console.log = console.error = () => {};
  try { return await f(); } finally { [console.log, console.error] = o; }
};

Deno.test('a success is stored as "work=N detail" so a later no-op can recognise it as evidence', async () => {
  const s = store();
  assertEquals(await writeJobStatus(s.client, 'j', 'success', 1, { message: 'processed 5', work: 5 }, NOW), 'written');
  assertEquals(s.rows.get(KEY)!.error_message, 'work=5 processed 5');
});

Deno.test('success with no work given is stored as work=0 (a no-op), not as NULL', async () => {
  const s = store();
  await writeJobStatus(s.client, 'j', 'success', 1, {}, NOW);
  assertEquals(s.rows.get(KEY)!.error_message, 'work=0');
});

Deno.test('the heal sequence: 21:15 work=5, then 22:00 running + no-op → the row still says work=5', async () => {
  const s = store();
  await writeJobStatus(s.client, 'j', 'running', 1, {}, NOW);
  await writeJobStatus(s.client, 'j', 'success', 1, { message: 'processed 5', work: 5 }, NOW);
  assertEquals(await writeJobStatus(s.client, 'j', 'running', 1, {}, NOW), 'kept');
  assertEquals(await writeJobStatus(s.client, 'j', 'success', 1, { message: 'no pending', work: 0 }, NOW), 'kept');
  assertEquals(s.rows.get(KEY)!.error_message, 'work=5 processed 5');
});

Deno.test('a failure is always written, and a later no-op does not clear it', async () => {
  const s = store();
  await writeJobStatus(s.client, 'j', 'success', 1, { message: 'ok', work: 5 }, NOW);
  assertEquals(await writeJobStatus(s.client, 'j', 'failed', 1, { message: 'boom' }, NOW), 'written');
  assertEquals(await writeJobStatus(s.client, 'j', 'success', 1, { work: 0 }, NOW), 'kept');
  assertEquals(s.rows.get(KEY)!.status, 'failed');
});

Deno.test('a clean success clears a scheduled-retry marker (S3), whatever its work count', async () => {
  const s = store();
  await writeJobStatus(s.client, 'j', 'retrying', 1, { message: 'again' }, NOW);
  assertEquals(await writeJobStatus(s.client, 'j', 'success', 2, { work: 0 }, NOW), 'written');
  assertEquals(s.rows.get(KEY)!.status, 'success');
});

Deno.test('a failed READ never lets a no-op overwrite evidence, but real outcomes still land', async () => {
  for (const readError of ['resolved', 'throws'] as const) {
    const s = store({ readError });
    s.rows.set(KEY, { status: 'success', error_message: 'work=5' });
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'running', 1, {}, NOW)), 'kept', readError);
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { work: 0 }, NOW)), 'kept', readError);
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { work: 3 }, NOW)), 'written', readError);
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'failed', 1, { message: 'x' }, NOW)), 'written', readError);
  }
});

Deno.test('a resolved upsert error is reported, not swallowed (#5), and never throws', async () => {
  const s = store({ upsertError: 'resolved' });
  assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'failed', 1, { message: 'x' }, NOW)), 'error');
});

Deno.test('a transport throw on the upsert is caught and reported', async () => {
  const s = store({ upsertError: 'throws' });
  assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'failed', 1, { message: 'x' }, NOW)), 'error');
});

Deno.test('the row shape is the table\'s: job_name, run_date, status, attempt_number, error_message, updated_at', async () => {
  const s = store();
  await writeJobStatus(s.client, 'j', 'failed', 2, { message: 'm' }, NOW);
  assertEquals(s.upserts[0], {
    job_name: 'j', run_date: '2026-10-09', status: 'failed', attempt_number: 2,
    error_message: 'm', updated_at: NOW.toISOString(),
  });
  assert(true);
});

Deno.test('M3: a failed read + a no-op success SETTLES a running row (never strands it)', async () => {
  for (const readError of ['resolved', 'throws'] as const) {
    const s = store({ readError });
    s.rows.set(KEY, { status: 'running', error_message: null });
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { message: 'nothing', work: 0 }, NOW)), 'written', readError);
    assertEquals(s.rows.get(KEY)!.status, 'success');
    assertEquals(s.rows.get(KEY)!.error_message, 'work=0 nothing');
  }
});

Deno.test('M3: the settle can only replace a running row: success evidence and failures are untouched', async () => {
  for (const existing of [{ status: 'success', error_message: 'work=5' }, { status: 'failed', error_message: 'boom' }] as const) {
    const s = store({ readError: 'resolved' });
    s.rows.set(KEY, { ...existing });
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { work: 0 }, NOW)), 'kept');
    assertEquals(s.rows.get(KEY), { ...existing });
  }
});

Deno.test('M3: no row at all + failed read + no-op: nothing is invented', async () => {
  const s = store({ readError: 'resolved' });
  assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { work: 0 }, NOW)), 'kept');
  assertEquals(s.rows.size, 0);
});

Deno.test('M3: a failing or throwing settle is reported, not thrown', async () => {
  for (const updateError of ['resolved', 'throws'] as const) {
    const s = store({ readError: 'resolved', updateError });
    s.rows.set(KEY, { status: 'running', error_message: null });
    assertEquals(await quiet(() => writeJobStatus(s.client, 'j', 'success', 1, { work: 0 }, NOW)), 'error', updateError);
  }
});
