import { describe, expect, it, vi } from 'vitest';
import { fetchInvitePreview, parseInvitePreview } from './invitePreview';

describe('parseInvitePreview (W3\'s contract)', () => {
  it.each([
    [{ found: true, name: 'Stock Scudetto', inviter: 'roberto_b', reason: null }, { kind: 'found', name: 'Stock Scudetto', inviter: 'roberto_b', block: null }],
    [{ found: true, name: 'Stock Scudetto', inviter: null, reason: null }, { kind: 'found', name: 'Stock Scudetto', inviter: null, block: null }],
    [{ found: true, name: ' Stock Scudetto ', inviter: '  ', reason: 'league_full' }, { kind: 'found', name: 'Stock Scudetto', inviter: null, block: 'league_full' }],
    [{ found: true, name: 'X', inviter: null, reason: 'draft_started' }, { kind: 'found', name: 'X', inviter: null, block: 'draft_started' }],
    [{ found: true, name: 'X', inviter: null, reason: 'season_completed' }, { kind: 'found', name: 'X', inviter: null, block: 'season_completed' }],
    // a reason from a newer server is a refusal we have no line for: never "joinable"
    [{ found: true, name: 'X', inviter: null, reason: 'brand_new_reason' }, { kind: 'found', name: 'X', inviter: null, block: 'unknown' }],
    [{ found: false }, { kind: 'not_found' }],
  ])('200 %j', (body, want) => {
    expect(parseInvitePreview(200, body)).toEqual(want);
  });

  it.each([
    [200, { found: true }],
    [200, { found: true, name: '', inviter: null, reason: null }],
    [200, { found: true, name: 42 }],
    [200, { found: 'true', name: 'X' }],
    [200, {}],
    [200, []],
    [200, null],
    [200, 'found'],
    [429, { error: 'rate_limited' }],
    [500, { error: 'unavailable' }],
    [401, { found: true, name: 'X', inviter: null, reason: null }],
    [404, { found: false }],
  ])('%s %j is unknown', (status, body) => {
    expect(parseInvitePreview(status, body)).toEqual({ kind: 'unknown' });
  });
});

describe('fetchInvitePreview', () => {
  const ok = (body: unknown, status = 200) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

  it('POSTs the code in the body (never the URL), with the publishable key, no credentials, no referrer', async () => {
    const fetchImpl = ok({ found: false });
    await fetchInvitePreview('ABCDE23456', { fetchImpl, url: 'https://x.supabase.co/functions/v1/invite-preview', key: 'sb_publishable_k' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x.supabase.co/functions/v1/invite-preview');
    expect(url).not.toContain('ABCDE23456');
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect(init.body).toBe('{"code":"ABCDE23456"}');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', apikey: 'sb_publishable_k' });
  });

  it('is unknown, and makes no request, when no endpoint is configured', async () => {
    const fetchImpl = ok({ found: true, name: 'X', inviter: null, reason: null });
    expect(await fetchInvitePreview('ABCDE23456', { fetchImpl, url: null })).toEqual({ kind: 'unknown' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never throws: a network error, an unparseable body and a timeout are all unknown', async () => {
    const url = 'https://x.invalid/f';
    expect(await fetchInvitePreview('ABCDE23456', { url, fetchImpl: vi.fn().mockRejectedValue(new TypeError('x')) })).toEqual({ kind: 'unknown' });
    expect(await fetchInvitePreview('ABCDE23456', { url, fetchImpl: vi.fn().mockResolvedValue(new Response('<html>')) })).toEqual({ kind: 'unknown' });
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    expect(await fetchInvitePreview('ABCDE23456', { url, fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 })).toEqual({ kind: 'unknown' });
  });

  it('a caller abort ends the request', async () => {
    const controller = new AbortController();
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    const pending = fetchInvitePreview('ABCDE23456', { url: 'https://x.invalid/f', fetchImpl: hang as unknown as typeof fetch, signal: controller.signal, timeoutMs: 60_000 });
    controller.abort();
    expect(await pending).toEqual({ kind: 'unknown' });
  });
});
