// Hermetic tests for preview-league's inviter lookup (see ./inviter.ts).
//   deno test supabase/functions/preview-league/inviter.test.ts
import { assertEquals } from 'jsr:@std/assert';
import { cleanUsername, lookupInviter, inviterReader } from './inviter.ts';

const UID = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';

Deno.test('a uuid commissioner with a username -> that username (trimmed)', async () => {
  assertEquals(await lookupInviter(UID, () => Promise.resolve(' Roberto ')), 'Roberto');
});

Deno.test('non-uuid commissioners (bots, junk, injection-shaped text) never reach the read', async () => {
  let reads = 0;
  const read = () => { reads++; return Promise.resolve('x'); };
  for (const id of ['bot-1', 'test-user-2', "' or 1=1 --", '', null, undefined, 7, UID + 'x']) {
    assertEquals(await lookupInviter(id, read), null, String(id));
  }
  assertEquals(reads, 0);
});

Deno.test('a missing profile, a blank name, an oversized name, a failed read: null, never an error', async () => {
  assertEquals(await lookupInviter(UID, () => Promise.resolve(undefined)), null);
  assertEquals(await lookupInviter(UID, () => Promise.resolve('   ')), null);
  assertEquals(await lookupInviter(UID, () => Promise.resolve('x'.repeat(41))), null);
  assertEquals(await lookupInviter(UID, () => Promise.resolve(42)), null);
  assertEquals(await lookupInviter(UID, () => Promise.reject(new Error('boom'))), null);
  assertEquals(cleanUsername('x'.repeat(40)), 'x'.repeat(40));
});

Deno.test('the real reader selects ONE column (username) of ONE row', async () => {
  const calls: string[] = [];
  const admin = {
    from(t: string) {
      calls.push(`from:${t}`);
      return {
        select(c: string) {
          calls.push(`select:${c}`);
          return { eq(col: string, v: string) { calls.push(`eq:${col}=${v}`); return { maybeSingle: () => Promise.resolve({ data: { username: 'Roberto' } }) }; } };
        },
      };
    },
  };
  assertEquals(await inviterReader(admin)(UID), 'Roberto');
  assertEquals(calls, ['from:user_profiles', 'select:username', `eq:id=${UID}`]);
});
