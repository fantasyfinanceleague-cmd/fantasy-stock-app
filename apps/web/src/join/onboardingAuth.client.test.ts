// @vitest-environment node
//
// The onboarding client's OPTIONS are the second line of defence for the URL scrub in index.html: if the scrub
// ever failed (CSP drift, a new path), a client that read the URL would auto-exchange a code it should never
// see. So its construction is pinned here, as the product of reading its options at the moment it is created.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const created: { url: string; key: string; options: Record<string, unknown> }[] = [];

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn((url: string, key: string, options: Record<string, unknown>) => {
    created.push({ url, key, options });
    return { fake: true };
  }),
}));

async function freshModule() {
  vi.resetModules();
  return import('./onboardingAuth');
}

beforeEach(() => {
  created.length = 0;
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.invalid');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
});
afterEach(() => vi.unstubAllEnvs());

describe('the onboarding Supabase client', () => {
  it('is created LAZILY: merely importing the module (the join chunk loading) creates nothing', async () => {
    await freshModule();
    expect(created).toHaveLength(0);
  });

  it('reads NO URL (detectSessionInUrl false), uses PKCE, and persists to localStorage-backed storage', async () => {
    const { onboardingClient } = await freshModule();
    onboardingClient();
    expect(created).toHaveLength(1);
    const auth = created[0].options.auth as Record<string, unknown>;
    expect(auth.detectSessionInUrl).toBe(false); // never auto-exchange a code it finds in a URL
    expect(auth.flowType).toBe('pkce'); // the code verifier lives in this browser
    expect(auth.persistSession).toBe(true); // the confirmation link opens a NEW tab: the verifier must be in shared storage
    expect(auth.autoRefreshToken).toBe(true);
    expect(auth.storageKey).toBe('stockpile-onboarding-auth');
  });

  it('sets exactly these auth options and nothing else (no custom storage, no fetch patch, no extra top-level option)', async () => {
    const { onboardingClient } = await freshModule();
    onboardingClient();
    expect(Object.keys(created[0].options)).toEqual(['auth']);
    expect(Object.keys(created[0].options.auth as object).sort()).toEqual(
      ['autoRefreshToken', 'detectSessionInUrl', 'flowType', 'persistSession', 'storageKey'],
    );
  });

  it('uses the project URL and the PUBLISHABLE key', async () => {
    const { onboardingClient } = await freshModule();
    onboardingClient();
    expect(created[0].url).toBe('https://test.invalid');
    expect(created[0].key).toBe('sb_publishable_test');
  });

  it('is a singleton: two calls, one client', async () => {
    const { onboardingClient } = await freshModule();
    expect(onboardingClient()).toBe(onboardingClient());
    expect(created).toHaveLength(1);
  });

  it('has its OWN storage key, distinct from the paused app\'s client (two clients on one key revoke each other by refresh-token reuse)', async () => {
    const { ONBOARDING_STORAGE_KEY } = await freshModule();
    const legacy = readFileSync(resolve(process.cwd(), 'src/supabase/supabaseClient.js'), 'utf-8');
    const legacyKey = /storageKey:\s*'([^']+)'/.exec(legacy)?.[1];
    expect(legacyKey).toBeTruthy();
    expect(ONBOARDING_STORAGE_KEY).not.toBe(legacyKey);
  });

  it('is null (and creates nothing) when this build has no Supabase configuration', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    const { onboardingClient } = await freshModule();
    expect(onboardingClient()).toBeNull();
    expect(created).toHaveLength(0);
  });
});
