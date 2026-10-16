import { describe, expect, it, vi } from 'vitest';
import { createJwtRetryFetch, isLegacyAuthReturn, LEGACY_AUTH_RETURN_PATH } from './legacyClientGuards';

const BASE = 'https://proj.supabase.co';

const url = (path) => new URL(path, 'https://app.example');

describe('isLegacyAuthReturn (the old client\'s detectSessionInUrl)', () => {
  it('returns at the site root, where the old app\'s sign-ins land', () => {
    expect(LEGACY_AUTH_RETURN_PATH).toBe('/');
    expect(isLegacyAuthReturn(url('/'), { access_token: 'a', refresh_token: 'r' })).toBe(true);
    expect(isLegacyAuthReturn(url('/'), { error: 'access_denied' })).toBe(true);
    expect(isLegacyAuthReturn(url('/'), { error_description: 'expired' })).toBe(true);
    expect(isLegacyAuthReturn(url('/'), { error_code: 'otp_expired' })).toBe(true);
  });

  it('ignores the root with no auth params', () => {
    expect(isLegacyAuthReturn(url('/'), {})).toBe(false);
    expect(isLegacyAuthReturn(url('/'), { code: 'pkce-code' })).toBe(false);
  });

  it.each([
    '/join/ABC123',
    '/auth/confirm',
    '/auth/web-callback',
    '/dashboard',
    '/login',
  ])('never takes tokens or errors from %s', (path) => {
    expect(isLegacyAuthReturn(url(path), { access_token: 'a', refresh_token: 'r' })).toBe(false);
    expect(isLegacyAuthReturn(url(path), { error: 'x', error_description: 'y', error_code: 'z' })).toBe(false);
  });
});

const jwtExpired = () =>
  new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401 });
const ok = (body = '[]') => new Response(body, { status: 200 });

function setup({ responses, refresh }) {
  const baseFetch = vi.fn(async () => responses.shift());
  const refreshSession = vi.fn(refresh ?? (async () => ({ data: { session: { access_token: 'NEW' } }, error: null })));
  const f = createJwtRetryFetch({ supabaseUrl: BASE, refreshSession, baseFetch });
  return { f, baseFetch, refreshSession };
}

describe('createJwtRetryFetch', () => {
  it('passes a normal response straight through', async () => {
    const { f, baseFetch, refreshSession } = setup({ responses: [ok()] });
    const res = await f(`${BASE}/rest/v1/leagues`, { headers: { Authorization: 'Bearer OLD' } });
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes once and retries a data request with the new token', async () => {
    const { f, baseFetch, refreshSession } = setup({ responses: [jwtExpired(), ok('[1]')] });
    const res = await f(`${BASE}/rest/v1/leagues`, { method: 'GET', headers: { Authorization: 'Bearer OLD', apikey: 'k' } });
    expect(await res.text()).toBe('[1]');
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    const retryInit = baseFetch.mock.calls[1][1];
    expect(retryInit.method).toBe('GET');
    expect(retryInit.headers.get('Authorization')).toBe('Bearer NEW');
    expect(retryInit.headers.get('apikey')).toBe('k');
  });

  it('shares one refresh between concurrent expired requests', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const { f, refreshSession } = setup({
      responses: [jwtExpired(), jwtExpired(), ok(), ok()],
      refresh: async () => { await gate; return { data: { session: { access_token: 'NEW' } }, error: null }; },
    });
    const both = Promise.all([f(`${BASE}/rest/v1/a`, {}), f(`${BASE}/functions/v1/b`, {})]);
    await new Promise((r) => setTimeout(r, 0));
    release();
    const [a, b] = await both;
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(refreshSession).toHaveBeenCalledTimes(1);
  });

  it('never retries an auth request (the refresh itself goes through this fetch)', async () => {
    const { f, baseFetch, refreshSession } = setup({ responses: [jwtExpired()] });
    const res = await f(`${BASE}/auth/v1/token?grant_type=refresh_token`, {});
    expect(res.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it.each([
    'https://evil.example/?next=https://proj.supabase.co/rest/v1/x',
    'https://proj.supabase.co.evil.example/rest/v1/x',
    'https://other.supabase.co/rest/v1/x',
  ])('never attaches its session to a request for another host: %s', async (href) => {
    const { f, baseFetch, refreshSession } = setup({ responses: [jwtExpired()] });
    const res = await f(href, {});
    expect(res.status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('leaves a 401 that is not an expired JWT alone', async () => {
    const { f, baseFetch, refreshSession } = setup({
      responses: [new Response('{"message":"permission denied"}', { status: 401 })],
    });
    expect((await f(`${BASE}/rest/v1/x`, {})).status).toBe(401);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('returns the original 401 when the refresh fails or throws', async () => {
    const failed = setup({
      responses: [jwtExpired()],
      refresh: async () => ({ data: { session: null }, error: new Error('refresh_token_not_found') }),
    });
    expect((await failed.f(`${BASE}/rest/v1/x`, {})).status).toBe(401);
    expect(failed.baseFetch).toHaveBeenCalledTimes(1);

    const threw = setup({ responses: [jwtExpired()], refresh: async () => { throw new Error('offline'); } });
    expect((await threw.f(`${BASE}/rest/v1/x`, {})).status).toBe(401);
    expect(threw.baseFetch).toHaveBeenCalledTimes(1);
  });
});
