// Effect tests on the REAL old client module (not a mock of supabase-js):
// importing it must leave window.fetch alone, its own requests must still go
// through the JWT-expired retry, and it must read a session from the URL only
// at the old app's own sign-in return.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SUPABASE_URL = 'https://proj.supabase.co';

let calls;

function fakeFetch() {
  calls = [];
  return vi.fn(async (input, init) => {
    const href = typeof input === 'string' ? input : input.url ?? String(input);
    calls.push({ href, init });
    if (href.includes('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'u1', aud: 'authenticated', email: 'a@b.c' }), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  });
}

async function loadClientAt(path) {
  window.history.replaceState(null, '', path);
  vi.resetModules();
  const mod = await import('./supabaseClient');
  const init = await mod.supabase.auth.initialize();
  return { ...mod, init };
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  vi.stubGlobal('fetch', fakeFetch());
  window.localStorage.clear();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.history.replaceState(null, '', '/');
});

describe('old web Supabase client: fetch scope', () => {
  it('does not replace window.fetch when imported', async () => {
    const before = globalThis.fetch;
    await loadClientAt('/');
    expect(globalThis.fetch).toBe(before);
    expect(window.fetch).toBe(before);
  });

  it('still routes its own requests through the JWT-expired retry', async () => {
    const { supabase } = await loadClientAt('/');
    let first = true;
    globalThis.fetch.mockImplementation(async (input, init) => {
      calls.push({ href: String(input), init });
      if (String(input).includes('/auth/v1/token')) {
        return new Response(JSON.stringify({
          access_token: 'NEW', refresh_token: 'r2', token_type: 'bearer', expires_in: 3600,
          user: { id: 'u1', aud: 'authenticated' },
        }), { status: 200 });
      }
      if (first) {
        first = false;
        return new Response('{"code":"PGRST301","message":"JWT expired"}', { status: 401 });
      }
      return new Response('[{"id":1}]', { status: 200 });
    });
    // A stored session so refreshSession has a refresh token to spend.
    window.localStorage.setItem('fantasy-finance-auth', JSON.stringify({
      access_token: 'OLD', refresh_token: 'r1', token_type: 'bearer',
      expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u1', aud: 'authenticated' },
    }));

    const { data, error } = await supabase.from('leagues').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([{ id: 1 }]);
    const rest = calls.filter((c) => c.href.includes('/rest/v1/leagues'));
    expect(rest).toHaveLength(2);
    expect(new Headers(rest[1].init.headers).get('Authorization')).toBe('Bearer NEW');
  });

  it('leaves other code\'s requests to Supabase untouched (no session, no retry)', async () => {
    await loadClientAt('/');
    globalThis.fetch.mockImplementation(async () =>
      new Response('{"message":"JWT expired"}', { status: 401 }));
    // e.g. the onboarding client's own request, made with its own fetch.
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_invite_preview`, {
      method: 'POST',
      headers: { apikey: 'sb_publishable_test' },
    });
    expect(res.status).toBe(401);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('old web Supabase client: URL session detection', () => {
  const tokens = '#access_token=AT&refresh_token=RT&expires_in=3600&token_type=bearer&type=signup';

  it('signs in from its own return at the site root', async () => {
    const { supabase } = await loadClientAt(`/${tokens}`);
    expect(calls.some((c) => c.href.includes('/auth/v1/user'))).toBe(true);
    const { data } = await supabase.auth.getSession();
    expect(data.session?.access_token).toBe('AT');
    expect(window.location.hash).toBe('');
  });

  it.each([
    '/join/ABC123',
    '/auth/confirm',
    '/auth/web-callback',
  ])('ignores tokens in the URL on %s', async (path) => {
    const { supabase } = await loadClientAt(`${path}${tokens}`);
    expect(calls.some((c) => c.href.includes('/auth/v1/'))).toBe(false);
    const { data } = await supabase.auth.getSession();
    expect(data.session).toBeNull();
    expect(window.location.hash).toBe(tokens);
  });

  it('ignores an auth error in the query on /auth/web-callback', async () => {
    const path = '/auth/web-callback?error=access_denied&error_code=otp_expired&error_description=expired';
    const { init } = await loadClientAt(path);
    // The old client claimed this as a failed sign-in of its own.
    expect(init.error).toBeNull();
    expect(calls).toHaveLength(0);
    expect(window.location.pathname + window.location.search).toBe(path);
  });
});
