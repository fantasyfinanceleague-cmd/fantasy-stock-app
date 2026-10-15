/**
 * Onboarding W2 (plan 2026-10-14): Sign in with Apple / Google against the two server pieces every
 * new account passes through, on REAL Postgres (PGlite = Postgres 16 in WASM). NOT hermetic: the
 * first run fetches npm:@electric-sql/pglite. Run instructions: supabase/tests/README.md.
 *
 * LOADED VERBATIM: the user_profiles chain the username suite loads, plus
 *   20260815000000_signup_gate             restrict_new_signups (Before User Created hook)
 *   20261005000001_signup_username_trigger handle_new_user_profile on auth.users
 * Neither function has been redefined since (grep supabase/migrations), so this is prod's body.
 *
 * What it pins:
 *   1. A first Apple / Google sign-in inserts auth.users with the PROVIDER's claims as
 *      raw_user_meta_data (no `username` key). The trigger still creates the profile row, with a
 *      NULL username, which is exactly what puts the app's pick-username gate in front.
 *      An email sign-up without a username (the create-account form lost its field) is the same.
 *   2. GoTrue runs the Before User Created hook on the id_token grant when it is about to CREATE
 *      a user (supabase/auth internal/api/token_oidc.go → triggerBeforeUserCreatedExternal, read
 *      2026-10-14), passing the provider's email as event.user.email. So an OAuth signup meets
 *      the same gate: refused while paused unless that email is allow-listed, with the message
 *      the app's isSignupsPausedError() matches (cross-checked against the client's own code).
 *
 * What it CANNOT prove: that GoTrue calls the hook on this path in prod (that is the dashboard
 * toggle plus GoTrue's code, read above, not tested here), and Apple's "Hide My Email" relay
 * address (a tester who hides their email is refused unless that relay address is allow-listed).
 */
import { assert, assertEquals } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { getAuthErrorMessage, isSignupsPausedError } from '../../apps/mobile/lib/authErrors.ts';

const ROOT = new URL('../../', import.meta.url);
const mig = (f: string) => Deno.readTextFile(new URL(`supabase/migrations/${f}`, ROOT));
const CHAIN = [
  '20251210100000_create_user_profiles.sql',
  '20251230230000_add_avatar_to_profiles.sql',
  '20260122000000_add_push_tokens.sql',
  '20260728000001_gate_user_profiles_to_authenticated.sql',
  '20260815000000_signup_gate.sql',
  '20261005000001_signup_username_trigger.sql',
];

const SCHEMA = `
create role anon; create role authenticated; create role service_role; create role supabase_auth_admin;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create publication supabase_realtime;
`;

// The provider claims GoTrue stores as user metadata (its provider.Claims), as observed shapes.
const APPLE_META = {
  iss: 'https://appleid.apple.com',
  sub: '001234.abcdef.0123',
  email: 'friend@example.com',
  email_verified: true,
  provider_id: '001234.abcdef.0123',
};
const GOOGLE_META = {
  iss: 'https://accounts.google.com',
  sub: '1098765432',
  name: 'Roberto Bianchi',
  full_name: 'Roberto Bianchi',
  given_name: 'roberto_b', // a username-shaped claim must NOT become the username
  picture: 'https://lh3.googleusercontent.com/a/x',
  avatar_url: 'https://lh3.googleusercontent.com/a/x',
  email: 'friend2@example.com',
  email_verified: true,
  provider_id: '1098765432',
};

// deno-lint-ignore no-explicit-any
type Row = any;

/** The event GoTrue builds for an external (OAuth / id_token) signup: SignupParams.ToUserModel. */
function oauthEvent(provider: 'apple' | 'google', email: string, meta: Record<string, unknown>) {
  return {
    metadata: { name: 'before-user-created' },
    user: {
      id: crypto.randomUUID(),
      aud: 'authenticated',
      role: '',
      email,
      app_metadata: { provider, providers: [provider] },
      user_metadata: meta,
      identities: [],
      is_anonymous: false,
    },
  };
}

Deno.test({
  name: 'social signup: profile row + signup gate (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    await db.exec(SCHEMA);
    for (const f of CHAIN) await db.exec(await mig(f));
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];

    const signup = async (email: string, meta: Record<string, unknown> | null) => {
      const id = crypto.randomUUID();
      await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`,
        [id, email, meta ? JSON.stringify(meta) : null]);
      return id;
    };
    const profile = async (id: string) => (await q(`select id, username from user_profiles where id = $1`, [id]))[0];

    await t.step('Apple signup: a profile row, username NULL (the pick-username gate)', async () => {
      const id = await signup(APPLE_META.email, APPLE_META);
      const row = await profile(id);
      assert(row, 'no profile row for an Apple signup');
      assertEquals(row.username, null);
    });

    await t.step('Google signup: a profile row, username NULL even with name claims present', async () => {
      const id = await signup(GOOGLE_META.email, GOOGLE_META);
      const row = await profile(id);
      assert(row, 'no profile row for a Google signup');
      assertEquals(row.username, null);
    });

    await t.step('Apple with Hide My Email (relay address): same row, same NULL', async () => {
      const id = await signup('x7k2q9@privaterelay.appleid.com', { ...APPLE_META, email: 'x7k2q9@privaterelay.appleid.com', is_private_email: true });
      assertEquals((await profile(id))?.username, null);
    });

    await t.step('email signup without a username (the form lost its field): a row, NULL', async () => {
      const id = await signup('mail@example.com', {});
      assertEquals((await profile(id))?.username, null);
      const id2 = await signup('mail2@example.com', null);
      assertEquals((await profile(id2))?.username, null);
    });

    const hook = async (event: unknown) =>
      (await q(`select public.restrict_new_signups($1::jsonb) as r`, [JSON.stringify(event)]))[0].r;

    await t.step('paused: an Apple / Google signup is refused with the text the app matches', async () => {
      await q(`update app_config set signups_paused = true`);
      for (const [provider, email, meta] of [
        ['apple', APPLE_META.email, APPLE_META],
        ['google', GOOGLE_META.email, GOOGLE_META],
      ] as const) {
        const r = await hook(oauthEvent(provider, email, meta));
        assertEquals(r.error?.http_code, 403, provider);
        // The client's own predicate and mapper, run on the server's own words.
        assert(isSignupsPausedError({ message: r.error.message }), `${provider}: isSignupsPausedError missed "${r.error.message}"`);
        assertEquals(
          getAuthErrorMessage({ message: r.error.message }, undefined, 'Stockpile'),
          'Stockpile is not open for new signups yet — check back soon. Existing accounts can still sign in.'
        );
      }
    });

    await t.step('paused + allow-listed provider email: allowed (case-insensitive)', async () => {
      await q(`insert into signup_allowlist (email) values ('friend2@example.com')`);
      assertEquals(await hook(oauthEvent('google', 'Friend2@Example.com', GOOGLE_META)), {});
    });

    await t.step('paused: Hide My Email relay is NOT the allow-listed address, so it is refused', async () => {
      await q(`insert into signup_allowlist (email) values ('friend@example.com')`);
      const r = await hook(oauthEvent('apple', 'x7k2q9@privaterelay.appleid.com', APPLE_META));
      assertEquals(r.error?.http_code, 403);
      assertEquals(await hook(oauthEvent('apple', 'friend@example.com', APPLE_META)), {});
    });

    await t.step('paused: no email at all is refused (fail closed)', async () => {
      const r = await hook(oauthEvent('apple', '', APPLE_META));
      assertEquals(r.error?.http_code, 403);
    });

    await t.step('open: every provider is allowed', async () => {
      await q(`update app_config set signups_paused = false`);
      assertEquals(await hook(oauthEvent('apple', 'x7k2q9@privaterelay.appleid.com', APPLE_META)), {});
      assertEquals(await hook(oauthEvent('google', 'stranger@example.com', GOOGLE_META)), {});
    });

    await db.close();
  },
});
