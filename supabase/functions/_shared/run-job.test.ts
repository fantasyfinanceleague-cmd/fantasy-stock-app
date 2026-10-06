/**
 * runJob: exactly one 'running' and exactly one terminal write per run, whichever
 * way the body ends. A recording writer stands in for the database.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { runJob, type JobRun, type JobStatusWriter } from './run-job.ts';
import type { JobStatusValue } from './job-status.ts';

type W = [JobStatusValue, number, string | undefined, number | undefined];
function recorder(opts: { throwOn?: JobStatusValue } = {}) {
  const writes: W[] = [];
  const write: JobStatusWriter = (status, attempt, message, work) => {
    writes.push([status, attempt, message, work]);
    if (opts.throwOn === status) return Promise.reject(new Error('writer blew up'));
    return Promise.resolve();
  };
  return { writes, write };
}
const ok = <R>(response: R, outcome: JobRun<R>['outcome']): JobRun<R> => ({ outcome, response });
const quiet = async <T>(f: () => Promise<T>): Promise<T> => {
  const e = console.error; console.error = () => {};
  try { return await f(); } finally { console.error = e; }
};

Deno.test('success: running, then exactly one terminal write carrying the outcome', async () => {
  const r = recorder();
  const out = await runJob({
    attempt: 1, write: r.write,
    body: () => Promise.resolve(ok('resp', { status: 'success', attempt: 1, work: 7, message: 'm' })),
    onThrow: () => Promise.reject(new Error('unreachable')),
  });
  assertEquals(out, 'resp');
  assertEquals(r.writes, [['running', 1, undefined, undefined], ['success', 1, 'm', 7]]);
});

Deno.test('a body that returns a failed or retrying outcome writes exactly that', async () => {
  for (const status of ['failed', 'retrying'] as const) {
    const r = recorder();
    await runJob({
      attempt: 2, write: r.write,
      body: () => Promise.resolve(ok(null, { status, attempt: 2, message: 'why' })),
      onThrow: () => Promise.reject(new Error('unreachable')),
    });
    assertEquals(r.writes.map((w) => w[0]), ['running', status]);
  }
});

Deno.test('a throw goes to onThrow, and ITS outcome is the one terminal write', async () => {
  const r = recorder();
  const out = await quiet(() => runJob({
    attempt: 1, write: r.write,
    body: () => Promise.reject(new Error('boom')),
    onThrow: (e) => Promise.resolve(ok('500', { status: 'retrying', attempt: 1, message: String(e) })),
  }));
  assertEquals(out, '500');
  assertEquals(r.writes.map((w) => w[0]), ['running', 'retrying']);
  assert(r.writes[1][2]!.includes('boom'));
});

Deno.test('if onThrow itself throws, a failed row is still written, then the error propagates', async () => {
  const r = recorder();
  await assertRejects(
    () => quiet(() => runJob({
      attempt: 1, write: r.write,
      body: () => Promise.reject(new Error('boom')),
      onThrow: () => Promise.reject(new Error('handler of the failure failed')),
    })),
    Error, 'handler of the failure failed',
  );
  assertEquals(r.writes.map((w) => w[0]), ['running', 'failed']);
});

Deno.test('a writer that throws cannot change the response (telemetry, not control flow)', async () => {
  for (const throwOn of ['running', 'success'] as const) {
    const r = recorder({ throwOn });
    const out = await quiet(() => runJob({
      attempt: 1, write: r.write,
      body: () => Promise.resolve(ok('the response', { status: 'success', attempt: 1, work: 1 })),
      onThrow: () => Promise.reject(new Error('unreachable')),
    }));
    assertEquals(out, 'the response', throwOn);
  }
});

Deno.test('the body runs AFTER running is written and the terminal write lands BEFORE the response returns', async () => {
  const order: string[] = [];
  const write: JobStatusWriter = (s) => { order.push(`write:${s}`); return Promise.resolve(); };
  await runJob({
    attempt: 1, write,
    body: () => { order.push('body'); return Promise.resolve(ok(1, { status: 'success', attempt: 1 })); },
    onThrow: () => Promise.reject(new Error('unreachable')),
  });
  order.push('returned');
  assertEquals(order, ['write:running', 'body', 'write:success', 'returned']);
});
