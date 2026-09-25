/**
 * Unit tests for the cron_job_status writer (see ./job-status.ts).
 *
 * The centerpiece is the RESOLVED-ERROR test: supabase-js resolves an upsert
 * rejected by Postgres to { error } rather than throwing, and the previous
 * writer (reconstructed below as `legacyUpdateJobStatus`) awaited it and
 * discarded the result. The same stub is run through both: the legacy writer
 * cannot tell the write failed; the new one reports false.
 *
 * Also pinned: the writer never throws (a status write must not change the
 * handler's HTTP response), and both success summaries are non-empty so the
 * message column is never a NULL-vs-text discriminator.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import {
  updateJobStatus,
  noPendingMessage,
  scoredMessage,
  type JobStatusClient,
} from './job-status.ts';

// ---------------------------------------------------------------------------
// Stub client
// ---------------------------------------------------------------------------

type Behaviour =
  | { kind: 'ok' }
  | { kind: 'resolved-error'; message: string }
  | { kind: 'throws'; message: string };

interface Call {
  table: string;
  row: Record<string, unknown>;
  opts: { onConflict: string };
}

function stubClient(behaviour: Behaviour): { client: JobStatusClient; calls: Call[] } {
  const calls: Call[] = [];
  const client: JobStatusClient = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, opts: { onConflict: string }) {
          calls.push({ table, row, opts });
          if (behaviour.kind === 'throws') {
            return Promise.reject(new Error(behaviour.message));
          }
          if (behaviour.kind === 'resolved-error') {
            return Promise.resolve({ error: { message: behaviour.message } });
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, calls };
}

// Silence the writer's console.error during the failure-path tests while still
// letting a test assert that it logged.
async function withCapturedErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: unknown[][] }> {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    return { result: await fn(), logged };
  } finally {
    console.error = original;
  }
}

// Reconstruction of the pre-fix writer from index.ts: awaits the upsert,
// discards the resolved value, only catches throws. Returns nothing.
async function legacyUpdateJobStatus(supabase: JobStatusClient, status: string): Promise<void> {
  try {
    await supabase.from('cron_job_status').upsert(
      { job_name: 'process-week-results', status },
      { onConflict: 'job_name,run_date' },
    );
  } catch (e) {
    console.error('Failed to update job status:', e);
  }
}

const NOW = new Date('2026-09-25T21:15:00.000Z');

// ---------------------------------------------------------------------------
// Happy path + row shape
// ---------------------------------------------------------------------------

Deno.test('successful write returns true and upserts the expected row', async () => {
  const { client, calls } = stubClient({ kind: 'ok' });

  const ok = await updateJobStatus(client, 'process-week-results', 'success', 1, 'summary', NOW);

  assertEquals(ok, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, 'cron_job_status');
  assertEquals(calls[0].opts, { onConflict: 'job_name,run_date' });
  assertEquals(calls[0].row, {
    job_name: 'process-week-results',
    run_date: '2026-09-25',
    status: 'success',
    attempt_number: 1,
    error_message: 'summary',
    updated_at: '2026-09-25T21:15:00.000Z',
  });
});

Deno.test("'running' with no message writes error_message NULL", async () => {
  const { client, calls } = stubClient({ kind: 'ok' });

  await updateJobStatus(client, 'process-week-results', 'running', 1, undefined, NOW);

  assertEquals(calls[0].row.error_message, null);
});

// ---------------------------------------------------------------------------
// Failure paths — never throw, report false
// ---------------------------------------------------------------------------

Deno.test('DISCRIMINATOR: resolved { error } is reported by the new writer, invisible to the legacy one', async () => {
  // e.g. a status outside the CHECK constraint, or RLS rejecting the write.
  const behaviour: Behaviour = { kind: 'resolved-error', message: 'violates check constraint' };

  const legacy = stubClient(behaviour);
  const { logged: legacyLogged } = await withCapturedErrors(() =>
    legacyUpdateJobStatus(legacy.client, 'success')
  );
  assertEquals(legacy.calls.length, 1, 'legacy writer did attempt the write');
  assertEquals(legacyLogged.length, 0, 'legacy writer is silent: the failure is invisible');

  const current = stubClient(behaviour);
  const { result, logged } = await withCapturedErrors(() =>
    updateJobStatus(current.client, 'process-week-results', 'success', 1, 'summary', NOW)
  );
  assertEquals(result, false, 'new writer reports the rejected write');
  assertEquals(logged.length, 1, 'and logs it');
});

Deno.test('transport throw is caught: returns false, does not propagate', async () => {
  const { client } = stubClient({ kind: 'throws', message: 'fetch failed' });

  const { result, logged } = await withCapturedErrors(() =>
    updateJobStatus(client, 'process-week-results', 'failed', 1, 'boom', NOW)
  );

  assertEquals(result, false);
  assertEquals(logged.length, 1);
});

Deno.test('a failed terminal write cannot change control flow: caller still reaches its return', async () => {
  // Models the handler's no-pending path: write status, then return the 200.
  // If updateJobStatus threw, the handler's catch would turn this into a 500.
  for (const behaviour of [
    { kind: 'resolved-error', message: 'x' },
    { kind: 'throws', message: 'y' },
  ] as Behaviour[]) {
    const { client } = stubClient(behaviour);
    const { result: status } = await withCapturedErrors(async () => {
      await updateJobStatus(client, 'process-week-results', 'success', 1, noPendingMessage(), NOW);
      return 200;
    });
    assertEquals(status, 200, `behaviour ${behaviour.kind}`);
  }
});

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

Deno.test('both success summaries are non-empty and distinguishable', () => {
  const none = noPendingMessage();
  const scored = scoredMessage(0, 0);

  // Non-empty: `message || null` would otherwise write NULL and make the
  // column's presence a discriminator between the two success paths.
  assert(none.length > 0);
  assert(scored.length > 0);
  assert(none !== scored, 'nothing-to-do must read differently from a run that reached scoring');
  assert(none.includes('no pending matchups'));
});

Deno.test('scoredMessage surfaces refused batches/matchups', () => {
  const msg = scoredMessage(4, 2);
  assert(msg.includes('processed 4 matchups'));
  assert(msg.includes('2 refused'));
});
