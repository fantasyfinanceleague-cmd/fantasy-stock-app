import { assertEquals } from 'jsr:@std/assert';
import { capSymbolList, checkRateLimits, combineVerdicts, readLimitResult } from './market-guard.ts';

Deno.test('readLimitResult: ONLY an explicit true admits (fail closed)', () => {
  assertEquals(readLimitResult({ data: true }), 'ok');
  assertEquals(readLimitResult({ data: false }), 'limited');
  // The preview-league shape (`data !== false` => ok) would admit all of these:
  assertEquals(readLimitResult({ data: null }), 'unavailable');
  assertEquals(readLimitResult({ data: undefined }), 'unavailable');
  assertEquals(readLimitResult({ data: 'true' }), 'unavailable');
  assertEquals(readLimitResult({ data: true, error: { message: 'x' } }), 'unavailable');
  assertEquals(readLimitResult({ error: { code: '42501' } }), 'unavailable');
  assertEquals(readLimitResult(null), 'unavailable');
});

Deno.test('combineVerdicts: worst wins; no verdicts is not a pass', () => {
  assertEquals(combineVerdicts(['ok', 'ok']), 'ok');
  assertEquals(combineVerdicts(['ok', 'limited']), 'limited');
  assertEquals(combineVerdicts(['limited', 'unavailable']), 'unavailable');
  assertEquals(combineVerdicts([]), 'unavailable');
});

Deno.test('checkRateLimits: a resolved error, a throw, and a mix all fail closed', async () => {
  const admin = (rows: unknown[]) => {
    let i = 0;
    return { rpc: () => { const r = rows[i++]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); } };
  };
  assertEquals(await checkRateLimits(admin([{ data: true }]), 'b', [{ subject: 'user:a', limit: 1 }]), 'ok');
  assertEquals(await checkRateLimits(admin([{ data: false }]), 'b', [{ subject: 'user:a', limit: 1 }]), 'limited');
  assertEquals(await checkRateLimits(admin([{ data: null, error: { message: 'down' } }]), 'b', [{ subject: 'u', limit: 1 }]), 'unavailable');
  assertEquals(await checkRateLimits(admin([new Error('net')]), 'b', [{ subject: 'u', limit: 1 }]), 'unavailable');
  assertEquals(
    await checkRateLimits(admin([{ data: true }, { data: false }]), 'b', [{ subject: 'u', limit: 1 }, { subject: 'ip', limit: 1 }]),
    'limited',
  );
});

Deno.test('capSymbolList: normalise, dedupe in order, cap, and REPORT the overflow', () => {
  assertEquals(capSymbolList([' aapl', 'AAPL', 'msft', '', null, 'nvda'], 2), { symbols: ['AAPL', 'MSFT'], truncated: ['NVDA'] });
  assertEquals(capSymbolList([], 5), { symbols: [], truncated: [] });
});
